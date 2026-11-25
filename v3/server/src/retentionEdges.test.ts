import { describe, it, expect, afterEach, vi } from 'vitest';
import fsDefault from 'node:fs';
import * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * #498: retention.ts (#463-#465, #470) at its edges. retention.test.ts and
 * retentionRecipients.test.ts cover what each job removes and when; this file pins what
 * the jobs say when something is off (every warning, word for word, with its error code),
 * what they refuse to touch (paths that leave their root, stray files, unreadable or
 * malformed data) and the exact summary line of a run. All of it is retention's promise
 * "never delete on a doubt, and never log more than counts and codes".
 */
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

const tmpDirs: string[] = [];
const restorers: (() => void)[] = [];
afterEach(() => {
  while (restorers.length) restorers.pop()?.();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});

function recorder() {
  const warn: string[] = [];
  const log: string[] = [];
  return { warn, log, logger: { log: (m: string) => { log.push(m); }, warn: (m: string) => { warn.push(m); } } };
}

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-retention-edges-'));
  tmpDirs.push(dir);
  process.env.DATA_DIR = dir;
  vi.resetModules();
  const db = await import('./db');
  const ret = await import('./retention');
  return { db, ret, dir, users: path.join(dir, 'users'), photos: path.join(dir, 'photos') };
}

/** Makes one fs method throw `code` for the paths `when` accepts (at most `times` times); everything else passes through. */
function failing(method: 'readdirSync' | 'lstatSync' | 'rmSync' | 'writeFileSync', when: (p: string) => boolean, code: string, times = Infinity): void {
  const target = fsDefault as unknown as Record<string, (...a: unknown[]) => unknown>;
  const original = target[method];
  let n = 0;
  const spy = vi.spyOn(target, method).mockImplementation((...args: unknown[]) => {
    if (when(String(args[0])) && n < times) {
      n += 1;
      throw Object.assign(new Error(code), { code });
    }
    return original.apply(fsDefault, args);
  });
  syncBuiltinESMExports();
  restorers.push(() => { spy.mockRestore(); syncBuiltinESMExports(); });
}
const release = (): void => { restorers.pop()?.(); };

const polish = (id: string, photo?: string, deletedAt?: number) => ({
  id, name: id, brand: 'B', num: '1', color: '#fff', finish: ['Classic'], status: 'ok', createdAt: 1, updatedAt: 1,
  ...(photo ? { photo } : {}), ...(deletedAt === undefined ? {} : { deletedAt }),
});
const collection = (extra: Record<string, unknown> = {}) => ({ polishes: [], customCats: [], manicures: [], stickers: [], ...extra });

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}
const OLD = 100 * DAY; // far past every grace period

/** A photo file old enough for the orphan sweep. */
function putOldPhoto(photos: string, name: string, now: number): string {
  const f = path.join(photos, name);
  fs.mkdirSync(photos, { recursive: true });
  fs.writeFileSync(f, 'img');
  const t = new Date(now - OLD);
  fs.utimesSync(f, t, t);
  return f;
}

const entry = (over: Record<string, unknown> = {}) => ({ id: 'e1', dir: 'alice', deletedAt: T0, files: [] as string[], photos: [] as string[], ...over });
const writePending = (dir: string, entries: unknown[]) => writeJson(path.join(dir, 'pending_deletions.json'), { v: 1, entries });
const NOW = T0 + 31 * DAY; // every entry written with deletedAt T0 is due

describe('pending_deletions.json, reading (#463)', () => {
  it.each([
    ['no file', undefined],
    ['an empty object', '{}'],
    ['null', 'null'],
    ['entries that are not a list', '{"entries":"x"}'],
    ['entries that are null', '{"entries":null}'],
  ])('reads %s as "nothing pending" without a warning and without moving anything', async (_n, content) => {
    const { ret, dir } = await fresh();
    const file = path.join(dir, 'pending_deletions.json');
    if (content !== undefined) fs.writeFileSync(file, content);
    const r = recorder();
    expect(ret.purgePendingDeletions(NOW, r.logger)).toEqual({ entriesPurged: 0, entriesFailed: 0, collectionsRemoved: 0, photosRemoved: 0, photosKept: 0 });
    expect(r.warn).toEqual([]);
    expect(fs.existsSync(file)).toBe(content !== undefined);
    expect(fs.readdirSync(dir).filter((n) => n.includes('corrupt'))).toEqual([]);
  });

  it('ignores entries that are not well-formed, field by field, and says how many', async () => {
    const { ret, dir } = await fresh();
    const good = entry({ id: 'ok' });
    const bad = [
      null, 'text', 5, [],
      { ...good, id: 5 }, { ...good, id: undefined },
      { ...good, dir: 5 }, { ...good, dir: '' }, { ...good, dir: undefined },
      { ...good, deletedAt: '1' }, { ...good, deletedAt: '__INF__' }, { ...good, deletedAt: undefined },
      { ...good, files: 'x' }, { ...good, files: [5] }, { ...good, files: undefined },
      { ...good, photos: 'x' }, { ...good, photos: [null] }, { ...good, photos: undefined },
    ];
    const text = JSON.stringify({ v: 1, entries: [good, ...bad] }).replace('"__INF__"', '1e999');
    fs.writeFileSync(path.join(dir, 'pending_deletions.json'), text);
    const r = recorder();
    const out = ret.purgePendingDeletions(NOW, r.logger);
    expect(r.warn).toEqual([`[retention] ${bad.length} malformed pending deletion(s) ignored.`]);
    expect(out.entriesPurged).toBe(1); // only the well-formed one was an entry at all
    expect(out.entriesFailed).toBe(0);
  });

  it('accepts an entry with empty lists and a deletion time of 0 or below as well-formed', async () => {
    const { ret, dir } = await fresh();
    writePending(dir, [entry({ id: 'zero', deletedAt: 0 }), entry({ id: 'neg', deletedAt: -5 })]);
    const r = recorder();
    expect(ret.purgePendingDeletions(NOW, r.logger).entriesPurged).toBe(2);
    expect(r.warn).toEqual([]);
  });

  it('moves a file it cannot parse aside under a name with the time, and carries on without it', async () => {
    const { ret, dir } = await fresh();
    const file = path.join(dir, 'pending_deletions.json');
    fs.writeFileSync(file, '{broken');
    const r = recorder();
    expect(ret.purgePendingDeletions(NOW, r.logger).entriesPurged).toBe(0);
    expect(r.warn).toEqual(['[retention] pending_deletions.json could not be parsed (error); moved aside, continuing without it.']);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(`${file}.corrupt-${NOW}`, 'utf-8')).toBe('{broken');
  });

  it('writes the file it keeps for the owner only, through a temporary file', async () => {
    const { ret, dir } = await fresh();
    writePending(dir, [entry({ id: 'fails', photos: ['p.png'] })]);
    writeJson(path.join(dir, 'users', 'bob', 'data.json'), '{ not json');
    // a second, harmless entry makes the run rewrite the file
    writePending(dir, [entry({ id: 'fails', photos: ['p.png'] }), entry({ id: 'done', dir: 'gone' })]);
    const writes: unknown[][] = [];
    const target = fsDefault as unknown as Record<string, (...a: unknown[]) => unknown>;
    const original = target.writeFileSync;
    const spy = vi.spyOn(target, 'writeFileSync').mockImplementation((...args: unknown[]) => { writes.push(args); return original.apply(fsDefault, args); });
    syncBuiltinESMExports();
    restorers.push(() => { spy.mockRestore(); syncBuiltinESMExports(); });
    ret.purgePendingDeletions(NOW, recorder().logger);
    const call = writes.find((a) => String(a[0]).endsWith('pending_deletions.json.tmp'));
    expect(call?.[2]).toEqual({ mode: 0o600 });
    expect(JSON.parse(String(call?.[1]))).toMatchObject({ v: 1, entries: [{ id: 'fails' }] });
  });
});

describe('purgePendingDeletions, refusals and failures (#463)', () => {
  it('leaves a directory outside users/ alone even when its name starts with "users"', async () => {
    const { ret, dir, users } = await fresh();
    fs.mkdirSync(users, { recursive: true });
    const evil = path.join(dir, 'users-evil');
    const evilFile = path.join(evil, 'data.json.deleted-1');
    writeJson(evilFile, 'x');
    const emptyDir = path.join(dir, 'users-empty');
    fs.mkdirSync(emptyDir);
    writePending(dir, [
      entry({ id: 'sibling', dir: '../users-evil', files: ['data.json.deleted-1'] }),
      entry({ id: 'empty', dir: '../users-empty' }),
    ]);
    const out = ret.purgePendingDeletions(NOW, recorder().logger);
    expect(out).toMatchObject({ entriesPurged: 2, entriesFailed: 0, collectionsRemoved: 0 });
    expect(fs.existsSync(evilFile)).toBe(true);
    expect(fs.existsSync(emptyDir)).toBe(true);
  });

  it('counts a collection file that is already gone as nothing removed', async () => {
    const { ret, dir, users } = await fresh();
    fs.mkdirSync(path.join(users, 'alice'), { recursive: true });
    writePending(dir, [entry({ files: ['data.json.deleted-1'] })]);
    expect(ret.purgePendingDeletions(NOW, recorder().logger)).toMatchObject({ entriesPurged: 1, collectionsRemoved: 0 });
  });

  it('removes the recorded file, counts it, and tidies the emptied directory but not a used one', async () => {
    const { ret, dir, users } = await fresh();
    writeJson(path.join(users, 'alice', 'data.json.deleted-1'), 'x');
    writeJson(path.join(users, 'carol', 'data.json.deleted-2'), 'x');
    writeJson(path.join(users, 'carol', 'data.json'), '{}');
    writePending(dir, [entry({ id: 'a', dir: 'alice', files: ['data.json.deleted-1'] }), entry({ id: 'c', dir: 'carol', files: ['data.json.deleted-2'] })]);
    expect(ret.purgePendingDeletions(NOW, recorder().logger)).toMatchObject({ entriesPurged: 2, collectionsRemoved: 2 });
    expect(fs.existsSync(path.join(users, 'alice'))).toBe(false);
    expect(fs.existsSync(path.join(users, 'carol', 'data.json'))).toBe(true);
  });

  it('skips a collection file name that is not a renamed collection, and says so', async () => {
    const { ret, dir, users } = await fresh();
    writeJson(path.join(users, 'alice', 'notes.txt'), 'keep');
    writeJson(path.join(users, 'alice', 'data.json.deleted-5'), 'x');
    writePending(dir, [entry({ files: ['notes.txt', 'data.json.deleted-5'] })]);
    const r = recorder();
    expect(ret.purgePendingDeletions(NOW, r.logger)).toMatchObject({ entriesPurged: 1, collectionsRemoved: 1 });
    expect(r.warn).toEqual(['[retention] entry e1: unexpected collection file name skipped.']);
    expect(fs.existsSync(path.join(users, 'alice', 'notes.txt'))).toBe(true);
  });

  it('skips photo names that are empty or carry a path, and says so for each', async () => {
    const { ret, dir, photos } = await fresh();
    fs.mkdirSync(photos, { recursive: true });
    fs.mkdirSync(path.join(dir, 'users'), { recursive: true });
    writeJson(path.join(dir, 'x.png'), 'outside');
    writeJson(path.join(photos, 'sub', 'y.png'), 'nested');
    writeJson(path.join(photos, 'ok.png'), 'img');
    writePending(dir, [entry({ photos: ['', '../x.png', 'sub/y.png', 'ok.png'] })]);
    const r = recorder();
    expect(ret.purgePendingDeletions(NOW, r.logger)).toMatchObject({ entriesPurged: 1, photosRemoved: 1, photosKept: 0 });
    expect(r.warn).toEqual(Array(3).fill('[retention] entry e1: unexpected photo name skipped.'));
    expect(fs.existsSync(path.join(dir, 'x.png'))).toBe(true);
    expect(fs.existsSync(path.join(photos, 'sub', 'y.png'))).toBe(true);
    expect(fs.existsSync(path.join(photos, 'ok.png'))).toBe(false);
  });

  it('keeps a photo whose recorded uploader still has an account, and removes one whose uploader is gone', async () => {
    const { ret, db, dir, photos } = await fresh();
    db.createUser('bob', 'hash');
    db.recordPhotoOwner('bobs.png', 'bob');
    db.recordPhotoOwner('ghosts.png', 'ghost');
    writeJson(path.join(photos, 'bobs.png'), 'img');
    writeJson(path.join(photos, 'ghosts.png'), 'img');
    writePending(dir, [entry({ photos: ['bobs.png', 'ghosts.png'] })]);
    expect(ret.purgePendingDeletions(NOW, recorder().logger)).toMatchObject({ photosRemoved: 1, photosKept: 1 });
    expect(fs.existsSync(path.join(photos, 'bobs.png'))).toBe(true);
    expect(fs.existsSync(path.join(photos, 'ghosts.png'))).toBe(false);
  });

  it('fails an entry with photos while a collection cannot be read, keeps it for the next run, but purges one without photos', async () => {
    const { ret, dir, users } = await fresh();
    writeJson(path.join(users, 'bob', 'data.json'), '{ not json');
    const before = [entry({ id: 'withphotos', photos: ['p.png'] }), entry({ id: 'plain', dir: 'gone' })];
    writePending(dir, before);
    const r = recorder();
    expect(ret.purgePendingDeletions(NOW, r.logger)).toMatchObject({ entriesPurged: 1, entriesFailed: 1 });
    expect(r.warn).toEqual(['[retention] entry withphotos not fully purged (EUNREADABLE); will retry.']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'pending_deletions.json'), 'utf-8')).entries.map((e: { id: string }) => e.id)).toEqual(['withphotos']);
  });

  it('does not rewrite the file when every due entry failed, so malformed entries in it survive', async () => {
    const { ret, dir, users } = await fresh();
    writeJson(path.join(users, 'bob', 'data.json'), '{ not json');
    const raw = JSON.stringify({ v: 1, entries: [entry({ photos: ['p.png'] }), { junk: true }] });
    fs.writeFileSync(path.join(dir, 'pending_deletions.json'), raw);
    ret.purgePendingDeletions(NOW, recorder().logger);
    expect(fs.readFileSync(path.join(dir, 'pending_deletions.json'), 'utf-8')).toBe(raw);
  });

  it('reads only entries that are due: exactly 30 days', async () => {
    const { ret, dir } = await fresh();
    writePending(dir, [entry({ id: 'due' }), entry({ id: 'young', deletedAt: T0 + 1 })]);
    expect(ret.purgePendingDeletions(T0 + 30 * DAY, recorder().logger)).toMatchObject({ entriesPurged: 1 });
    expect(ret.purgePendingDeletions(T0 + 30 * DAY, recorder().logger)).toMatchObject({ entriesPurged: 0 });
    expect(ret.purgePendingDeletions(T0 + 30 * DAY + 1, recorder().logger)).toMatchObject({ entriesPurged: 1 });
  });

  it('reports any error but "file not found" from the file system as a failed entry with its code', async () => {
    const { ret, dir, users } = await fresh();
    writeJson(path.join(users, 'alice', 'data.json.deleted-1'), 'x');
    writePending(dir, [entry({ files: ['data.json.deleted-1'] })]);
    failing('lstatSync', (p) => p.endsWith('data.json.deleted-1'), 'EACCES');
    const r = recorder();
    expect(ret.purgePendingDeletions(NOW, r.logger)).toMatchObject({ entriesPurged: 0, entriesFailed: 1 });
    expect(r.warn).toEqual(['[retention] entry e1 not fully purged (EACCES); will retry.']);
  });

  it('names an error without a code just "error"', async () => {
    const { ret, dir, users } = await fresh();
    writeJson(path.join(users, 'alice', 'data.json.deleted-1'), 'x');
    writePending(dir, [entry({ files: ['data.json.deleted-1'] })]);
    const target = fsDefault as unknown as Record<string, (...a: unknown[]) => unknown>;
    const spy = vi.spyOn(target, 'lstatSync').mockImplementation(() => { throw new Error('no code on this one'); });
    syncBuiltinESMExports();
    restorers.push(() => { spy.mockRestore(); syncBuiltinESMExports(); });
    const r = recorder();
    ret.purgePendingDeletions(NOW, r.logger);
    expect(r.warn).toEqual(['[retention] entry e1 not fully purged (error); will retry.']);
  });
});

describe('purgeLegacyDeletedCollections, edges (#463)', () => {
  const LEGACY_AT = T0 - 40 * DAY;

  it('copes with a data directory that has no users/ yet', async () => {
    const { ret } = await fresh();
    expect(ret.purgeLegacyDeletedCollections(T0, recorder().logger)).toBe(0);
  });

  it('ignores a stray file in users/, leaves an empty account directory alone and tidies only the one it emptied', async () => {
    const { ret, users } = await fresh();
    writeJson(path.join(users, 'stray.txt'), 'x');
    fs.mkdirSync(path.join(users, 'empty'), { recursive: true });
    writeJson(path.join(users, 'only', `data.json.deleted-${LEGACY_AT}`), 'x');
    writeJson(path.join(users, 'both', `data.json.deleted-${LEGACY_AT}`), 'x');
    writeJson(path.join(users, 'both', 'data.json'), '{}');
    const r = recorder();
    expect(ret.purgeLegacyDeletedCollections(T0, r.logger)).toBe(2);
    expect(r.warn).toEqual([]);
    expect(fs.existsSync(path.join(users, 'stray.txt'))).toBe(true);
    expect(fs.existsSync(path.join(users, 'empty'))).toBe(true);
    expect(fs.existsSync(path.join(users, 'only'))).toBe(false);
    expect(fs.existsSync(path.join(users, 'both', 'data.json'))).toBe(true);
  });

  it('skips a directory it cannot list, silently, and still handles the others', async () => {
    const { ret, users } = await fresh();
    writeJson(path.join(users, 'locked', `data.json.deleted-${LEGACY_AT}`), 'x');
    writeJson(path.join(users, 'open', `data.json.deleted-${LEGACY_AT}`), 'x');
    failing('readdirSync', (p) => path.basename(p) === 'locked', 'EACCES');
    const r = recorder();
    expect(ret.purgeLegacyDeletedCollections(T0, r.logger)).toBe(1);
    expect(r.warn).toEqual([]);
  });

  it('says when a leftover could not be removed, with the code, and counts only what went', async () => {
    const { ret, users } = await fresh();
    const stuck = path.join(users, 'alice', `data.json.deleted-${LEGACY_AT}`);
    writeJson(stuck, 'x');
    failing('rmSync', (p) => p.endsWith(`deleted-${LEGACY_AT}`), 'EPERM');
    const r = recorder();
    expect(ret.purgeLegacyDeletedCollections(T0, r.logger)).toBe(0);
    expect(r.warn).toEqual(['[retention] a leftover collection file could not be removed (EPERM); will retry.']);
    expect(fs.existsSync(stuck)).toBe(true);
    expect(fs.existsSync(path.join(users, 'alice'))).toBe(true);
  });

  it('removes a leftover at exactly 30 days and not a millisecond before', async () => {
    const { ret, users } = await fresh();
    const f = path.join(users, 'alice', `data.json.deleted-${T0}`);
    writeJson(f, 'x');
    expect(ret.purgeLegacyDeletedCollections(T0 + 30 * DAY - 1, recorder().logger)).toBe(0);
    expect(fs.existsSync(f)).toBe(true);
    expect(ret.purgeLegacyDeletedCollections(T0 + 30 * DAY, recorder().logger)).toBe(1);
  });
});

describe('purgeStoredTombstones, edges (#464)', () => {
  const stale = (id: string) => polish(id, undefined, T0 - 200 * DAY);

  it('passes over a directory without a collection, silently', async () => {
    const { ret, users } = await fresh();
    fs.mkdirSync(path.join(users, 'nodata'), { recursive: true });
    const r = recorder();
    expect(ret.purgeStoredTombstones(T0, r.logger)).toBe(0);
    expect(r.warn).toEqual([]);
  });

  it.each(['[]', 'null', '"text"', '5', 'true'])('leaves a collection that is %s untouched and counts it as unreadable', async (content) => {
    const { ret, users } = await fresh();
    const f = path.join(users, 'alice', 'data.json');
    writeJson(f, content);
    writeJson(path.join(users, 'bob', 'data.json'), '{ not json');
    const r = recorder();
    expect(ret.purgeStoredTombstones(T0, r.logger)).toBe(0);
    expect(r.warn).toEqual(['[retention] 2 collection file(s) could not be parsed and were left untouched.']);
    expect(fs.readFileSync(f, 'utf-8')).toBe(content);
  });

  it('is silent when every collection could be read', async () => {
    const { ret, users } = await fresh();
    writeJson(path.join(users, 'alice', 'data.json'), collection({ polishes: [stale('p')] }));
    const r = recorder();
    expect(ret.purgeStoredTombstones(T0, r.logger)).toBe(1);
    expect(r.warn).toEqual([]);
  });

  it('writes the cleaned collection for the owner only, via a temporary file', async () => {
    const { ret, users } = await fresh();
    writeJson(path.join(users, 'alice', 'data.json'), collection({ polishes: [stale('p'), polish('live')] }));
    const writes: unknown[][] = [];
    const target = fsDefault as unknown as Record<string, (...a: unknown[]) => unknown>;
    const original = target.writeFileSync;
    const spy = vi.spyOn(target, 'writeFileSync').mockImplementation((...args: unknown[]) => { writes.push(args); return original.apply(fsDefault, args); });
    syncBuiltinESMExports();
    restorers.push(() => { spy.mockRestore(); syncBuiltinESMExports(); });
    ret.purgeStoredTombstones(T0, recorder().logger);
    const call = writes.find((a) => String(a[0]).endsWith('data.json.tmp'));
    expect(call?.[2]).toEqual({ mode: 0o600 });
  });

  it('says when a collection could not be cleaned, with the code, and does not call it unparsable', async () => {
    const { ret, users } = await fresh();
    writeJson(path.join(users, 'alice', 'data.json'), collection({ polishes: [stale('p')] }));
    failing('writeFileSync', (p) => p.endsWith('data.json.tmp'), 'EACCES');
    const r = recorder();
    expect(ret.purgeStoredTombstones(T0, r.logger)).toBe(0);
    expect(r.warn).toEqual(['[retention] a collection could not be cleaned (EACCES); will retry.']);
  });
});

describe('sweepOrphanPhotos, edges (#465)', () => {
  const SWEEP_NOW = T0 + 500 * DAY;

  it('says when the photo directory cannot be read, but not when it is simply missing', async () => {
    const { ret, photos } = await fresh();
    fs.rmSync(photos, { recursive: true, force: true });
    const quiet = recorder();
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, quiet.logger)).toEqual({ removed: 0, failed: 0, referenced: 0, withinGrace: 0, skipped: false });
    expect(quiet.warn).toEqual([]);

    fs.mkdirSync(photos, { recursive: true });
    failing('readdirSync', (p) => path.basename(p) === 'photos', 'EACCES');
    const loud = recorder();
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, loud.logger)).toEqual({ removed: 0, failed: 0, referenced: 0, withinGrace: 0, skipped: false });
    expect(loud.warn).toEqual(['[retention] photo directory could not be read (EACCES).']);
  });

  it('says why nothing was judged: an unparsable collection, or no collection at all', async () => {
    const { ret, users, photos } = await fresh();
    putOldPhoto(photos, 'a.png', SWEEP_NOW);
    const none = recorder();
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, none.logger)).toMatchObject({ skipped: true, removed: 0 });
    expect(none.warn).toEqual(['[retention] no collection could be read; orphaned photos were not judged this run.']);

    writeJson(path.join(users, 'bob', 'data.json'), '{ not json');
    const broken = recorder();
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, broken.logger)).toMatchObject({ skipped: true, removed: 0 });
    expect(broken.warn).toEqual(['[retention] a collection could not be parsed; orphaned photos were not judged this run.']);
    expect(fs.existsSync(path.join(photos, 'a.png'))).toBe(true);
  });

  it.each(['[]', 'null', '"text"', '5'])('does not judge anything while a collection is %s', async (content) => {
    const { ret, users, photos } = await fresh();
    putOldPhoto(photos, 'a.png', SWEEP_NOW);
    writeJson(path.join(users, 'bob', 'data.json'), content);
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, recorder().logger)).toMatchObject({ skipped: true, removed: 0 });
    expect(fs.existsSync(path.join(photos, 'a.png'))).toBe(true);
  });

  it('is not thrown off by a stray file in users/ or an unrelated file in an account directory', async () => {
    const { ret, users, photos } = await fresh();
    writeJson(path.join(users, 'stray.txt'), 'x');
    writeJson(path.join(users, 'bob', 'data.json'), collection({ polishes: [polish('p', 'kept.png')] }));
    writeJson(path.join(users, 'bob', 'avatar.png'), 'not a collection');
    writeJson(path.join(users, 'bob', 'data.json.tmp'), 'not a collection');
    putOldPhoto(photos, 'kept.png', SWEEP_NOW);
    putOldPhoto(photos, 'orphan.png', SWEEP_NOW);
    const r = recorder();
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, r.logger)).toMatchObject({ skipped: false, removed: 1, referenced: 1 });
    expect(r.warn).toEqual([]);
  });

  it('skips judging when an account directory cannot be listed', async () => {
    const { ret, users, photos } = await fresh();
    writeJson(path.join(users, 'bob', 'data.json'), collection());
    putOldPhoto(photos, 'a.png', SWEEP_NOW);
    failing('readdirSync', (p) => path.basename(p) === 'bob', 'EACCES');
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, recorder().logger)).toMatchObject({ skipped: true, removed: 0 });
  });

  it('reads records that are null, and manicures without photo slots, without failing', async () => {
    const { ret, users, photos } = await fresh();
    writeJson(path.join(users, 'bob', 'data.json'), collection({
      polishes: [null, polish('p', 'kept-p.png')],
      stickers: [null, { id: 's', photo: 'kept-s.png' }],
      manicures: [null, { id: 'm1' }, { id: 'm2', photos: null }, { id: 'm3', photos: { left: 'kept-m.png', right: null, mid: '' } }, { id: 'm4', photo: 'kept-m4.png' }],
    }));
    for (const n of ['kept-p.png', 'kept-s.png', 'kept-m.png', 'kept-m4.png', 'orphan.png']) putOldPhoto(photos, n, SWEEP_NOW);
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, recorder().logger)).toMatchObject({ skipped: false, removed: 1, referenced: 4 });
    expect(fs.existsSync(path.join(photos, 'orphan.png'))).toBe(false);
  });

  it('counts a collection only once it was read, and so judges when there is exactly one', async () => {
    const { ret, users, photos } = await fresh();
    writeJson(path.join(users, 'bob', 'data.json'), collection());
    putOldPhoto(photos, 'orphan.png', SWEEP_NOW);
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, recorder().logger)).toMatchObject({ skipped: false, removed: 1 });
  });

  it('counts a photo it could not remove as failed, says so with the code, and tries again next time', async () => {
    const { ret, users, photos } = await fresh();
    writeJson(path.join(users, 'bob', 'data.json'), collection());
    const f = putOldPhoto(photos, 'orphan.png', SWEEP_NOW);
    failing('rmSync', (p) => p.endsWith('orphan.png'), 'EPERM', 1);
    const r = recorder();
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, r.logger)).toMatchObject({ removed: 0, failed: 1 });
    expect(r.warn).toEqual(['[retention] an orphaned photo could not be removed (EPERM); will retry.']);
    expect(fs.existsSync(f)).toBe(true);
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, recorder().logger)).toMatchObject({ removed: 1, failed: 0 });
  });

  it('treats a photo that vanished since the listing as nothing to do', async () => {
    const { ret, users, photos } = await fresh();
    writeJson(path.join(users, 'bob', 'data.json'), collection());
    putOldPhoto(photos, 'gone.png', SWEEP_NOW);
    failing('lstatSync', (p) => p.endsWith('gone.png'), 'ENOENT', 1);
    const r = recorder();
    expect(ret.sweepOrphanPhotos(SWEEP_NOW, r.logger)).toEqual({ removed: 0, failed: 0, referenced: 0, withinGrace: 0, skipped: false });
    expect(r.warn).toEqual([]);
  });
});

describe('purgeUnconfirmedRecipients, edges (#470)', () => {
  const cfg = (extra: Record<string, unknown> = {}) => ({
    enabled: true, frequency: 'weekly', toEmail: 'friend@example.org', confirmSeq: 3, ...extra,
  });
  const writeStore = (dir: string, schedules: Record<string, unknown>) => writeJson(path.join(dir, 'schedule.json'), { v: 2, schedules });
  const writeUsers = (dir: string, users: unknown) => writeJson(path.join(dir, 'users.json'), users);
  const read = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, 'schedule.json'), 'utf-8')).schedules as Record<string, Record<string, unknown>>;

  it('says so, and judges nothing, when schedule.json or users.json cannot be parsed', async () => {
    const { ret, dir } = await fresh();
    fs.writeFileSync(path.join(dir, 'schedule.json'), '{ nope');
    const a = recorder();
    expect(ret.purgeUnconfirmedRecipients(T0, a.logger)).toEqual({ removed: 0, waiting: 0, skipped: true });
    expect(a.warn).toEqual(['[retention] schedule.json could not be parsed; unconfirmed report recipients were not judged this run.']);

    writeStore(dir, { alice: cfg({ confirmSentAt: 1 }) });
    fs.writeFileSync(path.join(dir, 'users.json'), '{ nope');
    const b = recorder();
    expect(ret.purgeUnconfirmedRecipients(T0, b.logger)).toEqual({ removed: 0, waiting: 0, skipped: true });
    expect(b.warn).toEqual(['[retention] users.json could not be parsed; unconfirmed report recipients were not judged this run.']);
    expect(read(dir).alice.toEmail).toBe('friend@example.org');
  });

  it('does not look at users.json while there is no schedule at all', async () => {
    const { ret, dir } = await fresh();
    writeStore(dir, {});
    fs.writeFileSync(path.join(dir, 'users.json'), '{ nope');
    const r = recorder();
    expect(ret.purgeUnconfirmedRecipients(T0, r.logger)).toEqual({ removed: 0, waiting: 0, skipped: false });
    expect(r.warn).toEqual([]);
  });

  it('skips a schedule without a usable recipient address, and a user entry that is null', async () => {
    const { ret, dir } = await fresh();
    writeStore(dir, {
      noaddr: cfg({ toEmail: '', confirmSentAt: 1 }),
      numeric: cfg({ toEmail: 5, confirmSentAt: 1 }),
      missing: { enabled: true, frequency: 'weekly', confirmSentAt: 1 },
      alice: cfg({ confirmSentAt: 1 }),
    });
    writeUsers(dir, [null, 'x', { username: 5 }, { username: 'alice', email: 'a@example.org', email_verified: true }]);
    const out = ret.purgeUnconfirmedRecipients(T0, recorder().logger);
    expect(out).toEqual({ removed: 1, waiting: 0, skipped: false });
    expect(read(dir).alice.toEmail).toBe('');
    expect(read(dir).numeric.toEmail).toBe(5);
  });

  it('keeps the account\'s own verified address and an address that opted out, and removes an unverified own one', async () => {
    const { ret, dir } = await fresh();
    writeStore(dir, {
      verified: cfg({ toEmail: 'v@example.org', confirmSentAt: 1 }),
      unverified: cfg({ toEmail: 'u@example.org', confirmSentAt: 1 }),
      optedout: cfg({ confirmSentAt: 1, unsubscribedEmails: ['friend@example.org'] }),
    });
    writeUsers(dir, [
      { username: 'verified', email: 'V@example.org', email_verified: true },
      { username: 'unverified', email: 'u@example.org', email_verified: false },
      { username: 'optedout' },
    ]);
    expect(ret.purgeUnconfirmedRecipients(T0, recorder().logger)).toEqual({ removed: 1, waiting: 0, skipped: false });
    const s = read(dir);
    expect(s.verified.toEmail).toBe('v@example.org');
    expect(s.optedout.toEmail).toBe('friend@example.org');
    expect(s.unverified.toEmail).toBe('');
  });

  it('counts from the newest of the three timestamps, ignoring ones that are not finite numbers', async () => {
    const { ret, dir } = await fresh();
    const NOW48 = T0 + 48 * HOUR;
    writeStore(dir, {
      onlylist: cfg({ confirmMailsAt: [T0 + 30 * HOUR] }), // no confirmSentAt at all
      junk: cfg({ confirmSentAt: T0, confirmMailsAt: ['x', null, '__INF__'], recipientChangesAt: [T0 + 40 * HOUR] }),
      infinite: cfg({ confirmSentAt: T0, confirmMailsAt: ['__INF__'] }),
      none: cfg({}),
    });
    fs.writeFileSync(path.join(dir, 'schedule.json'), fs.readFileSync(path.join(dir, 'schedule.json'), 'utf-8').replace(/"__INF__"/g, '1e999'));
    writeUsers(dir, []);
    expect(ret.purgeUnconfirmedRecipients(NOW48, recorder().logger)).toEqual({ removed: 2, waiting: 2, skipped: false });
    const s = read(dir);
    expect(s.onlylist.toEmail).toBe('friend@example.org'); // 18 h old: waiting
    expect(s.junk.toEmail).toBe('friend@example.org'); // newest valid stamp is 8 h old: waiting
    expect(s.infinite.toEmail).toBe(''); // the only valid stamp is 48 h old: removed
    expect(s.none.toEmail).toBe(''); // nothing to count from: removed
  });

  it('leaves a schedule written by a pending removal exactly as documented', async () => {
    const { ret, dir } = await fresh();
    writeStore(dir, { alice: cfg({ confirmSentAt: T0, confirmedEmail: 'other@example.org', confirmedAt: 5 }) });
    writeUsers(dir, []);
    ret.purgeUnconfirmedRecipients(T0 + 48 * HOUR, recorder().logger);
    expect(read(dir).alice).toEqual({
      enabled: false, frequency: 'weekly', toEmail: '', confirmSeq: 4, recipientExpiredAt: T0 + 48 * HOUR,
    });
  });
});

describe('runRetentionJobs, edges', () => {
  it('survives a part that throws, says which one with its code, and leaves its counts at zero', async () => {
    const { ret, dir, users } = await fresh();
    writeJson(path.join(users, 'alice', 'data.json.deleted-1'), 'x');
    writePending(dir, [entry({ files: ['data.json.deleted-1'] })]);
    // the entry is purged, then writing the shortened list fails: the whole part throws
    failing('writeFileSync', (p) => p.endsWith('pending_deletions.json.tmp'), 'EIO');
    const r = recorder();
    const out = ret.runRetentionJobs(NOW, r.logger);
    expect(r.warn).toContain('[retention] pending deletions failed (EIO).');
    expect(out).toEqual({
      entriesPurged: 0, entriesFailed: 0, collectionsRemoved: 0, photosRemoved: 0, photosKept: 0,
      legacyCollectionsRemoved: 0, tombstoneCollectionsRewritten: 0, orphanPhotosRemoved: 0, unconfirmedRecipientsRemoved: 0,
    });
  });

  it('names every part when it fails', async () => {
    const { ret } = await fresh();
    // Every existsSync() call fails: each part reads pending_deletions.json or a collection first.
    const target = fsDefault as unknown as Record<string, (...a: unknown[]) => unknown>;
    const spy = vi.spyOn(target, 'existsSync').mockImplementation(() => { throw Object.assign(new Error('x'), { code: 'EIO' }); });
    syncBuiltinESMExports();
    restorers.push(() => { spy.mockRestore(); syncBuiltinESMExports(); });
    const r = recorder();
    ret.runRetentionJobs(NOW, r.logger);
    expect(r.warn).toContain('[retention] pending deletions failed (EIO).');
    expect(r.warn).toContain('[retention] legacy leftovers failed (EIO).');
  });

  it('writes one summary line with every count, each in its own place', async () => {
    const { ret, db, dir, users, photos } = await fresh();
    db.createUser('bob', 'hash');
    // a pending deletion: one collection file, one photo removed, one kept
    writeJson(path.join(users, 'alice', 'data.json.deleted-1'), 'x');
    putOldPhoto(photos, 'gone.png', NOW);
    db.recordPhotoOwner('kept.png', 'bob');
    putOldPhoto(photos, 'kept.png', NOW);
    writePending(dir, [entry({ files: ['data.json.deleted-1'], photos: ['gone.png', 'kept.png'] })]);
    // a legacy leftover, two stale markers in one collection, an orphan, an unconfirmed recipient
    writeJson(path.join(users, 'old', `data.json.deleted-${T0 - 40 * DAY}`), 'x');
    writeJson(path.join(users, 'bob', 'data.json'), collection({ polishes: [polish('p', undefined, T0 - 200 * DAY), polish('q', 'kept.png')] }));
    putOldPhoto(photos, 'orphan.png', NOW);
    db.createUser('carol', 'hash');
    db.setScheduleConfig('carol', { enabled: true, frequency: 'weekly', toEmail: 'friend@example.org', confirmSeq: 1, confirmSentAt: T0 } as never);

    const r = recorder();
    const out = ret.runRetentionJobs(NOW, r.logger);
    expect(out).toEqual({
      entriesPurged: 1, entriesFailed: 0, collectionsRemoved: 1, photosRemoved: 1, photosKept: 1,
      legacyCollectionsRemoved: 1, tombstoneCollectionsRewritten: 1, orphanPhotosRemoved: 1, unconfirmedRecipientsRemoved: 1,
    });
    expect(r.log).toEqual([
      '[retention] purged 1 admin deletion(s) (1 collection file(s), 1 photo(s) removed, 1 kept), 1 legacy leftover(s), '
      + '1 collection(s) cleaned of old deletion markers, 1 orphaned photo(s) removed, 1 unconfirmed report recipient(s) removed.',
    ]);
  });

  it('says nothing when there was nothing to do, whatever the other parts count', async () => {
    const { ret } = await fresh();
    const r = recorder();
    ret.runRetentionJobs(NOW, r.logger);
    expect(r.log).toEqual([]);
  });

  it('logs the summary for a run whose only result is one unconfirmed recipient, one orphan, or one rewritten collection', async () => {
    const { ret, db, users, photos } = await fresh();
    db.createUser('carol', 'hash');
    db.setScheduleConfig('carol', { enabled: true, frequency: 'weekly', toEmail: 'friend@example.org', confirmSeq: 1, confirmSentAt: T0 } as never);
    const only = recorder();
    ret.runRetentionJobs(NOW, only.logger);
    expect(only.log).toHaveLength(1);
    expect(only.log[0]).toContain('1 unconfirmed report recipient(s) removed.');

    writeJson(path.join(users, 'bob', 'data.json'), collection());
    putOldPhoto(photos, 'orphan.png', NOW);
    const orphan = recorder();
    ret.runRetentionJobs(NOW, orphan.logger);
    expect(orphan.log).toHaveLength(1);
    expect(orphan.log[0]).toContain('1 orphaned photo(s) removed');

    writeJson(path.join(users, 'bob', 'data.json'), collection({ polishes: [polish('p', undefined, T0 - 200 * DAY)] }));
    const marker = recorder();
    ret.runRetentionJobs(NOW, marker.logger);
    expect(marker.log).toHaveLength(1);
    expect(marker.log[0]).toContain('1 collection(s) cleaned of old deletion markers');
  });
});

describe('what the admin deletion records (#463)', () => {
  it('keeps the numbers the retention rests on', async () => {
    const { ret } = await fresh();
    expect(ret.ORPHAN_PHOTO_GRACE_DAYS).toBe(7);
    expect(ret.ORPHAN_PHOTO_GRACE_MS).toBe(7 * DAY);
    expect(ret.UNCONFIRMED_RECIPIENT_TTL_MS).toBe(48 * HOUR);
  });

  it('only sweeps files named like an upload, extension in any case, with the temporary suffix', async () => {
    const { ret, users, photos } = await fresh();
    writeJson(path.join(users, 'bob', 'data.json'), collection());
    const names = ['a.jpg', 'b.JPEG', 'c.png', 'd.webp', 'e.gif', 'f-g_h.png', 'i.png.tmp'];
    const foreign = ['readme.txt', 'x.bmp', '.hidden.png', 'a b.png', 'j.png.tmp.bak', 'k.svg'];
    for (const n of [...names, ...foreign]) putOldPhoto(photos, n, NOW);
    expect(ret.sweepOrphanPhotos(NOW, recorder().logger)).toMatchObject({ removed: names.length });
    expect(fs.readdirSync(photos).sort()).toEqual([...foreign].sort());
  });
});

describe('more edges (#498)', () => {
  it('does not take a file for a renamed collection just because its name ends like one', async () => {
    const { ret, dir, users } = await fresh();
    const lookalike = path.join(users, 'alice', 'old-data.json.deleted-1');
    writeJson(lookalike, 'keep');
    expect(ret.purgeLegacyDeletedCollections(T0 + 365 * DAY, recorder().logger)).toBe(0);
    expect(fs.existsSync(lookalike)).toBe(true);
    writePending(dir, [entry({ files: ['old-data.json.deleted-1'] })]);
    const r = recorder();
    expect(ret.purgePendingDeletions(NOW, r.logger)).toMatchObject({ entriesPurged: 1, collectionsRemoved: 0 });
    expect(r.warn).toEqual(['[retention] entry e1: unexpected collection file name skipped.']);
    expect(fs.existsSync(lookalike)).toBe(true);
  });

  it('records a new deletion on top of nothing when the pending file is corrupt, instead of inventing entries', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('alice', 'hash');
    const file = path.join(dir, 'pending_deletions.json');
    fs.writeFileSync(file, '{broken');
    const silent = recorder();
    const spy = vi.spyOn(console, 'warn').mockImplementation((m: string) => { silent.warn.push(m); });
    restorers.push(() => spy.mockRestore());
    ret.adminDeleteAccount('alice', T0);
    const { entries } = JSON.parse(fs.readFileSync(file, 'utf-8')) as { entries: { dir: string; deletedAt: number }[] };
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ dir: 'alice', deletedAt: T0 });
    expect(silent.warn).toHaveLength(1);
  });

  it.each([
    ['an entry with nothing to remove', { files: [] as string[], photos: [] as string[] }, { entriesPurged: 1, collectionsRemoved: 0, photosRemoved: 0 }],
    ['an entry with one collection file', { files: ['data.json.deleted-1'], photos: [] as string[] }, { entriesPurged: 1, collectionsRemoved: 1, photosRemoved: 0 }],
    ['an entry with one photo', { files: [] as string[], photos: ['p.png'] }, { entriesPurged: 1, collectionsRemoved: 0, photosRemoved: 1 }],
  ])('logs a summary for a run whose only work was %s', async (_n, recorded, expected) => {
    const { ret, dir, users, photos } = await fresh();
    if (recorded.files.length > 0) writeJson(path.join(users, 'alice', 'data.json.deleted-1'), 'x');
    writeJson(path.join(users, 'bob', 'data.json'), collection());
    if (recorded.photos.length > 0) writeJson(path.join(photos, 'p.png'), 'img'); // young: the orphan sweep leaves it to the entry
    writePending(dir, [entry(recorded)]);
    const r = recorder();
    const out = ret.runRetentionJobs(T0 + 30 * DAY, r.logger);
    expect(out).toMatchObject(expected);
    expect(out).toMatchObject({ legacyCollectionsRemoved: 0, tombstoneCollectionsRewritten: 0, orphanPhotosRemoved: 0, unconfirmedRecipientsRemoved: 0 });
    expect(r.log).toHaveLength(1);
  });

  it('logs a summary for a run whose only work was one legacy leftover', async () => {
    const { ret, users } = await fresh();
    writeJson(path.join(users, 'old', `data.json.deleted-${T0 - 40 * DAY}`), 'x');
    const r = recorder();
    expect(ret.runRetentionJobs(T0, r.logger)).toMatchObject({ legacyCollectionsRemoved: 1, entriesPurged: 0 });
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toContain('1 legacy leftover(s)');
  });

  it('names the part that failed, for each of the parts a logging failure can reach', async () => {
    const { ret, dir, users, photos } = await fresh();
    writeJson(path.join(users, 'bob', 'data.json'), '{ not json');
    putOldPhoto(photos, 'a.png', NOW);
    fs.writeFileSync(path.join(dir, 'schedule.json'), '{ nope');
    const warn: string[] = [];
    const logger = {
      log: () => undefined,
      // A warning about unparsable data cannot be written: that makes the part that raised it fail.
      warn: (m: string) => {
        warn.push(m);
        if (m.includes('could not be parsed')) throw Object.assign(new Error('log sink gone'), { code: 'EIO' });
      },
    };
    ret.runRetentionJobs(NOW, logger);
    expect(warn).toContain('[retention] deletion markers failed (EIO).');
    expect(warn).toContain('[retention] orphaned photos failed (EIO).');
    expect(warn).toContain('[retention] unconfirmed recipients failed (EIO).');
  });
});
