import { serverBase, serverSession } from './serverBase';
import type { RecipientState, SendTarget } from './reportRecipient';

/**
 * Password reset, e-mail verification (#324 S18, S19) and report-recipient confirmation (#449). The server mails links to
 * hash routes of this app; the token travels in the fragment, which browsers never
 * send to any server, so it stays out of access logs and Referer headers.
 */
export type AccountRoute = { kind: 'reset' | 'verify' | 'recipient' | 'unsubscribe'; token: string };

const ROUTES: Record<string, AccountRoute['kind']> = {
  '#/passwort-neu': 'reset',
  '#/email-bestaetigen': 'verify',
  // The recipient of a scheduled report confirms their address (#449).
  '#/bericht-bestaetigen': 'recipient',
  // The recipient of a report mail stops the reports with the link in its footer (#457).
  '#/bericht-abbestellen': 'unsubscribe',
};

export function accountRouteForHash(hash: string): AccountRoute | null {
  const q = hash.indexOf('?');
  const path = q < 0 ? hash : hash.slice(0, q);
  const kind = ROUTES[path];
  if (!kind) return null;
  const token = new URLSearchParams(q < 0 ? '' : hash.slice(q + 1)).get('token') ?? '';
  // A well-formed token is 64 hex characters; anything else still opens the page,
  // which then says the link is broken rather than silently showing the app.
  return { kind, token };
}

async function post(path: string, body: unknown, base = serverBase(), headers: Record<string, string> = {}): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Fehler ${res.status}`);
  }
  return { ok: true, data };
}

export async function requestPasswordReset(identifier: string, base = serverBase()): Promise<void> {
  await post('/api/auth/password/forgot', { identifier }, base);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await post('/api/auth/password/reset', { token, password });
}

export async function verifyEmail(token: string): Promise<void> {
  await post('/api/auth/email/verify', { token });
}

function bearer(): { base: string; headers: Record<string, string> } {
  const session = serverSession();
  if (!session) throw new Error('Nicht angemeldet');
  return { base: session.base, headers: { Authorization: `Bearer ${session.token}` } };
}

export async function resendVerification(): Promise<void> {
  const { base, headers } = bearer();
  await post('/api/auth/email/resend', {}, base, headers);
}

/** Whether saving `typed` would change the account address, which then needs the password (#475). */
export function emailChangeNeedsPassword(typed: string, saved: string | null): boolean {
  const next = typed.trim().toLowerCase();
  return next !== '' && next !== (saved ?? '').trim().toLowerCase();
}

/**
 * Saves the account's address; true when a verification mail went out for it. A new address needs
 * the current password (#475): the address is where a password reset goes, so a stolen session
 * alone must not be able to change it.
 */
export async function saveAccountEmail(email: string, password: string): Promise<boolean> {
  const { base, headers } = bearer();
  const res = await fetch(`${base}/api/auth/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({})) as { error?: string; verificationSent?: boolean };
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data.verificationSent === true;
}

/** GET /api/me/export as a file download (#324 S20). */
export async function downloadAccountExport(): Promise<void> {
  const { base, headers } = bearer();
  const res = await fetch(`${base}/api/me/export`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `Fehler ${res.status}`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'nagellacke-konto.json';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** POST /api/me/delete (#324 S21). The caller ends the local session afterwards. */
export async function deleteOwnAccount(password: string): Promise<void> {
  const { base, headers } = bearer();
  await post('/api/me/delete', { password }, base, headers);
}

/** What POST /api/auth/email/remove answers (#471): whether the report schedule lost its recipient, and its new view. */
export interface RemoveEmailResult {
  scheduleCleared: boolean;
  schedule?: {
    config: { enabled: boolean; frequency: 'weekly' | 'monthly'; toEmail: string } | null;
    recipient?: RecipientState;
    sendTargets?: SendTarget[];
  };
}

/** Removes the account's e-mail address (#471); needs the password. */
export async function removeAccountEmail(password: string): Promise<RemoveEmailResult> {
  const { base, headers } = bearer();
  const { data } = await post('/api/auth/email/remove', { password }, base, headers);
  return {
    scheduleCleared: data.scheduleCleared === true,
    ...(data.schedule && typeof data.schedule === 'object' ? { schedule: data.schedule as RemoveEmailResult['schedule'] } : {}),
  };
}

/**
 * The warning shown before the account address is removed (#471). Without an address there is
 * no password reset, so the user has to be told plainly; and a report schedule that mails this
 * address stops.
 */
export function removeEmailWarning(address: string, scheduleUsesIt: boolean): string {
  const parts = [
    `Entfernt ${address.trim()} aus deinem Konto. Anmelden kannst du dich weiter mit Benutzername und Passwort.`,
    'Wichtig: Ohne E-Mail-Adresse kannst du dein Passwort nicht mehr zurücksetzen. Vergisst du es, kommst du nicht mehr in dein Konto (Passkeys, falls eingerichtet, funktionieren weiter).',
  ];
  if (scheduleUsesIt) parts.push('Dein automatischer Berichtsplan sendet an diese Adresse; er wird pausiert und die Adresse daraus entfernt.');
  parts.push('Du kannst später jederzeit wieder eine Adresse eintragen; sie muss dann neu bestätigt werden.');
  return parts.join(' ');
}

/** The message after removing, from the server's answer. */
export function removeEmailMessage(result: RemoveEmailResult): string {
  return result.scheduleCleared
    ? 'Adresse entfernt. Der automatische Berichtsplan ist pausiert, weil er an diese Adresse ging.'
    : 'Adresse entfernt.';
}
