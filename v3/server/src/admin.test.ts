import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

// nodemailer is mocked so the smtp/test route tests below never touch a real
// network socket — sendMail resolves instantly, and we can inspect exactly
// which host/credential a real (non-guard-rejected) send would have used.
interface TransportOptions { host: string; port: number; secure: boolean; auth: { user: string; pass: string } }
const sendMail = vi.fn().mockResolvedValue(undefined);
const createTransport = vi.fn((_opts: TransportOptions) => ({ sendMail }));
vi.mock('nodemailer', () => ({ createTransport }));

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
  createTransport.mockClear();
  sendMail.mockClear();
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

  it('promoting a pre-existing user requires that user\'s real password (PR #216 review item 2)', async () => {
    const { app, dir, apiKey } = await createTestApp();
    tmpDirs.push(dir);
    // Create a plain (non-admin) user first, via open first-user registration.
    await register(app, 'existing-user', 'correct-password');
    // countAdmins() > 0 now (the first registered user is auto-promoted), so
    // demote them again to exercise the "existing user, no admin yet" branch
    // that /api/admin/bootstrap's existing-user promotion path guards.
    const db = await import('./db');
    db.setUserRole('existing-user', 'user');
    expect(db.countAdmins()).toBe(0);

    const wrongPassword = await app.inject({
      method: 'POST', url: '/api/admin/bootstrap', headers: { 'x-api-key': apiKey },
      payload: { username: 'existing-user', password: 'totally-wrong-pw' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(db.isAdmin('existing-user')).toBe(false);

    const rightPassword = await app.inject({
      method: 'POST', url: '/api/admin/bootstrap', headers: { 'x-api-key': apiKey },
      payload: { username: 'existing-user', password: 'correct-password' },
    });
    expect(rightPassword.statusCode).toBe(200);
    expect((rightPassword.json() as { token?: string }).token).toBeTruthy();
    expect(db.isAdmin('existing-user')).toBe(true);
  });

  // The API key proves filesystem-level ownership, which is enough to promote
  // an account's role — but not to *become* that account when it is protected
  // by a second factor. Without this, holding the key plus a username would
  // mint a full admin session for a 2FA-protected account without ever
  // touching its authenticator, while /api/auth/login for the same account
  // correctly hands back only a challenge.
  it('returns an MFA challenge instead of tokens when the promoted account has TOTP enabled', async () => {
    const { app, dir, apiKey } = await createTestApp();
    tmpDirs.push(dir);
    await register(app, 'mfa-user', 'correct-password');
    const db = await import('./db');
    db.enableTotp('mfa-user', ['deadbeef']);
    db.setUserRole('mfa-user', 'user');
    expect(db.countAdmins()).toBe(0);

    const res = await app.inject({
      method: 'POST', url: '/api/admin/bootstrap', headers: { 'x-api-key': apiKey },
      payload: { username: 'mfa-user', password: 'correct-password' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token?: string; refreshToken?: string; mfaRequired?: boolean; challengeToken?: string };
    expect(body.mfaRequired).toBe(true);
    expect(body.challengeToken).toBeTruthy();
    expect(body.token).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    // The role promotion itself is still allowed to have happened - it is the
    // session, not the privilege bit, that the second factor gates.
    expect(db.isAdmin('mfa-user')).toBe(true);
  });

  // An `mfa` token is minted *before* the second factor has been checked, so
  // it must not open any admin route on its own — otherwise the challenge
  // above would simply be a differently-shaped admin session. requireAdmin
  // and its two siblings originally checked tokenVersionValid but not
  // tokenTypeValid, which let exactly that through.
  it('the challenge from bootstrap cannot itself reach an admin route', async () => {
    const { app, dir, apiKey } = await createTestApp();
    tmpDirs.push(dir);
    await register(app, 'mfa-user2', 'correct-password');
    const db = await import('./db');
    db.enableTotp('mfa-user2', ['deadbeef']);
    db.setUserRole('mfa-user2', 'user');

    const res = await app.inject({
      method: 'POST', url: '/api/admin/bootstrap', headers: { 'x-api-key': apiKey },
      payload: { username: 'mfa-user2', password: 'correct-password' },
    });
    const { challengeToken } = res.json() as { challengeToken: string };

    // requireAdmin
    const users = await app.inject({
      method: 'GET', url: '/api/admin/users',
      headers: { authorization: `Bearer ${challengeToken}` },
    });
    expect(users.statusCode).toBe(401);

    // requireApiKeyOrAdminJwt
    const updateCheck = await app.inject({
      method: 'GET', url: '/api/update/check',
      headers: { authorization: `Bearer ${challengeToken}` },
    });
    expect(updateCheck.statusCode).toBe(401);

    // requireApiKeyOrAdminReconfirm — guards the git pull + npm install path,
    // so a pre-2FA token reaching it would be remote code execution.
    const updateApply = await app.inject({
      method: 'POST', url: '/api/update/apply',
      headers: { authorization: `Bearer ${challengeToken}` },
      payload: { password: 'correct-password' },
    });
    expect(updateApply.statusCode).toBe(401);
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

// #275: same length/shape cap as self-registration, so an admin can't be
// tricked (or trick themselves) into creating an account whose JWT bricks
// itself with HTTP 431 on the very next request.
describe('POST /api/admin/users — username length/shape validation (#275)', () => {
  it('accepts a 64-character username (the maximum)', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token: adminToken } = await register(app, 'owner');
    const res = await app.inject({
      method: 'POST', url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: 'u'.repeat(64), password: 'password123' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a 65-character username with 400', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token: adminToken } = await register(app, 'owner');
    const res = await app.inject({
      method: 'POST', url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: 'u'.repeat(65), password: 'password123' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a whitespace-only username with 400', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token: adminToken } = await register(app, 'owner');
    const res = await app.inject({
      method: 'POST', url: '/api/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: '   ', password: 'password123' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('.api_key startup validation (PR #216 review item 3)', () => {
  it('refuses to start (process.exit(1)) when .api_key exists but is empty, instead of failing open', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-admin-test-'));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, '.api_key'), '', { mode: 0o600 });
    process.env.DATA_DIR = dir;
    process.env.NAGELLACKE_NO_AUTOSTART = 'true';
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(import('./index')).rejects.toThrow('process.exit(1)');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('.api_key'));
    exitSpy.mockRestore();
    errorSpy.mockRestore();
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

describe('POST /api/admin/settings/smtp/test — credential exfiltration (PR #216 review item 1)', () => {
  it('rejects a test-send to an attacker-controlled host without an explicit password, even with a real stored password saved', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app, 'owner'); // first user = admin
    const saveRes = await app.inject({
      method: 'POST', url: '/api/admin/settings', headers: { authorization: `Bearer ${token}` },
      payload: { smtp: { host: 'smtp.real.example', port: 587, user: 'real-user', pass: 'real-secret-pass', from: 'a@b.c' } },
    });
    expect(saveRes.statusCode).toBe(200);

    // The exact exploit request from the PR #216 finding: an admin bearer
    // token, no knowledge of the stored SMTP password, host redirected to
    // an attacker-controlled destination.
    const res = await app.inject({
      method: 'POST', url: '/api/admin/settings/smtp/test', headers: { authorization: `Bearer ${token}` },
      payload: { toEmail: 'x@evil.example', host: 'attacker.example', port: 2525, secure: false },
    });
    // Rejected by the credential-binding guard before any connection is even
    // attempted — the real stored password never leaves the server, let
    // alone travels to attacker.example.
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain('real-secret-pass');
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('still allows a normal test-send that keeps the stored host/user (falls back to the stored password)', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app, 'owner');
    await app.inject({
      method: 'POST', url: '/api/admin/settings', headers: { authorization: `Bearer ${token}` },
      payload: { smtp: { host: 'smtp.real.example', port: 587, user: 'real-user', pass: 'real-secret-pass', from: 'a@b.c' } },
    });
    // No host/user override — this must reach the real send path (mocked
    // nodemailer here) using the stored host and stored password.
    const res = await app.inject({
      method: 'POST', url: '/api/admin/settings/smtp/test', headers: { authorization: `Bearer ${token}` },
      payload: { toEmail: 'x@ok.example' },
    });
    expect(res.statusCode).toBe(200);
    expect(createTransport).toHaveBeenCalledTimes(1);
    const cfg = createTransport.mock.calls[0][0];
    expect(cfg.host).toBe('smtp.real.example');
    expect(cfg.auth.pass).toBe('real-secret-pass');
  });
});

describe('POST /api/admin/settings — secrets never reach the audit log (PR #216 review item 4)', () => {
  it('a settings update containing a real secret value never persists that value in the audit log', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const { token } = await register(app, 'owner');
    await app.inject({
      method: 'POST', url: '/api/admin/settings', headers: { authorization: `Bearer ${token}` },
      payload: { smtp: { host: 'smtp.example.com', port: 587, user: 'u', pass: 'hunter2', from: 'a@b.c' } },
    });
    const res = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('hunter2');
    const body = res.json() as { entries: { action: string }[] };
    expect(body.entries.some((e) => e.action === 'server_settings.updated')).toBe(true);
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
