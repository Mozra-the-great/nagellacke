import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { SoftAuthenticator } from './softAuthenticator';
import { maskEmails, mailErrorText } from './logRedact';

/**
 * #481: no full address in mail error logs. #482: audit entries for account security changes,
 * without personal data. #483: verification mails throttled per target address, address changes
 * limited per account and day. Mail delivery is replaced by a recorder that can fail like SMTP.
 */
const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
const smtp = vi.hoisted(() => ({ configured: true, failFor: new Set<string>() }));
vi.mock('./email', () => ({
  isEmailConfigured: () => smtp.configured,
  sendHtmlEmail: async (to: string, subject: string, html: string) => {
    if (smtp.failFor.has(to)) {
      // What nodemailer throws for a rejected recipient: the address is in the message.
      throw Object.assign(new Error(`Can't send mail - all recipients were rejected: 550 5.1.1 <${to}>: Recipient address rejected`), {
        code: 'EENVELOPE', responseCode: 550,
      });
    }
    sent.push({ to, subject, html });
  },
  sendTestEmail: async () => {},
}));

const APP_URL = 'https://app.example.de';
const RP = { rpId: 'app.example.de', origin: APP_URL };
const PASSWORD = 'password123';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-account-privacy-'));
  tmpDirs.push(dir);
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.APP_URL = APP_URL;
  process.env.ALLOW_REGISTRATION = 'true';
  vi.resetModules();
  const lines: string[] = [];
  const logStream = new Writable({ write(chunk: Buffer, _enc, cb) { lines.push(chunk.toString('utf-8')); cb(); } });
  const mod = await import('./index');
  const db = await import('./db');
  const app: FastifyInstance = await mod.buildApp({ logStream });
  return { app, db, lines };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const flush = () => new Promise((r) => setImmediate(r));

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

/** Changes the address and returns the answer; the fresh token is in it (#480). */
function setEmail(app: FastifyInstance, token: string, email: string) {
  return app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(token), payload: { email, password: PASSWORD } });
}

describe('mail errors in the log (#481)', () => {
  it('maskEmails keeps the first character and the domain of every address', () => {
    expect(maskEmails('550 <thief.name+tag@evil.example.org>: rejected, cc a@b.de'))
      .toBe('550 <t***@evil.example.org>: rejected, cc a***@b.de');
    expect(maskEmails('no address here')).toBe('no address here');
    expect(maskEmails('user @ host')).toBe('user @ host');
  });

  it('mailErrorText keeps the SMTP code and masks the message', () => {
    const e = Object.assign(new Error('550 <anna@example.org> rejected'), { code: 'EENVELOPE', responseCode: 550 });
    expect(mailErrorText(e)).toBe('[EENVELOPE 550] 550 <a***@example.org> rejected');
    expect(mailErrorText('plain anna@example.org')).toBe('plain a***@example.org');
    expect(mailErrorText(new Error('timeout'))).toBe('timeout');
  });

  it('no mail path writes a full address to the log: verification, notices, reset, report confirmation', async () => {
    const { app, db, lines } = await createTestApp();
    let token = await register(app, 'anna');
    // Verification mail fails.
    smtp.failFor.add('new.address@example.org');
    const set = await setEmail(app, token, 'new.address@example.org');
    expect(set.json()).toMatchObject({ verificationSent: false });
    token = (set.json() as { token: string }).token;
    // Change notice and passkey notice to a verified address fail.
    db.patchUser('anna', { email_verified: true });
    const options = (await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(token), payload: { password: PASSWORD } })).json();
    await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/verify', headers: auth(token), payload: { response: new SoftAuthenticator(RP).register(options) } });
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await flush();
    const changed = await setEmail(app, token, 'second@example.org');
    token = (changed.json() as { token: string }).token;
    // Report confirmation to a third party fails.
    smtp.failFor.add('friend@example.org');
    await app.inject({ method: 'POST', url: '/api/reports/schedule', headers: auth(token), payload: { enabled: true, frequency: 'weekly', toEmail: 'friend@example.org' } });

    const log = lines.join('');
    expect(log).toMatch(/verification mail failed: \[EENVELOPE 550\]/);
    expect(log).toMatch(/passkey notice failed/);
    expect(log).toMatch(/reset mail failed/);
    expect(log).toMatch(/e-mail change notice failed/);
    expect(log).toMatch(/report recipient confirmation failed/);
    expect(log).toContain('n***@example.org');
    for (const full of ['new.address@example.org', 'friend@example.org']) expect(log).not.toContain(full);
  });
});

describe('audit entries for account security changes (#482)', () => {
  it('records every change under the account, without address, passkey name or secret', async () => {
    const { app, db } = await createTestApp();
    await register(app, 'owner');
    let token = await register(app, 'anna');
    token = (await setEmail(app, token, 'anna@example.org')).json().token as string;
    const options = (await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(token), payload: { password: PASSWORD } })).json();
    const device = new SoftAuthenticator(RP);
    await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/verify', headers: auth(token), payload: { response: device.register(options), name: 'Privates Handy' } });
    await app.inject({ method: 'DELETE', url: `/api/auth/passkeys/${device.id}`, headers: auth(token), payload: { password: PASSWORD } });
    const removed = await app.inject({ method: 'POST', url: '/api/auth/email/remove', headers: auth(token), payload: { password: PASSWORD } });
    token = (removed.json() as { token: string }).token;
    const changed = await app.inject({ method: 'POST', url: '/api/auth/password/change', headers: auth(token), payload: { password: PASSWORD, newPassword: 'another-password' } });
    expect(changed.statusCode).toBe(200);
    token = (changed.json() as { token: string }).token;
    // 2FA on, recovery codes, 2FA off, through the real routes.
    const setup = (await app.inject({ method: 'POST', url: '/api/auth/totp/setup', headers: auth(token) })).json() as { secret: string };
    const { TOTP, Secret } = await import('otpauth');
    const totp = new TOTP({ secret: Secret.fromBase32(setup.secret), digits: 6, period: 30 });
    const enabled = await app.inject({ method: 'POST', url: '/api/auth/totp/enable', headers: auth(token), payload: { password: 'another-password', code: totp.generate() } });
    expect(enabled.statusCode).toBe(200);
    const { token: t2, recoveryCodes } = enabled.json() as { token: string; recoveryCodes: string[] };
    const regen = await app.inject({ method: 'POST', url: '/api/auth/totp/recovery-codes/regenerate', headers: auth(t2), payload: { password: 'another-password', code: recoveryCodes[0] } });
    const codes = (regen.json() as { recoveryCodes: string[] }).recoveryCodes;
    expect((await app.inject({ method: 'POST', url: '/api/auth/totp/disable', headers: auth(t2), payload: { password: 'another-password', code: codes[0] } })).statusCode).toBe(200);

    const entries = db.getAuditLog().filter((e) => e.actor === 'anna').reverse();
    expect(entries.map((e) => e.action)).toEqual([
      'account.email_changed', 'account.passkey_added', 'account.passkey_removed', 'account.email_removed',
      'account.password_changed', 'account.totp_enabled', 'account.recovery_codes_regenerated', 'account.totp_disabled',
    ]);
    for (const e of entries) expect(e.target).toBe('anna');
    const raw = JSON.stringify(entries);
    for (const pii of ['@', 'Privates Handy', PASSWORD, 'another-password', setup.secret]) expect(raw).not.toContain(pii);
  });

  it('records a password reset, with only whether the passkeys went too', async () => {
    const { app, db } = await createTestApp();
    await register(app, 'anna');
    db.patchUser('anna', { email: 'anna@example.org', email_verified: true });
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await flush();
    const link = /#\/passwort-neu\?token=([0-9a-f]{64})/.exec(sent.pop()!.html)![1];
    await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token: link, password: 'brand-new-pass', removePasskeys: true } });
    expect(db.getAuditLog()[0]).toMatchObject({ actor: 'anna', action: 'account.password_reset', target: 'anna', meta: { passkeysRemoved: true } });
  });

  it('a refused change leaves no entry', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(token), payload: { email: 'x@example.org', password: 'wrong-password' } });
    expect(db.getAuditLog().filter((e) => e.actor === 'anna')).toEqual([]);
  });
});

describe('verification mails and address changes are limited (#483)', () => {
  it('at most 3 verification mails per address and day, across accounts; A→B→A does not resend forever', async () => {
    const { app } = await createTestApp();
    let anna = await register(app, 'anna');
    let ben = await register(app, 'ben');
    const tokens: Record<string, string> = { carl: await register(app, 'carl') };
    const answers: unknown[] = [];
    // Four mails to the same target from three accounts, A→B→A included (5 requests: the route's
    // own limit is 5 per IP and 15 minutes).
    for (const [who, email] of [['anna', 'victim@example.org'], ['anna', 'mine@example.org'], ['anna', 'victim@example.org'], ['ben', 'victim@example.org'], ['carl', 'victim@example.org']] as const) {
      const res = await setEmail(app, who === 'anna' ? anna : who === 'ben' ? ben : tokens.carl, email);
      expect(res.statusCode).toBe(200);
      const body = res.json() as { token: string; verificationSent: boolean; verificationThrottled?: boolean };
      if (who === 'anna') anna = body.token; else if (who === 'ben') ben = body.token; else tokens.carl = body.token;
      answers.push({ email, sent: body.verificationSent, throttled: body.verificationThrottled ?? false });
    }
    expect(sent.filter((m) => m.to === 'victim@example.org')).toHaveLength(3);
    expect(answers.at(-1)).toEqual({ email: 'victim@example.org', sent: false, throttled: true });
    // The resend button meets the same limit, and says so.
    const resend = await app.inject({ method: 'POST', url: '/api/auth/email/resend', headers: auth(tokens.carl) });
    expect(resend.statusCode).toBe(429);
    expect((resend.json() as { error: string }).error).toMatch(/zu viele Bestätigungsmails/);
  });

  it('an account may change its address 5 times a day: the 6th is a 429 that changes nothing, and remove + add does not reset it', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    const now = Date.now();
    db.patchUser('anna', { email: 'old@example.org', email_changes_at: [now - 1000, now - 2000, now - 3000, now - 4000, now - 5000] });
    const res = await setEmail(app, token, 'new@example.org');
    expect(res.statusCode).toBe(429);
    expect((res.json() as { error: string }).error).toMatch(/zu oft geändert/);
    expect(db.getUser('anna')?.email).toBe('old@example.org');
    // Removing the address keeps the count.
    db.removeUserEmail('anna');
    expect(db.getUser('anna')?.email_changes_at).toHaveLength(5);
    // Changes older than a day no longer count.
    db.patchUser('anna', { email_changes_at: [now - 25 * 60 * 60 * 1000] });
    expect((await setEmail(app, token, 'new@example.org')).statusCode).toBe(200);
    expect(db.getUser('anna')?.email_changes_at).toHaveLength(1);
  });
});
