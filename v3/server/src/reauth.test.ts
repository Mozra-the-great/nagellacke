import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TOTP, Secret } from 'otpauth';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { SoftAuthenticator } from './softAuthenticator';
import { generateRecoveryCodes } from './totp';
import { passkeyChangedMail, TAKEOVER_ADVICE } from './accountMail';

/**
 * #479: one re-auth helper for every account-security change, with the login lockout counter and a
 * TOTP/recovery-code step-up. #478: adding and removing a passkey go through it, and the owner's
 * verified address hears about both. Mail delivery is replaced by a recorder.
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

const APP_URL = 'https://app.example.de';
const RP = { rpId: 'app.example.de', origin: APP_URL };
const PASSWORD = 'password123';
const SECRET = 'JBSWY3DPEHPK3PXP';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-reauth-'));
  tmpDirs.push(dir);
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.APP_URL = APP_URL;
  process.env.ALLOW_REGISTRATION = 'true';
  vi.resetModules();
  const mod = await import('./index');
  const db = await import('./db');
  const app: FastifyInstance = await mod.buildApp();
  return { app, db };
}

type Db = Awaited<ReturnType<typeof createTestApp>>['db'];
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** The current TOTP code; the server spends each time step once (replay guard). */
function freshCode(): string {
  return new TOTP({ secret: Secret.fromBase32(SECRET), digits: 6, period: 30 }).generate({ timestamp: Date.now() });
}

/** A well-formed code from ten minutes ago, outside the accepted window. */
function staleCode(): string {
  return new TOTP({ secret: Secret.fromBase32(SECRET), digits: 6, period: 30 }).generate({ timestamp: Date.now() - 600_000 });
}

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

/** Turns 2FA on directly in the store and returns a recovery code; the session stays valid. */
function enableTotp(db: Db, username: string): string[] {
  const { codes, hashes } = generateRecoveryCodes();
  db.patchUser(username, { totp_enabled: true, totp_secret: SECRET, recovery_codes: hashes });
  return codes;
}

function verifiedEmail(db: Db, username: string, email: string): void {
  db.patchUser(username, { email, email_verified: true });
}

type Call = (app: FastifyInstance, token: string, body: Record<string, unknown>) => Promise<LightMyRequestResponse>;

/** Every route behind the re-auth helper, with the extra body fields it needs. */
const ROUTES: Record<string, Call> = {
  'PATCH /api/auth/me': (app, token, body) => app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(token), payload: { email: 'neu@example.org', ...body } }),
  'POST /api/auth/email/remove': (app, token, body) => app.inject({ method: 'POST', url: '/api/auth/email/remove', headers: auth(token), payload: body }),
  'POST /api/me/delete': (app, token, body) => app.inject({ method: 'POST', url: '/api/me/delete', headers: auth(token), payload: body }),
  'POST /api/auth/totp/disable': (app, token, body) => app.inject({ method: 'POST', url: '/api/auth/totp/disable', headers: auth(token), payload: body }),
  'POST /api/auth/totp/recovery-codes/regenerate': (app, token, body) => app.inject({ method: 'POST', url: '/api/auth/totp/recovery-codes/regenerate', headers: auth(token), payload: body }),
  'POST /api/auth/passkeys/register/options': (app, token, body) => app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(token), payload: body }),
  'DELETE /api/auth/passkeys/:id': (app, token, body) => app.inject({ method: 'DELETE', url: '/api/auth/passkeys/pk-1', headers: auth(token), payload: body }),
};

/** An account that every route above can act on: address, 2FA, one passkey. */
async function fullAccount(app: FastifyInstance, db: Db, username = 'anna', withTotp = true) {
  const token = await register(app, username);
  verifiedEmail(db, username, `${username}@example.org`);
  db.patchUser(username, {
    webauthn_credentials: [{ id: 'pk-1', publicKey: 'x', counter: 0, name: 'Handy', rpId: RP.rpId, createdAt: Date.now() }],
  });
  const recovery = withTotp ? enableTotp(db, username) : [];
  return { token, recovery };
}

describe('every re-auth route refuses a token alone (#479, #478)', () => {
  for (const [name, call] of Object.entries(ROUTES)) {
    it(`${name}: 403 without and with a wrong password, nothing changed`, async () => {
      const { app, db } = await createTestApp();
      const { token } = await fullAccount(app, db);
      const before = db.getUser('anna');
      for (const body of [{}, { password: 'wrong-password' }]) {
        const res = await call(app, token, body);
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Passwort falsch' });
      }
      const after = db.getUser('anna')!;
      expect({ ...after, login_fail_count: undefined }).toEqual({ ...before, login_fail_count: undefined });
      expect(sent).toHaveLength(0);
    });
  }
});

describe('per-account lockout shared with the login (#479)', () => {
  it('counts wrong passwords across routes and the login, then answers 429 everywhere, the right password included', async () => {
    const { app, db } = await createTestApp();
    const { token } = await fullAccount(app, db, 'anna', false);
    const names = Object.keys(ROUTES).filter((n) => !n.includes('totp'));
    // 5 wrong logins and 5 wrong re-auths over different routes: one budget of 10.
    for (let i = 0; i < 5; i++) {
      const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password: 'nope' } });
      expect(login.statusCode).toBe(401);
    }
    for (let i = 0; i < 4; i++) {
      expect((await ROUTES[names[i % names.length]](app, token, { password: 'nope' })).statusCode).toBe(403);
    }
    const tenth = await ROUTES['POST /api/me/delete'](app, token, { password: 'nope' });
    expect(tenth.statusCode).toBe(429);
    expect(tenth.json()).toMatchObject({ locked: true });
    expect(Number(tenth.headers['retry-after'])).toBeGreaterThan(800);

    const right = await ROUTES['POST /api/auth/email/remove'](app, token, { password: PASSWORD });
    expect(right.statusCode).toBe(429);
    expect((right.json() as { error: string }).error).toMatch(/Zu viele Fehlversuche.*15 Minuten/);
    expect(db.getUser('anna')?.email).toBe('anna@example.org');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password: PASSWORD } });
    expect(login.statusCode).toBe(401);
    expect((login.json() as { error: string }).error).toMatch(/gesperrt/);
  });

  it('a missing password is not a guess, and the right one clears the count', async () => {
    const { app, db } = await createTestApp();
    const { token } = await fullAccount(app, db, 'anna', false);
    for (let i = 0; i < 3; i++) await ROUTES['POST /api/me/delete'](app, token, {});
    expect(db.getUser('anna')?.login_fail_count).toBeUndefined();
    await ROUTES['POST /api/me/delete'](app, token, { password: 'nope' });
    expect(db.getUser('anna')?.login_fail_count).toBe(1);
    expect((await ROUTES['PATCH /api/auth/me'](app, token, { password: PASSWORD })).statusCode).toBe(200);
    expect(db.getUser('anna')?.login_fail_count).toBeUndefined();
  });

  it('expires: after 15 minutes the right password works again', async () => {
    const { app, db } = await createTestApp();
    const { token } = await fullAccount(app, db, 'anna', false);
    db.patchUser('anna', { login_locked_until: Date.now() + 60_000 });
    const locked = await ROUTES['PATCH /api/auth/me'](app, token, { password: PASSWORD });
    expect(locked.statusCode).toBe(429);
    expect((locked.json() as { error: string }).error).toMatch(/1 Minute erneut/);
    db.patchUser('anna', { login_locked_until: Date.now() - 1 });
    expect((await ROUTES['PATCH /api/auth/me'](app, token, { password: PASSWORD })).statusCode).toBe(200);
  });

  it('POST /api/update/apply on the admin-JWT path uses the same lockout and keeps its 401 for a wrong password', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'owner');
    const wrong = await app.inject({ method: 'POST', url: '/api/update/apply', headers: auth(token), payload: { password: 'nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(db.getUser('owner')?.login_fail_count).toBe(1);
    db.patchUser('owner', { login_locked_until: Date.now() + 60_000 });
    // The right password while locked never reaches the update itself.
    const locked = await app.inject({ method: 'POST', url: '/api/update/apply', headers: auth(token), payload: { password: PASSWORD } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ locked: true });
  });
});

describe('TOTP step-up (#479)', () => {
  for (const [name, call] of Object.entries(ROUTES)) {
    it(`${name}: with 2FA on, the password alone or a wrong code is refused; a valid code passes`, async () => {
      const { app, db } = await createTestApp();
      const { token } = await fullAccount(app, db);
      const missing = await call(app, token, { password: PASSWORD });
      expect(missing.statusCode).toBe(403);
      expect(missing.json()).toMatchObject({ totpRequired: true });
      const wrong = await call(app, token, { password: PASSWORD, code: staleCode() });
      expect(wrong.statusCode).toBe(403);
      expect(wrong.json()).toMatchObject({ error: 'Ungültiger Code', totpRequired: true });
      expect(db.getUser('anna')?.totp_fail_count).toBe(1);
      const ok = await call(app, token, { password: PASSWORD, code: freshCode() });
      // Passing re-auth: whatever the route answers next, it is not a re-auth refusal.
      expect([403, 429]).not.toContain(ok.statusCode);
      if (name !== 'POST /api/me/delete') expect(db.getUser('anna')?.totp_fail_count).toBeUndefined();
    });
  }

  it('accepts a recovery code once, and refuses a TOTP code replayed in its own window', async () => {
    const { app, db } = await createTestApp();
    const { token } = await fullAccount(app, db);
    const code = freshCode();
    expect((await ROUTES['POST /api/auth/totp/recovery-codes/regenerate'](app, token, { password: PASSWORD, code })).statusCode).toBe(200);
    expect((await ROUTES['POST /api/auth/totp/recovery-codes/regenerate'](app, token, { password: PASSWORD, code })).statusCode).toBe(403);
    // regenerate replaced the recovery codes; set a known one again.
    const { codes, hashes } = generateRecoveryCodes();
    db.patchUser('anna', { recovery_codes: hashes });
    expect((await ROUTES['PATCH /api/auth/me'](app, token, { password: PASSWORD, code: codes[0] })).statusCode).toBe(200);
    expect(db.getUser('anna')?.recovery_codes).toHaveLength(codes.length - 1);
    const again = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(token), payload: { email: 'drei@example.org', password: PASSWORD, code: codes[0] } });
    expect(again.statusCode).toBe(403);
  });

  it('wrong codes lock on the 2FA counter: 429, and the 2FA login is locked as well', async () => {
    const { app, db } = await createTestApp();
    const { token } = await fullAccount(app, db);
    db.patchUser('anna', { totp_fail_count: 9 });
    const res = await ROUTES['POST /api/auth/totp/disable'](app, token, { password: PASSWORD, code: '12345' });
    expect(res.statusCode).toBe(429);
    expect(db.getUser('anna')?.totp_enabled).toBe(true);
    const valid = await ROUTES['POST /api/auth/totp/disable'](app, token, { password: PASSWORD, code: freshCode() });
    expect(valid.statusCode).toBe(429);
    expect(db.totpLockedUntil('anna')).toBeGreaterThan(Date.now());
  });

  it('totp/enable asks for the password only (2FA is still off), on the same lockout', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    await app.inject({ method: 'POST', url: '/api/auth/totp/setup', headers: auth(token) });
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/totp/enable', headers: auth(token), payload: { password: 'nope', code: '123456' } });
    expect(wrong.statusCode).toBe(403);
    expect(db.getUser('anna')?.login_fail_count).toBe(1);
  });
});

describe('passkeys need re-auth and are announced (#478)', () => {
  async function addPasskey(app: FastifyInstance, token: string, body: Record<string, unknown> = { password: PASSWORD }, name = 'Handy') {
    const options = await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(token), payload: body });
    if (options.statusCode !== 200) return { options, res: null, device: null };
    const device = new SoftAuthenticator(RP);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/passkeys/register/verify', headers: auth(token),
      payload: { response: device.register(options.json()), name },
    });
    return { options, res, device };
  }

  it('a stolen token cannot add a passkey: no challenge without the password, and verify without one fails', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    const { options } = await addPasskey(app, token, {});
    expect(options.statusCode).toBe(403);
    // A response built against a challenge the server never issued.
    const forged = new SoftAuthenticator(RP).register({
      challenge: 'Zm9yZ2VkLWNoYWxsZW5nZQ', rp: { id: RP.rpId, name: 'x' }, user: { id: 'dXNlcg', name: 'anna', displayName: 'anna' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    } as never);
    const verify = await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/verify', headers: auth(token), payload: { response: forged } });
    expect(verify.statusCode).toBe(400);
    expect(db.getUser('anna')?.webauthn_credentials).toBeUndefined();
  });

  it('with 2FA on, adding needs the code as well', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    enableTotp(db, 'anna');
    expect((await addPasskey(app, token)).options.json()).toMatchObject({ totpRequired: true });
    const { res } = await addPasskey(app, token, { password: PASSWORD, code: freshCode() });
    expect(res?.statusCode).toBe(200);
  });

  it('mails the verified address when a passkey is added and removed, escaped and without a link', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    verifiedEmail(db, 'anna', 'anna@example.org');
    const { res, device } = await addPasskey(app, token, { password: PASSWORD }, '<b>Laptop</b>');
    expect(res?.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'anna@example.org', subject: expect.stringContaining('Passkey hinzugefügt') });
    expect(sent[0].html).toContain('&lt;b&gt;Laptop&lt;/b&gt;');
    expect(sent[0].html).not.toContain('<b>Laptop');
    expect(sent[0].html).not.toMatch(/https?:/);

    const noPw = await app.inject({ method: 'DELETE', url: `/api/auth/passkeys/${device!.id}`, headers: auth(token) });
    expect(noPw.statusCode).toBe(403);
    expect(db.getUser('anna')?.webauthn_credentials).toHaveLength(1);
    const del = await app.inject({ method: 'DELETE', url: `/api/auth/passkeys/${device!.id}`, headers: auth(token), payload: { password: PASSWORD } });
    expect(del.statusCode).toBe(200);
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toContain('Passkey entfernt');
    expect(db.getUser('anna')?.webauthn_credentials).toBeUndefined();
  });

  it('mails nobody for an unverified or missing address, and a failing mail does not fail the change', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    expect((await addPasskey(app, token)).res?.statusCode).toBe(200);
    db.patchUser('anna', { email: 'anna@example.org', email_verified: false });
    expect((await addPasskey(app, token, { password: PASSWORD }, 'Zwei')).res?.statusCode).toBe(200);
    expect(sent).toHaveLength(0);
    db.patchUser('anna', { email_verified: true });
    smtp.failFor.add('anna@example.org');
    expect((await addPasskey(app, token, { password: PASSWORD }, 'Drei')).res?.statusCode).toBe(200);
    expect(db.getUser('anna')?.webauthn_credentials).toHaveLength(3);
  });

  it('a 404 for an unknown passkey comes only after re-auth', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    expect((await app.inject({ method: 'DELETE', url: '/api/auth/passkeys/nope', headers: auth(token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/auth/passkeys/nope', headers: auth(token), payload: { password: PASSWORD } })).statusCode).toBe(404);
  });
});

describe('password reset can drop every passkey (#478)', () => {
  async function resetWith(app: FastifyInstance, db: Db, extra: Record<string, unknown>) {
    const token = await register(app, 'anna');
    verifiedEmail(db, 'anna', 'anna@example.org');
    db.patchUser('anna', { webauthn_credentials: [{ id: 'pk-1', publicKey: 'x', counter: 0, name: 'Fremd', rpId: RP.rpId, createdAt: 1 }] });
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await new Promise((r) => setImmediate(r));
    const link = /#\/passwort-neu\?token=([0-9a-f]{64})/.exec(sent.find((m) => m.subject.includes('Passwort'))!.html)![1];
    const res = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token: link, password: 'brand-new-pass', ...extra } });
    expect(res.statusCode).toBe(200);
    void token;
    return res.json() as { passkeysRemoved: boolean };
  }

  it('keeps the passkeys by default', async () => {
    const { app, db } = await createTestApp();
    expect(await resetWith(app, db, {})).toMatchObject({ passkeysRemoved: false });
    expect(db.getUser('anna')?.webauthn_credentials).toHaveLength(1);
  });

  it('removes them all on request', async () => {
    const { app, db } = await createTestApp();
    expect(await resetWith(app, db, { removePasskeys: true })).toMatchObject({ passkeysRemoved: true });
    expect(db.getUser('anna')?.webauthn_credentials).toBeUndefined();
  });
});

describe('notice texts (#475, #478)', () => {
  it('tell the owner to end all sessions and check the passkey list', () => {
    expect(TAKEOVER_ADVICE).toMatch(/Von allen Geräten abmelden/);
    expect(TAKEOVER_ADVICE).toMatch(/Passkeys/);
    const mail = passkeyChangedMail('Nagellacke', 'anna', 'removed', 'Handy');
    expect(mail.html).toContain('entfernt');
    expect(mail.html).toContain('Von allen Geräten abmelden');
  });
});
