import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * #301: POST /api/ai/settings wrote every string-typed body field through on an
 * `!== undefined` check alone, with no `typeof` guard, so a JSON number landed in
 * ai_config.json under a field the AiConfig type declares as `string`.
 *
 * Same isolated-module-graph harness as admin.test.ts — a fresh DATA_DIR per test
 * so nothing touches the developer's real v3/server/data/.
 */
async function createTestApp(): Promise<{ app: FastifyInstance; dir: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-ai-settings-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  vi.resetModules();
  const mod = await import('./index');
  return { app: await mod.buildApp(), dir };
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
});

/** The first account registered on a fresh install is the admin (see db.ts). */
async function registerAdmin(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: { username: 'owner', password: 'password123' },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function post(app: FastifyInstance, token: string, payload: unknown) {
  return app.inject({
    method: 'POST', url: '/api/ai/settings',
    headers: { authorization: `Bearer ${token}` },
    payload: payload as Record<string, unknown>,
  });
}

/** A body that is valid in every respect except the field under test. */
const VALID = {
  provider: 'gemini' as const,
  gemini: { apiKey: 'real-key', model: 'gemini-flash-latest' },
  openrouter: { apiKey: 'sk-or-key', model: 'openrouter/auto', freeOnly: true },
  webSearch: { backend: 'off' as const, searxngUrl: '', braveApiKey: '' },
};

/**
 * The config as it sits on disk. Absent when nothing was ever written, which is the
 * correct outcome for a rejected request — hence {} rather than a throw, so a test
 * can assert "this value did not get persisted" without caring which of the two
 * ways it failed to.
 */
function storedConfig(dir: string): Record<string, Record<string, unknown> | undefined> {
  const file = path.join(dir, 'ai_config.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

describe('POST /api/ai/settings input validation (#301)', () => {
  it('rejects a number where a string is declared, instead of persisting it', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const token = await registerAdmin(app);

    const res = await post(app, token, { ...VALID, gemini: { apiKey: 123 } });

    expect(res.statusCode).toBe(400);
    // The reported symptom: a 200 followed by a number sitting in the config file
    // where the type says string.
    expect(typeof storedConfig(dir).gemini?.apiKey).not.toBe('number');
  });

  /**
   * The issue notes no crash was observed, but webSearch.searxngUrl is the one
   * string field the handler calls a method on (.trim()) before storing it, so a
   * number there threw a TypeError and the route answered 500 — a server error for
   * what is plainly a bad request.
   */
  it('answers 400, not 500, for a non-string webSearch.searxngUrl', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const token = await registerAdmin(app);

    const res = await post(app, token, { ...VALID, webSearch: { backend: 'off', searxngUrl: 42 } });

    expect(res.statusCode).toBe(400);
  });

  it.each([
    ['openrouter.apiKey', { openrouter: { apiKey: 1 } }],
    ['openrouter.model', { openrouter: { model: [] } }],
    ['gemini.model', { gemini: { model: 7 } }],
    ['webSearch.braveApiKey', { webSearch: { backend: 'off', braveApiKey: {} } }],
  ])('rejects a non-string %s', async (_name, override) => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const token = await registerAdmin(app);

    const res = await post(app, token, { ...VALID, ...override });

    expect(res.statusCode).toBe(400);
  });

  it('rejects a non-boolean openrouter.freeOnly', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const token = await registerAdmin(app);

    const res = await post(app, token, { ...VALID, openrouter: { freeOnly: 'yes' } });

    expect(res.statusCode).toBe(400);
  });

  it('still accepts a fully valid body and stores it', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const token = await registerAdmin(app);

    const res = await post(app, token, VALID);

    expect(res.statusCode).toBe(200);
    const stored = storedConfig(dir);
    expect(stored.provider).toBe('gemini');
    expect(stored.gemini?.apiKey).toBe('real-key');
    expect(stored.openrouter?.freeOnly).toBe(true);
  });

  /**
   * Omitting a field means "leave it alone" — that is how the web app saves a
   * model change without resending the API key it was never shown. The new type
   * guards must not turn absence into a rejection.
   */
  it('still treats an omitted field as "keep the current value"', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const token = await registerAdmin(app);

    expect((await post(app, token, VALID)).statusCode).toBe(200);
    const res = await post(app, token, { provider: 'gemini', gemini: { model: 'gemini-2.0-flash' } });

    expect(res.statusCode).toBe(200);
    const stored = storedConfig(dir);
    expect(stored.gemini?.model).toBe('gemini-2.0-flash');
    expect(stored.gemini?.apiKey).toBe('real-key');
  });

  it('still accepts an explicit empty string, which is how a key is cleared', async () => {
    const { app, dir } = await createTestApp();
    tmpDirs.push(dir);
    const token = await registerAdmin(app);

    expect((await post(app, token, VALID)).statusCode).toBe(200);
    const res = await post(app, token, { provider: 'gemini', gemini: { apiKey: '' } });

    expect(res.statusCode).toBe(200);
    expect(storedConfig(dir).gemini?.apiKey).toBe('');
  });
});
