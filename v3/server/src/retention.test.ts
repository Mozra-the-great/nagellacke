import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AppData } from '@nagellacke/core';

/**
 * #463 (admin deletion: leftovers go after 30 days) and #464 (old deletion markers go
 * after 90 days). Time is injected through the `now` parameters; nothing here waits.
 * db.ts captures DATA_DIR at import, so every test gets fresh modules on a fresh dir.
 */
const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000; // the moment of the admin deletion

const silent = { log: vi.fn(), warn: vi.fn() };
const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  silent.log.mockClear();
  silent.warn.mockClear();
});

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-retention-test-'));
  tmpDirs.push(dir);
  process.env.DATA_DIR = dir;
  vi.resetModules();
  const db = await import('./db');
  const ret = await import('./retention');
  return { db, ret, dir };
}

const empty = (): AppData => ({ polishes: [], customCats: [], manicures: [], stickers: [] });
const polish = (id: string, photo?: string, deletedAt?: number) => ({
  id, name: id, brand: 'B', num: '1', color: '#fff', finish: ['Classic'], status: 'ok', createdAt: 1, updatedAt: 1,
  ...(photo ? { photo } : {}), ...(deletedAt === undefined ? {} : { deletedAt }),
});
const withPolishes = (...p: ReturnType<typeof polish>[]): AppData => ({ ...empty(), polishes: p as never });

function putPhoto(dir: string, name: string): string {
  const f = path.join(dir, 'photos', name);
  fs.writeFileSync(f, 'img');
  return f;
}

function aiJob(id: string, username: string) {
  return { id, type: 'autofill', status: 'done', username, input: {}, createdAt: 1, updatedAt: 1 } as never;
}

function pending(dir: string): { entries: { id: string; dir: string; deletedAt: number; files: string[]; photos: string[] }[] } {
  const f = path.join(dir, 'pending_deletions.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : { entries: [] };
}

/** An account with a collection, two uploaded photos and an AI job, deleted by an admin at T0. */
async function deletedAliceAt(t0 = T0) {
  const ctx = await fresh();
  const { db, dir } = ctx;
  db.createUser('alice', 'hash');
  db.createUser('bob', 'hash');
  const p1 = putPhoto(dir, 'alice-1.png');
  const p2 = putPhoto(dir, 'alice-2.png');
  db.recordPhotoOwner('alice-1.png', 'alice');
  db.recordPhotoOwner('alice-2.png', 'alice');
  db.setData('alice', withPolishes(polish('a1', 'alice-1.png'), polish('a2', 'alice-2.png')));
  db.addAiJob(aiJob('j-alice', 'alice'));
  db.addAiJob(aiJob('j-bob', 'bob'));
  ctx.ret.adminDeleteAccount('alice', t0);
  const renamed = path.join(dir, 'users', 'alice', `data.json.deleted-${t0}`);
  return { ...ctx, p1, p2, renamed };
}

describe('adminDeleteAccount (#463)', () => {
  it('captures the photo list before the ownership rows are dropped, and records the deletion time', async () => {
    const { db, dir, renamed } = await deletedAliceAt();
    expect(db.getUser('alice')).toBeUndefined();
    expect(db.photoOwner('alice-1.png')).toBeUndefined(); // deleteUser() dropped the rows ...
    const [entry] = pending(dir).entries;
    expect(entry.deletedAt).toBe(T0); // ... but the entry still knows them
    expect(entry.photos.sort()).toEqual(['alice-1.png', 'alice-2.png']);
    expect(entry.files).toEqual([`data.json.deleted-${T0}`]);
    expect(fs.existsSync(renamed)).toBe(true);
    expect(fs.statSync(path.join(dir, 'pending_deletions.json')).isFile()).toBe(true);
  });

  it('removes the account\'s AI jobs at once and leaves other accounts\' jobs alone', async () => {
    const { db } = await deletedAliceAt();
    expect(db.getAiJob('j-alice')).toBeUndefined();
    expect(db.getAiJob('j-bob')).toBeDefined();
  });

  it('does not record other accounts\' photos', async () => {
    const ctx = await fresh();
    ctx.db.createUser('alice', 'hash');
    ctx.db.createUser('bob', 'hash');
    putPhoto(ctx.dir, 'bob-1.png');
    ctx.db.recordPhotoOwner('bob-1.png', 'bob');
    ctx.ret.adminDeleteAccount('alice', T0);
    expect(pending(ctx.dir).entries[0].photos).toEqual([]);
  });

  it('keeps earlier entries when a second account is deleted', async () => {
    const ctx = await deletedAliceAt();
    ctx.ret.adminDeleteAccount('bob', T0 + DAY);
    expect(pending(ctx.dir).entries.map((e) => e.deletedAt)).toEqual([T0, T0 + DAY]);
  });
});

describe('purgePendingDeletions (#463)', () => {
  it('removes nothing at day 29 and everything at day 30', async () => {
    const { ret, dir, p1, p2, renamed } = await deletedAliceAt();

    const early = ret.purgePendingDeletions(T0 + 30 * DAY - 1, silent);
    expect(early.entriesPurged).toBe(0);
    expect(fs.existsSync(renamed) && fs.existsSync(p1) && fs.existsSync(p2)).toBe(true);
    expect(pending(dir).entries).toHaveLength(1);
    ret.purgePendingDeletions(T0 + 29 * DAY, silent);
    expect(fs.existsSync(renamed)).toBe(true);

    const result = ret.purgePendingDeletions(T0 + 30 * DAY, silent);
    expect(result).toMatchObject({ entriesPurged: 1, collectionsRemoved: 1, photosRemoved: 2, entriesFailed: 0 });
    expect(fs.existsSync(renamed)).toBe(false);
    expect(fs.existsSync(p1)).toBe(false);
    expect(fs.existsSync(p2)).toBe(false);
    expect(pending(dir).entries).toEqual([]);
    expect(fs.existsSync(path.join(dir, 'users', 'alice'))).toBe(false); // emptied directory goes too
  });

  it('is idempotent: a second run, or files already gone, is not an error', async () => {
    const { ret, p1 } = await deletedAliceAt();
    fs.rmSync(p1); // an operator removed one by hand
    const first = ret.purgePendingDeletions(T0 + 31 * DAY, silent);
    expect(first.entriesFailed).toBe(0);
    const second = ret.purgePendingDeletions(T0 + 32 * DAY, silent);
    expect(second).toEqual({ entriesPurged: 0, entriesFailed: 0, collectionsRemoved: 0, photosRemoved: 0, photosKept: 0 });
    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('keeps a photo another account\'s records reference, also one that appeared after the deletion', async () => {
    const { ret, db, p1, p2 } = await deletedAliceAt();
    db.setData('bob', withPolishes(polish('b1', 'alice-1.png'))); // reference added after the admin deletion
    const result = ret.purgePendingDeletions(T0 + 30 * DAY, silent);
    expect(result).toMatchObject({ photosRemoved: 1, photosKept: 1 });
    expect(fs.existsSync(p1)).toBe(true);
    expect(fs.existsSync(p2)).toBe(false);
  });

  it('keeps a photo that only a soft-deleted record of another account still references', async () => {
    const { ret, db, p1 } = await deletedAliceAt();
    db.setData('bob', withPolishes(polish('b1', 'alice-1.png', T0)));
    ret.purgePendingDeletions(T0 + 30 * DAY, silent);
    expect(fs.existsSync(p1)).toBe(true);
  });

  it('never touches a same-name account registered during the period', async () => {
    const { ret, db, dir, p1, renamed } = await deletedAliceAt();
    db.createUser('alice', 'hash2'); // registers again under the old name
    const newPhoto = putPhoto(dir, 'new-alice.png');
    db.recordPhotoOwner('new-alice.png', 'alice');
    db.setData('alice', withPolishes(polish('n1', 'new-alice.png')));
    db.addAiJob(aiJob('j-new', 'alice'));
    expect(db.getData('alice').polishes.map((p) => p.id)).toEqual(['n1']); // sees nothing of the old account
    expect(db.getAiJob('j-alice')).toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'users', 'alice', 'data.json'))).toBe(true);

    ret.purgePendingDeletions(T0 + 30 * DAY, silent);

    expect(fs.existsSync(renamed)).toBe(false);
    expect(fs.existsSync(p1)).toBe(false);
    expect(fs.existsSync(newPhoto)).toBe(true);
    expect(db.photoOwner('new-alice.png')).toBe('alice');
    expect(db.getUser('alice')).toBeDefined();
    expect(db.getData('alice').polishes.map((p) => p.id)).toEqual(['n1']);
    expect(db.getAiJob('j-new')).toBeDefined();
  });

  it('keeps the new same-name account\'s photo even if it references an old filename', async () => {
    const { ret, db, p2 } = await deletedAliceAt();
    db.createUser('alice', 'hash2');
    db.setData('alice', withPolishes(polish('n1', 'alice-2.png')));
    ret.purgePendingDeletions(T0 + 30 * DAY, silent);
    expect(fs.existsSync(p2)).toBe(true);
  });

  it('one failing entry does not stop the others and is retried', async () => {
    const { ret, db, dir } = await deletedAliceAt();
    // bob is deleted a day later; his "collection" is a directory, which rm without
    // recursive refuses, so his entry fails.
    db.setData('bob', empty());
    ret.adminDeleteAccount('bob', T0 + DAY);
    const bobFile = path.join(dir, 'users', 'bob', `data.json.deleted-${T0 + DAY}`);
    fs.rmSync(bobFile);
    fs.mkdirSync(bobFile);
    fs.writeFileSync(path.join(bobFile, 'x'), '1');

    const result = ret.purgePendingDeletions(T0 + 31 * DAY, silent);
    expect(result).toMatchObject({ entriesPurged: 2 - 1, entriesFailed: 1 });
    expect(pending(dir).entries).toHaveLength(1);
    expect(silent.warn).toHaveBeenCalledTimes(1);
    const logged = String(silent.warn.mock.calls[0][0]);
    expect(logged).not.toMatch(/bob|alice/i); // no personal data in the log

    fs.rmSync(bobFile, { recursive: true });
    const retry = ret.purgePendingDeletions(T0 + 32 * DAY, silent);
    expect(retry.entriesPurged).toBe(1);
    expect(pending(dir).entries).toEqual([]);
  });

  it('refuses paths that would leave the photo or user-data root', async () => {
    const { ret, dir } = await fresh();
    const outside = path.join(dir, 'outside.txt');
    fs.writeFileSync(outside, 'keep');
    fs.writeFileSync(path.join(dir, 'users.json'), '[]');
    fs.mkdirSync(path.join(dir, 'users'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pending_deletions.json'), JSON.stringify({
      v: 1,
      entries: [{
        id: 'evil', dir: '..', deletedAt: T0,
        files: ['../outside.txt', 'data.json.deleted-1'],
        photos: ['../outside.txt', '..', '.', '', '../users.json', 'sub/../../outside.txt'],
      }],
    }));
    const result = ret.purgePendingDeletions(T0 + 40 * DAY, silent);
    expect(result.photosRemoved + result.collectionsRemoved).toBe(0);
    expect(fs.readFileSync(outside, 'utf-8')).toBe('keep');
    expect(fs.existsSync(path.join(dir, 'users.json'))).toBe(true);
  });

  it('ignores an entry for an account that still exists (crash between recording and deleting)', async () => {
    const { db, ret, dir } = await fresh();
    db.createUser('carol', 'hash');
    const photo = putPhoto(dir, 'carol-1.png');
    db.recordPhotoOwner('carol-1.png', 'carol');
    // What adminDeleteAccount() writes first - and then the process died.
    fs.writeFileSync(path.join(dir, 'pending_deletions.json'), JSON.stringify({
      v: 1, entries: [{ id: 'x', dir: 'carol', deletedAt: T0, files: [`data.json.deleted-${T0}`], photos: ['carol-1.png'] }],
    }));
    const result = ret.purgePendingDeletions(T0 + 31 * DAY, silent);
    expect(result.photosKept).toBe(1);
    expect(fs.existsSync(photo)).toBe(true);
    expect(db.photoOwner('carol-1.png')).toBe('carol');
  });

  it('does not delete photos while a collection cannot be parsed, and retries later', async () => {
    const { ret, db, dir, p1 } = await deletedAliceAt();
    db.setData('bob', empty());
    fs.writeFileSync(path.join(dir, 'users', 'bob', 'data.json'), '{ not json');
    const result = ret.purgePendingDeletions(T0 + 30 * DAY, silent);
    expect(result.entriesFailed).toBe(1);
    expect(fs.existsSync(p1)).toBe(true);
    expect(pending(dir).entries).toHaveLength(1);
    fs.writeFileSync(path.join(dir, 'users', 'bob', 'data.json'), JSON.stringify(empty()));
    expect(ret.purgePendingDeletions(T0 + 31 * DAY, silent).entriesPurged).toBe(1);
    expect(fs.existsSync(p1)).toBe(false);
  });

  it('moves an unparseable pending file aside instead of overwriting it', async () => {
    const { ret, dir } = await fresh();
    fs.writeFileSync(path.join(dir, 'pending_deletions.json'), '{ broken');
    expect(ret.purgePendingDeletions(T0, silent).entriesPurged).toBe(0);
    expect(fs.existsSync(path.join(dir, 'pending_deletions.json'))).toBe(false);
    expect(fs.readdirSync(dir).some((f) => f.startsWith('pending_deletions.json.corrupt-'))).toBe(true);
    expect(silent.warn).toHaveBeenCalled();
  });

  it('survives a restart: the schedule is read from disk by a fresh module graph', async () => {
    const { dir, p1, renamed } = await deletedAliceAt();
    vi.resetModules();
    const ret2 = await import('./retention');
    expect(ret2.purgePendingDeletions(T0 + 29 * DAY, silent).entriesPurged).toBe(0);
    expect(ret2.purgePendingDeletions(T0 + 30 * DAY, silent).entriesPurged).toBe(1);
    expect(fs.existsSync(p1) || fs.existsSync(renamed)).toBe(false);
    expect(pending(dir).entries).toEqual([]);
  });

  it('uses one named 30-day constant', async () => {
    const { ret } = await fresh();
    expect(ret.ADMIN_DELETION_RETENTION_DAYS).toBe(30);
    expect(ret.ADMIN_DELETION_RETENTION_MS).toBe(30 * DAY);
  });
});

describe('purgeLegacyDeletedCollections (#463)', () => {
  it('purges leftovers from before the entry file by the timestamp in their name', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('live', 'hash');
    db.setData('live', withPolishes(polish('keep')));
    const d = path.join(dir, 'users', 'ghost');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, `data.json.deleted-${T0}`), '{}');
    fs.writeFileSync(path.join(d, 'notes.txt'), 'not ours');
    // a leftover inside the directory of a current account (registered under the same name later)
    fs.writeFileSync(path.join(dir, 'users', 'live', `data.json.deleted-${T0}`), '{}');

    expect(ret.purgeLegacyDeletedCollections(T0 + 29 * DAY, silent)).toBe(0);
    expect(fs.existsSync(path.join(d, `data.json.deleted-${T0}`))).toBe(true);

    expect(ret.purgeLegacyDeletedCollections(T0 + 30 * DAY, silent)).toBe(2);
    expect(fs.existsSync(path.join(d, `data.json.deleted-${T0}`))).toBe(false);
    expect(fs.existsSync(path.join(d, 'notes.txt'))).toBe(true); // foreign files and non-empty dirs stay
    expect(fs.existsSync(path.join(dir, 'users', 'live', `data.json.deleted-${T0}`))).toBe(false);
    expect(db.getData('live').polishes.map((p) => p.id)).toEqual(['keep']);
    expect(ret.purgeLegacyDeletedCollections(T0 + 31 * DAY, silent)).toBe(0);
  });

  it('leaves files an entry covers to that entry, and never touches photos', async () => {
    const { ret, dir, renamed, p1 } = await deletedAliceAt();
    expect(ret.purgeLegacyDeletedCollections(T0 + 30 * DAY, silent)).toBe(0);
    expect(fs.existsSync(renamed)).toBe(true);
    expect(fs.existsSync(p1)).toBe(true);
    expect(pending(dir).entries).toHaveLength(1);
  });

  it('ignores names whose timestamp is not a plain number', async () => {
    const { ret, dir } = await fresh();
    const d = path.join(dir, 'users', 'x');
    fs.mkdirSync(d, { recursive: true });
    for (const n of ['data.json.deleted-', 'data.json.deleted-abc', 'data.json.deleted-1e3', 'data.json.deleted-99999999999999999999999']) {
      fs.writeFileSync(path.join(d, n), '{}');
    }
    expect(ret.purgeLegacyDeletedCollections(T0, silent)).toBe(0);
    expect(fs.readdirSync(d)).toHaveLength(4);
  });
});

describe('purgeStoredTombstones (#464)', () => {
  const store = (dir: string, user: string, data: unknown) => {
    const d = path.join(dir, 'users', user);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'data.json'), typeof data === 'string' ? data : JSON.stringify(data));
    return path.join(d, 'data.json');
  };
  const NOW = T0;

  it('drops markers from day 90 on, keeps day 89 and live entries, in every collection', async () => {
    const { ret, dir } = await fresh();
    const file = store(dir, 'anna', {
      polishes: [polish('old', undefined, NOW - 90 * DAY), polish('young', undefined, NOW - 89 * DAY), polish('live')],
      customCats: [{ id: 'c', label: 'c', updatedAt: 1, deletedAt: NOW - 120 * DAY }],
      manicures: [{ id: 'm', date: '2026-01-01', createdAt: 1, updatedAt: 1, deletedAt: NOW - 120 * DAY }],
      stickers: [{ id: 's', name: 's', type: 'accent', status: 'ok', createdAt: 1, updatedAt: 1, deletedAt: NOW - 120 * DAY }],
      futureField: { keep: true },
    });
    expect(ret.purgeStoredTombstones(NOW, silent)).toBe(1);
    const out = JSON.parse(fs.readFileSync(file, 'utf-8')) as AppData & { futureField: unknown };
    expect(out.polishes.map((p) => p.id)).toEqual(['young', 'live']);
    expect(out.customCats).toEqual([]);
    expect(out.manicures).toEqual([]);
    expect(out.stickers).toEqual([]);
    expect(out.futureField).toEqual({ keep: true });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it('is idempotent and does not rewrite a file with nothing to purge', async () => {
    const { ret, dir } = await fresh();
    const file = store(dir, 'anna', '{"polishes": [ ], "customCats": []}');
    const before = fs.readFileSync(file, 'utf-8');
    expect(ret.purgeStoredTombstones(NOW, silent)).toBe(0);
    expect(fs.readFileSync(file, 'utf-8')).toBe(before); // not even re-serialised
    store(dir, 'bea', { ...empty(), polishes: [polish('old', undefined, NOW - 200 * DAY)] });
    expect(ret.purgeStoredTombstones(NOW, silent)).toBe(1);
    expect(ret.purgeStoredTombstones(NOW, silent)).toBe(0);
  });

  it('leaves a file it cannot parse untouched and says so without naming it', async () => {
    const { ret, dir } = await fresh();
    const bad = store(dir, 'broken-user', '{ nope');
    const arr = store(dir, 'array-user', '[1,2]');
    store(dir, 'ok', { ...empty(), polishes: [polish('old', undefined, NOW - 200 * DAY)] });
    expect(ret.purgeStoredTombstones(NOW, silent)).toBe(1);
    expect(fs.readFileSync(bad, 'utf-8')).toBe('{ nope');
    expect(fs.readFileSync(arr, 'utf-8')).toBe('[1,2]');
    expect(silent.warn).toHaveBeenCalledTimes(1);
    expect(String(silent.warn.mock.calls[0][0])).not.toMatch(/broken-user|array-user/);
  });

  it('does not touch the renamed deletion leftovers', async () => {
    const { ret, dir } = await fresh();
    const d = path.join(dir, 'users', 'x');
    fs.mkdirSync(d, { recursive: true });
    const left = path.join(d, 'data.json.deleted-5');
    const body = JSON.stringify({ ...empty(), polishes: [polish('old', undefined, 1)] });
    fs.writeFileSync(left, body);
    expect(ret.purgeStoredTombstones(NOW, silent)).toBe(0);
    expect(fs.readFileSync(left, 'utf-8')).toBe(body);
  });
});

describe('runRetentionJobs', () => {
  it('runs all three parts, reports counts only, and a second run does nothing', async () => {
    const { ret, db, dir, renamed } = await deletedAliceAt();
    db.setData('bob', { ...empty(), polishes: [polish('old', undefined, T0 - 100 * DAY)] as never });
    const first = ret.runRetentionJobs(T0 + 31 * DAY, silent);
    expect(first).toMatchObject({ entriesPurged: 1, photosRemoved: 2, tombstoneCollectionsRewritten: 1 });
    expect(fs.existsSync(renamed)).toBe(false);
    expect(db.getData('bob').polishes).toEqual([]);
    expect(silent.log).toHaveBeenCalledTimes(1);
    expect(String(silent.log.mock.calls[0][0])).not.toMatch(/alice|bob|\.png/);
    const second = ret.runRetentionJobs(T0 + 32 * DAY, silent);
    expect(second).toMatchObject({ entriesPurged: 0, photosRemoved: 0, tombstoneCollectionsRewritten: 0 });
    expect(silent.log).toHaveBeenCalledTimes(1); // quiet when there was nothing to do
    expect(pending(dir).entries).toEqual([]);
  });

  it('never removes data of users that were not deleted', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('dora', 'hash');
    putPhoto(dir, 'dora.png');
    db.recordPhotoOwner('dora.png', 'dora');
    db.setData('dora', withPolishes(polish('d1', 'dora.png')));
    db.addAiJob(aiJob('j-dora', 'dora'));
    ret.runRetentionJobs(T0 + 1000 * DAY, silent);
    expect(fs.existsSync(path.join(dir, 'photos', 'dora.png'))).toBe(true);
    expect(db.getData('dora').polishes.map((p) => p.id)).toEqual(['d1']);
    expect(db.getAiJob('j-dora')).toBeDefined();
    expect(db.getUser('dora')).toBeDefined();
  });
});

describe('sweepOrphanPhotos (#465)', () => {
  const NOW = T0 + 500 * DAY;
  const GRACE = 7 * DAY;

  /** A photo file whose mtime is `age` ms before NOW. */
  function oldPhoto(dir: string, name: string, age: number): string {
    const f = putPhoto(dir, name);
    const t = (NOW - age) / 1000;
    fs.utimesSync(f, t, t);
    return f;
  }
  const exists = (f: string): boolean => fs.existsSync(f);

  it('removes an unreferenced photo older than the grace period and forgets its owner', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setData('alice', withPolishes(polish('p1', 'kept.png')));
    const orphan = oldPhoto(dir, 'orphan.png', GRACE + 1000);
    const kept = oldPhoto(dir, 'kept.png', 100 * DAY);
    db.recordPhotoOwner('orphan.png', 'alice');
    const s = ret.sweepOrphanPhotos(NOW, silent);
    expect(s).toMatchObject({ removed: 1, referenced: 1, withinGrace: 0, failed: 0, skipped: false });
    expect(exists(orphan)).toBe(false);
    expect(exists(kept)).toBe(true);
    expect(db.photoOwner('orphan.png')).toBeUndefined();
  });

  it('keeps a photo that any collection references: stickers, manicure slots, legacy field, other accounts, soft-deleted records', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.createUser('bob', 'hash');
    db.setData('alice', {
      ...empty(),
      polishes: [polish('p1', 'a-polish.png'), polish('p2', 'a-deleted.png', NOW - 10 * DAY)] as never,
      stickers: [{ id: 's1', photo: 'a-sticker.png' }] as never,
      manicures: [{ id: 'm1', photo: 'a-legacy.png', photos: { thumb: 'a-slot.png' } }] as never,
    });
    db.setData('bob', withPolishes(polish('b1', 'b-polish.png')));
    const names = ['a-polish.png', 'a-deleted.png', 'a-sticker.png', 'a-legacy.png', 'a-slot.png', 'b-polish.png'];
    const files = names.map((n) => oldPhoto(dir, n, 100 * DAY));
    expect(ret.sweepOrphanPhotos(NOW, silent)).toMatchObject({ removed: 0, referenced: 6 });
    for (const f of files) expect(exists(f)).toBe(true);
  });

  it('never removes a photo younger than the grace period; the boundary is exactly 7 days', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setData('alice', empty());
    const young = oldPhoto(dir, 'young.png', GRACE - 1000);
    const edge = oldPhoto(dir, 'edge.png', GRACE);
    const future = putPhoto(dir, 'future.png');
    fs.utimesSync(future, (NOW + DAY) / 1000, (NOW + DAY) / 1000);
    const s = ret.sweepOrphanPhotos(NOW, silent);
    expect(s).toMatchObject({ removed: 1, withinGrace: 2 });
    expect(exists(young)).toBe(true);
    expect(exists(future)).toBe(true);
    expect(exists(edge)).toBe(false);
  });

  it('judges photos without a recorded uploader and those of existing accounts like any other', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setData('alice', empty());
    const apiKeyUpload = oldPhoto(dir, 'apikey.jpg', 30 * DAY); // no owner row: X-Api-Key upload
    const previewOnly = oldPhoto(dir, 'preview.webp', 30 * DAY);
    db.recordPhotoOwner('preview.webp', 'alice'); // uploaded, never referenced
    expect(ret.sweepOrphanPhotos(NOW, silent).removed).toBe(2);
    expect(exists(apiKeyUpload)).toBe(false);
    expect(exists(previewOnly)).toBe(false);
  });

  it('keeps the photos of an admin-deleted account for the whole deletion period, then they are removed', async () => {
    const { ret, db, dir, p1, p2, renamed } = await deletedAliceAt();
    for (const f of [p1, p2]) fs.utimesSync(f, (T0 - 40 * DAY) / 1000, (T0 - 40 * DAY) / 1000);
    db.setData('bob', empty());
    // Day 10: collection renamed and entry recorded -> both protect the photos.
    expect(ret.sweepOrphanPhotos(T0 + 10 * DAY, silent)).toMatchObject({ removed: 0, referenced: 2 });
    // The entry file is lost: the renamed collection alone still protects them.
    fs.rmSync(path.join(dir, 'pending_deletions.json'));
    expect(ret.sweepOrphanPhotos(T0 + 20 * DAY, silent).removed).toBe(0);
    // Only the entry is left (renamed collection gone): the recorded list protects them.
    fs.rmSync(renamed);
    fs.writeFileSync(path.join(dir, 'pending_deletions.json'), JSON.stringify({
      v: 1, entries: [{ id: 'e1', dir: 'alice', deletedAt: T0, files: [], photos: ['alice-1.png', 'alice-2.png'] }],
    }));
    expect(ret.sweepOrphanPhotos(T0 + 20 * DAY, silent).removed).toBe(0);
    // Neither is left: orphans.
    fs.rmSync(path.join(dir, 'pending_deletions.json'));
    expect(ret.sweepOrphanPhotos(T0 + 20 * DAY, silent).removed).toBe(2);
  });

  it('removes the photos of a legacy deletion once its collection is purged (runRetentionJobs order)', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('bob', 'hash');
    db.setData('bob', empty());
    fs.mkdirSync(path.join(dir, 'users', 'old'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'users', 'old', `data.json.deleted-${T0}`), JSON.stringify(withPolishes(polish('x', 'legacy.png'))));
    const photo = putPhoto(dir, 'legacy.png');
    fs.utimesSync(photo, (T0 - 5 * DAY) / 1000, (T0 - 5 * DAY) / 1000);
    ret.runRetentionJobs(T0 + 29 * DAY, silent);
    expect(exists(photo)).toBe(true);
    ret.runRetentionJobs(T0 + 31 * DAY, silent);
    expect(exists(photo)).toBe(false);
  });

  it('judges the photo of a purged deletion marker only after the marker is gone (day 89 vs day 90)', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setData('alice', withPolishes(polish('p89', 'p89.png', NOW - 89 * DAY), polish('p90', 'p90.png', NOW - 90 * DAY)));
    const f89 = oldPhoto(dir, 'p89.png', 120 * DAY);
    const f90 = oldPhoto(dir, 'p90.png', 120 * DAY);
    const out = ret.runRetentionJobs(NOW, silent);
    expect(out.orphanPhotosRemoved).toBe(1);
    expect(exists(f89)).toBe(true);
    expect(exists(f90)).toBe(false);
    expect(db.getData('alice').polishes.map((p) => p.id)).toEqual(['p89']);
  });

  it('judges nothing while a collection cannot be parsed, then catches up', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setData('alice', empty());
    fs.mkdirSync(path.join(dir, 'users', 'broken'), { recursive: true });
    const broken = path.join(dir, 'users', 'broken', 'data.json');
    fs.writeFileSync(broken, '{not json');
    const orphan = oldPhoto(dir, 'orphan.png', 30 * DAY);
    const s = ret.sweepOrphanPhotos(NOW, silent);
    expect(s).toMatchObject({ removed: 0, skipped: true });
    expect(exists(orphan)).toBe(true);
    expect(silent.warn).toHaveBeenCalledTimes(1);
    expect(String(silent.warn.mock.calls[0][0])).not.toMatch(/broken|orphan\.png/);
    fs.writeFileSync(broken, '[]'); // valid JSON but not a collection counts as unreadable too
    expect(ret.sweepOrphanPhotos(NOW, silent).skipped).toBe(true);
    fs.writeFileSync(broken, JSON.stringify(empty()));
    expect(ret.sweepOrphanPhotos(NOW, silent)).toMatchObject({ removed: 1, skipped: false });
    expect(exists(orphan)).toBe(false);
  });

  it('judges nothing when no collection exists at all (empty or wrongly mounted data)', async () => {
    const { ret, dir } = await fresh();
    const photo = oldPhoto(dir, 'lonely.png', 30 * DAY);
    expect(ret.sweepOrphanPhotos(NOW, silent)).toMatchObject({ removed: 0, skipped: true });
    expect(exists(photo)).toBe(true);
  });

  it('copes with a missing photo directory and an empty one', async () => {
    const { ret, dir } = await fresh();
    expect(ret.sweepOrphanPhotos(NOW, silent)).toMatchObject({ removed: 0, skipped: false });
    fs.rmSync(path.join(dir, 'photos'), { recursive: true });
    expect(ret.sweepOrphanPhotos(NOW, silent)).toMatchObject({ removed: 0, failed: 0, skipped: false });
    expect(silent.warn).not.toHaveBeenCalled();
  });

  it('only touches files named like uploads: not directories, symlinks, dotfiles or foreign names', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setData('alice', empty());
    const photos = path.join(dir, 'photos');
    const dirNamedLikePhoto = path.join(photos, 'folder.png');
    fs.mkdirSync(dirNamedLikePhoto);
    fs.writeFileSync(path.join(dirNamedLikePhoto, 'inner.png'), 'x');
    const foreign = [oldPhoto(dir, 'notes.txt', 30 * DAY), oldPhoto(dir, '.gitkeep', 30 * DAY), oldPhoto(dir, 'photo.png.bak', 30 * DAY)];
    const outside = path.join(dir, 'outside.png');
    fs.writeFileSync(outside, 'x');
    fs.utimesSync(outside, (NOW - 30 * DAY) / 1000, (NOW - 30 * DAY) / 1000);
    let symlinked = true;
    try { fs.symlinkSync(outside, path.join(photos, 'link.png')); } catch { symlinked = false; } // needs privileges on Windows
    const s = ret.sweepOrphanPhotos(NOW, silent);
    expect(s).toMatchObject({ removed: 0, failed: 0 });
    expect(exists(path.join(dirNamedLikePhoto, 'inner.png'))).toBe(true);
    for (const f of foreign) expect(exists(f)).toBe(true);
    expect(exists(outside)).toBe(true);
    if (symlinked) expect(fs.lstatSync(path.join(photos, 'link.png')).isSymbolicLink()).toBe(true);
  });

  it('removes a stale interrupted upload (.tmp) but not a fresh one', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setData('alice', empty());
    const stale = oldPhoto(dir, 'a1b2.png.tmp', 30 * DAY);
    const recent = oldPhoto(dir, 'c3d4.png.tmp', 60 * 1000);
    ret.sweepOrphanPhotos(NOW, silent);
    expect(exists(stale)).toBe(false);
    expect(exists(recent)).toBe(true);
  });

  it('is idempotent and logs counts only', async () => {
    const { ret, db, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setData('alice', empty());
    oldPhoto(dir, 'secret-name.png', 30 * DAY);
    const log = { log: vi.fn(), warn: vi.fn() };
    const first = ret.runRetentionJobs(NOW, log);
    expect(first.orphanPhotosRemoved).toBe(1);
    expect(log.log).toHaveBeenCalledTimes(1);
    expect(String(log.log.mock.calls[0][0])).toMatch(/1 orphaned photo\(s\) removed/);
    expect(String(log.log.mock.calls[0][0])).not.toMatch(/secret|\.png/);
    expect(ret.runRetentionJobs(NOW, log).orphanPhotosRemoved).toBe(0);
    expect(log.log).toHaveBeenCalledTimes(1);
    expect(ret.sweepOrphanPhotos(NOW, silent)).toMatchObject({ removed: 0, failed: 0 });
  });
});
