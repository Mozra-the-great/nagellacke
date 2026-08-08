import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TOTP, Secret } from 'otpauth';
import type { FastifyInstance } from 'fastify';

// DATA_DIR (and everything derived from it — users.json, .jwt_secret,
// .api_key) resolves at *module scope* in both db.ts and index.ts, and
// `fs.mkdirSync` runs at import time. It must therefore be set before either
// module is imported — a static `import './index'` at the top of this file
// would be hoisted above any assignment to process.env, so we import
// dynamically inside beforeAll instead.
let buildApp: typeof import('./index').buildApp;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-test-'));
  process.env.DATA_DIR = tmpDir;
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.ALLOWED_ORIGIN = 'http://localhost';
  process.env.ALLOW_REGISTRATION = 'true'; // every test registers its own user
  ({ buildApp } = await import('./index'));
});

// A fresh Fastify instance per test: the rate-limit plugin and the mfaAttempts
// map both live inside buildApp()'s closure, so this also resets both of
// those between tests without needing to reset users.json (tests use unique
// usernames instead).
let app: FastifyInstance;
beforeEach(async () => {
  app = await buildApp();
});

let userCounter = 0;
function freshUsername(): string {
  userCounter += 1;
  return `totp-test-user-${userCounter}`;
}

async function register(username: string, password = 'correct-horse-battery'): Promise<{ token: string; refreshToken: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function login(username: string, password = 'correct-horse-battery') {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
}

/** Generates a valid current TOTP code for a base32 secret, independent of the app under test. */
function codeFor(secretBase32: string, timestamp: number = Date.now()): string {
  const totp = new TOTP({ secret: Secret.fromBase32(secretBase32), digits: 6, period: 30 });
  return totp.generate({ timestamp });
}

/** Registers a user, enables 2FA on it via the real setup/enable flow, and returns everything a test needs. */
async function registerWithTotpEnabled(username: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  const { token } = await register(username);
  const setupRes = await app.inject({
    method: 'POST', url: '/api/auth/totp/setup',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(setupRes.statusCode).toBe(200);
  const { secret } = setupRes.json() as { secret: string };

  const enableRes = await app.inject({
    method: 'POST', url: '/api/auth/totp/enable',
    headers: { authorization: `Bearer ${token}` },
    payload: { code: codeFor(secret) },
  });
  expect(enableRes.statusCode).toBe(200);
  const { recoveryCodes } = enableRes.json() as { recoveryCodes: string[] };
  return { secret, recoveryCodes };
}

describe('POST /api/auth/login — regression guard (no 2FA)', () => {
  it('returns the unchanged { token, refreshToken } shape for an account without 2FA', async () => {
    const username = freshUsername();
    await register(username);
    const res = await login(username);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(body.mfaRequired).toBeUndefined();
    expect(body.challengeToken).toBeUndefined();
  });
});

describe('§0 typ-claim fix', () => {
  it('rejects a refresh token on a protected route (the pre-existing hole this PR closes)', async () => {
    const username = freshUsername();
    const { refreshToken } = await register(username);
    const res = await app.inject({
      method: 'GET', url: '/api/sync',
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an MFA challenge token on a protected route', async () => {
    const username = freshUsername();
    await registerWithTotpEnabled(username);
    const loginRes = await login(username);
    const { challengeToken } = loginRes.json() as { challengeToken: string };
    expect(challengeToken).toBeTruthy();

    const res = await app.inject({
      method: 'GET', url: '/api/sync',
      headers: { authorization: `Bearer ${challengeToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('still accepts a plain access token on a protected route', async () => {
    const username = freshUsername();
    const { token } = await register(username);
    const res = await app.inject({
      method: 'GET', url: '/api/sync',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Two-step login for accounts with 2FA enabled', () => {
  it('login returns { mfaRequired: true, challengeToken } and no token', async () => {
    const username = freshUsername();
    await registerWithTotpEnabled(username);
    const res = await login(username);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mfaRequired).toBe(true);
    expect(typeof body.challengeToken).toBe('string');
    expect(body.token).toBeUndefined();
  });

  it('login/verify with the correct TOTP code returns a full token pair', async () => {
    const username = freshUsername();
    const { secret } = await registerWithTotpEnabled(username);
    const loginRes = await login(username);
    const { challengeToken } = loginRes.json() as { challengeToken: string };

    const res = await app.inject({
      method: 'POST', url: '/api/auth/login/verify',
      payload: { challengeToken, code: codeFor(secret) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('login/verify with a wrong code is rejected and counts against the attempt cap', async () => {
    const username = freshUsername();
    await registerWithTotpEnabled(username);
    const loginRes = await login(username);
    const { challengeToken } = loginRes.json() as { challengeToken: string };

    const res = await app.inject({
      method: 'POST', url: '/api/auth/login/verify',
      payload: { challengeToken, code: '000000' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('the 6th attempt on the same challenge is rejected even with the correct code (per-jti attempt cap)', async () => {
    const username = freshUsername();
    const { secret } = await registerWithTotpEnabled(username);
    const loginRes = await login(username);
    const { challengeToken } = loginRes.json() as { challengeToken: string };

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST', url: '/api/auth/login/verify',
        payload: { challengeToken, code: '000000' },
      });
      expect(res.statusCode).toBe(401);
    }

    const res = await app.inject({
      method: 'POST', url: '/api/auth/login/verify',
      payload: { challengeToken, code: codeFor(secret) },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Zu viele Fehlversuche');
  });

  it('a recovery code logs in once, then fails on replay, and recoveryCodesRemaining drops', async () => {
    const username = freshUsername();
    const { recoveryCodes } = await registerWithTotpEnabled(username);
    const code = recoveryCodes[0];

    const loginRes1 = await login(username);
    const { challengeToken: challenge1 } = loginRes1.json() as { challengeToken: string };
    const res1 = await app.inject({
      method: 'POST', url: '/api/auth/login/verify',
      payload: { challengeToken: challenge1, code },
    });
    expect(res1.statusCode).toBe(200);
    const { token } = res1.json() as { token: string };

    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(meRes.json().recoveryCodesRemaining).toBe(recoveryCodes.length - 1);

    // Same code again, fresh challenge: must fail — single-use.
    const loginRes2 = await login(username);
    const { challengeToken: challenge2 } = loginRes2.json() as { challengeToken: string };
    const res2 = await app.inject({
      method: 'POST', url: '/api/auth/login/verify',
      payload: { challengeToken: challenge2, code },
    });
    expect(res2.statusCode).toBe(401);
  });
});

describe('POST /api/auth/totp/setup + /enable — verify-before-enable', () => {
  it('a wrong code at /enable leaves 2FA disabled (pending secret preserved for retry)', async () => {
    const username = freshUsername();
    const { token } = await register(username);
    const setupRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/setup',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(setupRes.statusCode).toBe(200);

    const enableRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/enable',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: '000000' },
    });
    expect(enableRes.statusCode).toBe(401);

    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(meRes.json().totpEnabled).toBe(false);

    // Login is still the plain, non-2FA shape.
    const loginRes = await login(username);
    expect(loginRes.json().mfaRequired).toBeUndefined();
  });

  it('the correct code at /enable flips totpEnabled and returns recovery codes once', async () => {
    const username = freshUsername();
    const { recoveryCodes } = await registerWithTotpEnabled(username);
    expect(recoveryCodes.length).toBeGreaterThanOrEqual(8);

    const { token } = await login(username).then(async (res) => {
      // Already 2FA-enabled at this point — verify via the challenge instead of a plain login.
      const { challengeToken } = res.json() as { challengeToken: string };
      const verifyRes = await app.inject({
        method: 'POST', url: '/api/auth/login/verify',
        payload: { challengeToken, code: recoveryCodes[1] },
      });
      return verifyRes.json() as { token: string };
    });

    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(meRes.json().totpEnabled).toBe(true);
  });
});

describe('POST /api/auth/totp/setup and /enable are blocked while 2FA is already enabled', () => {
  it('setup does not silently disable 2FA on an already-enrolled account', async () => {
    const username = freshUsername();
    const { secret } = await registerWithTotpEnabled(username);
    const loginRes1 = await login(username);
    const { challengeToken } = loginRes1.json() as { challengeToken: string };
    const verifyRes = await app.inject({
      method: 'POST', url: '/api/auth/login/verify',
      payload: { challengeToken, code: codeFor(secret) },
    });
    const { token } = verifyRes.json() as { token: string };

    const setupRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/setup',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(setupRes.statusCode).toBe(400);

    // 2FA must still be enabled — login must still return a challenge, not tokens.
    const loginRes2 = await login(username);
    expect(loginRes2.json().mfaRequired).toBe(true);
  });

  it('enable is rejected once already enabled, without touching state', async () => {
    const username = freshUsername();
    const { token } = await register(username);
    const setupRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/setup',
      headers: { authorization: `Bearer ${token}` },
    });
    const { secret } = setupRes.json() as { secret: string };
    await app.inject({
      method: 'POST', url: '/api/auth/totp/enable',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: codeFor(secret) },
    });

    const secondEnable = await app.inject({
      method: 'POST', url: '/api/auth/totp/enable',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: codeFor(secret) },
    });
    expect(secondEnable.statusCode).toBe(400);
  });
});

describe('POST /api/auth/totp/disable', () => {
  it('rejects without the correct password', async () => {
    const username = freshUsername();
    const { secret } = await registerWithTotpEnabled(username);
    const loginRes = await login(username);
    const { challengeToken } = loginRes.json() as { challengeToken: string };
    const verifyRes = await app.inject({
      method: 'POST', url: '/api/auth/login/verify',
      payload: { challengeToken, code: codeFor(secret) },
    });
    const { token } = verifyRes.json() as { token: string };

    const res = await app.inject({
      method: 'POST', url: '/api/auth/totp/disable',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'definitely-wrong' },
    });
    expect(res.statusCode).toBe(401);

    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(meRes.json().totpEnabled).toBe(true); // unchanged
  });

  it('disables 2FA with the correct password and returns a fresh usable token pair', async () => {
    const username = freshUsername();
    const { secret } = await registerWithTotpEnabled(username);
    const loginRes = await login(username);
    const { challengeToken } = loginRes.json() as { challengeToken: string };
    const verifyRes = await app.inject({
      method: 'POST', url: '/api/auth/login/verify',
      payload: { challengeToken, code: codeFor(secret) },
    });
    const { token } = verifyRes.json() as { token: string };

    const disableRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/disable',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'correct-horse-battery' },
    });
    expect(disableRes.statusCode).toBe(200);
    const disableBody = disableRes.json() as { ok: boolean; token: string; refreshToken: string };
    expect(disableBody.ok).toBe(true);
    expect(typeof disableBody.token).toBe('string');

    // The fresh token from /disable must itself work (token_version was bumped).
    const meRes = await app.inject({
      method: 'GET', url: '/api/auth/me',
      headers: { authorization: `Bearer ${disableBody.token}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().totpEnabled).toBe(false);

    // Login is now the plain, non-2FA shape again.
    const finalLogin = await login(username);
    const finalBody = finalLogin.json();
    expect(typeof finalBody.token).toBe('string');
    expect(finalBody.mfaRequired).toBeUndefined();
  });
});
