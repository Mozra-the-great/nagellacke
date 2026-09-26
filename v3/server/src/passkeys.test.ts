import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SoftAuthenticator } from './softAuthenticator';
import { resolveRelyingParty, isValidRpId, ChallengeStore } from './passkeys';

/**
 * #228: passkeys as an opt-in third way to sign in. The routes are driven by a software
 * authenticator, so every test goes through @simplewebauthn/server's real verification.
 */
const APP_URL = 'https://app.example.de';
const RP = { rpId: 'app.example.de', origin: APP_URL };

async function createTestApp(appUrl: string | undefined = APP_URL) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-passkey-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.ALLOW_REGISTRATION = 'true';
  if (appUrl) process.env.APP_URL = appUrl; else delete process.env.APP_URL;
  vi.resetModules();
  const mod = await import('./index');
  const db = await import('./db');
  const app: FastifyInstance = await mod.buildApp();
  tmpDirs.push(dir);
  return { app, db };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.ALLOW_REGISTRATION;
  delete process.env.APP_URL;
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'password123' } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

async function addPasskey(app: FastifyInstance, token: string, device = new SoftAuthenticator(RP), name = 'Handy') {
  const options = (await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(token) })).json();
  const res = await app.inject({
    method: 'POST', url: '/api/auth/passkeys/register/verify', headers: auth(token),
    payload: { response: device.register(options), name },
  });
  return { res, device, options };
}

async function loginOptions(app: FastifyInstance) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/passkeys/login/options' });
  expect(res.statusCode).toBe(200);
  return res.json() as { challenge: string; rpId: string };
}

async function loginWith(app: FastifyInstance, response: unknown) {
  return app.inject({ method: 'POST', url: '/api/auth/passkeys/login/verify', payload: { response } });
}

describe('relying party (#228)', () => {
  it('is the App-URL host, or a parent domain of it, and only over https or on localhost', () => {
    expect(resolveRelyingParty('https://app.example.de')).toEqual({ rpId: 'app.example.de', origin: 'https://app.example.de' });
    expect(resolveRelyingParty('https://app.example.de', 'example.de')).toEqual({ rpId: 'example.de', origin: 'https://app.example.de' });
    expect(resolveRelyingParty('http://localhost:4173')).toEqual({ rpId: 'localhost', origin: 'http://localhost:4173' });
    expect(resolveRelyingParty('http://192.168.1.5:3001')).toBe('insecure');
    expect(resolveRelyingParty('https://app.example.de', 'other.de')).toBe('rp-id-mismatch');
    // A suffix match has to fall on a label boundary.
    expect(resolveRelyingParty('https://evilexample.de', 'example.de')).toBe('rp-id-mismatch');
    expect(resolveRelyingParty('')).toBe('no-app-url');
    expect(isValidRpId('example.de')).toBe(true);
    expect(isValidRpId('https://example.de')).toBe(false);
  });

  it('keeps challenges single-use, typed and bound to the registering account', () => {
    const store = new ChallengeStore();
    store.put('c1', { kind: 'register', username: 'anna', expires: Date.now() + 1000 });
    expect(store.take('c1', 'register', 'ben')).toBe(false);
    expect(store.take('c1', 'register', 'anna')).toBe(false); // spent by the failed attempt
    store.put('c2', { kind: 'login', expires: Date.now() + 1000 });
    expect(store.take('c2', 'register', 'anna')).toBe(false);
    store.put('c3', { kind: 'login', expires: Date.now() - 1 });
    expect(store.take('c3', 'login')).toBe(false);
  });
});

describe('passkey routes (#228)', () => {
  it('registers a passkey and signs in with it, without a username and without any token before the end', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    const { res, device } = await addPasskey(app, token);
    expect(res.statusCode).toBe(200);

    const list = (await app.inject({ method: 'GET', url: '/api/auth/passkeys', headers: auth(token) })).json();
    expect(list).toMatchObject({ available: true, passkeys: [{ name: 'Handy', stale: false, lastUsedAt: null }] });

    const options = await loginOptions(app);
    expect(JSON.stringify(options)).not.toMatch(/token/i);
    const login = await loginWith(app, device.authenticate(options));
    expect(login.statusCode).toBe(200);
    const session = (login.json() as { token: string }).token;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(session) });
    expect(me.json()).toMatchObject({ username: 'anna' });
  });

  it('refuses a replayed assertion, a wrong origin and one without user verification', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    const { device } = await addPasskey(app, token);

    const first = device.authenticate(await loginOptions(app));
    expect((await loginWith(app, first)).statusCode).toBe(200);
    expect((await loginWith(app, first)).statusCode).toBe(401);

    expect((await loginWith(app, device.authenticate(await loginOptions(app), { origin: 'https://evil.example' }))).statusCode).toBe(401);
    expect((await loginWith(app, device.authenticate(await loginOptions(app), { uv: false }))).statusCode).toBe(401);
  });

  it('refuses a passkey registered under a challenge issued to another account', async () => {
    const { app } = await createTestApp();
    const anna = await register(app, 'anna');
    const ben = await register(app, 'ben');
    const options = (await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(anna) })).json();
    const res = await app.inject({
      method: 'POST', url: '/api/auth/passkeys/register/verify', headers: auth(ben),
      payload: { response: new SoftAuthenticator(RP).register(options) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('works next to TOTP: the password path still asks for the code, the passkey path does not', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    const { device } = await addPasskey(app, token);
    db.patchUser('anna', { totp_enabled: true, totp_secret: 'JBSWY3DPEHPK3PXP' });

    const pw = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password: 'password123' } });
    expect(pw.json()).toMatchObject({ mfaRequired: true });
    expect((pw.json() as { token?: string }).token).toBeUndefined();

    const pk = await loginWith(app, device.authenticate(await loginOptions(app)));
    expect(pk.statusCode).toBe(200);
    expect(typeof (pk.json() as { token?: string }).token).toBe('string');
  });

  it('removing the passkey ends that way in, the password keeps working', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    const { device } = await addPasskey(app, token);
    const del = await app.inject({ method: 'DELETE', url: `/api/auth/passkeys/${device.id}`, headers: auth(token) });
    expect(del.statusCode).toBe(200);
    expect((await loginWith(app, device.authenticate(await loginOptions(app)))).statusCode).toBe(401);
    const pw = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password: 'password123' } });
    expect(pw.statusCode).toBe(200);
  });

  it('refuses the same authenticator twice for one account', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    const { device } = await addPasskey(app, token);
    const options = (await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(token) })).json() as { excludeCredentials: { id: string }[] };
    expect(options.excludeCredentials.map((c) => c.id)).toEqual([device.id]);
    const again = await app.inject({
      method: 'POST', url: '/api/auth/passkeys/register/verify', headers: auth(token),
      payload: { response: device.register(options as never) },
    });
    expect(again.statusCode).toBe(409);
  });

  it('is unavailable without https, and says why', async () => {
    const { app } = await createTestApp('http://192.168.1.5:3001');
    const token = await register(app, 'anna');
    expect((await app.inject({ method: 'GET', url: '/api/auth/registration-status' })).json()).toMatchObject({ passkeys: false });
    const res = await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(token) });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toMatch(/HTTPS/);
    expect((await app.inject({ method: 'POST', url: '/api/auth/passkeys/login/options' })).statusCode).toBe(409);
  });

  it('reports passkeys bound to an old domain after the App-URL changed, and removes them on request', async () => {
    const { app } = await createTestApp();
    const admin = await register(app, 'owner');
    const { device } = await addPasskey(app, admin);

    const move = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: auth(admin), payload: { appUrl: 'https://neu.example.de' } });
    expect(move.statusCode).toBe(200);
    const settings = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: auth(admin) })).json();
    expect(settings.passkeys).toMatchObject({ rpId: 'neu.example.de', total: 1, stale: 1 });
    const list = (await app.inject({ method: 'GET', url: '/api/auth/passkeys', headers: auth(admin) })).json();
    expect(list.passkeys[0].stale).toBe(true);
    // Dead indeed: the new relying party does not accept it.
    expect((await loginWith(app, device.authenticate(await loginOptions(app)))).statusCode).toBe(401);

    await app.inject({ method: 'POST', url: '/api/admin/settings', headers: auth(admin), payload: { dropStalePasskeys: true } });
    const after = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: auth(admin) })).json();
    expect(after.passkeys).toMatchObject({ total: 0, stale: 0 });
  });

  it('accepts a parent domain as RP ID and refuses a malformed one', async () => {
    const { app } = await createTestApp();
    const admin = await register(app, 'owner');
    const ok = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: auth(admin), payload: { webauthnRpId: 'Example.de' } });
    expect(ok.statusCode).toBe(200);
    const s = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: auth(admin) })).json();
    expect(s).toMatchObject({ webauthnRpId: 'example.de', passkeys: { rpId: 'example.de' } });
    const bad = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: auth(admin), payload: { webauthnRpId: 'https://x' } });
    expect(bad.statusCode).toBe(400);

    // A passkey created for the parent domain signs in from the subdomain.
    const device = new SoftAuthenticator({ rpId: 'example.de', origin: APP_URL });
    expect((await addPasskey(app, admin, device)).res.statusCode).toBe(200);
    expect((await loginWith(app, device.authenticate(await loginOptions(app)))).statusCode).toBe(200);
  });
});
