import * as crypto from 'node:crypto';
import type { ScheduleConfig, User } from './db';
import { normalizeEmail } from './reportRecipient';

/**
 * One-click unsubscribe for report mails (#457, RFC 8058).
 *
 * #449 made the recipient of a report schedule confirm by double opt-in, but a confirmed
 * third party could not take it back: the confirmation page told them to write to the
 * operator. Every report mail now carries a signed link, in the footer and as the
 * `List-Unsubscribe` / `List-Unsubscribe-Post` headers, so mail clients can offer their own
 * "Unsubscribe" button.
 *
 * Token: `base64url(JSON) . base64url(HMAC-SHA256)`, keyed with a value derived from
 * JWT_SECRET under its own context (a confirmation token, a photo token or a JWT cannot be
 * replayed here and vice versa). The payload names the account and the address.
 *
 * **No expiry, on purpose.** An unsubscribe link has to work for as long as the mail it sits
 * in exists: people clear out old newsletters months later, and a dead link there sends them
 * back to "contact the operator", which is the problem this fixes. What the token can do is
 * small and in the recipient's favour (stop mail to exactly this address from exactly this
 * account), so a leaked or forwarded link is no more than a nuisance, and every report mail
 * carries a fresh copy anyway. The confirmation token is different (it grants something, so
 * it expires after 48 h). It also has no sequence number: a link must keep working after later
 * confirmation mails, which bump that number. Rotating JWT_SECRET invalidates all of them.
 *
 * Effect (`applyUnsubscribe`), idempotent:
 *  - the schedule is paused and the address's confirmation removed, so nothing more goes out;
 *  - an address that is not the account's own verified one is also remembered as having
 *    opted out (`unsubscribedEmails`), so the owner cannot simply ask it again with a new
 *    confirmation mail or confirm it with a stale link;
 *  - the owner is told in the UI (`lastUnsubscribe`, shown in Settings -> Reports): the
 *    account may have no usable e-mail address, and a paused schedule is something they
 *    notice there, while a mail triggered from a public endpoint would be one more thing to
 *    rate-limit and to fail.
 */

const TOKEN_CONTEXT = 'nagellacke:report-unsubscribe:v1';
const PURPOSE = 'unsub';
/** How many opted-out addresses a schedule remembers; the oldest go first. */
export const MAX_UNSUBSCRIBED_ADDRESSES = 50;

export interface UnsubscribeTokenPayload {
  /** Username whose schedule the address belongs to (canonical form). */
  u: string;
  /** The address the mail went to, normalised. */
  e: string;
}

function secretFor(jwtSecret: string): Buffer {
  return crypto.createHmac('sha256', jwtSecret).update(TOKEN_CONTEXT).digest();
}

export function signUnsubscribeToken(payload: UnsubscribeTokenPayload, jwtSecret: string): string {
  const body = Buffer.from(JSON.stringify({ p: PURPOSE, u: payload.u, e: normalizeEmail(payload.e) }), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', secretFor(jwtSecret)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** The payload when the signature checks out, otherwise null. Nothing is read before it does. */
export function verifyUnsubscribeToken(token: unknown, jwtSecret: string): UnsubscribeTokenPayload | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secretFor(jwtSecret)).update(body).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as { p?: unknown; u?: unknown; e?: unknown };
  if (p.p !== PURPOSE || typeof p.u !== 'string' || typeof p.e !== 'string' || !p.u || !p.e) return null;
  return { u: p.u, e: p.e };
}

// ── State ─────────────────────────────────────────────────────────────────────

type MailUser = Pick<User, 'email' | 'email_verified'> | undefined | null;

function isOwnVerified(user: MailUser, address: string): boolean {
  return !!(user?.email_verified && user.email && normalizeEmail(user.email) === normalizeEmail(address));
}

/**
 * Whether the address has opted out of this account's reports and may therefore not be asked
 * again. Never true for the account's own verified address: its owner can always switch their
 * own reports back on.
 */
export function isAddressBlocked(cfg: ScheduleConfig | null, user: MailUser, address: string): boolean {
  if (!cfg || !address.trim() || isOwnVerified(user, address)) return false;
  const wanted = normalizeEmail(address);
  return (cfg.unsubscribedEmails ?? []).includes(wanted);
}

export const BLOCKED_MESSAGE = 'Diese Adresse hat die Berichte dieses Kontos abbestellt und bekommt keine weiteren Mails mehr, auch keine Bestätigungsmail. '
  + 'Trage eine andere Adresse ein.';

/**
 * Applies a valid unsubscribe link. Returns the schedule to store and whether anything changed
 * (false: already unsubscribed, nothing to write), or null when the account has no schedule
 * (deleted, or never configured): there is nothing to stop, and the answer is the same "done".
 */
export function applyUnsubscribe(
  cfg: ScheduleConfig | null, user: MailUser, payload: UnsubscribeTokenPayload, now: number,
): { cfg: ScheduleConfig; changed: boolean } | null {
  if (!cfg) return null;
  const address = normalizeEmail(payload.e);
  const own = isOwnVerified(user, address);
  const isRecipient = !!cfg.toEmail && normalizeEmail(cfg.toEmail) === address;
  const blocked = (cfg.unsubscribedEmails ?? []).includes(address);

  const next: ScheduleConfig = { ...cfg };
  let changed = false;

  if (isRecipient) {
    if (next.enabled) { next.enabled = false; changed = true; }
    if (next.confirmedEmail === address) {
      // Only the link-confirmed state goes; for the own verified address the account itself still vouches.
      next.confirmedEmail = undefined;
      next.confirmedAt = undefined;
      changed = true;
    }
  }
  if (!own && !blocked) {
    next.unsubscribedEmails = [...(cfg.unsubscribedEmails ?? []), address].slice(-MAX_UNSUBSCRIBED_ADDRESSES);
    changed = true;
  }
  if (!changed) return { cfg, changed: false };
  if (isRecipient) {
    next.lastUnsubscribe = { email: address, at: now };
    if (!own) {
      // Kills a confirmation mail still in flight for this address, so a stale link cannot re-confirm it.
      next.confirmSeq = (cfg.confirmSeq ?? 0) + 1;
      next.confirmSentAt = undefined;
    }
  }
  return { cfg: next, changed: true };
}

// ── Links and headers ─────────────────────────────────────────────────────────

export interface UnsubscribeLinks {
  /** SPA page for the link in the mail body (token in the fragment, so it stays out of logs and Referer). */
  pageUrl: string;
  /** Endpoint for mail clients (RFC 8058 POSTs here; a GET redirects to the page). */
  postUrl: string;
  /** Headers to add to the message. */
  headers: Record<string, string>;
}

/**
 * Links for one report mail, or null when the server has no App-URL to point them at. Never
 * derived from request data. `List-Unsubscribe-Post` is only sent for https: RFC 8058 requires
 * a secure URL for one-click, and a client would ignore (or distrust) it on plain http, where
 * the plain `List-Unsubscribe` link still works.
 */
export function unsubscribeLinks(baseUrl: string, jwtSecret: string, username: string, address: string): UnsubscribeLinks | null {
  const base = baseUrl.replace(/\/$/, '');
  if (!base) return null;
  const token = signUnsubscribeToken({ u: username, e: address }, jwtSecret);
  const postUrl = `${base}/api/reports/unsubscribe?token=${token}`;
  const headers: Record<string, string> = { 'List-Unsubscribe': `<${postUrl}>` };
  if (base.startsWith('https://')) headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  return { pageUrl: `${base}/#/bericht-abbestellen?token=${token}`, postUrl, headers };
}
