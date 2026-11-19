/**
 * Re-authentication for account-security changes (#479). The server asks for the password again
 * before an e-mail change or removal, account deletion, turning 2FA off, new recovery codes and
 * adding or removing a passkey, and, when 2FA is on, also for a TOTP or recovery code. Its answers:
 *
 * - 403 `{ error: 'Passwort falsch' }`
 * - 403 `{ error, totpRequired: true }` when the code is missing or wrong
 * - 429 `{ error, locked: true, retryAfter }` while the account is locked after too many failures
 *
 * The error text is already meant for the user, so the UI shows it as it comes.
 */

export interface ReauthPayload {
  password: string;
  code?: string;
}

/** The body fields for a re-auth request; the code only goes along when 2FA is on. */
export function reauthPayload(password: string, code: string, totpEnabled: boolean): ReauthPayload {
  const trimmed = code.trim();
  return totpEnabled && trimmed ? { password, code: trimmed } : { password };
}

/** Whether the prompt has everything the server will ask for, so the button can be enabled. */
export function reauthComplete(password: string, code: string, totpEnabled: boolean): boolean {
  return password !== '' && (!totpEnabled || code.trim() !== '');
}

/** An API refusal that keeps what the UI needs to react: show the code field, or wait. */
export class ApiError extends Error {
  readonly status: number;
  readonly totpRequired: boolean;
  readonly locked: boolean;

  constructor(message: string, status: number, totpRequired = false, locked = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.totpRequired = totpRequired;
    this.locked = locked;
  }
}

/** Builds the error for a non-2xx answer from its status and JSON body. */
export function apiError(status: number, data: Record<string, unknown>): ApiError {
  const message = typeof data.error === 'string' && data.error ? data.error : `Fehler ${status}`;
  return new ApiError(message, status, data.totpRequired === true, status === 429 || data.locked === true);
}

/** True when the server said this account needs a 2FA code here (its 2FA state may be newer than ours). */
export function needsTotpCode(e: unknown): boolean {
  return e instanceof ApiError && e.totpRequired;
}

export const CODE_LABEL = '2FA-Code oder Wiederherstellungscode';
