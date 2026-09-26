import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/** #324 S20 (own data export) and S21 (deleting one's own account). */
async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-self-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.ALLOW_REGISTRATION = 'true';
  vi.resetModules();
  const mod = await import('./index');
  const db = await import('./db');
  const app: FastifyInstance = await mod.buildApp();
  tmpDirs.push(dir);
  return { app, db, dir };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.ALLOW_REGISTRATION;
});

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'password123' } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 7)]).toString('base64');

async function upload(app: FastifyInstance, token: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/photos', headers: auth(token), payload: { data: PNG, mimeType: 'image/png' } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { filename: string }).filename;
}

function polish(id: string, photo?: string) {
  return { id, name: id, brand: 'B', num: '1', color: '#fff', finish: ['Classic'], status: 'ok', createdAt: 1, updatedAt: 1, ...(photo ? { photo } : {}) };
}

describe('GET /api/me/export (#324 S20)', () => {
  it('returns the account, the collection and the schedule as a JSON download, without secrets', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    db.setData('anna', { polishes: [polish('p1')], customCats: [], manicures: [], stickers: [] } as never);
    const res = await app.inject({ method: 'GET', url: '/api/me/export', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="nagellacke-konto-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = res.json() as { account: Record<string, unknown>; collection: { polishes: { id: string }[] } };
    expect(body.account).toMatchObject({ username: 'anna', role: 'admin', emailVerified: false });
    expect(body.collection.polishes.map((p) => p.id)).toEqual(['p1']);
    expect(res.body).not.toMatch(/password_hash|totp_secret|reset_hash|verify_hash|scrypt/);
  });

  it('needs a session', async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: 'GET', url: '/api/me/export' })).statusCode).toBe(401);
  });
});

describe('POST /api/me/delete (#324 S21)', () => {
  it('erases the account, its data and its own photos, and the old token stops working', async () => {
    const { app, db, dir } = await createTestApp();
    await register(app, 'owner'); // someone else stays admin
    const token = await register(app, 'anna');
    const photo = await upload(app, token);
    db.setData('anna', { polishes: [polish('p1', photo)], customCats: [], manicures: [], stickers: [] } as never);

    const res = await app.inject({ method: 'POST', url: '/api/me/delete', headers: auth(token), payload: { password: 'password123' } });
    expect(res.statusCode).toBe(200);
    expect(db.getUser('anna')).toBeUndefined();
    expect(fs.existsSync(path.join(dir, 'users', 'anna'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'photos', photo))).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(token) })).statusCode).toBe(401);
    // A new account under the same name starts empty.
    const again = await register(app, 'anna');
    const exp = (await app.inject({ method: 'GET', url: '/api/me/export', headers: auth(again) })).json() as { collection: { polishes: unknown[] } };
    expect(exp.collection.polishes).toEqual([]);
  });

  it('keeps a photo another account still shows', async () => {
    const { app, db, dir } = await createTestApp();
    await register(app, 'owner');
    const token = await register(app, 'anna');
    const photo = await upload(app, token);
    db.setData('owner', { polishes: [polish('shared', photo)], customCats: [], manicures: [], stickers: [] } as never);
    const res = await app.inject({ method: 'POST', url: '/api/me/delete', headers: auth(token), payload: { password: 'password123' } });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(dir, 'photos', photo))).toBe(true);
  });

  it('refuses a wrong password', async () => {
    const { app, db } = await createTestApp();
    await register(app, 'owner');
    const token = await register(app, 'anna');
    const res = await app.inject({ method: 'POST', url: '/api/me/delete', headers: auth(token), payload: { password: 'wrong-password' } });
    expect(res.statusCode).toBe(403);
    expect(db.getUser('anna')).toBeDefined();
  });

  it('refuses the last admin while other accounts exist, but lets the only account go', async () => {
    const { app, db } = await createTestApp();
    const owner = await register(app, 'owner');
    await register(app, 'anna');
    const blocked = await app.inject({ method: 'POST', url: '/api/me/delete', headers: auth(owner), payload: { password: 'password123' } });
    expect(blocked.statusCode).toBe(409);

    const solo = await createTestApp();
    const only = await register(solo.app, 'solo');
    const res = await solo.app.inject({ method: 'POST', url: '/api/me/delete', headers: auth(only), payload: { password: 'password123' } });
    expect(res.statusCode).toBe(200);
    expect(solo.db.getUserCount()).toBe(0);
    expect(db.getUser('owner')).toBeDefined();
  });
});
