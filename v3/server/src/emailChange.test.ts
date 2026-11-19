import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { emailChangedMail, maskEmail } from './accountMail';

/**
 * #475: changing the account e-mail through PATCH /api/auth/me needs the current password (the
 * address is the recovery channel), invalidates every link mailed earlier and tells the old,
 * verified address. Mail delivery is replaced by a recorder.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-email-change-'));
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
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const flush = () => new Promise((r) => setImmediate(r));

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function change(app: FastifyInstance, token: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(token), payload });
}

function linkToken(mail: { html: string }, route: string): string {
  const m = new RegExp(`#/${route}\\?token=([0-9a-f]{64})`).exec(mail.html);
  expect(m).not.toBeNull();
  return m![1];
}

/** An account whose address is set and verified through the real mail link. */
async function verifiedAccount(app: FastifyInstance, username: string, email: string): Promise<string> {
  const token = await register(app, username);
  expect((await change(app, token, { email, password: PASSWORD })).json()).toMatchObject({ ok: true, verificationSent: true });
  const mail = sent.pop()!;
  const verify = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: linkToken(mail, 'email-bestaetigen') } });
  expect(verify.statusCode).toBe(200);
  sent.length = 0;
  return token;
}

describe('PATCH /api/auth/me needs the password to change the address (#475)', () => {
  it('needs a session', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'PATCH', url: '/api/auth/me', payload: { email: 'a@example.org', password: PASSWORD } });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a change without or with a wrong password, and changes nothing', async () => {
    const { app, db } = await createTestApp();
    const token = await verifiedAccount(app, 'anna', 'anna@example.org');
    // Exactly the 5 requests the limiter allows, so the loop never reaches the 429 branch.
    for (const payload of [
      { email: 'thief@example.org' },
      { email: 'thief@example.org', password: 'nope-nope' },
      { email: 'thief@example.org', password: '' },
      { email: 'thief@example.org', password: 123456 },
    ]) {
      const res = await change(app, token, payload);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Passwort falsch' });
    }
    expect(db.getUser('anna')).toMatchObject({ email: 'anna@example.org', email_verified: true });
    expect(sent).toHaveLength(0);
  });

  it('is rate limited like the other password checks: 5 per 15 minutes, right password or not', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    for (let i = 0; i < 5; i++) {
      expect((await change(app, token, { email: 'thief@example.org', password: `guess-${i}-xx` })).statusCode).toBe(403);
    }
    const blocked = await change(app, token, { email: 'thief@example.org', password: 'guess-6-xx' });
    expect(blocked.statusCode).toBe(429);
    // The limit also holds against a guess that happens to be right.
    expect((await change(app, token, { email: 'anna@example.org', password: PASSWORD })).statusCode).toBe(429);
    expect(db.getUser('anna')?.email).toBeUndefined();
  });

  it('still rejects an invalid address with 400, before asking for the password', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    expect((await change(app, token, { email: 'nope', password: PASSWORD })).statusCode).toBe(400);
    expect((await change(app, token, { password: PASSWORD })).statusCode).toBe(400);
    expect((await change(app, token, { email: ['a@example.org'], password: PASSWORD })).statusCode).toBe(400);
  });

  it('sets the address with the right password, unverified, and mails the verification link to it', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    const res = await change(app, token, { email: 'Anna@Example.org', password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, verificationSent: true });
    expect(db.getUser('anna')).toMatchObject({ email: 'anna@example.org' });
    expect(db.getUser('anna')?.email_verified).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('anna@example.org');
    expect(sent[0].html).toContain('https://app.example/#/email-bestaetigen?token=');
  });

  it('a save that changes nothing needs no password and sends nothing', async () => {
    const { app, db } = await createTestApp();
    const token = await verifiedAccount(app, 'anna', 'anna@example.org');
    const res = await change(app, token, { email: 'ANNA@example.org' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, verificationSent: false });
    expect(db.getUser('anna')?.email_verified).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('a changed address does not touch the password or the session', async () => {
    const { app, db } = await createTestApp();
    const token = await verifiedAccount(app, 'anna', 'anna@example.org');
    const before = db.getUser('anna')!;
    expect((await change(app, token, { email: 'new@example.org', password: PASSWORD })).statusCode).toBe(200);
    const after = db.getUser('anna')!;
    expect(after.password_hash).toBe(before.password_hash);
    expect(after.token_version).toBe(before.token_version);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(token) })).json()).toMatchObject({ email: 'new@example.org', emailVerified: false });
  });
});

describe('a change invalidates open links (#475)', () => {
  it('kills a password-reset link mailed to the old address, and the old verification link', async () => {
    const { app, db } = await createTestApp();
    const token = await verifiedAccount(app, 'anna', 'anna@example.org');
    expect((await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } })).statusCode).toBe(200);
    await flush();
    const resetToken = linkToken(sent.pop()!, 'passwort-neu');

    // A verification link for the old address is open as well.
    db.patchUser('anna', { email_verified: undefined, verify_sent_at: undefined });
    expect((await app.inject({ method: 'POST', url: '/api/auth/email/resend', headers: auth(token) })).statusCode).toBe(200);
    const oldVerify = linkToken(sent.pop()!, 'email-bestaetigen');
    expect(db.getUser('anna')).toMatchObject({ reset_hash: expect.any(String), verify_hash: expect.any(String) });

    expect((await change(app, token, { email: 'new@example.org', password: PASSWORD })).statusCode).toBe(200);
    const user = db.getUser('anna')!;
    for (const k of ['reset_hash', 'reset_expires', 'reset_sent_at']) expect(user).not.toHaveProperty(k);

    const reset = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token: resetToken, password: 'brand-new-secret' } });
    expect(reset.statusCode).toBe(400);
    const verifyOld = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: oldVerify } });
    expect(verifyOld.statusCode).toBe(400);
    // The password did not change.
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password: PASSWORD } })).statusCode).toBe(200);

    // Only the new address's own link verifies it.
    const newVerify = linkToken(sent.find((m) => m.to === 'new@example.org')!, 'email-bestaetigen');
    expect((await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: newVerify } })).statusCode).toBe(200);
  });

  it('leaves the links alone when the save changes nothing', async () => {
    const { app, db } = await createTestApp();
    const token = await verifiedAccount(app, 'anna', 'anna@example.org');
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await flush();
    const resetToken = linkToken(sent.pop()!, 'passwort-neu');
    expect((await change(app, token, { email: 'anna@example.org' })).statusCode).toBe(200);
    expect(db.getUser('anna')?.reset_hash).toBeDefined();
    const reset = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token: resetToken, password: 'brand-new-secret' } });
    expect(reset.statusCode).toBe(200);
  });
});

describe('the old address is told (#475)', () => {
  it('mails a verified old address a notice without link or the full new address', async () => {
    const { app } = await createTestApp();
    const token = await verifiedAccount(app, 'anna', 'anna@example.org');
    expect((await change(app, token, { email: 'thief@evil.example', password: PASSWORD })).statusCode).toBe(200);
    const notice = sent.find((m) => m.to === 'anna@example.org');
    expect(notice).toBeDefined();
    expect(notice!.subject).toContain('geändert');
    expect(notice!.html).toContain('t***@evil.example');
    expect(notice!.html).not.toContain('thief@evil.example');
    expect(notice!.html).not.toContain('http');
    // The new address gets the verification link, and nothing else.
    const toNew = sent.filter((m) => m.to === 'thief@evil.example');
    expect(toNew).toHaveLength(1);
    expect(toNew[0].html).toContain('#/email-bestaetigen?token=');
    expect(toNew[0].html).not.toContain('Adresse geändert');
  });

  it('does not mail an unverified old address, nor when the account had none', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await change(app, token, { email: 'first@example.org', password: PASSWORD });
    expect(sent.map((m) => m.to)).toEqual(['first@example.org']);
    sent.length = 0;
    await change(app, token, { email: 'second@example.org', password: PASSWORD });
    expect(sent.map((m) => m.to)).toEqual(['second@example.org']);
  });

  it('a failing notice does not fail the change, and the verification mail still goes out', async () => {
    const { app, db } = await createTestApp();
    const token = await verifiedAccount(app, 'anna', 'anna@example.org');
    smtp.failFor.add('anna@example.org');
    const res = await change(app, token, { email: 'new@example.org', password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, verificationSent: true });
    expect(db.getUser('anna')?.email).toBe('new@example.org');
  });

  it('without mail delivery the change still works and nothing is sent', async () => {
    const { app, db } = await createTestApp();
    const token = await verifiedAccount(app, 'anna', 'anna@example.org');
    smtp.configured = false;
    const res = await change(app, token, { email: 'new@example.org', password: PASSWORD });
    expect(res.json()).toEqual({ ok: true, verificationSent: false });
    expect(db.getUser('anna')?.email).toBe('new@example.org');
    expect(sent).toHaveLength(0);
  });
});

describe('emailChangedMail / maskEmail', () => {
  it('masks all but the first character of the local part', () => {
    expect(maskEmail('thief@evil.example')).toBe('t***@evil.example');
    expect(maskEmail('x')).toBe('***');
  });

  it('escapes the account name and has no link', () => {
    const mail = emailChangedMail('Nagellacke', '<b>x</b>', 'a@b.example');
    expect(mail.html).not.toContain('<b>x</b>');
    expect(mail.html).toContain('&lt;b&gt;');
    expect(mail.html).not.toContain('http');
  });
});
