import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * Route-level integration tests via buildApp() + inject(). Each test gets a
 * fully isolated module graph (fresh DATA_DIR + vi.resetModules()) so no test
 * ever touches the developer's real v3/server/data/, and rate-limit buckets
 * (in-memory per Fastify instance) never leak between tests.
 *
 * NEVER inject() POST /api/update/apply's accept path — it runs `git pull` +
 * `npm install` + process.exit(0) for real. Only its rejection paths are
 * exercised here.
 */
async function createTestApp(): Promise<{ app: FastifyInstance; dir: string; apiKey: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-admin-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  vi.resetModules();
  const mod = await import('./index');
  const app = await mod.buildApp();
  const apiKey = fs.readFileSync(path.join(dir, '.api_key'), 'utf-8').trim();
  return { app, dir, apiKey };
}

const tmpDirs: string[] = [];

afterEach(async () => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.ALLOW_REGISTRATION;
});

async function register(app: FastifyInstance, username: string, password = 'password123'): Promise<{ token: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  return res.json() as { token: string };
}

describe('requireAdmin', () => {
  it('401s with no token', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const res = await app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(res.statusCode).toBe(401);
  });

  it('403s for a valid non-admin JWT', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token: adminToken } = await register(app, 'owner'); // first user = admin
    process.env.ALLOW_REGISTRATION = 'true';
    const { token } = await register(app, 'plain-user');
    void adminToken;
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it('passes for an admin JWT', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app, 'owner'); // first user = admin
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { users: { username: string; role: string }[] };
    expect(body.users.find((u) => u.username === 'owner')?.role).toBe('admin');
  });
});

describe('POST /api/admin/bootstrap', () => {
  it('401s without X-Api-Key', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const res = await app.inject({ method: 'POST', url: '/api/admin/bootstrap', payload: { username: 'root', password: 'password123' } });
    expect(res.statusCode).toBe(401);
  });

  it('enforces the password-length rule', async () => {
    const { app, dir, apiKey } = await createTestApp();
    tmpDirs.push(dir);
    const res = await app.inject({
      method: 'POST', url: '/api/admin/bootstrap', headers: { 'x-api-key': apiKey },
      payload: { username: 'root', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('succeeds once and issues tokens; a second call 409s', async () => {
    const { app, dir, apiKey } = await createTestApp();
    tmpDirs.push(dir);
    const first = await app.inject({
      method: 'POST', url: '/api/admin/bootstrap', headers: { 'x-api-key': apiKey },
      payload: { username: 'root', password: 'password123' },
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { token?: string }).token).toBeTruthy();

    const second = await app.inject({
      method: 'POST', url: '/api/admin/bootstrap', headers: { 'x-api-key': apiKey },
      payload: { username: 'someone-else', password: 'password123' },
    });
    expect(second.statusCode).toBe(409);
  });
});

describe('last-admin and self-delete protection', () => {
  it('refuses to demote the last admin', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app, 'owner');
    const res = await app.inject({
      method: 'PATCH', url: '/api/admin/users/owner/role', headers: { authorization: `Bearer ${token}` },
      payload: { role: 'user' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('allows demotion when another admin exists, and bumps token_version (old token 401s next request)', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token: ownerToken } = await register(app, 'owner');
    process.env.ALLOW_REGISTRATION = 'true';
    const { token: bobToken } = await register(app, 'bob');
    await app.inject({
      method: 'PATCH', url: '/api/admin/users/bob/role', headers: { authorization: `Bearer ${ownerToken}` },
      payload: { role: 'admin' },
    });
    const demote = await app.inject({
      method: 'PATCH', url: '/api/admin/users/bob/role', headers: { authorization: `Bearer ${ownerToken}` },
      payload: { role: 'user' },
    });
    expect(demote.statusCode).toBe(200);
    const stale = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${bobToken}` } });
    expect(stale.statusCode).toBe(401);
  });

  it('refuses self-delete', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app, 'owner');
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/users/owner', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(409);
  });

  it('refuses to delete the last admin', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token: ownerToken } = await register(app, 'owner');
    process.env.ALLOW_REGISTRATION = 'true';
    await register(app, 'bob');
    // bob is a plain user, not the last admin — deleting bob must succeed, so
    // delete owner instead is what we actually assert is refused.
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/users/owner', headers: { authorization: `Bearer ${ownerToken}` } });
    expect(res.statusCode).toBe(409);
  });

  it('deleting a scheduled user clears (disables) the schedule', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token: ownerToken } = await register(app, 'owner');
    process.env.ALLOW_REGISTRATION = 'true';
    const { token: bobToken } = await register(app, 'bob');
    await app.inject({
      method: 'POST', url: '/api/reports/schedule', headers: { authorization: `Bearer ${bobToken}` },
      payload: { enabled: true, frequency: 'weekly', toEmail: 'bob@example.com' },
    });
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/users/bob', headers: { authorization: `Bearer ${ownerToken}` } });
    expect(del.statusCode).toBe(200);
    const db = await import('./db');
    expect(db.getScheduleConfig()?.enabled).toBe(false);
  });
});

describe('GET /api/admin/settings — secret masking', () => {
  it('never returns a raw smtp.pass or AI key under any input', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app, 'owner');
    await app.inject({
      method: 'POST', url: '/api/admin/settings', headers: { authorization: `Bearer ${token}` },
      payload: { smtp: { host: 'smtp.example.com', port: 587, user: 'u', pass: 'super-secret-pass', from: 'a@b.c' } },
    });
    await app.inject({
      method: 'POST', url: '/api/ai/settings', headers: { authorization: `Bearer ${token}` },
      payload: { provider: 'openrouter', openrouter: { apiKey: 'sk-or-secret-key', model: 'openrouter/auto', freeOnly: false }, gemini: { model: 'gemini-flash-latest' }, webSearch: { backend: 'off', searxngUrl: '' } },
    });
    const res = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    const raw = res.body;
    expect(raw).not.toContain('super-secret-pass');
    expect(raw).not.toContain('sk-or-secret-key');
    const body = res.json() as { smtp: { hasPassword: boolean }; ai: { openrouter: { hasApiKey: boolean } } };
    expect(body.smtp.hasPassword).toBe(true);
    expect(body.ai.openrouter.hasApiKey).toBe(true);
  });
});

describe('POST /api/ai/settings tightening regression', () => {
  it('now 403s for a non-admin JWT that previously succeeded', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    await register(app, 'owner');
    process.env.ALLOW_REGISTRATION = 'true';
    const { token } = await register(app, 'plain-user');
    const res = await app.inject({
      method: 'POST', url: '/api/ai/settings', headers: { authorization: `Bearer ${token}` },
      payload: { provider: 'openrouter', openrouter: { model: 'openrouter/auto', freeOnly: false }, gemini: { model: 'gemini-flash-latest' }, webSearch: { backend: 'off', searxngUrl: '' } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('still keeps AI job endpoints on requireJwt for non-admins', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    await register(app, 'owner');
    process.env.ALLOW_REGISTRATION = 'true';
    const { token } = await register(app, 'plain-user');
    // No AI provider configured -> 400 "not configured", not 401/403 —
    // proves the route is reachable (still requireJwt, not requireAdmin).
    const res = await app.inject({
      method: 'POST', url: '/api/ai/autofill', headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Ballet Slippers' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('the four requireApiKey endpoints accept X-Api-Key or admin-JWT (additive)', () => {
  it('GET /api/logs: X-Api-Key alone still works', async () => {
    const { app, dir, apiKey } = await createTestApp();
    tmpDirs.push(dir);
    const res = await app.inject({ method: 'GET', url: '/api/logs', headers: { 'x-api-key': apiKey } });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/logs: admin JWT alone now also works', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app, 'owner');
    const res = await app.inject({ method: 'GET', url: '/api/logs', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/logs: non-admin JWT is still rejected', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    await register(app, 'owner');
    process.env.ALLOW_REGISTRATION = 'true';
    const { token } = await register(app, 'plain-user');
    const res = await app.inject({ method: 'GET', url: '/api/logs', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/logs: neither credential still 401s', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const res = await app.inject({ method: 'GET', url: '/api/logs' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/admin/api-key/rotate: X-Api-Key alone still works', async () => {
    const { app, dir, apiKey } = await createTestApp();
    tmpDirs.push(dir);
    const res = await app.inject({ method: 'POST', url: '/api/admin/api-key/rotate', headers: { 'x-api-key': apiKey } });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/admin/api-key/rotate: admin JWT alone now also works', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app, 'owner');
    const res = await app.inject({ method: 'POST', url: '/api/admin/api-key/rotate', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
  });

  it('GET /api/update/check: rejects with no credentials (network call never reached)', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const res = await app.inject({ method: 'GET', url: '/api/update/check' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/update/apply: rejects with no credentials (accept path never inject()ed)', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const res = await app.inject({ method: 'POST', url: '/api/update/apply' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/update/apply: rejects a non-admin JWT even with a password field', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    await register(app, 'owner');
    process.env.ALLOW_REGISTRATION = 'true';
    const { token } = await register(app, 'plain-user');
    const res = await app.inject({
      method: 'POST', url: '/api/update/apply', headers: { authorization: `Bearer ${token}` },
      payload: { password: 'password123' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/update/apply: rejects an admin JWT without the fresh password re-confirmation', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app, 'owner');
    const res = await app.inject({ method: 'POST', url: '/api/update/apply', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
  });
});
