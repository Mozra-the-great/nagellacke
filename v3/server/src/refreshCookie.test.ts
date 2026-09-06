import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * #299: the web app kept both sync JWTs in localStorage, so an XSS anywhere in the
 * SPA walked away with a refresh token good for 30 days — and the refresh token
 * silently re-mints access tokens, so the shorter access TTL bounded nothing.
 *
 * The refresh token is now also delivered as an httpOnly cookie. These tests pin the
 * properties that actually buy security, rather than merely that a cookie exists.
 */
async function createTestApp(env: Record<string, string> = {}): Promise<{ app: FastifyInstance; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-refresh-cookie-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  const mod = await import('./index');
  return { app: await mod.buildApp(), dir };
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.ALLOWED_ORIGIN;
});

interface Tokens { token: string; refreshToken: string }

async function register(app: FastifyInstance, username = 'owner'): Promise<Tokens> {
  const res = await app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: { username, password: 'password123' },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as Tokens;
}

/** The Set-Cookie header for our refresh cookie, or undefined if none was sent. */
function refreshCookieHeader(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const all = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return all.find((c) => c.startsWith('nl_refresh='));
}

function cookieValue(header: string): string {
  return header.slice('nl_refresh='.length).split(';')[0];
}

describe('refresh token as an httpOnly cookie (#299)', () => {
  it('sets an httpOnly cookie on login', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    await register(app);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'owner', password: 'password123' },
    });

    expect(res.statusCode).toBe(200);
    const cookie = refreshCookieHeader(res);
    expect(cookie).toBeDefined();
    // httpOnly is the entire point: it is what a script cannot read.
    expect(cookie).toMatch(/HttpOnly/i);
    // Scoped so it is not attached to sync, photo or admin traffic.
    expect(cookie).toMatch(/Path=\/api\/auth/i);
  });

  it('defaults to SameSite=Strict for a same-origin deployment', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    await register(app);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'owner', password: 'password123' },
    });

    expect(refreshCookieHeader(res)).toMatch(/SameSite=Strict/i);
  });

  it('refreshes from the cookie alone, with no token in the body', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    await register(app);
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'owner', password: 'password123' },
    });
    const cookie = cookieValue(refreshCookieHeader(login) as string);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { nl_refresh: cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    // This is what keeps the user logged in across a reload without localStorage.
    expect(typeof (res.json() as { token?: string }).token).toBe('string');
  });

  /**
   * The property the whole change rests on. An injected script can already *call*
   * /api/auth/refresh and have the browser attach the cookie for it. If the response
   * echoed the new refresh token, that script would walk off with a 30-day credential
   * and #299 would be exactly as bad as before.
   */
  it('never returns a refresh token in the body of a cookie-authenticated refresh', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    await register(app);
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'owner', password: 'password123' },
    });
    const cookie = cookieValue(refreshCookieHeader(login) as string);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { nl_refresh: cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('refreshToken');
    expect(res.body).not.toContain(cookie);
  });

  /**
   * Android has no cookie jar and must keep working exactly as before — this change
   * is additive for it, not a migration.
   */
  it('still returns both tokens for a body-authenticated refresh', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { refreshToken } = await register(app);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      payload: { refreshToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Partial<Tokens>;
    expect(typeof body.token).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('prefers an explicit body token over a stale cookie', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { refreshToken } = await register(app);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { nl_refresh: 'not-a-real-token' },
      payload: { refreshToken },
    });

    // The body token is valid, so the garbage cookie must not decide the outcome.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('refreshToken');
  });

  it('rejects a forged cookie', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    await register(app);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { nl_refresh: 'forged.token.value' },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects an access token presented as the refresh cookie', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { nl_refresh: token },
      payload: {},
    });

    // The `typ` guard has to hold on the cookie path too, or a leaked access token
    // could be renewed forever and its short TTL would mean nothing.
    expect(res.statusCode).toBe(401);
  });

  it('logout-all clears the cookie and the cleared cookie stops working', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app);
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'owner', password: 'password123' },
    });
    const cookie = cookieValue(refreshCookieHeader(login) as string);

    const logout = await app.inject({
      method: 'POST', url: '/api/auth/logout-all',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(200);
    // Cleared by setting it empty/expired, not merely left to rot.
    expect(refreshCookieHeader(logout)).toBeDefined();

    const after = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { nl_refresh: cookie },
      payload: {},
    });
    expect(after.statusCode).toBe(401);
  });

  it('drops the cookie when it is rejected, so the browser stops replaying it', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app);
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'owner', password: 'password123' },
    });
    const cookie = cookieValue(refreshCookieHeader(login) as string);
    await app.inject({
      method: 'POST', url: '/api/auth/logout-all',
      headers: { authorization: `Bearer ${token}` },
    });

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { nl_refresh: cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(refreshCookieHeader(res)).toBeDefined();
  });

  it('still answers 400 when neither a cookie nor a body token is present', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);

    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: {} });

    expect(res.statusCode).toBe(400);
  });
});

/**
 * A cross-origin deployment (the SPA on GitHub Pages, the API elsewhere) needs
 * SameSite=None for the cookie to be sent at all — which removes SameSite as a CSRF
 * defence, so the refresh route requires a header no simple cross-site request can
 * set, forcing a preflight that CORS then answers only for ALLOWED_ORIGIN.
 */
describe('cross-origin deployment (#299)', () => {
  const origin = 'https://app.example';

  it('marks the cookie SameSite=None and Secure', async () => {
    const { app, dir } = await createTestApp({ ALLOWED_ORIGIN: origin });
    tmpDirs.push(dir);
    await register(app);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'owner', password: 'password123' },
    });

    const cookie = refreshCookieHeader(res);
    expect(cookie).toMatch(/SameSite=None/i);
    // Browsers reject SameSite=None without Secure outright.
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('refuses a cookie refresh without the preflight-forcing header', async () => {
    const { app, dir } = await createTestApp({ ALLOWED_ORIGIN: origin });
    tmpDirs.push(dir);
    await register(app);
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'owner', password: 'password123' },
    });
    const cookie = cookieValue(refreshCookieHeader(login) as string);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { nl_refresh: cookie },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it('accepts the same request with the header', async () => {
    const { app, dir } = await createTestApp({ ALLOWED_ORIGIN: origin });
    tmpDirs.push(dir);
    await register(app);
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: 'owner', password: 'password123' },
    });
    const cookie = cookieValue(refreshCookieHeader(login) as string);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      cookies: { nl_refresh: cookie },
      headers: { 'x-nagellacke-refresh': '1' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it('does not require the header on the body path, which Android uses', async () => {
    const { app, dir } = await createTestApp({ ALLOWED_ORIGIN: origin });
    tmpDirs.push(dir);
    const { refreshToken } = await register(app);

    const res = await app.inject({
      method: 'POST', url: '/api/auth/refresh',
      payload: { refreshToken },
    });

    expect(res.statusCode).toBe(200);
  });
});
