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
 * `X-Api-Key` are marked `k` and are signed under a secret that incorporates the key
 * in force, so rotating the key invalidates every token minted from the old one.
 */

/** Bumped only if the payload shape changes incompatibly. Part of the signing context. */
const TOKEN_CONTEXT = 'nagellacke:photo-token:v1';
/** Separates the API-key signing secret from the user-token one. */
const API_KEY_CONTEXT = 'nagellacke:photo-token:api-key:v1';

export interface PhotoTokenPayload {
  /** Expiry, unix seconds. */
  exp: number;
  /** Username the token was minted for; empty string for API-key tokens. */
  u: string;
  /** The user's token_version at minting time. Absent/0 for API-key tokens. */
  tv?: number;
  /** Filename this token is bound to. Absent = valid for any photo. */
  f?: string;
  /**
   * Marks a token minted from `X-Api-Key` rather than for a user. It selects the
   * signing secret (see photoSecret) - it is not itself a credential, and nothing
   * derived from the key is stored in the token.
   */
  k?: true;
}

/**
 * Domain-separated from JWT_SECRET so a deployment needs no extra configuration,
 * while a photo token can never be replayed as a session JWT (and vice versa) —
 * the two are signed with different keys even though only one secret is stored.
 */
function photoSecret(jwtSecret: string, apiKey?: string): Buffer {
  const base = crypto.createHmac('sha256', jwtSecret).update(TOKEN_CONTEXT).digest();
  if (apiKey === undefined) return base;
  // API-key tokens get their own signing secret, with the key itself as the HMAC
  // key. Rotating the API key therefore invalidates every token minted under the
  // old one, without putting any function of the key into the token - the earlier
  // version embedded a digest of it in the payload, which is both a (small)
  // disclosure and, per CodeQL's password-hash rule, a fast hash over a secret.
  return crypto.createHmac('sha256', apiKey).update(base).update(API_KEY_CONTEXT).digest();
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/**
 * @param apiKey Required exactly when `payload.k` is set: an API-key token is signed
 *   under a secret derived from the key in force.
 */
export function signPhotoToken(payload: PhotoTokenPayload, jwtSecret: string, apiKey?: string): string {
  if (payload.k && apiKey === undefined) {
    throw new Error('signPhotoToken: an API-key token needs the API key to sign with');
  }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf-8'));
  const secret = photoSecret(jwtSecret, payload.k ? apiKey : undefined);
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

/**
 * Verifies signature and expiry and returns the payload, or null if the token is
 * malformed, forged or expired. Caller still has to check `f` against the requested
 * filename and `tv` against the user's current token_version — this function
 * deliberately knows nothing about users.
 *
 * @param apiKey The API key currently in force, so `k` tokens can be verified. Omit
 *   it and those simply never verify.
 */
export function verifyPhotoToken(
  token: string,
  jwtSecret: string,
  options: { apiKey?: string; now?: number } = {},
): PhotoTokenPayload | null {
  const now = options.now ?? Date.now();
  if (typeof token !== 'string' || token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // The payload is parsed before the signature is checked, purely to learn which
  // secret to verify against - the same role a JWT `kid` header plays. Nothing from
  // it is trusted or returned unless the signature that follows validates, and a
  // forged `k` only picks a secret the forger cannot produce a signature for.
  let payload: PhotoTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as PhotoTokenPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (payload.k !== undefined && payload.k !== true) return null;
  if (payload.k && options.apiKey === undefined) return null;

  const secret = photoSecret(jwtSecret, payload.k ? options.apiKey : undefined);
  const expected = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // length of a signature is not a secret anyway.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
  if (payload.exp * 1000 <= now) return null;
  if (typeof payload.u !== 'string') return null;
  return payload;
}
