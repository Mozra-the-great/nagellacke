import * as crypto from 'node:crypto';
import { TOTP, Secret } from 'otpauth';

const ISSUER = 'Nagellacke';
const PERIOD = 30;
const DIGITS = 6;

/** Generates a fresh random TOTP secret (base32-encoded, 20 bytes / 160 bit). */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function buildTotp(secret: string, username: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  });
}

/** otpauth:// URI for QR-code enrollment (and manual entry via the same secret). */
export function buildOtpauthUri(secret: string, username: string): string {
  return buildTotp(secret, username).toString();
}

/**
 * Verifies a 6-digit TOTP code against `secret` with a ±1 step (±30s, ±90s
 * total) clock-skew window. On success, returns the absolute 30s-step
 * counter the accepted code belongs to — the caller compares this against
 * `totp_last_counter` to reject replays of an already-used code, and persists
 * it via updateTotpCounter() on acceptance. Returns null on an invalid code.
 */
export function verifyTotpCode(secret: string, code: string, username = '', timestamp: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const totp = buildTotp(secret, username);
  const delta = totp.validate({ token: code, timestamp, window: 1 });
  if (delta === null) return null;
  return Math.floor(timestamp / 1000 / PERIOD) + delta;
}

/** SHA-256 hex digest. Recovery codes are already high-entropy random values, so
 * cheap hashing carries no meaningful brute-force risk — unlike scrypt-verifying
 * up to MAX_RECOVERY_CODES candidates per login attempt, which would multiply
 * per-request CPU cost and become a self-inflicted DoS vector on every 2FA login.
 */
export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

/** Recovery codes are compared case/format-insensitively: strip whitespace, dashes, uppercase. */
function normalizeRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '');
}

export const RECOVERY_CODE_COUNT = 10;

/** Generates fresh recovery codes, formatted like XXXX-XXXX, plus their sha256 hashes. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 5 random bytes -> 10 hex chars (40 bits of entropy), grouped XXXXX-XXXXX.
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    const code = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    codes.push(code);
    hashes.push(hashRecoveryCode(code));
  }
  return { codes, hashes };
}
