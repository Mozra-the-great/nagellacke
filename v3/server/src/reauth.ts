import {
  loginLockedUntil, recordLoginFailure, clearLoginFailures,
  totpLockedUntil, recordTotpFailure, clearTotpFailures,
  updateTotpCounter, consumeRecoveryCode,
} from './db';
import type { User } from './db';
import { verifyTotpCode } from './totp';

/**
 * Re-authentication for account-security changes (#479).
 *
 * Every route that changes how the account is reached or protected (e-mail change and removal,
 * account deletion, 2FA on/off, recovery codes, passkeys, password change) asks for the password
 * again, so a stolen access token alone cannot do it. Those checks used to be a bare
 * verifyPassword() behind a per-IP rate limit, which made each of them a password oracle over
 * many IPs that bypassed the login lockout. They now share one helper that
 *
 * - counts wrong passwords on the **same** per-account counter as POST /api/auth/login
 *   (login_fail_count / login_locked_until): the password is one secret, so it gets one budget of
 *   guesses, whichever route they arrive through;
 * - asks for a second factor when the account has TOTP on (a 6-digit code or a recovery code),
 *   counted on the same per-account counter as the 2FA login step;
 * - answers 429 while either counter has the account locked, before checking anything.
 *
 * Answers: 403 `Passwort falsch`, 403 with `totpRequired: true` when the code is missing or
 * wrong, 429 with `locked: true` and `retryAfter` (seconds) while locked.
 */

export interface ReauthInput {
  password?: unknown;
  /** TOTP code or recovery code; only looked at when the account has TOTP on. */
  code?: unknown;
}

export interface ReauthRefusal {
  status: 403 | 429;
  body: { error: string; locked?: true; retryAfter?: number; totpRequired?: true };
}

export interface ReauthOptions {
  /** Ask for the second factor when TOTP is on. Default true; off where TOTP is being set up. */
  stepUp?: boolean;
  now?: number;
}

/**
 * Checks a TOTP code (with the replay guard) or spends a recovery code. Shared by the 2FA login
 * step and the re-auth helper, so both accept exactly the same codes.
 */
export function verifySecondFactor(user: User, code: string): boolean {
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed) && user.totp_secret) {
    const counter = verifyTotpCode(user.totp_secret, trimmed, user.username);
    // Reject a code whose step has already been accepted: a shoulder-surfed code cannot be
    // replayed inside its own validity window.
    if (counter !== null && counter > (user.totp_last_counter ?? -1)) {
      updateTotpCounter(user.username, counter);
      return true;
    }
    return false;
  }
  return consumeRecoveryCode(user.username, trimmed);
}

function locked(until: number, now: number): ReauthRefusal {
  const seconds = Math.max(1, Math.ceil((until - now) / 1000));
  const minutes = Math.ceil(seconds / 60);
  return {
    status: 429,
    body: {
      error: `Zu viele Fehlversuche. Bitte versuche es in ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'} erneut.`,
      locked: true,
      retryAfter: seconds,
    },
  };
}

export const WRONG_PASSWORD = 'Passwort falsch';
export const CODE_REQUIRED = 'Bitte gib den Code aus deiner Authenticator-App oder einen Wiederherstellungscode ein.';
export const WRONG_CODE = 'Ungültiger Code';

/** Null when the caller proved it is the account owner; otherwise the answer to send. */
export function checkReauth(
  user: User,
  input: ReauthInput,
  verifyPassword: (password: string, stored: string) => boolean,
  options: ReauthOptions = {},
): ReauthRefusal | null {
  const now = options.now ?? Date.now();
  const stepUp = (options.stepUp ?? true) && !!user.totp_enabled;
  const lockedUntil = Math.max(loginLockedUntil(user.username), stepUp ? totpLockedUntil(user.username) : 0);
  if (lockedUntil) return locked(lockedUntil, now);

  const { password, code } = input;
  // A missing password is not a guess and costs nothing from the budget.
  if (typeof password !== 'string' || !password) return { status: 403, body: { error: WRONG_PASSWORD } };
  if (!verifyPassword(password, user.password_hash)) {
    const until = recordLoginFailure(user.username);
    return until ? locked(until, now) : { status: 403, body: { error: WRONG_PASSWORD } };
  }
  clearLoginFailures(user.username);

  if (stepUp) {
    if (typeof code !== 'string' || !code.trim()) {
      return { status: 403, body: { error: CODE_REQUIRED, totpRequired: true } };
    }
    if (!verifySecondFactor(user, code)) {
      const until = recordTotpFailure(user.username);
      return until ? locked(until, now) : { status: 403, body: { error: WRONG_CODE, totpRequired: true } };
    }
    clearTotpFailures(user.username);
  }
  return null;
}
