import { serverBase, serverSession } from './serverBase';

/**
 * Password reset and e-mail verification (#324 S18, S19). The server mails links to
 * hash routes of this app; the token travels in the fragment, which browsers never
 * send to any server, so it stays out of access logs and Referer headers.
 */
export type AccountRoute = { kind: 'reset' | 'verify'; token: string };

const ROUTES: Record<string, AccountRoute['kind']> = {
  '#/passwort-neu': 'reset',
  '#/email-bestaetigen': 'verify',
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

/** Saves the account's address; true when a verification mail went out for it. */
export async function saveAccountEmail(email: string): Promise<boolean> {
  const { base, headers } = bearer();
  const res = await fetch(`${base}/api/auth/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email }),
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
