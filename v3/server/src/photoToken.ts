import * as crypto from 'node:crypto';

/**
 * Signed, expiring access tokens for `/photos/*` (#269).
 *
 * Photos used to be served by a plain static handler with no auth at all — the
 * unguessable UUID filename was the only protection, and once a filename leaked
 * (browser history, a forwarded report email, a proxy/CDN cache) that photo was
 * anonymously readable forever, with no way to invalidate just that URL.
 *
 * A bearer header is not an option here: photos are rendered by `<img>` tags in
 * the web app and by Coil on Android, and embedded in report emails opened in a
 * mail client. So the credential has to travel in the URL — but as a *signed,
 * expiring* one rather than the filename itself.
 *
 * Two flavours, distinguished only by whether `f` is set:
 *  - session token (no `f`): short-lived, covers every photo, minted by
 *    `GET /api/photos/token` for a logged-in client.
 *  - file token (`f` set): longer-lived but bound to one filename, embedded in
 *    report emails. A leaked report link therefore exposes exactly the photos in
 *    that report, and only until it expires.
 *
 * Revocation: `tv` carries the user's `token_version`, so `POST /api/auth/logout-all`
 * invalidates outstanding photo links along with the sessions. Tokens minted via
 * `X-Api-Key` carry `k` (a digest of the key) instead and die when the key is rotated.
 */

/** Bumped only if the payload shape changes incompatibly. Part of the signing context. */
const TOKEN_CONTEXT = 'nagellacke:photo-token:v1';

export interface PhotoTokenPayload {
  /** Expiry, unix seconds. */
  exp: number;
  /** Username the token was minted for; empty string for API-key tokens. */
  u: string;
  /** The user's token_version at minting time. Absent/0 for API-key tokens. */
  tv?: number;
  /** Filename this token is bound to. Absent = valid for any photo. */
  f?: string;
  /** Digest of the API key this token was minted from (API-key tokens only). */
  k?: string;
}

/**
 * Domain-separated from JWT_SECRET so a deployment needs no extra configuration,
 * while a photo token can never be replayed as a session JWT (and vice versa) —
 * the two are signed with different keys even though only one secret is stored.
 */
function photoSecret(jwtSecret: string): Buffer {
  return crypto.createHmac('sha256', jwtSecret).update(TOKEN_CONTEXT).digest();
}

/** Short, URL-safe digest binding an API-key-minted token to the key in force. */
export function apiKeyDigest(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('base64url').slice(0, 16);
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function signPhotoToken(payload: PhotoTokenPayload, jwtSecret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf-8'));
  const sig = b64url(crypto.createHmac('sha256', photoSecret(jwtSecret)).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verifies signature and expiry and returns the payload, or null if the token is
 * malformed, forged or expired. Caller still has to check `f` against the
 * requested filename and `tv`/`k` against current server state — this function
 * deliberately knows nothing about users.
 */
export function verifyPhotoToken(token: string, jwtSecret: string, now = Date.now()): PhotoTokenPayload | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = b64url(crypto.createHmac('sha256', photoSecret(jwtSecret)).update(body).digest());
  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // length of a signature is not a secret anyway.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  let payload: PhotoTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as PhotoTokenPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
  if (payload.exp * 1000 <= now) return null;
  if (typeof payload.u !== 'string') return null;
  return payload;
}
