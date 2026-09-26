import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { FastifyInstance } from 'fastify';
import * as crypto from 'node:crypto';
import { solvePowForTest, hasLeadingZeroBits, type PowChallenge } from './pow';

// Same bootstrap as index.test.ts: DATA_DIR resolves at module scope, so it has
// to be set before the module is imported.
let buildApp: typeof import('./index').buildApp;
let setServerSettings: typeof import('./db').setServerSettings;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-reg-test-'));
  process.env.DATA_DIR = tmpDir;
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.ALLOWED_ORIGIN = 'http://localhost';
  delete process.env.ALLOW_REGISTRATION; // the panel setting is what these tests drive
  ({ buildApp } = await import('./index'));
  ({ setServerSettings } = await import('./db'));
});

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildApp();
});

let userCounter = 0;
function freshUsername(): string {
  userCounter += 1;
  return `reg-test-user-${userCounter}`;
}

const PASSWORD = 'correct-horse-battery';

async function status(): Promise<{ allowed: boolean; firstUser: boolean; requiresPow: boolean }> {
  const res = await app.inject({ method: 'GET', url: '/api/auth/registration-status' });
  expect(res.statusCode).toBe(200);
  return res.json() as { allowed: boolean; firstUser: boolean; requiresPow: boolean };
}

async function register(username: string, pow?: unknown) {
  return app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: { username, password: PASSWORD, ...(pow !== undefined ? { pow } : {}) },
  });
}

function isSolution(salt: string, n: number, difficulty: number): boolean {
  return hasLeadingZeroBits(crypto.createHash('sha256').update(`${salt}${n}`).digest(), difficulty);
}

async function challenge(): Promise<PowChallenge> {
  const res = await app.inject({ method: 'GET', url: '/api/auth/pow-challenge' });
  expect(res.statusCode).toBe(200);
  return res.json() as PowChallenge;
}

/**
 * #278: the web app had no register form because it had no way to ask whether
 * registration is open — the flag only lived on the admin-only settings route.
 */
describe('GET /api/auth/registration-status (#278)', () => {
  it('reports open on a server with no users yet, and says so is the first-user case', async () => {
    const before = await status();
    expect(before).toEqual({ allowed: true, firstUser: true, requiresPow: false, passwordReset: false, passkeys: false });

    // Bootstrap the first account; that one is always allowed through.
    expect((await register(freshUsername())).statusCode).toBe(200);
  });

  it('reports closed once a user exists and registration is not enabled', async () => {
    setServerSettings({ allowRegistration: false });
    const s = await status();
    expect(s.allowed).toBe(false);
    expect(s.firstUser).toBe(false);
  });

  it('agrees with what POST /api/auth/register actually does — closed', async () => {
    setServerSettings({ allowRegistration: false });
    expect((await status()).allowed).toBe(false);

    const res = await register(freshUsername());
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('Registrierung deaktiviert');
  });

  it('agrees with what POST /api/auth/register actually does — open', async () => {
    setServerSettings({ allowRegistration: true });
    expect((await status()).allowed).toBe(true);

    const res = await register(freshUsername());
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token?: string; refreshToken?: string };
    // Registration hands back a usable session directly, which is what lets the
    // web form log the user straight in instead of asking them to log in again.
    expect(typeof body.token).toBe('string');
    expect(typeof body.refreshToken).toBe('string');

    const me = await app.inject({
      method: 'GET', url: '/api/auth/me',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it('needs no authentication — an anonymous visitor is exactly who asks', async () => {
    setServerSettings({ allowRegistration: true });
    const res = await app.inject({ method: 'GET', url: '/api/auth/registration-status' });
    expect(res.statusCode).toBe(200);
    // Nothing about existing accounts leaks out of it.
    expect(Object.keys(res.json() as object).sort()).toEqual(['allowed', 'firstUser', 'passkeys', 'passwordReset', 'requiresPow']);
  });
});

/**
 * #324 S13: a proof of work on registration, for public instances. Off by default,
 * so a LAN install behaves exactly as before.
 */
describe('registration proof of work (#324 S13)', () => {
  it('is not required unless switched on', async () => {
    setServerSettings({ allowRegistration: true });
    expect((await status()).requiresPow).toBe(false);
    expect((await register(freshUsername())).statusCode).toBe(200);
  });

  it('refuses a registration without a solution once switched on, and says why', async () => {
    setServerSettings({ allowRegistration: true, registrationPow: true });
    expect((await status()).requiresPow).toBe(true);
    const res = await register(freshUsername());
    expect(res.statusCode).toBe(400);
    expect((res.json() as { powRequired?: boolean }).powRequired).toBe(true);
  });

  it('accepts a valid solution', async () => {
    setServerSettings({ allowRegistration: true, registrationPow: true });
    const res = await register(freshUsername(), solvePowForTest(await challenge()));
    expect(res.statusCode).toBe(200);
  });

  it('refuses a wrong n, a tampered salt or a lowered difficulty', async () => {
    setServerSettings({ allowRegistration: true, registrationPow: true });
    const solved = solvePowForTest(await challenge());
    // solvePowForTest returns the smallest solution, and n + 1 is itself one with
    // probability 2^-16; step on until it is not.
    let wrong = solved.n + 1;
    while (isSolution(solved.salt, wrong, solved.difficulty)) wrong += 1;
    expect((await register(freshUsername(), { ...solved, n: wrong })).statusCode).toBe(400);
    const tamperedSalt = solved.salt.replace(/^./, (c) => (c === '0' ? '1' : '0'));
    expect((await register(freshUsername(), { ...solved, salt: tamperedSalt })).statusCode).toBe(400);
    expect((await register(freshUsername(), { ...solved, difficulty: 1 })).statusCode).toBe(400);
  });

  it('refuses the same solution twice, even when the first use hit a taken name', async () => {
    setServerSettings({ allowRegistration: true, registrationPow: true });
    const taken = freshUsername();
    expect((await register(taken, solvePowForTest(await challenge()))).statusCode).toBe(200);

    const solved = solvePowForTest(await challenge());
    expect((await register(taken, solved)).statusCode).toBe(409);
    expect((await register(freshUsername(), solved)).statusCode).toBe(400);
  });
});
