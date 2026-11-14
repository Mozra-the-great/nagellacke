import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { stripImageMetadata } from './imageMeta';
import { stripStoredPhotos } from './photoMigration';
import { JPEG_WITH_METADATA, PNG_WITH_METADATA, WEBP_WITH_METADATA, plainPng } from './testImages';

/**
 * #451: photos stored before uploads were scrubbed keep their EXIF. The startup
 * migration rewrites them once; it must be idempotent, leave anything it cannot
 * handle alone, and never take the server down.
 */
const silent = { log: () => undefined, warn: () => undefined };

function tmpDirs(): { photos: string; state: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-photomig-test-'));
  const photos = path.join(root, 'photos');
  fs.mkdirSync(photos);
  return { photos, state: path.join(root, 'photo_metadata.json') };
}

describe('stripStoredPhotos (#451)', () => {
  it('rewrites photos that carry metadata and leaves clean ones byte for byte alone', () => {
    const { photos, state } = tmpDirs();
    fs.writeFileSync(path.join(photos, 'a.jpg'), JPEG_WITH_METADATA);
    fs.writeFileSync(path.join(photos, 'b.png'), PNG_WITH_METADATA);
    fs.writeFileSync(path.join(photos, 'c.webp'), WEBP_WITH_METADATA);
    const clean = plainPng();
    fs.writeFileSync(path.join(photos, 'd.png'), clean);
    const cleanMtime = fs.statSync(path.join(photos, 'd.png')).mtimeMs;

    const result = stripStoredPhotos(photos, state, silent);
    expect(result).toMatchObject({ scanned: 4, rewritten: 3, unchanged: 1, failed: [] });

    expect(fs.readFileSync(path.join(photos, 'a.jpg')).equals(stripImageMetadata(JPEG_WITH_METADATA))).toBe(true);
    expect(fs.readFileSync(path.join(photos, 'b.png')).equals(stripImageMetadata(PNG_WITH_METADATA))).toBe(true);
    expect(fs.readFileSync(path.join(photos, 'c.webp')).equals(stripImageMetadata(WEBP_WITH_METADATA))).toBe(true);
    for (const f of ['a.jpg', 'b.png', 'c.webp']) {
      expect(fs.readFileSync(path.join(photos, f)).includes(Buffer.from('SecretCam'))).toBe(false);
    }
    expect(fs.readFileSync(path.join(photos, 'd.png')).equals(clean)).toBe(true);
    expect(fs.statSync(path.join(photos, 'd.png')).mtimeMs).toBe(cleanMtime);
    // No temp files left behind.
    expect(fs.readdirSync(photos).sort()).toEqual(['a.jpg', 'b.png', 'c.webp', 'd.png']);
  });

  it('records its result and does not run a second time', () => {
    const { photos, state } = tmpDirs();
    fs.writeFileSync(path.join(photos, 'a.jpg'), JPEG_WITH_METADATA);
    stripStoredPhotos(photos, state, silent);
    expect(JSON.parse(fs.readFileSync(state, 'utf-8'))).toMatchObject({ v: 1, scanned: 1, rewritten: 1, failed: [] });

    // A photo that arrives afterwards (stored by an older build, restored from backup) is
    // not touched: the state file says the pass is done. Uploads are scrubbed by the route.
    fs.writeFileSync(path.join(photos, 'late.jpg'), JPEG_WITH_METADATA);
    expect(stripStoredPhotos(photos, state, silent)).toBeNull();
    expect(fs.readFileSync(path.join(photos, 'late.jpg')).equals(JPEG_WITH_METADATA)).toBe(true);
  });

  it('is idempotent: removing the state file and running again changes nothing', () => {
    const { photos, state } = tmpDirs();
    fs.writeFileSync(path.join(photos, 'a.jpg'), JPEG_WITH_METADATA);
    stripStoredPhotos(photos, state, silent);
    const after = fs.readFileSync(path.join(photos, 'a.jpg'));
    fs.rmSync(state);

    expect(stripStoredPhotos(photos, state, silent)).toMatchObject({ scanned: 1, rewritten: 0, unchanged: 1 });
    expect(fs.readFileSync(path.join(photos, 'a.jpg')).equals(after)).toBe(true);
  });

  it('leaves a file it cannot process exactly as it was, reports it, and carries on', () => {
    const { photos, state } = tmpDirs();
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff]), Buffer.from('truncated')]);
    fs.writeFileSync(path.join(photos, 'broken.jpg'), broken);
    fs.writeFileSync(path.join(photos, 'good.jpg'), JPEG_WITH_METADATA);
    const warnings: string[] = [];

    const result = stripStoredPhotos(photos, state, { log: () => undefined, warn: (m) => warnings.push(m) });
    expect(result).toMatchObject({ scanned: 2, rewritten: 1, failed: ['broken.jpg'] });
    expect(fs.readFileSync(path.join(photos, 'broken.jpg')).equals(broken)).toBe(true);
    expect(fs.readFileSync(path.join(photos, 'good.jpg')).includes(Buffer.from('SecretCam'))).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('broken.jpg');
  });

  it('ignores other files, temp files and directories, and does not follow symlinks', () => {
    const { photos, state } = tmpDirs();
    fs.writeFileSync(path.join(photos, 'notes.txt'), 'hello');
    fs.writeFileSync(path.join(photos, 'upload.jpg.tmp'), JPEG_WITH_METADATA);
    fs.mkdirSync(path.join(photos, 'dir.jpg'));
    const outside = path.join(path.dirname(photos), 'outside.jpg');
    fs.writeFileSync(outside, JPEG_WITH_METADATA);
    let linked = true;
    try {
      fs.symlinkSync(outside, path.join(photos, 'link.jpg'));
    } catch {
      linked = false; // symlinks need a privilege on some Windows setups
    }

    const result = stripStoredPhotos(photos, state, silent);
    expect(result).toMatchObject({ scanned: 0, rewritten: 0, failed: [] });
    expect(fs.readFileSync(path.join(photos, 'upload.jpg.tmp')).equals(JPEG_WITH_METADATA)).toBe(true);
    if (linked) expect(fs.readFileSync(outside).equals(JPEG_WITH_METADATA)).toBe(true);
  });

  it('handles an empty photo directory', () => {
    const { photos, state } = tmpDirs();
    expect(stripStoredPhotos(photos, state, silent)).toMatchObject({ scanned: 0, rewritten: 0 });
    expect(fs.existsSync(state)).toBe(true);
  });
});

describe('the migration runs when the server starts', () => {
  let app: FastifyInstance;
  let photos: string;

  beforeAll(async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-photomig-boot-'));
    photos = path.join(dataDir, 'photos');
    fs.mkdirSync(photos, { recursive: true });
    fs.writeFileSync(path.join(photos, 'old.jpg'), JPEG_WITH_METADATA);
    process.env.DATA_DIR = dataDir;
    process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
    const { buildApp } = await import('./index');
    app = await buildApp();
  });

  it('scrubs a photo stored before the fix and records that it did', () => {
    expect(app).toBeDefined();
    const stored = fs.readFileSync(path.join(photos, 'old.jpg'));
    expect(stored.includes(Buffer.from('SecretCam'))).toBe(false);
    expect(stored.equals(stripImageMetadata(JPEG_WITH_METADATA))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(photos), 'photo_metadata.json'))).toBe(true);
  });
});
