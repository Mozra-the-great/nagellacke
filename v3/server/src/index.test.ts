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

/**
 * Registers a user, enables 2FA on it via the real setup/enable flow, and
 * returns everything a test needs — including the fresh token pair /enable
 * returns, since enableTotp() bumps token_version and invalidates the
 * pre-enable `token` from register() (security review of #174, BLOCKER 1).
 */
async function registerWithTotpEnabled(
  username: string,
  password = 'correct-horse-battery',
): Promise<{ secret: string; recoveryCodes: string[]; token: string; refreshToken: string }> {
  const { token: preEnableToken } = await register(username, password);
  const setupRes = await app.inject({
    method: 'POST', url: '/api/auth/totp/setup',
    headers: { authorization: `Bearer ${preEnableToken}` },
  });
  expect(setupRes.statusCode).toBe(200);
  const { secret } = setupRes.json() as { secret: string };

  const enableRes = await app.inject({
    method: 'POST', url: '/api/auth/totp/enable',
    headers: { authorization: `Bearer ${preEnableToken}` },
    payload: { code: codeFor(secret), password },
  });
  expect(enableRes.statusCode).toBe(200);
  const { recoveryCodes, token, refreshToken } = enableRes.json() as { recoveryCodes: string[]; token: string; refreshToken: string };
  return { secret, recoveryCodes, token, refreshToken };
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
      payload: { code: '000000', password: 'correct-horse-battery' },
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
    const firstEnable = await app.inject({
      method: 'POST', url: '/api/auth/totp/enable',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: codeFor(secret), password: 'correct-horse-battery' },
    });
    expect(firstEnable.statusCode).toBe(200);
    // enableTotp() bumps token_version, so the pre-enable `token` no longer
    // authenticates — the second call must use the fresh token /enable returned.
    const { token: freshToken } = firstEnable.json() as { token: string };

    const secondEnable = await app.inject({
      method: 'POST', url: '/api/auth/totp/enable',
      headers: { authorization: `Bearer ${freshToken}` },
      payload: { code: codeFor(secret), password: 'correct-horse-battery' },
    });
    expect(secondEnable.statusCode).toBe(400);
  });
});

describe('POST /api/auth/totp/disable', () => {
  // #276: /disable used to run disableTotp() unconditionally, and that bumps
  // token_version - so a defensive or duplicate call on an account that never had
  // 2FA logged the user out everywhere while reporting { ok: true }.
  it('rejects with 400 when 2FA was never enabled, without touching other sessions', async () => {
    const username = freshUsername();
    const { token } = await register(username);
    // A second, independent session that must survive the call below.
    const otherLogin = await login(username);
    const { token: otherToken } = otherLogin.json() as { token: string };

    const res = await app.inject({
      method: 'POST', url: '/api/auth/totp/disable',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('2FA ist nicht aktiviert');

    for (const t of [token, otherToken]) {
      const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${t}` } });
      expect(meRes.statusCode).toBe(200);
    }
  });

  it('checks the password before revealing whether 2FA is enabled', async () => {
    const username = freshUsername();
    const { token } = await register(username);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/totp/disable',
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'definitely-wrong' },
    });
    // 401 (password), not 400 ("2FA ist nicht aktiviert") - the guard must not
    // turn this endpoint into a 2FA-status oracle for a stolen token.
    expect(res.statusCode).toBe(401);
  });

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

// ── Security review of PR #215 — regression tests ──────────────────────────────

describe('BLOCKER 1: enabling 2FA invalidates refresh tokens issued before enrollment', () => {
  it('a refresh token obtained before /totp/enable is rejected after enable', async () => {
    const username = freshUsername();
    const { token: preEnableToken, refreshToken: preEnableRefresh } = await register(username);

    // Sanity: the refresh token works before 2FA is enabled.
    const preCheck = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      payload: { refreshToken: preEnableRefresh },
    });
    expect(preCheck.statusCode).toBe(200);

    const setupRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/setup',
      headers: { authorization: `Bearer ${preEnableToken}` },
    });
    const { secret } = setupRes.json() as { secret: string };
    const enableRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/enable',
      headers: { authorization: `Bearer ${preEnableToken}` },
      payload: { code: codeFor(secret), password: 'correct-horse-battery' },
    });
    expect(enableRes.statusCode).toBe(200);

    // The pre-enrollment refresh token — e.g. stolen by an attacker before
    // the victim turned 2FA on — must no longer mint fresh tokens. Without
    // the token_version bump in enableTotp(), this would still return 200,
    // letting the attacker renew indefinitely without ever supplying a code.
    const refreshRes = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      payload: { refreshToken: preEnableRefresh },
    });
    expect(refreshRes.statusCode).toBe(401);
  });
});

describe('BLOCKER 2: POST /api/auth/totp/enable requires password confirmation', () => {
  it('rejects without a password, leaving 2FA disabled', async () => {
    const username = freshUsername();
    const { token } = await register(username);
    const setupRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/setup',
      headers: { authorization: `Bearer ${token}` },
    });
    const { secret } = setupRes.json() as { secret: string };

    const enableRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/enable',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: codeFor(secret) },
    });
    expect(enableRes.statusCode).toBe(401);

    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(meRes.json().totpEnabled).toBe(false);
  });

  it('rejects with a wrong password, leaving 2FA disabled', async () => {
    const username = freshUsername();
    const { token } = await register(username);
    const setupRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/setup',
      headers: { authorization: `Bearer ${token}` },
    });
    const { secret } = setupRes.json() as { secret: string };

    const enableRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/enable',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: codeFor(secret), password: 'definitely-wrong' },
    });
    expect(enableRes.statusCode).toBe(401);

    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(meRes.json().totpEnabled).toBe(false);
  });

  it('accepts with the correct password, and the returned fresh token pair works on a protected route', async () => {
    const username = freshUsername();
    const { token: preEnableToken } = await register(username);
    const setupRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/setup',
      headers: { authorization: `Bearer ${preEnableToken}` },
    });
    const { secret } = setupRes.json() as { secret: string };

    const enableRes = await app.inject({
      method: 'POST', url: '/api/auth/totp/enable',
      headers: { authorization: `Bearer ${preEnableToken}` },
      payload: { code: codeFor(secret), password: 'correct-horse-battery' },
    });
    expect(enableRes.statusCode).toBe(200);
    const { token, refreshToken } = enableRes.json() as { token: string; refreshToken: string };
    expect(typeof token).toBe('string');
    expect(typeof refreshToken).toBe('string');

    const syncRes = await app.inject({ method: 'GET', url: '/api/sync', headers: { authorization: `Bearer ${token}` } });
    expect(syncRes.statusCode).toBe(200);
  });
});

describe('Hardening item 3: account-scoped TOTP lockout, independent of challenge and source IP', () => {
  it('locks the account after repeated failures across different challenge tokens and simulated IPs', async () => {
    const username = freshUsername();
    const { secret } = await registerWithTotpEnabled(username);

    // 10 failed attempts, each against a *fresh* challenge (fresh jti, so the
    // per-jti cap of 5 never triggers) from a *different* simulated source IP
    // (so the per-route rate limit of 10/15min per IP never triggers either).
    // Only the account-scoped counter added in db.ts can be what stops this.
    for (let i = 0; i < 10; i++) {
      const ip = `10.0.0.${i + 1}`;
      const loginRes = await app.inject({
        method: 'POST', url: '/api/auth/login',
        payload: { username, password: 'correct-horse-battery' },
        remoteAddress: ip,
      });
      const { challengeToken } = loginRes.json() as { challengeToken: string };
      const verifyRes = await app.inject({
        method: 'POST', url: '/api/auth/login/verify',
        payload: { challengeToken, code: '000000' },
        remoteAddress: ip,
      });
      expect(verifyRes.statusCode).toBe(401);
    }

    // A brand-new challenge, from yet another IP, with the *correct* code is
    // still rejected — the account itself is locked, not any single
    // challenge or IP.
    const finalLoginRes = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username, password: 'correct-horse-battery' },
      remoteAddress: '10.0.0.99',
    });
    const { challengeToken: finalChallenge } = finalLoginRes.json() as { challengeToken: string };
    const finalVerifyRes = await app.inject({
      method: 'POST', url: '/api/auth/login/verify',
      payload: { challengeToken: finalChallenge, code: codeFor(secret) },
      remoteAddress: '10.0.0.99',
    });
    expect(finalVerifyRes.statusCode).toBe(401);
    expect(finalVerifyRes.json().error).toBe('Konto vorübergehend gesperrt — zu viele Fehlversuche');
  });
});

describe('#217: POST /api/sync and /api/sync/push validate the request body', () => {
  it('/api/sync/push rejects a non-array list field instead of corrupting the collection', async () => {
    const username = freshUsername();
    const { token } = await register(username);

    const res = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { data: { polishes: 'not-an-array', customCats: [], manicures: [], stickers: [] } },
    });
    expect(res.statusCode).toBe(400);

    const getRes = await app.inject({
      method: 'GET', url: '/api/sync',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.json().data.polishes).toEqual([]);
  });

  it('/api/sync rejects list items missing id/updatedAt instead of merging garbage entries', async () => {
    const username = freshUsername();
    const { token } = await register(username);

    const res = await app.inject({
      method: 'POST', url: '/api/sync',
      headers: { authorization: `Bearer ${token}` },
      payload: { data: { polishes: [{ name: 'no id or updatedAt' }], customCats: [], manicures: [], stickers: [] } },
    });
    expect(res.statusCode).toBe(400);
  });

  // The validation must not reject the legacy scalar `finish` an older client still
  // sends: mergeData normalizes that to an array on the way through (#192/#197), and
  // the guard deliberately leaves the field's type alone so the two do not disagree.
  it('/api/sync/push still accepts a well-formed payload, including a legacy scalar finish', async () => {
    const username = freshUsername();
    const { token } = await register(username);

    const polish = {
      id: 'p1', name: 'Test', brand: 'Brand', num: '001', color: '#ffffff',
      finish: 'Classic', status: 'ok', createdAt: 1, updatedAt: 1,
    };
    const res = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { data: { polishes: [polish], customCats: [], manicures: [], stickers: [] } },
    });
    expect(res.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET', url: '/api/sync',
      headers: { authorization: `Bearer ${token}` },
    });
    const stored = getRes.json().data.polishes;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 'p1', name: 'Test', brand: 'Brand', color: '#ffffff' });
    expect(stored[0].finish).toEqual(['Classic']);
  });

  it('rejects a data field that is not an object at all', async () => {
    const username = freshUsername();
    const { token } = await register(username);

    for (const data of ['a string', 42, ['an', 'array']]) {
      const res = await app.inject({
        method: 'POST', url: '/api/sync/push',
        headers: { authorization: `Bearer ${token}` },
        payload: { data },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('accepts a payload that omits list fields entirely', async () => {
    const username = freshUsername();
    const { token } = await register(username);

    const res = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { data: { polishes: [] } },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a null entry inside an otherwise valid list', async () => {
    const username = freshUsername();
    const { token } = await register(username);

    const res = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { data: { polishes: [null], customCats: [], manicures: [], stickers: [] } },
    });
    expect(res.statusCode).toBe(400);
  });

  // A string updatedAt would reach mergeList's `item.updatedAt > existing.updatedAt`
  // and silently decide last-write-wins by string comparison.
  it('rejects a numeric-looking string updatedAt', async () => {
    const username = freshUsername();
    const { token } = await register(username);

    const res = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        data: {
          polishes: [{ id: 'p1', name: 'Test', updatedAt: '123' }],
          customCats: [], manicures: [], stickers: [],
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // Deliberately still allowed: the guard checks id/updatedAt only, not every required
  // field. An entry missing `color` therefore still gets through - which is exactly why
  // #218 (the client-side error boundary) is a separate, non-redundant defence.
  it('does not reject an entry that is missing other required fields', async () => {
    const username = freshUsername();
    const { token } = await register(username);

    const res = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        data: {
          polishes: [{ id: 'p1', updatedAt: 1 }],
          customCats: [], manicures: [], stickers: [],
        },
      },
    });
    expect(res.statusCode).toBe(200);
  });
});

// #275: an unbounded username ends up embedded verbatim in every issued JWT,
// which rides along as an HTTP header on every subsequent request. Past a
// certain length that header alone exceeds the server's/proxy's max header
// size, and the account is permanently bricked with HTTP 431 - before
// Fastify even routes the request. These guard the length cap that prevents
// that at registration time.
describe('POST /api/auth/register — username length/shape validation (#275)', () => {
  it('accepts a 64-character username (the maximum)', async () => {
    const username = 'u'.repeat(64);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username, password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a 65-character username with 400', async () => {
    const username = 'u'.repeat(65);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username, password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.any(String) });
  });

  it('rejects an oversized username (the actual #275 scenario) with 400, not by minting a giant JWT', async () => {
    const username = 'u'.repeat(100_000);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username, password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty username with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: '', password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a whitespace-only username with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: '   \t  ', password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a username containing control characters with 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: 'bad\x00name', password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(400);
  });
});
