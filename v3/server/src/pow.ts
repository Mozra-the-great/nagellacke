import * as crypto from 'node:crypto';

/**
 * Self-hosted proof of work for POST /api/auth/register (#324 S13), after the
 * Altcha scheme: no captcha provider, no third-party request, no personal data.
 *
 * The server hands out a signed challenge `{ salt, difficulty, expires, sig }`.
 * The client searches for a number `n` such that sha256(salt + n) starts with
 * `difficulty` zero bits and sends `{ salt, difficulty, expires, sig, n }` back
 * with the registration. Checking costs one hash; finding costs about
 * 2^difficulty, which a browser does in roughly a second — nothing for one
 * person, a real cost for anyone registering thousands of accounts. It adds to
 * the per-IP rate limit on the route, it does not replace it.
 *
 * The challenge is stateless (the HMAC proves the server issued it), so the
 * only state is the set of salts already spent, kept until they would have
 * expired anyway. That set lives in memory: a restart forgets it, which reopens
 * at most the one-minute window of challenges issued just before — acceptable
 * for a speed bump that is not an authentication factor.
 */

/** Part of the signing context; bumped only if the challenge shape changes. */
const POW_CONTEXT = 'nagellacke:registration-pow:v1';

/**
 * Leading zero bits. 2^16 ≈ 65 000 hashes on average, about a second with
 * crypto.subtle in a browser and well under that with MessageDigest on a phone.
 */
export const POW_DIFFICULTY = 16;

/** How long a challenge stays valid. Fetched at submit time, so this only has to cover solving. */
export const POW_TTL_MS = 60_000;

export interface PowChallenge {
  salt: string;
  difficulty: number;
  /** Expiry, unix milliseconds. */
  expires: number;
  sig: string;
}

export interface PowSolution extends PowChallenge {
  n: number;
}

function powKey(jwtSecret: string): Buffer {
  // Domain-separated from JWT_SECRET like the photo tokens, so no extra configuration
  // and no way to replay one kind of signature as the other.
  return crypto.createHmac('sha256', jwtSecret).update(POW_CONTEXT).digest();
}

function sign(key: Buffer, salt: string, difficulty: number, expires: number): string {
  return crypto.createHmac('sha256', key).update(`${salt}.${difficulty}.${expires}`).digest('base64url');
}

export function issuePowChallenge(jwtSecret: string, now = Date.now(), difficulty = POW_DIFFICULTY): PowChallenge {
  const salt = crypto.randomBytes(16).toString('hex');
  const expires = now + POW_TTL_MS;
  return { salt, difficulty, expires, sig: sign(powKey(jwtSecret), salt, difficulty, expires) };
}

/** Whether `hash` starts with at least `bits` zero bits. */
export function hasLeadingZeroBits(hash: Uint8Array, bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  for (let i = 0; i < fullBytes; i++) if (hash[i] !== 0) return false;
  const rest = bits % 8;
  if (rest === 0) return true;
  return (hash[fullBytes] >> (8 - rest)) === 0;
}

export type PowFailure = 'malformed' | 'signature' | 'expired' | 'solution' | 'replayed';

/**
 * Tracks spent salts. One instance per app, so tests building several apps
 * don't share state.
 */
export class PowVerifier {
  private readonly spent = new Map<string, number>();

  constructor(private readonly jwtSecret: string) {}

  /** null on success, otherwise why the solution was refused. A successful check spends the salt. */
  verify(input: unknown, now = Date.now()): PowFailure | null {
    if (!input || typeof input !== 'object') return 'malformed';
    const s = input as Partial<PowSolution>;
    if (typeof s.salt !== 'string' || !/^[0-9a-f]{32}$/.test(s.salt)) return 'malformed';
    if (typeof s.difficulty !== 'number' || !Number.isInteger(s.difficulty)) return 'malformed';
    if (typeof s.expires !== 'number' || !Number.isFinite(s.expires)) return 'malformed';
    if (typeof s.sig !== 'string' || s.sig.length > 128) return 'malformed';
    if (typeof s.n !== 'number' || !Number.isSafeInteger(s.n) || s.n < 0) return 'malformed';

    const expected = sign(powKey(this.jwtSecret), s.salt, s.difficulty, s.expires);
    if (s.sig.length !== expected.length
      || !crypto.timingSafeEqual(Buffer.from(s.sig), Buffer.from(expected))) return 'signature';
    // The difficulty is covered by the signature, so a client cannot lower it; this
    // only refuses challenges issued under an older, easier setting.
    if (s.difficulty < POW_DIFFICULTY) return 'signature';
    if (s.expires <= now) return 'expired';

    const hash = crypto.createHash('sha256').update(`${s.salt}${s.n}`).digest();
    if (!hasLeadingZeroBits(hash, s.difficulty)) return 'solution';

    this.prune(now);
    if (this.spent.has(s.salt)) return 'replayed';
    this.spent.set(s.salt, s.expires);
    return null;
  }

  private prune(now: number): void {
    for (const [salt, expires] of this.spent) {
      if (expires <= now) this.spent.delete(salt);
    }
  }
}

/** Brute-force solver, for tests. Clients have their own (web: utils/pow.ts, Android: Pow.kt). */
export function solvePowForTest(c: PowChallenge): PowSolution {
  for (let n = 0; ; n++) {
    const hash = crypto.createHash('sha256').update(`${c.salt}${n}`).digest();
    if (hasLeadingZeroBits(hash, c.difficulty)) return { ...c, n };
  }
}
