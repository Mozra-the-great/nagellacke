import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { orientationTiff, readExifOrientation, stripImageMetadata } from './imageMeta';
import { JPEG_WITH_METADATA, PNG_WITH_METADATA, WEBP_WITH_METADATA, plainPng } from './testImages';

/**
 * #451: uploads used to be stored unchanged, so GPS, device and time came back out of
 * GET /photos/*. These tests go through the real routes and read the file back.
 */
let app: FastifyInstance;
let photosDir: string;
let bearer: string;

beforeAll(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-photometa-test-'));
  photosDir = path.join(dataDir, 'photos');
  process.env.DATA_DIR = dataDir;
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.ALLOW_REGISTRATION = 'true';
  const { buildApp } = await import('./index');
  app = await buildApp();
  const reg = await app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: { username: 'photo-meta-user', password: 'correct-horse-battery' },
  });
  bearer = (reg.json() as { token: string }).token;
});

async function upload(bytes: Buffer, mimeType: string) {
  return app.inject({
    method: 'POST', url: '/api/photos', headers: { authorization: `Bearer ${bearer}` },
    payload: { data: bytes.toString('base64'), mimeType },
  });
}

async function download(filename: string): Promise<Buffer> {
  const res = await app.inject({ method: 'GET', url: `/photos/${filename}`, headers: { authorization: `Bearer ${bearer}` } });
  expect(res.statusCode).toBe(200);
  return res.rawPayload;
}

describe('POST /api/photos strips metadata (#451)', () => {
  it.each([
    ['image/jpeg', 'JPEG', JPEG_WITH_METADATA],
    ['image/png', 'PNG', PNG_WITH_METADATA],
    ['image/webp', 'WebP', WEBP_WITH_METADATA],
  ])('%s: neither the stored file nor the served bytes carry GPS, device or time', async (mimeType, _name, original) => {
    expect(original.includes(Buffer.from('SecretCam'))).toBe(true);
    const res = await upload(original, mimeType);
    expect(res.statusCode).toBe(200);
    const { filename } = res.json() as { filename: string };

    const stored = fs.readFileSync(path.join(photosDir, filename));
    const served = await download(filename);
    for (const bytes of [stored, served]) {
      for (const leak of ['SecretCam', 'Model X-1', 'GPS', '2024:01:02']) {
        expect(bytes.includes(Buffer.from(leak, 'latin1'))).toBe(false);
      }
      // The orientation (6) survives, so the photo is not turned on its side.
      const at = bytes.indexOf(orientationTiff(6));
      expect(at).toBeGreaterThan(0);
      expect(readExifOrientation(bytes.subarray(at, at + 26))).toBe(6);
    }
    expect(served.equals(stripImageMetadata(original))).toBe(true);
  });

  it('decides by content, not by the declared type', async () => {
    const res = await upload(JPEG_WITH_METADATA, 'image/png');
    expect(res.statusCode).toBe(200);
    const { filename } = res.json() as { filename: string };
    expect((await download(filename)).includes(Buffer.from('SecretCam'))).toBe(false);
  });

  it('stores a photo without metadata unchanged', async () => {
    const png = plainPng();
    const res = await upload(png, 'image/png');
    const { filename } = res.json() as { filename: string };
    expect((await download(filename)).equals(png)).toBe(true);
  });

  it('refuses a file that has an image header but is not a well-formed image, instead of storing it unscrubbed', async () => {
    const before = fs.readdirSync(photosDir).length;
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x7f, 0xff]), Buffer.from('SecretCam but cut off')]);
    const res = await upload(fake, 'image/jpeg');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Ungültiges Bildformat' });
    expect(fs.readdirSync(photosDir).length).toBe(before);
  });

  it('still rejects non-images', async () => {
    expect((await upload(Buffer.from('<svg onload=alert(1)>'), 'image/svg+xml')).statusCode).toBe(400);
  });
});

describe('POST /api/admin/branding/logo strips metadata (#451)', () => {
  it('scrubs the logo, which is served publicly', async () => {
    // The first registered account is the admin.
    const res = await app.inject({
      method: 'POST', url: '/api/admin/branding/logo', headers: { authorization: `Bearer ${bearer}` },
      payload: { data: PNG_WITH_METADATA.toString('base64') },
    });
    expect(res.statusCode).toBe(200);
    const stored = fs.readFileSync(path.join(path.dirname(photosDir), 'branding', 'logo.png'));
    expect(stored.includes(Buffer.from('SecretCam'))).toBe(false);
    expect(stored.includes(Buffer.from('Jane Doe'))).toBe(false);
    expect(stored.equals(stripImageMetadata(PNG_WITH_METADATA))).toBe(true);
  });
});
