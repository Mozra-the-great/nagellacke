import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { SoftAuthenticator } from './softAuthenticator';
import { resolveRelyingParty, isValidRpId, ChallengeStore, relyingPartyProblemText, CHALLENGE_TTL_MS } from './passkeys';

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
// Adding and removing a passkey needs the password since #478.
const REAUTH = { password: 'password123' };

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'password123' } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

async function addPasskey(app: FastifyInstance, token: string, device = new SoftAuthenticator(RP), name = 'Handy') {
  const options = (await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(token), payload: REAUTH })).json();
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
    const options = (await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(anna), payload: REAUTH })).json();
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
    const del = await app.inject({ method: 'DELETE', url: `/api/auth/passkeys/${device.id}`, headers: auth(token), payload: REAUTH });
    expect(del.statusCode).toBe(200);
    expect((await loginWith(app, device.authenticate(await loginOptions(app)))).statusCode).toBe(401);
    const pw = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password: 'password123' } });
    expect(pw.statusCode).toBe(200);
  });

  it('refuses the same authenticator twice for one account', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    const { device } = await addPasskey(app, token);
    const options = (await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(token), payload: REAUTH })).json() as { excludeCredentials: { id: string }[] };
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
    const res = await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: auth(token), payload: REAUTH });
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

describe('relying party and challenge store, in detail (#498)', () => {
  afterEach(() => vi.useRealTimers());

  describe('isValidRpId', () => {
    const label = (n: number): string => 'a'.repeat(n);
    const hostOfLength = (total: number): string => {
      // labels of 63 characters, the last one shorter, joined by dots
      const parts: string[] = [];
      let left = total;
      while (left > 63 + 1) { parts.push(label(63)); left -= 64; }
      parts.push(label(left));
      return parts.join('.');
    };

    it.each(['a', 'example.de', 'app.example.de', 'a.b', 'a-b.c-d.de', 'xn--bcher-kva.example', 'a1.b2', '1.2', 'localhost', `${label(63)}.de`])(
      'accepts %s', (value) => { expect(isValidRpId(value)).toBe(true); },
    );

    it.each([
      '', ' ', 'UPPER.de', 'a_b.de', 'a b.de', '-a.de', 'a-.de', 'a.-b', 'a.b-', 'a..de', '.de', 'de.', 'a.de/', 'a.de:443',
      'https://example.de', `${label(64)}.de`, 'a.ä.de',
    ])('refuses %j', (value) => { expect(isValidRpId(value)).toBe(false); });

    it('accepts a name of 253 characters and refuses one of 254', () => {
      expect(hostOfLength(253)).toHaveLength(253);
      expect(isValidRpId(hostOfLength(253))).toBe(true);
      expect(hostOfLength(254)).toHaveLength(254);
      expect(isValidRpId(hostOfLength(254))).toBe(false);
      expect(isValidRpId(hostOfLength(252))).toBe(true);
    });

    it('allows a hyphen or digit inside a later label, and refuses a later label that starts or ends with one', () => {
      expect(isValidRpId('a.b-c.d')).toBe(true);
      expect(isValidRpId('a.bc9.d')).toBe(true);
      expect(isValidRpId('a.-bc.d')).toBe(false);
      expect(isValidRpId('a.bc-.d')).toBe(false);
      expect(isValidRpId(`a.${label(63)}.d`)).toBe(true);
      expect(isValidRpId(`a.${label(64)}.d`)).toBe(false);
    });
  });

  describe('resolveRelyingParty', () => {
    it('answers an App-URL that cannot be parsed like a missing one', () => {
      expect(resolveRelyingParty('not a url')).toBe('no-app-url');
      expect(resolveRelyingParty('example.de')).toBe('no-app-url');
    });

    it('lower-cases host and override, and keeps the port out of the RP ID but in the origin', () => {
      expect(resolveRelyingParty('https://App.Example.DE:8443', 'Example.DE'))
        .toEqual({ rpId: 'example.de', origin: 'https://app.example.de:8443' });
    });

    it('treats an empty override as none', () => {
      expect(resolveRelyingParty('https://app.example.de', '')).toEqual({ rpId: 'app.example.de', origin: 'https://app.example.de' });
    });

    it('accepts the host itself as override and refuses a longer or unrelated one', () => {
      expect(resolveRelyingParty('https://app.example.de', 'app.example.de')).toMatchObject({ rpId: 'app.example.de' });
      expect(resolveRelyingParty('https://example.de', 'app.example.de')).toBe('rp-id-mismatch');
      expect(resolveRelyingParty('https://app.example.de', 'p.example.de')).toBe('rp-id-mismatch');
    });

    it('refuses http for anything but localhost, whatever the override', () => {
      expect(resolveRelyingParty('http://app.example.de')).toBe('insecure');
      expect(resolveRelyingParty('http://app.example.de', 'example.de')).toBe('insecure');
      expect(resolveRelyingParty('http://LOCALHOST:3001')).toMatchObject({ rpId: 'localhost' });
    });

    it('describes each problem in words', () => {
      expect(relyingPartyProblemText('no-app-url')).toBe('Auf diesem Server ist keine App-URL eingetragen.');
      expect(relyingPartyProblemText('insecure')).toBe('Passkeys funktionieren nur über HTTPS. Dieser Server ist per http:// erreichbar.');
      expect(relyingPartyProblemText('rp-id-mismatch')).toBe('Die eingestellte Passkey-Domain passt nicht zur App-URL.');
    });
  });

  describe('ChallengeStore', () => {
    const NOW = 1_800_000_000_000;
    const size = (s: ChallengeStore): number => (s as unknown as { pending: Map<string, unknown> }).pending.size;

    it('lives five minutes', () => {
      expect(CHALLENGE_TTL_MS).toBe(300_000);
    });

    it('accepts a fresh challenge once, up to the last millisecond before it expires', () => {
      const store = new ChallengeStore();
      store.put('c', { kind: 'login', expires: NOW + 1000 });
      expect(store.take('c', 'login', undefined, NOW + 999)).toBe(true);
      expect(store.take('c', 'login', undefined, NOW + 999)).toBe(false); // single use
    });

    it('refuses a challenge at its expiry and after, and spends it either way', () => {
      const store = new ChallengeStore();
      store.put('c1', { kind: 'login', expires: NOW + 1000 });
      expect(store.take('c1', 'login', undefined, NOW + 1000)).toBe(false);
      store.put('c1', { kind: 'login', expires: NOW + 1000 });
      expect(store.take('c1', 'login', undefined, NOW + 5000)).toBe(false);
      expect(store.take('c1', 'login', undefined, NOW)).toBe(false); // gone, although it would be fresh again
    });

    it('refuses an unknown challenge', () => {
      expect(new ChallengeStore().take('nope', 'login', undefined, NOW)).toBe(false);
    });

    it('binds a registration challenge to the account that asked, and lets a login challenge ignore the name', () => {
      const store = new ChallengeStore();
      store.put('r', { kind: 'register', username: 'anna', expires: NOW + 1000 });
      expect(store.take('r', 'register', 'anna', NOW)).toBe(true);
      store.put('r2', { kind: 'register', username: 'anna', expires: NOW + 1000 });
      expect(store.take('r2', 'register', undefined, NOW)).toBe(false);
      store.put('r3', { kind: 'register', expires: NOW + 1000 });
      expect(store.take('r3', 'register', 'anna', NOW)).toBe(false);
      store.put('l', { kind: 'login', username: 'anna', expires: NOW + 1000 });
      expect(store.take('l', 'login', 'ben', NOW)).toBe(true);
    });

    it('refuses a challenge of the other kind, in both directions', () => {
      const store = new ChallengeStore();
      store.put('a', { kind: 'register', username: 'anna', expires: NOW + 1000 });
      expect(store.take('a', 'login', 'anna', NOW)).toBe(false);
      store.put('b', { kind: 'login', expires: NOW + 1000 });
      expect(store.take('b', 'register', undefined, NOW)).toBe(false);
    });

    it('reads the clock when no time is given', () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const store = new ChallengeStore();
      store.put('c', { kind: 'login', expires: NOW + 1000 });
      vi.setSystemTime(NOW + 999);
      expect(store.take('c', 'login')).toBe(true);
      store.put('d', { kind: 'login', expires: NOW + 1000 });
      vi.setSystemTime(NOW + 1000);
      expect(store.take('d', 'login')).toBe(false);
    });

    it('drops expired challenges when a new one is stored, and only those', () => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const store = new ChallengeStore();
      store.put('dead', { kind: 'login', expires: NOW });       // expires exactly now
      store.put('alive', { kind: 'login', expires: NOW + 1 });  // put() prunes at NOW: "dead" goes
      expect(size(store)).toBe(1);
      store.put('later', { kind: 'login', expires: NOW + 10 });
      expect(size(store)).toBe(2);
      vi.setSystemTime(NOW + 1);
      store.put('x', { kind: 'login', expires: NOW + 100 });    // "alive" expires exactly now
      expect(size(store)).toBe(2); // later, x
      expect(store.take('later', 'login')).toBe(true);
    });
  });
});
