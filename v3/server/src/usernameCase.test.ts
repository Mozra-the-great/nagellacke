import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * #445: usernames are compared and stored in canonical form (NFKC + lowercase).
 * Covers the HTTP behaviour (register / login / admin create), the data-dir path
 * and the startup migration of pre-#445 installs, including refusing to start on
 * a collision.
 */

const tmpDirs: string[] = [];

function mkTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-case-test-'));
  tmpDirs.push(dir);
  return dir;
}

function setEnv(dir: string): void {
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.ALLOW_REGISTRATION = 'true';
  vi.resetModules();
}

async function createTestApp(dir: string = mkTmp()) {
  setEnv(dir);
  const mod = await import('./index');
  const db = await import('./db');
  const app: FastifyInstance = await mod.buildApp();
  return { app, db, dir };
}

async function freshDb(dir: string = mkTmp()) {
  process.env.DATA_DIR = dir;
  vi.resetModules();
  const db = await import('./db');
  return { db, dir };
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.ALLOW_REGISTRATION;
});

const PASSWORD = 'password123';

function catIds(file: string): string[] {
  return (JSON.parse(fs.readFileSync(file, 'utf-8')) as { customCats: { id: string }[] }).customCats.map((c) => c.id);
}

const cat = (id: string) => ({ id, label: id, updatedAt: 1 });

function post(app: FastifyInstance, url: string, payload: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url, payload, headers });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('canonicalUsername', () => {
  it('lowercases, folds NFKC look-alikes and is idempotent', async () => {
    const { db } = await freshDb();
    expect(db.canonicalUsername('ALICE')).toBe('alice');
    expect(db.canonicalUsername('Alice')).toBe('alice');
    expect(db.canonicalUsername('ＡＬＩＣＥ')).toBe('alice');          // full-width
    expect(db.canonicalUsername('Straße')).toBe('straße');
    for (const n of ['ALICE', 'ＡＬＩＣＥ', 'İstanbul', 'ǅ', 'ﷺ', 'Ünï']) {
      const once = db.canonicalUsername(n);
      expect(db.canonicalUsername(once)).toBe(once);
    }
    expect(db.sameUsername('Alice', 'aLICE')).toBe(true);
    expect(db.sameUsername('alice', 'bob')).toBe(false);
  });
});

describe('POST /api/auth/register (#445)', () => {
  it('rejects a case variant of an existing name with 409', async () => {
    const { app } = await createTestApp();
    expect((await post(app, '/api/auth/register', { username: 'alice', password: PASSWORD })).statusCode).toBe(200);
    for (const variant of ['ALICE', 'Alice', 'aLiCe', 'ＡＬＩＣＥ']) {
      const res = await post(app, '/api/auth/register', { username: variant, password: PASSWORD });
      expect(res.statusCode, variant).toBe(409);
    }
  });

  it('rejects the lowercase form of an earlier mixed-case registration', async () => {
    const { app } = await createTestApp();
    expect((await post(app, '/api/auth/register', { username: 'Bob', password: PASSWORD })).statusCode).toBe(200);
    expect((await post(app, '/api/auth/register', { username: 'bob', password: PASSWORD })).statusCode).toBe(409);
  });

  it('stores the canonical (lowercase) name and issues tokens for it', async () => {
    const { app, db } = await createTestApp();
    const res = await post(app, '/api/auth/register', { username: 'MiXed', password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(db.getUser('mixed')?.username).toBe('mixed');
    const token = (res.json() as { token: string }).token;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(token) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { username: string }).username).toBe('mixed');
    expect(db.getUserCount()).toBe(1);
  });

  it('measures the length limit on the canonical form', async () => {
    const { app } = await createTestApp();
    // U+FDFA expands to 18 characters under NFKC: 4 of them are 72 > 64.
    const res = await post(app, '/api/auth/register', { username: 'ﷺﷺﷺﷺ', password: PASSWORD });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/auth/login (#445)', () => {
  it('works with any case of the registered name', async () => {
    const { app } = await createTestApp();
    await post(app, '/api/auth/register', { username: 'alice', password: PASSWORD });
    for (const variant of ['alice', 'ALICE', 'Alice']) {
      const res = await post(app, '/api/auth/login', { username: variant, password: PASSWORD });
      expect(res.statusCode, variant).toBe(200);
      expect((res.json() as { token?: string }).token).toBeTruthy();
    }
    expect((await post(app, '/api/auth/login', { username: 'ALICE', password: 'wrong-password' })).statusCode).toBe(401);
  });

  it('counts failed attempts of all case variants against the one account lockout', async () => {
    const { app, db } = await createTestApp();
    await post(app, '/api/auth/register', { username: 'alice', password: PASSWORD });
    await post(app, '/api/auth/login', { username: 'ALICE', password: 'wrong-password' });
    await post(app, '/api/auth/login', { username: 'Alice', password: 'wrong-password' });
    expect(db.getUser('alice')?.login_fail_count).toBe(2);
  });

  it('keeps a token minted with the old spelling of the name working and canonicalises it', async () => {
    const { app, db } = await createTestApp();
    await post(app, '/api/auth/register', { username: 'alice', password: PASSWORD });
    const token = app.jwt.sign({ username: 'ALICE', tokenVersion: 0, typ: 'access' });
    db.setData('alice', { polishes: [], customCats: [], manicures: [], stickers: [] });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(token) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { username: string }).username).toBe('alice');
  });
});

describe('POST /api/admin/users (#445)', () => {
  it('refuses a case variant of an existing account with 409', async () => {
    const { app } = await createTestApp();
    const reg = await post(app, '/api/auth/register', { username: 'admin', password: PASSWORD });   // first user = admin
    const token = (reg.json() as { token: string }).token;
    expect((await post(app, '/api/admin/users', { username: 'Carol', password: PASSWORD }, auth(token))).statusCode).toBe(200);
    expect((await post(app, '/api/admin/users', { username: 'CAROL', password: PASSWORD }, auth(token))).statusCode).toBe(409);
    expect((await post(app, '/api/admin/users', { username: 'ADMIN', password: PASSWORD }, auth(token))).statusCode).toBe(409);
  });

  it('does not let an admin delete their own account through a case variant', async () => {
    const { app } = await createTestApp();
    const reg = await post(app, '/api/auth/register', { username: 'admin', password: PASSWORD });
    const token = (reg.json() as { token: string }).token;
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/users/ADMIN', headers: auth(token) });
    expect(res.statusCode).toBe(409);
  });
});

describe('data dir path (#445)', () => {
  it('derives from the canonical name, whatever case the caller uses', async () => {
    const { db, dir } = await freshDb();
    db.createUser('alice', 'hash');
    const data = { polishes: [], customCats: [cat('x')], manicures: [], stickers: [] };
    db.setData('ALICE', data);
    expect(fs.readdirSync(path.join(dir, 'users'))).toEqual(['alice']);
    expect(fs.existsSync(path.join(dir, 'users', 'alice', 'data.json'))).toBe(true);
    expect(db.getData('Alice').customCats.map((c) => c.id)).toEqual(['x']);
    expect(db.getData('alice').customCats.map((c) => c.id)).toEqual(['x']);
  });

  it('createUser refuses a case-variant duplicate even when the caller skipped the pre-check', async () => {
    const { db } = await freshDb();
    db.createUser('alice', 'hash');
    expect(() => db.createUser('ALICE', 'hash')).toThrow('username already exists');
    expect(db.getUserCount()).toBe(1);
  });

  it('keeps the existing path-traversal escaping', async () => {
    const { db, dir } = await freshDb();
    db.createUser('../../Etc', 'hash');
    db.setData('../../ETC', { polishes: [], customCats: [], manicures: [], stickers: [] });
    const entries = fs.readdirSync(path.join(dir, 'users'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toContain('/');
    expect(entries[0]).not.toContain('..');
  });
});

describe('migrateUsernamesToCanonical (#445)', () => {
  const EMPTY = { polishes: [], customCats: [], manicures: [], stickers: [] };

  function writeUsers(dir: string, names: string[]): void {
    fs.writeFileSync(
      path.join(dir, 'users.json'),
      JSON.stringify(names.map((username, i) => ({ username, password_hash: 'h', created_at: 1000 + i, role: i === 0 ? 'admin' : undefined }))),
    );
  }

  function writeUserData(dir: string, dirName: string, marker: string): void {
    fs.mkdirSync(path.join(dir, 'users', dirName), { recursive: true });
    fs.writeFileSync(path.join(dir, 'users', dirName, 'data.json'), JSON.stringify({ ...EMPTY, customCats: [cat(marker)] }));
  }

  function storedNames(dir: string): string[] {
    return (JSON.parse(fs.readFileSync(path.join(dir, 'users.json'), 'utf-8')) as { username: string }[]).map((u) => u.username);
  }

  it('is a no-op on an empty install and on already canonical data', async () => {
    const { db, dir } = await freshDb();
    expect(() => db.migrateUsernamesToCanonical()).not.toThrow();
    writeUsers(dir, ['alice', 'bob']);
    writeUserData(dir, 'alice', 'a');
    const before = fs.readFileSync(path.join(dir, 'users.json'), 'utf-8');
    db.migrateUsernamesToCanonical();
    expect(fs.readFileSync(path.join(dir, 'users.json'), 'utf-8')).toBe(before);
    expect(db.getData('alice').customCats.map((c) => c.id)).toEqual(['a']);
  });

  it('renames a mixed-case account with its data dir, schedule, photo owners and AI jobs, and is idempotent', async () => {
    const { db, dir } = await freshDb();
    writeUsers(dir, ['Alice', 'bob']);
    writeUserData(dir, 'Alice', 'alice-data');
    writeUserData(dir, 'bob', 'bob-data');
    fs.writeFileSync(path.join(dir, 'schedule.json'), JSON.stringify({
      v: 2, schedules: { Alice: { enabled: true, frequency: 'weekly', toEmail: 'a@x.org', username: 'Alice' }, bob: { enabled: false, frequency: 'monthly', toEmail: '', username: 'bob' } },
    }));
    fs.writeFileSync(path.join(dir, 'photo_owners.json'), JSON.stringify({ 'a.png': 'Alice', 'b.png': 'bob' }));
    fs.writeFileSync(path.join(dir, 'ai_jobs.json'), JSON.stringify([{ id: 'j1', type: 'autofill', status: 'done', username: 'Alice', createdAt: 1, updatedAt: 1 }]));

    db.migrateUsernamesToCanonical();

    expect(storedNames(dir)).toEqual(['alice', 'bob']);
    expect(fs.readdirSync(path.join(dir, 'users')).sort()).toEqual(['alice', 'bob']);
    expect(db.getData('alice').customCats.map((c) => c.id)).toEqual(['alice-data']);
    expect(db.getData('Alice').customCats.map((c) => c.id)).toEqual(['alice-data']);
    expect(db.getData('bob').customCats.map((c) => c.id)).toEqual(['bob-data']);
    expect(db.getScheduleConfig('Alice')).toMatchObject({ toEmail: 'a@x.org', username: 'alice' });
    expect(db.getUser('ALICE')?.role).toBe('admin');
    const owners = JSON.parse(fs.readFileSync(path.join(dir, 'photo_owners.json'), 'utf-8')) as Record<string, string>;
    expect(owners).toEqual({ 'a.png': 'alice', 'b.png': 'bob' });
    const jobs = JSON.parse(fs.readFileSync(path.join(dir, 'ai_jobs.json'), 'utf-8')) as { username: string }[];
    expect(jobs[0].username).toBe('alice');

    // second run changes nothing
    const snapshot = ['users.json', 'schedule.json', 'photo_owners.json', 'ai_jobs.json'].map((f) => fs.readFileSync(path.join(dir, f), 'utf-8'));
    db.migrateUsernamesToCanonical();
    expect(['users.json', 'schedule.json', 'photo_owners.json', 'ai_jobs.json'].map((f) => fs.readFileSync(path.join(dir, f), 'utf-8'))).toEqual(snapshot);
    expect(fs.readdirSync(path.join(dir, 'users')).sort()).toEqual(['alice', 'bob']);
  });

  it('resumes after a crash that renamed the dir but not users.json', async () => {
    const { db, dir } = await freshDb();
    writeUsers(dir, ['Alice']);
    writeUserData(dir, 'alice', 'moved-already');   // the dir step ran, users.json was not rewritten
    db.migrateUsernamesToCanonical();
    expect(storedNames(dir)).toEqual(['alice']);
    expect(db.getData('alice').customCats.map((c) => c.id)).toEqual(['moved-already']);
  });

  it('moves the data.json into a canonical dir that only holds leftovers of a removed account', async () => {
    const { db, dir } = await freshDb();
    writeUsers(dir, ['Alice']);
    writeUserData(dir, 'Alice', 'live');
    fs.mkdirSync(path.join(dir, 'users', 'alice'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'users', 'alice', 'data.json.deleted-1'), '{}');
    // On a case-insensitive file system both names are one directory; the
    // seeding above then just added the leftover file to it and the plain
    // rename path is taken, which the assertions below cover as well.
    db.migrateUsernamesToCanonical();
    expect(storedNames(dir)).toEqual(['alice']);
    expect(db.getData('alice').customCats.map((c) => c.id)).toEqual(['live']);
    expect(fs.existsSync(path.join(dir, 'users', 'alice', 'data.json.deleted-1'))).toBe(true);
  });

  it('refuses to start and changes nothing when two accounts collide case-insensitively', async () => {
    const { db, dir } = await freshDb();
    writeUsers(dir, ['alice', 'ALICE', 'bob']);
    writeUserData(dir, 'alice', 'one');
    const before = fs.readFileSync(path.join(dir, 'users.json'), 'utf-8');
    let error: unknown;
    try { db.migrateUsernamesToCanonical(); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(db.UsernameCollisionError);
    const message = (error as Error).message;
    expect(message).toContain('"alice": "alice", "ALICE"');
    expect(message).toContain('Nothing was changed');
    expect(fs.readFileSync(path.join(dir, 'users.json'), 'utf-8')).toBe(before);
    expect(db.getUserCount()).toBe(3);
  });

  it('detects a collision through Unicode compatibility forms too', async () => {
    const { db, dir } = await freshDb();
    writeUsers(dir, ['alice', 'ａlice']);
    expect(() => db.migrateUsernamesToCanonical()).toThrow(db.UsernameCollisionError);
  });

  it('refuses when a legacy data dir would be merged into an existing canonical one', async () => {
    const { db, dir } = await freshDb();
    writeUsers(dir, ['Alice']);
    writeUserData(dir, 'Alice', 'legacy');
    fs.mkdirSync(path.join(dir, 'users', 'alice'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'users', 'alice', 'data.json'), JSON.stringify({ ...EMPTY, customCats: [cat('other')] }));
    const caseInsensitiveFs = fs.readdirSync(path.join(dir, 'users')).length === 1;
    if (caseInsensitiveFs) return;   // both names are one dir here: no such state can exist
    expect(() => db.migrateUsernamesToCanonical()).toThrow(/would be merged/);
    expect(storedNames(dir)).toEqual(['Alice']);
    expect(catIds(path.join(dir, 'users', 'alice', 'data.json'))).toEqual(['other']);
    expect(catIds(path.join(dir, 'users', 'Alice', 'data.json'))).toEqual(['legacy']);
  });

  it('aborts buildApp() on a collision instead of serving requests', async () => {
    const dir = mkTmp();
    writeUsers(dir, ['alice', 'ALICE']);
    setEnv(dir);
    const mod = await import('./index');
    await expect(mod.buildApp()).rejects.toThrow(/collide case-insensitively/);
  });

  it('lets buildApp() start on a legacy mixed-case install and refuses the case variant afterwards', async () => {
    const dir = mkTmp();
    writeUsers(dir, ['Alice']);
    writeUserData(dir, 'Alice', 'legacy');
    const { app, db: db2 } = await createTestApp(dir);
    expect(storedNames(dir)).toEqual(['alice']);
    expect(db2.getData('alice').customCats.map((c) => c.id)).toEqual(['legacy']);
    // registration of the case variant is now refused
    expect((await post(app, '/api/auth/register', { username: 'ALICE', password: PASSWORD })).statusCode).toBe(409);
  });
});
