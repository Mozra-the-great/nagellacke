/**
 * Passkeys (WebAuthn) as an opt-in third way to sign in, next to password and TOTP
 * (#228). The cryptography is @simplewebauthn/server's; this module holds what is
 * specific to this app: where the relying party comes from, and the short-lived
 * challenges between an "options" call and its "verify" call.
 *
 * The relying party is derived from the App-URL (#324 S17), optionally narrowed to a
 * parent domain by the panel's `webauthnRpId`. WebAuthn only works in a secure context,
 * so an http:// App-URL other than localhost yields no relying party at all: a LAN
 * install under http://192.168.x.x cannot use passkeys and keeps TOTP (#221).
 */

export interface RelyingParty {
  /** The RP ID credentials are bound to: the App-URL's host or a registrable parent of it. */
  rpId: string;
  /** The exact origin the browser reports in clientDataJSON. */
  origin: string;
}

export type RelyingPartyProblem = 'no-app-url' | 'insecure' | 'rp-id-mismatch';

/** Hostname syntax only; whether it is a suffix of the App-URL host is checked separately. */
export function isValidRpId(value: string): boolean {
  return value.length <= 253 && /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value);
}

export function resolveRelyingParty(appUrl: string, rpIdOverride?: string): RelyingParty | RelyingPartyProblem {
  if (!appUrl) return 'no-app-url';
  let url: URL;
  try { url = new URL(appUrl); } catch { return 'no-app-url'; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' && host !== 'localhost') return 'insecure';
  const rpId = (rpIdOverride || host).toLowerCase();
  // The browser only accepts an RP ID equal to the page's host or a parent domain of it.
  if (rpId !== host && !host.endsWith(`.${rpId}`)) return 'rp-id-mismatch';
  return { rpId, origin: url.origin };
}

export function relyingPartyProblemText(problem: RelyingPartyProblem): string {
  switch (problem) {
    case 'no-app-url': return 'Auf diesem Server ist keine App-URL eingetragen.';
    case 'insecure': return 'Passkeys funktionieren nur über HTTPS. Dieser Server ist per http:// erreichbar.';
    case 'rp-id-mismatch': return 'Die eingestellte Passkey-Domain passt nicht zur App-URL.';
  }
}

/** A stored passkey. The public key is base64url; nothing here is secret. */
export interface StoredPasskey {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  /** Given by the user when adding it, so the list can tell devices apart. */
  name: string;
  /** Credentials are bound to one RP ID for life; one from another RP ID is dead. */
  rpId: string;
  createdAt: number;
  lastUsedAt?: number;
}

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface PendingChallenge {
  kind: 'register' | 'login';
  /** Registration only: the account that asked, which must be the one that verifies. */
  username?: string;
  expires: number;
}

/**
 * Challenges between an options call and its verify call, in memory. Single use: taking
 * one removes it whether or not the rest of the verification succeeds, so a response can
 * never be replayed. A restart forgets them, which costs at most one retried ceremony.
 */
export class ChallengeStore {
  private readonly pending = new Map<string, PendingChallenge>();

  put(challenge: string, entry: PendingChallenge): void {
    this.prune(Date.now());
    this.pending.set(challenge, entry);
  }

  /** Consumes the challenge; true only if it was issued for this kind (and account) and is fresh. */
  take(challenge: string, kind: PendingChallenge['kind'], username?: string, now = Date.now()): boolean {
    const entry = this.pending.get(challenge);
    if (!entry) return false;
    this.pending.delete(challenge);
    if (entry.kind !== kind || entry.expires <= now) return false;
    if (kind === 'register' && entry.username !== username) return false;
    return true;
  }

  private prune(now: number): void {
    for (const [c, e] of this.pending) if (e.expires <= now) this.pending.delete(c);
  }
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(value, 'base64url');
  const out = new Uint8Array(new ArrayBuffer(buf.length));
  out.set(buf);
  return out;
}
