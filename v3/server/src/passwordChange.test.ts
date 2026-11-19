import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TOTP, Secret } from 'otpauth';
import type { FastifyInstance } from 'fastify';
import { passwordChangedMail } from './accountMail';

/**
 * #480: POST /api/auth/password/change. The signed-in account replaces its password through the
 * shared re-auth helper (#479); every other session ends, the caller gets a fresh pair, and a
 * verified address is told. Mail delivery is replaced by a recorder.
 */
const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
const smtp = vi.hoisted(() => ({ configured: true, failFor: new Set<string>() }));
vi.mock('./email', () => ({
  isEmailConfigured: () => smtp.configured,
  sendHtmlEmail: async (to: string, subject: string, html: string) => {
    if (smtp.failFor.has(to)) throw new Error('smtp down');
    sent.push({ to, subject, html });
  },
  sendTestEmail: async () => {},
}));

const tmpDirs: string[] = [];
beforeEach(() => { sent.length = 0; smtp.configured = true; smtp.failFor.clear(); });
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.APP_URL;
  delete process.env.ALLOW_REGISTRATION;
});

async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-pw-change-'));
  tmpDirs.push(dir);
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.APP_URL = 'https://app.example';
  process.env.ALLOW_REGISTRATION = 'true';
  vi.resetModules();
  const mod = await import('./index');
  const db = await import('./db');
  const app: FastifyInstance = await mod.buildApp();
  return { app, db };
}

const PASSWORD = 'password123';
const NEW = 'a-brand-new-secret';
const SECRET = 'JBSWY3DPEHPK3PXP';
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function changePw(app: FastifyInstance, token: string | null, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/auth/password/change', headers: token ? auth(token) : {}, payload });
}

const login = (app: FastifyInstance, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password } });

describe('POST /api/auth/password/change (#480)', () => {
  it('needs a session', async () => {
    const { app } = await createTestApp();
    await register(app, 'anna');
    expect((await changePw(app, null, { password: PASSWORD, newPassword: NEW })).statusCode).toBe(401);
  });

  it('refuses a short or missing new password with 400, and a repeat of the old one, without changing anything', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    const hash = db.getUser('anna')!.password_hash;
    for (const newPassword of [undefined, 'short', 42]) {
      expect((await changePw(app, token, { password: PASSWORD, newPassword })).statusCode).toBe(400);
    }
    const same = await changePw(app, token, { password: PASSWORD, newPassword: PASSWORD });
    expect(same.statusCode).toBe(400);
    expect((same.json() as { error: string }).error).toMatch(/unterscheiden/);
    expect(db.getUser('anna')!.password_hash).toBe(hash);
  });

  it('refuses a wrong current password with 403 on the login lockout counter, and 429 once locked', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    const wrong = await changePw(app, token, { password: 'nope-nope', newPassword: NEW });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json()).toEqual({ error: 'Passwort falsch' });
    expect(db.getUser('anna')?.login_fail_count).toBe(1);
    db.patchUser('anna', { login_locked_until: Date.now() + 60_000 });
    const locked = await changePw(app, token, { password: PASSWORD, newPassword: NEW });
    expect(locked.statusCode).toBe(429);
    expect((await login(app, NEW)).statusCode).toBe(401);
  });

  it('with 2FA on it needs the code as well', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    db.patchUser('anna', { totp_enabled: true, totp_secret: SECRET });
    expect((await changePw(app, token, { password: PASSWORD, newPassword: NEW })).json()).toMatchObject({ totpRequired: true });
    const code = new TOTP({ secret: Secret.fromBase32(SECRET), digits: 6, period: 30 }).generate();
    expect((await changePw(app, token, { password: PASSWORD, code, newPassword: NEW })).statusCode).toBe(200);
  });

  it('changes the password, ends every other session and outstanding reset link, and hands the caller a fresh pair', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    const other = ((await login(app, PASSWORD)).json() as { token: string }).token;
    db.patchUser('anna', { reset_hash: 'r', reset_expires: Date.now() + 60_000, login_fail_count: 3 });
    const res = await changePw(app, token, { password: PASSWORD, newPassword: NEW });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; token: string; refreshToken: string };
    expect(body.ok).toBe(true);
    expect(typeof body.refreshToken).toBe('string');
    expect(String(res.headers['set-cookie'])).toContain('nl_refresh=');

    for (const old of [token, other]) {
      expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(old) })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(body.token) })).statusCode).toBe(200);
    expect((await login(app, PASSWORD)).statusCode).toBe(401);
    expect((await login(app, NEW)).statusCode).toBe(200);
    const user = db.getUser('anna')!;
    expect(user.reset_hash).toBeUndefined();
    expect(user.login_fail_count).toBeUndefined();
  });

  it('tells a verified address, without a link, and nobody else; a failing mail does not fail the change', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    db.patchUser('anna', { email: 'anna@example.org', email_verified: true });
    const first = await changePw(app, token, { password: PASSWORD, newPassword: NEW });
    expect(first.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'anna@example.org', subject: expect.stringContaining('Passwort geändert') });
    expect(sent[0].html).not.toMatch(/https?:/);

    sent.length = 0;
    db.patchUser('anna', { email_verified: false });
    const second = await changePw(app, (first.json() as { token: string }).token, { password: NEW, newPassword: 'third-password' });
    expect(second.statusCode).toBe(200);
    expect(sent).toHaveLength(0);

    db.patchUser('anna', { email_verified: true });
    smtp.failFor.add('anna@example.org');
    const third = await changePw(app, (second.json() as { token: string }).token, { password: 'third-password', newPassword: 'fourth-password' });
    expect(third.statusCode).toBe(200);
  });

  it('works for an account without any address, which cannot use the reset link', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    expect(db.getUser('anna')?.email).toBeUndefined();
    expect((await changePw(app, token, { password: PASSWORD, newPassword: NEW })).statusCode).toBe(200);
    expect((await login(app, NEW)).statusCode).toBe(200);
  });
});

describe('passwordChangedMail (#480)', () => {
  it('escapes the account name and carries no link', () => {
    const mail = passwordChangedMail('Nagellacke', '<i>x</i>');
    expect(mail.html).toContain('&lt;i&gt;');
    expect(mail.html).not.toContain('<i>x</i>');
    expect(mail.html).not.toMatch(/https?:/);
  });
});
