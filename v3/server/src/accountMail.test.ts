import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * #324 S17 (password reset, live App-URL) and S19 (address verification). Mail
 * delivery is replaced by a recorder; the tokens are read back out of the mails the
 * way a user would get them.
 */
const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
const smtp = vi.hoisted(() => ({ configured: true }));
vi.mock('./email', () => ({
  isEmailConfigured: () => smtp.configured,
  sendHtmlEmail: async (to: string, subject: string, html: string) => { sent.push({ to, subject, html }); },
  sendTestEmail: async () => {},
}));

async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-account-test-'));
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
  tmpDirs.push(dir);
  return { app, db };
}

const tmpDirs: string[] = [];
beforeEach(() => { sent.length = 0; smtp.configured = true; });
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.APP_URL;
  delete process.env.ALLOW_REGISTRATION;
});

async function register(app: FastifyInstance, username: string, password = 'password123'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function tokenFrom(mail: { html: string }, route: string): string {
  const m = new RegExp(`#/${route}\\?token=([0-9a-f]{64})`).exec(mail.html);
  expect(m).not.toBeNull();
  return m![1];
}

/** Mails for forgot-password go out after the response. */
const flush = () => new Promise((r) => setImmediate(r));

async function setEmail(app: FastifyInstance, token: string, email: string) {
  return app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` }, payload: { email } });
}

async function verifiedUser(app: FastifyInstance, username: string, email: string): Promise<string> {
  const token = await register(app, username);
  const res = await setEmail(app, token, email);
  expect(res.json()).toMatchObject({ ok: true, verificationSent: true });
  const mail = sent.pop()!;
  expect(mail.to).toBe(email);
  const verify = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: tokenFrom(mail, 'email-bestaetigen') } });
  expect(verify.statusCode).toBe(200);
  return token;
}

describe('e-mail verification (#324 S19)', () => {
  it('mails a link when an address is set, and the link marks it verified', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await setEmail(app, token, 'Anna@Example.org');
    const mail = sent.pop()!;
    expect(mail.to).toBe('anna@example.org');
    expect(mail.html).toContain('https://app.example/#/email-bestaetigen?token=');

    const me = async () => (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } })).json();
    expect((await me()).emailVerified).toBe(false);
    const res = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: tokenFrom(mail, 'email-bestaetigen') } });
    expect(res.statusCode).toBe(200);
    expect((await me()).emailVerified).toBe(true);
    // Single use.
    expect((await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: tokenFrom(mail, 'email-bestaetigen') } })).statusCode).toBe(400);
  });

  it('makes a changed address unverified again, and leaves an unchanged one alone', async () => {
    const { app, db } = await createTestApp();
    const token = await verifiedUser(app, 'anna', 'anna@example.org');
    expect((await setEmail(app, token, 'anna@example.org')).json()).toMatchObject({ verificationSent: false });
    expect(db.getUser('anna')?.email_verified).toBe(true);
    expect((await setEmail(app, token, 'new@example.org')).json()).toMatchObject({ verificationSent: true });
    expect(db.getUser('anna')?.email_verified).toBeUndefined();
  });

  it('refuses a resend within the hour', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await setEmail(app, token, 'anna@example.org');
    const res = await app.inject({ method: 'POST', url: '/api/auth/email/resend', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(429);
  });

  it('takes an optional address at registration and mails the link after the response', async () => {
    const { app, db } = await createTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'anna', password: 'password123', email: ' Anna@Example.org ' } });
    expect(res.statusCode).toBe(200);
    expect(db.getUser('anna')?.email).toBe('anna@example.org');
    await flush();
    expect(sent.map((m) => m.to)).toEqual(['anna@example.org']);

    const bad = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ben', password: 'password123', email: 'nope' } });
    expect(bad.statusCode).toBe(400);
    expect(db.getUser('ben')).toBeUndefined();
  });

  it('refuses a malformed or unknown token', async () => {
    const { app } = await createTestApp();
    for (const token of ['x', 'a'.repeat(64), undefined]) {
      expect((await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token } })).statusCode).toBe(400);
    }
  });
});

describe('password reset (#324 S17)', () => {
  it('mails a one-hour link for a verified address; the new password works and old sessions die', async () => {
    const { app } = await createTestApp();
    const oldToken = await verifiedUser(app, 'anna', 'anna@example.org');

    const forgot = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna@example.org' } });
    expect(forgot.statusCode).toBe(200);
    await flush();
    const mail = sent.pop()!;
    expect(mail.to).toBe('anna@example.org');
    const resetToken = tokenFrom(mail, 'passwort-neu');

    const reset = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token: resetToken, password: 'brand-new-secret' } });
    expect(reset.statusCode).toBe(200);

    const login = (password: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password } });
    expect((await login('password123')).statusCode).toBe(401);
    expect((await login('brand-new-secret')).statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${oldToken}` } });
    expect(me.statusCode).toBe(401);

    // The link works once.
    const again = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token: resetToken, password: 'another-secret' } });
    expect(again.statusCode).toBe(400);
  });

  it('also finds the account by username', async () => {
    const { app } = await createTestApp();
    await verifiedUser(app, 'anna', 'anna@example.org');
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('answers identically for an unknown account, an unverified address and a known one, and mails only the last', async () => {
    const { app } = await createTestApp();
    await verifiedUser(app, 'anna', 'anna@example.org');
    const unverified = await register(app, 'ben');
    await setEmail(app, unverified, 'ben@example.org');
    sent.length = 0;

    const bodies = [];
    for (const identifier of ['nobody@example.org', 'ben@example.org', 'anna@example.org']) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier } });
      bodies.push([res.statusCode, res.body]);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    await flush();
    expect(sent.map((m) => m.to)).toEqual(['anna@example.org']);
  });

  it('does not mail the same account twice within a minute', async () => {
    const { app } = await createTestApp();
    await verifiedUser(app, 'anna', 'anna@example.org');
    for (let i = 0; i < 2; i++) await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('refuses an expired link', async () => {
    const { app, db } = await createTestApp();
    await verifiedUser(app, 'anna', 'anna@example.org');
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await flush();
    const token = tokenFrom(sent.pop()!, 'passwort-neu');
    db.patchUser('anna', { reset_expires: Date.now() - 1 });
    const res = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password: 'brand-new-secret' } });
    expect(res.statusCode).toBe(400);
  });

  it('says so when the server cannot send mail, and registration-status reports it', async () => {
    const { app } = await createTestApp();
    await register(app, 'owner');
    smtp.configured = false;
    expect((await app.inject({ method: 'GET', url: '/api/auth/registration-status' })).json()).toMatchObject({ passwordReset: false });
    const res = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'owner' } });
    expect(res.statusCode).toBe(503);
    smtp.configured = true;
    expect((await app.inject({ method: 'GET', url: '/api/auth/registration-status' })).json()).toMatchObject({ passwordReset: true });
  });
});

describe('App-URL read live (#324 S17)', () => {
  it('uses a value saved in the panel for links right away, without a restart', async () => {
    const { app } = await createTestApp();
    const admin = await register(app, 'owner');
    const auth = { authorization: `Bearer ${admin}` };
    const save = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: auth, payload: { appUrl: 'https://panel.example/' } });
    expect(save.statusCode).toBe(200);
    const settings = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: auth })).json();
    expect(settings).toMatchObject({ appUrl: 'https://panel.example', appUrlSource: 'panel', appUrlRequiresRestart: false });

    await setEmail(app, admin, 'owner@example.org');
    expect(sent.pop()!.html).toContain('https://panel.example/#/email-bestaetigen?token=');
  });

  it('refuses anything but a plain http(s) URL', async () => {
    const { app } = await createTestApp();
    const admin = await register(app, 'owner');
    for (const appUrl of ['javascript:alert(1)', 'https://x.example/?a=1', 'https://x.example/#f', 'https://u:p@x.example', 'not a url']) {
      const res = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: { authorization: `Bearer ${admin}` }, payload: { appUrl } });
      expect(res.statusCode, appUrl).toBe(400);
    }
  });
});
