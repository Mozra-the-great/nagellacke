import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/** #471 (F116.5 b): the account removes its own e-mail address. */
async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-email-remove-'));
  tmpDirs.push(dir);
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.ALLOW_REGISTRATION = 'true';
  vi.resetModules();
  const mod = await import('./index');
  const db = await import('./db');
  const app: FastifyInstance = await mod.buildApp();
  return { app, db };
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

describe('POST /api/auth/email/remove (#471)', () => {
  it('needs a session and the right password', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    db.updateUserEmail('anna', 'anna@example.org');
    expect((await app.inject({ method: 'POST', url: '/api/auth/email/remove', payload: { password: 'password123' } })).statusCode).toBe(401);
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/email/remove', headers: auth(token), payload: { password: 'nope-nope' } });
    expect(wrong.statusCode).toBe(403);
    const missing = await app.inject({ method: 'POST', url: '/api/auth/email/remove', headers: auth(token), payload: {} });
    expect(missing.statusCode).toBe(403);
    expect(db.getUser('anna')?.email).toBe('anna@example.org');
  });

  it('removes the address, its verification and any reset/verification token; login by username keeps working', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    db.updateUserEmail('anna', 'anna@example.org');
    db.patchUser('anna', {
      email_verified: true, verify_hash: 'v', verify_expires: Date.now() + 1000, verify_sent_at: 1,
      reset_hash: 'r', reset_expires: Date.now() + 1000, reset_sent_at: 1,
    });
    const res = await app.inject({ method: 'POST', url: '/api/auth/email/remove', headers: auth(token), payload: { password: 'password123' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, scheduleCleared: false });

    const user = db.getUser('anna')!;
    for (const k of ['email', 'email_verified', 'verify_hash', 'verify_expires', 'verify_sent_at', 'reset_hash', 'reset_expires', 'reset_sent_at']) {
      expect(user).not.toHaveProperty(k);
    }
    // Every other session ended (#480); the caller carries on with the fresh pair.
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(token) })).statusCode).toBe(401);
    const fresh = (res.json() as { token: string }).token;
    expect(String(res.headers['set-cookie'])).toContain('nl_refresh=');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(fresh) });
    expect(me.json()).toMatchObject({ email: null, emailVerified: false });

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password: 'password123' } });
    expect(login.statusCode).toBe(200);

    // Nothing left to remove.
    const again = await app.inject({ method: 'POST', url: '/api/auth/email/remove', headers: auth(fresh), payload: { password: 'password123' } });
    expect(again.statusCode).toBe(400);
  });

  it('pauses and clears a report schedule that mails the removed address, and leaves other recipients alone', async () => {
    const { app, db } = await createTestApp();
    const anna = await register(app, 'anna');
    const ben = await register(app, 'ben');
    for (const [u, e] of [['anna', 'anna@example.org'], ['ben', 'ben@example.org']] as const) {
      db.updateUserEmail(u, e);
      db.patchUser(u, { email_verified: true });
    }
    db.setScheduleConfig('anna', { enabled: true, frequency: 'weekly', toEmail: 'Anna@Example.org', confirmSeq: 2 });
    db.setScheduleConfig('ben', { enabled: true, frequency: 'weekly', toEmail: 'friend@example.org', confirmedEmail: 'friend@example.org', confirmSeq: 1 });

    const a = await app.inject({ method: 'POST', url: '/api/auth/email/remove', headers: auth(anna), payload: { password: 'password123' } });
    expect(a.statusCode).toBe(200);
    const body = a.json() as { scheduleCleared: boolean; schedule: { config: { enabled: boolean; toEmail: string }; recipient: { status: string }; sendTargets: unknown[] } };
    expect(body.scheduleCleared).toBe(true);
    expect(body.schedule.config).toMatchObject({ enabled: false, toEmail: '' });
    expect(body.schedule.recipient.status).toBe('none');
    expect(body.schedule.sendTargets).toEqual([]);
    expect(db.getScheduleConfig('anna')).toMatchObject({ enabled: false, toEmail: '', confirmSeq: 3 });

    const b = await app.inject({ method: 'POST', url: '/api/auth/email/remove', headers: auth(ben), payload: { password: 'password123' } });
    expect(b.json()).toMatchObject({ scheduleCleared: false });
    expect(db.getScheduleConfig('ben')).toMatchObject({ enabled: true, toEmail: 'friend@example.org', confirmedEmail: 'friend@example.org' });
  });

  it('a new address can be added afterwards and starts unverified', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    db.updateUserEmail('anna', 'anna@example.org');
    db.patchUser('anna', { email_verified: true });
    const removed = await app.inject({ method: 'POST', url: '/api/auth/email/remove', headers: auth(token), payload: { password: 'password123' } });
    const afterRemove = (removed.json() as { token: string }).token;
    const add = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(afterRemove), payload: { email: 'anna@example.org', password: 'password123' } });
    expect(add.statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth((add.json() as { token: string }).token) });
    expect(me.json()).toMatchObject({ email: 'anna@example.org', emailVerified: false });
  });
});
