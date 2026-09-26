import { beforeAll, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { FastifyInstance } from 'fastify';

/**
 * #355: no response carried any hardening header, so the SPA that install.sh
 * serves from this same process could be framed by any site (clickjacking).
 * The headers come from one root onRequest hook; these tests pin that they
 * reach every kind of response, including the encapsulated /photos/ plugin and
 * error paths that never get as far as a route handler.
 */
let app: FastifyInstance;

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-headers-test-'));
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.ALLOW_REGISTRATION = 'true';
  const { buildApp } = await import('./index');
  app = await buildApp();
});

function expectHardened(res: { headers: Record<string, unknown> }) {
  expect(res.headers['x-frame-options']).toBe('DENY');
  expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['referrer-policy']).toBe('no-referrer');
}

describe('security headers (#355)', () => {
  it('are set on an ordinary API response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/registration-status' });
    expect(res.statusCode).toBe(200);
    expectHardened(res);
  });

  it('are set on a rejected /photos/ request, inside the encapsulated plugin', async () => {
    const res = await app.inject({ method: 'GET', url: '/photos/does-not-matter.png' });
    expect(res.statusCode).toBe(401);
    expectHardened(res);
  });

  it('are set on a served photo', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: 'header-test', password: 'correct-horse-battery' },
    });
    const { token } = reg.json() as { token: string };
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 7)]);
    const up = await app.inject({
      method: 'POST', url: '/api/photos',
      headers: { authorization: `Bearer ${token}` },
      payload: { data: png.toString('base64'), mimeType: 'image/png' },
    });
    const { filename } = up.json() as { filename: string };

    const res = await app.inject({
      method: 'GET', url: `/photos/${filename}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expectHardened(res);
  });

  it('are set on a 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/no-such-route' });
    expect(res.statusCode).toBe(404);
    expectHardened(res);
  });
});
