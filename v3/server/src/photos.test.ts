import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { FastifyInstance } from 'fastify';

// Same reason as index.test.ts: DATA_DIR and everything derived from it resolves
// at module scope, so the env has to be set before the module is imported.
const JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
let buildApp: typeof import('./index').buildApp;
let signPhotoToken: typeof import('./photoToken').signPhotoToken;
let verifyPhotoToken: typeof import('./photoToken').verifyPhotoToken;

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-photos-test-'));
  process.env.DATA_DIR = tmpDir;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.ALLOWED_ORIGIN = 'http://localhost';
  process.env.ALLOW_REGISTRATION = 'true';
  ({ buildApp } = await import('./index'));
  ({ signPhotoToken, verifyPhotoToken } = await import('./photoToken'));
});

let app: FastifyInstance;
beforeEach(async () => {
  app = await buildApp();
});

let userCounter = 0;
function freshUsername(): string {
  userCounter += 1;
  return `photo-test-user-${userCounter}`;
}

const PASSWORD = 'correct-horse-battery';

async function register(username: string): Promise<{ token: string; refreshToken: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** A minimal but magic-byte-valid PNG payload; the server only checks the header. */
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 7)]);

async function uploadPhoto(token: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/photos',
    headers: { authorization: `Bearer ${token}` },
    payload: { data: PNG_BYTES.toString('base64'), mimeType: 'image/png' },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { filename: string }).filename;
}

async function mintSessionToken(token: string): Promise<string> {
  const res = await app.inject({
    method: 'GET', url: '/api/photos/token',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { token: string; expiresAt: number };
  expect(body.expiresAt).toBeGreaterThan(Date.now());
  return body.token;
}

/**
 * #269: /photos/* used to be served with no authentication at all — the
 * unguessable UUID filename was the only protection and a leaked URL granted
 * permanent, unrevocable anonymous access.
 */
describe('GET /photos/* access control (#269)', () => {
  it('rejects a request with no credential at all', async () => {
    const { token } = await register(freshUsername());
    const filename = await uploadPhoto(token);

    const res = await app.inject({ method: 'GET', url: `/photos/${filename}` });
    expect(res.statusCode).toBe(401);
  });

  it('serves the photo for a bearer access token', async () => {
    const { token } = await register(freshUsername());
    const filename = await uploadPhoto(token);

    const res = await app.inject({
      method: 'GET', url: `/photos/${filename}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 4)).toEqual(PNG_BYTES.subarray(0, 4));
  });

  it('rejects a refresh token used as a bearer credential', async () => {
    const { token, refreshToken } = await register(freshUsername());
    const filename = await uploadPhoto(token);

    const res = await app.inject({
      method: 'GET', url: `/photos/${filename}`,
      headers: { authorization: `Bearer ${refreshToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('serves the photo for a session token minted via /api/photos/token', async () => {
    const { token } = await register(freshUsername());
    const filename = await uploadPhoto(token);
    const photoToken = await mintSessionToken(token);

    const res = await app.inject({ method: 'GET', url: `/photos/${filename}?t=${encodeURIComponent(photoToken)}` });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a token whose signature has been tampered with', async () => {
    const { token } = await register(freshUsername());
    const filename = await uploadPhoto(token);
    const photoToken = await mintSessionToken(token);

    // Flip the last character of the signature.
    const last = photoToken.slice(-1);
    const forged = photoToken.slice(0, -1) + (last === 'A' ? 'B' : 'A');

    const res = await app.inject({ method: 'GET', url: `/photos/${filename}?t=${encodeURIComponent(forged)}` });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired token', async () => {
    const username = freshUsername();
    const { token } = await register(username);
    const filename = await uploadPhoto(token);

    const expired = signPhotoToken(
      { exp: Math.floor(Date.now() / 1000) - 1, u: username, tv: 0 },
      JWT_SECRET,
    );
    const res = await app.inject({ method: 'GET', url: `/photos/${filename}?t=${encodeURIComponent(expired)}` });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token minted for a user that no longer exists', async () => {
    const { token } = await register(freshUsername());
    const filename = await uploadPhoto(token);

    const ghost = signPhotoToken(
      { exp: Math.floor(Date.now() / 1000) + 600, u: 'never-registered', tv: 0 },
      JWT_SECRET,
    );
    const res = await app.inject({ method: 'GET', url: `/photos/${filename}?t=${encodeURIComponent(ghost)}` });
    expect(res.statusCode).toBe(401);
  });

  it('binds a file-scoped token (as embedded in report emails) to its one filename', async () => {
    const username = freshUsername();
    const { token } = await register(username);
    const mine = await uploadPhoto(token);
    const other = await uploadPhoto(token);

    const scoped = signPhotoToken(
      { exp: Math.floor(Date.now() / 1000) + 600, u: username, tv: 0, f: mine },
      JWT_SECRET,
    );

    const okRes = await app.inject({ method: 'GET', url: `/photos/${mine}?t=${encodeURIComponent(scoped)}` });
    expect(okRes.statusCode).toBe(200);

    const wrongRes = await app.inject({ method: 'GET', url: `/photos/${other}?t=${encodeURIComponent(scoped)}` });
    expect(wrongRes.statusCode).toBe(403);
  });

  it('mints a working token from X-Api-Key and rejects a forged k-token', async () => {
    const { token } = await register(freshUsername());
    const filename = await uploadPhoto(token);

    // The API key is generated at first boot and stored under DATA_DIR.
    const apiKey = fs.readFileSync(path.join(process.env.DATA_DIR as string, '.api_key'), 'utf-8').trim();

    const minted = await app.inject({
      method: 'GET', url: '/api/photos/token', headers: { 'x-api-key': apiKey },
    });
    expect(minted.statusCode).toBe(200);
    const { token: photoToken } = minted.json() as { token: string };

    const ok = await app.inject({ method: 'GET', url: `/photos/${filename}?t=${encodeURIComponent(photoToken)}` });
    expect(ok.statusCode).toBe(200);

    // The k flag selects a signing secret derived from the API key, so the same
    // token must not verify under the plain user secret - which is what makes a
    // key rotation revoke it.
    expect(verifyPhotoToken(photoToken, JWT_SECRET)).toBeNull();
    expect(verifyPhotoToken(photoToken, JWT_SECRET, { apiKey })).not.toBeNull();
    expect(verifyPhotoToken(photoToken, JWT_SECRET, { apiKey: 'a-rotated-key' })).toBeNull();
  });

  it('revokes outstanding photo tokens on logout-all — the revocation path #269 asked for', async () => {
    const { token } = await register(freshUsername());
    const filename = await uploadPhoto(token);
    const photoToken = await mintSessionToken(token);

    const before = await app.inject({ method: 'GET', url: `/photos/${filename}?t=${encodeURIComponent(photoToken)}` });
    expect(before.statusCode).toBe(200);

    const logout = await app.inject({
      method: 'POST', url: '/api/auth/logout-all',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: `/photos/${filename}?t=${encodeURIComponent(photoToken)}` });
    expect(after.statusCode).toBe(401);
  });
});
