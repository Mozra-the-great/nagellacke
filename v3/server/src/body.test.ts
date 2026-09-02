import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { FastifyInstance } from 'fastify';

// Same bootstrap as index.test.ts: DATA_DIR resolves at module scope, so it has
// to be set before the module is imported.
let buildApp: typeof import('./index').buildApp;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-body-test-'));
  process.env.DATA_DIR = tmpDir;
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.ALLOWED_ORIGIN = 'http://localhost';
  process.env.ALLOW_REGISTRATION = 'true';
  ({ buildApp } = await import('./index'));
});

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildApp();
});

let userCounter = 0;
function freshUsername(): string {
  userCounter += 1;
  return `body-test-user-${userCounter}`;
}

async function register(username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/auth/register',
    payload: { username, password: 'correct-horse-battery' },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

/**
 * #273: `null` is valid JSON, so `request.body` came through as null and every
 * handler's `const { x } = request.body as {...}` threw a TypeError — reported as a
 * 500, when it is plainly a client input error.
 */
describe('literal JSON null body (#273)', () => {
  // app.inject serialises a payload of `null` to the string "null" with an
  // application/json content-type, which is exactly the reported request.
  const nullBody = { headers: { 'content-type': 'application/json' }, payload: 'null' } as const;

  // /api/auth/login answers 401 for absent credentials by design - it must not
  // reveal whether a username exists. The bug here was the 500, not the 401.
  it('answers 401, not 500, on /api/auth/login', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', ...nullBody });
    expect(res.statusCode).toBe(401);
  });

  it('answers 400, not 500, on /api/auth/register', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', ...nullBody });
    expect(res.statusCode).toBe(400);
  });

  it('answers 400, not 500, on an authenticated route (/api/photos)', async () => {
    const token = await register(freshUsername());
    const res = await app.inject({
      method: 'POST', url: '/api/photos',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      payload: 'null',
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 400, not 500, on PATCH /api/auth/me', async () => {
    const token = await register(freshUsername());
    const res = await app.inject({
      method: 'PATCH', url: '/api/auth/me',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      payload: 'null',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unauthenticated null body with 401 before the body is even read', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/sync', ...nullBody });
    expect(res.statusCode).toBe(401);
  });

  it('never answers 5xx for a null body on any of the reported routes', async () => {
    // The normalisation only changes *which* client error a route reports - it must
    // never let a null body through as a success either.
    const token = await register(freshUsername());
    const auth = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
    const cases = [
      app.inject({ method: 'POST', url: '/api/auth/login', ...nullBody }),
      app.inject({ method: 'POST', url: '/api/auth/register', ...nullBody }),
      app.inject({ method: 'POST', url: '/api/sync', headers: auth, payload: 'null' }),
      app.inject({ method: 'POST', url: '/api/photos', headers: auth, payload: 'null' }),
      app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth, payload: 'null' }),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    }
  });

  it('leaves a normal object body untouched', async () => {
    const username = freshUsername();
    await register(username);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username, password: 'correct-horse-battery' },
    });
    expect(res.statusCode).toBe(200);
  });
});
