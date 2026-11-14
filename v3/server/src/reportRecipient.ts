import * as crypto from 'node:crypto';
import type { ScheduleConfig, User } from './db';

/**
 * Double opt-in for the recipient of the scheduled report (#449).
 *
 * Until now any signed-in user could point their schedule at any valid address
 * and the server would mail it a report every week: a spam vector against third
 * parties who never agreed, and those recipients never got the information
 * Art. 14 GDPR asks for. Now an address only receives reports once its owner has
 * clicked the link in a confirmation mail.
 *
 * What counts as confirmed (`isRecipientConfirmed`):
 *  - the recipient is the account's own e-mail address and that address is verified
 *    (the owner already proved the mailbox is theirs, #324 S19), or
 *  - the recipient equals `confirmedEmail`, set when the link in the confirmation mail
 *    was opened. Changing the recipient clears it, so a swapped address is never
 *    covered by the previous address's confirmation.
 *
 * The token is stateless and signed (HMAC-SHA256, expiring), like the photo token.
 * It names the account, the address and a sequence number. The sequence number
 * (`ScheduleConfig.confirmSeq`) is bumped whenever the recipient changes or a new
 * mail goes out, so only the newest link can be used and a link for an address the
 * user has since replaced is dead.
 *
 * The ad-hoc send ("Jetzt per E-Mail senden", `POST /api/reports/send`, #456) follows the
 * same rule: it mails only the account's own verified address or the currently confirmed
 * recipient (`adHocTargets`), never an address the user merely typed.
 *
 * Limits (all enforced server-side, per account unless noted):
 *  - recipient changes: at most MAX_RECIPIENT_CHANGES_PER_DAY in 24 h;
 *  - confirmation mails: at most MAX_CONFIRM_MAILS_PER_DAY in 24 h and one per
 *    MIN_CONFIRM_INTERVAL_MS;
 *  - per target address across ALL accounts: at most MAX_CONFIRM_MAILS_PER_ADDRESS_PER_DAY
 *    in 24 h, which is what stops many accounts from pointing at one victim.
 */

export const RECIPIENT_CONFIRM_TTL_MS = 48 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RECIPIENT_CHANGES_PER_DAY = 5;
export const MAX_CONFIRM_MAILS_PER_DAY = 5;
export const MIN_CONFIRM_INTERVAL_MS = 2 * 60 * 1000;
export const MAX_CONFIRM_MAILS_PER_ADDRESS_PER_DAY = 3;

/** Separates this token from the photo token and every other HMAC derived from JWT_SECRET. */
const TOKEN_CONTEXT = 'nagellacke:report-recipient:v1';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface RecipientTokenPayload {
  /** Expiry, unix seconds. */
  exp: number;
  /** Username whose schedule the address belongs to (canonical form). */
  u: string;
  /** The address being confirmed, normalised. */
  e: string;
  /** ScheduleConfig.confirmSeq at the time the mail was issued. */
  c: number;
}

function secretFor(jwtSecret: string): Buffer {
  return crypto.createHmac('sha256', jwtSecret).update(TOKEN_CONTEXT).digest();
}

export function signRecipientToken(payload: RecipientTokenPayload, jwtSecret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', secretFor(jwtSecret)).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * The payload when signature and expiry check out, otherwise null. Whether the token
 * still matches the schedule (same address, newest sequence number) is the caller's
 * business: this function knows nothing about accounts.
 */
export function verifyRecipientToken(token: unknown, jwtSecret: string, now: number = Date.now()): RecipientTokenPayload | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // Signature first: nothing from the payload is looked at until it is proven ours.
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
  const p = payload as Partial<RecipientTokenPayload>;
  if (typeof p.exp !== 'number' || !Number.isFinite(p.exp) || p.exp * 1000 <= now) return null;
  if (typeof p.u !== 'string' || typeof p.e !== 'string' || typeof p.c !== 'number' || !Number.isInteger(p.c)) return null;
  return { exp: p.exp, u: p.u, e: p.e, c: p.c };
}

// ── Status ────────────────────────────────────────────────────────────────────

export type RecipientStatus = 'none' | 'pending' | 'confirmed';
export type ConfirmedVia = 'account' | 'link';

/** Where the schedule's recipient stands. `via` is set when it is confirmed. */
export function recipientStatus(cfg: ScheduleConfig | null, user: Pick<User, 'email' | 'email_verified'> | undefined | null): { status: RecipientStatus; via?: ConfirmedVia } {
  const to = cfg?.toEmail ? normalizeEmail(cfg.toEmail) : '';
  if (!cfg || !to) return { status: 'none' };
  if (user?.email_verified && user.email && normalizeEmail(user.email) === to) return { status: 'confirmed', via: 'account' };
  if (cfg.confirmedEmail === to) return { status: 'confirmed', via: 'link' };
  return { status: 'pending' };
}

export function isRecipientConfirmed(cfg: ScheduleConfig | null, user: Pick<User, 'email' | 'email_verified'> | undefined | null): boolean {
  return recipientStatus(cfg, user).status === 'confirmed';
}

// ── Limits ────────────────────────────────────────────────────────────────────

/** Timestamps still inside the 24 h window. */
export function recent(stamps: number[] | undefined, now: number): number[] {
  return (stamps ?? []).filter((t) => t > now - DAY_MS && t <= now);
}

export type LimitReason = 'changes' | 'too-soon' | 'daily' | 'address';

export const LIMIT_MESSAGES: Record<LimitReason, string> = {
  changes: 'Du hast die Empfängeradresse heute zu oft geändert. Bitte versuche es morgen wieder.',
  'too-soon': 'Die letzte Bestätigungsmail ist erst kurz her. Bitte warte ein paar Minuten.',
  daily: 'Für dieses Konto wurden heute schon zu viele Bestätigungsmails gesendet. Bitte versuche es morgen wieder.',
  address: 'An diese Adresse wurden heute schon zu viele Bestätigungsmails gesendet. Bitte versuche es morgen wieder.',
};

/** Whether the account may change its recipient now. */
export function checkChangeLimit(cfg: ScheduleConfig | null, now: number): LimitReason | null {
  return recent(cfg?.recipientChangesAt, now).length >= MAX_RECIPIENT_CHANGES_PER_DAY ? 'changes' : null;
}

/** Whether the account may be sent another confirmation mail now (the per-address cap is separate). */
export function checkMailLimit(cfg: ScheduleConfig | null, now: number): LimitReason | null {
  const sent = recent(cfg?.confirmMailsAt, now);
  if (sent.length >= MAX_CONFIRM_MAILS_PER_DAY) return 'daily';
  if (sent.length > 0 && now - Math.max(...sent) < MIN_CONFIRM_INTERVAL_MS) return 'too-soon';
  return null;
}

/**
 * Sliding 24 h window per target address, shared by every account. In memory on
 * purpose: it protects a third party from a burst, and a server restart (rare) only
 * resets the burst allowance, while the per-account limits above persist. Bounded, so
 * a flood of distinct addresses cannot grow it without limit.
 */
export class AddressThrottle {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly max: number = MAX_CONFIRM_MAILS_PER_ADDRESS_PER_DAY, private readonly maxKeys: number = 10_000) {}

  allowed(address: string, now: number): boolean {
    return recent(this.hits.get(normalizeEmail(address)), now).length < this.max;
  }

  record(address: string, now: number): void {
    const key = normalizeEmail(address);
    const stamps = [...recent(this.hits.get(key), now), now];
    this.hits.delete(key); // re-insert so Map order is "least recently used first"
    this.hits.set(key, stamps);
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }
}

// ── Confirmation step ─────────────────────────────────────────────────────────

/**
 * The schedule with a new confirmation issued: bumps the sequence number (older
 * links die), records the mail for the limits and returns the signed token to mail.
 */
export function issueConfirmation(cfg: ScheduleConfig, username: string, jwtSecret: string, now: number): { cfg: ScheduleConfig; token: string } {
  const confirmSeq = (cfg.confirmSeq ?? 0) + 1;
  const next: ScheduleConfig = {
    ...cfg,
    confirmSeq,
    confirmSentAt: now,
    confirmMailsAt: [...recent(cfg.confirmMailsAt, now), now],
  };
  const token = signRecipientToken({
    exp: Math.floor((now + RECIPIENT_CONFIRM_TTL_MS) / 1000),
    u: username,
    e: normalizeEmail(cfg.toEmail),
    c: confirmSeq,
  }, jwtSecret);
  return { cfg: next, token };
}

/**
 * Applies a confirmation link to a schedule. Returns the updated schedule, or null
 * when the link no longer fits: other account, address replaced since, or a newer
 * mail has been issued. Opening the same (newest) link twice is harmless.
 */
export function applyConfirmation(cfg: ScheduleConfig | null, payload: RecipientTokenPayload, now: number): ScheduleConfig | null {
  if (!cfg || !cfg.toEmail) return null;
  if (normalizeEmail(cfg.toEmail) !== payload.e) return null;
  if ((cfg.confirmSeq ?? 0) !== payload.c) return null;
  return { ...cfg, confirmedEmail: payload.e, confirmedAt: now };
}

// ── Ad-hoc send (#456) ────────────────────────────────────────────────────────

export interface AdHocTarget {
  /** The address as stored; this is the one the mail goes to. */
  email: string;
  /** The account's own verified address, or the recipient confirmed by link. */
  kind: 'account' | 'recipient';
}

/**
 * Where an immediate report may go: the account's own verified address and, when it is a
 * different one, the schedule's recipient if (and only if) it is confirmed right now. A
 * pending or replaced recipient is not in the list, and neither is an unverified own address.
 */
export function adHocTargets(cfg: ScheduleConfig | null, user: Pick<User, 'email' | 'email_verified'> | undefined | null): AdHocTarget[] {
  const targets: AdHocTarget[] = [];
  if (user?.email_verified && user.email) targets.push({ email: user.email, kind: 'account' });
  if (cfg?.toEmail && recipientStatus(cfg, user).status === 'confirmed'
    && !targets.some((t) => normalizeEmail(t.email) === normalizeEmail(cfg.toEmail))) {
    targets.push({ email: cfg.toEmail, kind: 'recipient' });
  }
  return targets;
}

export type AdHocDenial = 'recipient-pending' | 'own-unverified' | 'not-allowed';

export type AdHocDecision =
  | { allowed: true; target: AdHocTarget }
  | { allowed: false; reason: AdHocDenial; message: string };

/** Whether `requested` may get an ad-hoc report, and if not, the most helpful reason why. */
export function decideAdHocTarget(
  cfg: ScheduleConfig | null, user: Pick<User, 'email' | 'email_verified'> | undefined | null, requested: string,
): AdHocDecision {
  const wanted = normalizeEmail(requested);
  const hit = adHocTargets(cfg, user).find((t) => normalizeEmail(t.email) === wanted);
  if (hit) return { allowed: true, target: hit };
  if (cfg?.toEmail && normalizeEmail(cfg.toEmail) === wanted) {
    return {
      allowed: false, reason: 'recipient-pending',
      message: 'Diese Adresse ist als Berichtsempfänger noch nicht bestätigt. Der Empfänger muss zuerst den Link in der Bestätigungsmail öffnen (Einstellungen → Berichte → Automatischer Zeitplan).',
    };
  }
  if (user?.email && !user.email_verified && normalizeEmail(user.email) === wanted) {
    return {
      allowed: false, reason: 'own-unverified',
      message: 'Die Adresse deines Kontos ist noch nicht verifiziert. Bestätige sie über den Link in der Verifizierungsmail (Einstellungen → Konto).',
    };
  }
  return {
    allowed: false, reason: 'not-allowed',
    message: 'Berichte können nur an die verifizierte Adresse deines Kontos oder an den bestätigten Empfänger deines Zeitplans gesendet werden. '
      + 'Soll der Bericht an eine andere Adresse gehen, trage sie im automatischen Zeitplan ein: Der Besitzer bekommt dann eine Bestätigungsmail.',
  };
}
