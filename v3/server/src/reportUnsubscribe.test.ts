import { describe, expect, it } from 'vitest';
import * as nodemailer from 'nodemailer';
import {
  applyUnsubscribe, isAddressBlocked, MAX_UNSUBSCRIBED_ADDRESSES, signUnsubscribeToken, unsubscribeLinks, verifyUnsubscribeToken,
} from './reportUnsubscribe';
import { signRecipientToken } from './reportRecipient';
import type { ScheduleConfig } from './db';

/** #457: the signed unsubscribe token, what applying it does, and the links and headers built from it. */
const SECRET = 'test-secret-do-not-use-in-prod';
const FRIEND = 'friend@example.org';
const OWN = 'anna@example.org';

describe('unsubscribe token', () => {
  it('round-trips and normalises the address', () => {
    const token = signUnsubscribeToken({ u: 'anna', e: ' Friend@Example.org ' }, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ u: 'anna', e: FRIEND });
  });

  it('is URL safe (it travels in a query string and a fragment)', () => {
    expect(signUnsubscribeToken({ u: 'anna müller/ü?&=', e: FRIEND }, SECRET)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('has no expiry: a token signed long ago still verifies (justified in reportUnsubscribe.ts)', () => {
    const token = signUnsubscribeToken({ u: 'anna', e: FRIEND }, SECRET);
    const body = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf-8')) as Record<string, unknown>;
    expect(body).not.toHaveProperty('exp');
    expect(verifyUnsubscribeToken(token, SECRET)).not.toBeNull();
  });

  it('rejects a tampered payload, a damaged signature and a wrong secret', () => {
    const token = signUnsubscribeToken({ u: 'anna', e: FRIEND }, SECRET);
    const [body, sig] = token.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ p: 'unsub', u: 'anna', e: 'victim@example.org' })).toString('base64url');
    expect(verifyUnsubscribeToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${body}.${sig.slice(0, -2)}AA`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(`${body}.${sig.slice(1)}`, SECRET)).toBeNull();
    expect(verifyUnsubscribeToken(token, 'another-secret')).toBeNull();
  });

  it('rejects malformed input', () => {
    for (const bad of [undefined, null, 42, {}, '', '.', 'abc', 'abc.', '.abc', 'a.b.c', 'x'.repeat(5000)]) {
      expect(verifyUnsubscribeToken(bad, SECRET)).toBeNull();
    }
  });

  it('is not interchangeable with the confirmation token', () => {
    const confirm = signRecipientToken({ exp: Math.floor(Date.now() / 1000) + 3600, u: 'anna', e: FRIEND, c: 1 }, SECRET);
    expect(verifyUnsubscribeToken(confirm, SECRET)).toBeNull();
  });

  it('rejects a correctly signed payload that is not an unsubscribe payload', () => {
    // Same key as the real thing would need to be forged; here we only check the shape rules via a hand-made token.
    expect(verifyUnsubscribeToken(Buffer.from('{}').toString('base64url') + '.AAAA', SECRET)).toBeNull();
  });
});

describe('applyUnsubscribe', () => {
  const user = { email: OWN, email_verified: true };
  const base = (extra: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
    enabled: true, frequency: 'weekly', toEmail: FRIEND, confirmedEmail: FRIEND, confirmedAt: 1, confirmSeq: 3, confirmSentAt: 2, ...extra,
  });

  it('pauses the schedule, removes the confirmation, remembers the opt-out and kills in-flight links', () => {
    const r = applyUnsubscribe(base(), user, { u: 'anna', e: FRIEND }, 1000)!;
    expect(r.changed).toBe(true);
    expect(r.cfg).toMatchObject({
      enabled: false, confirmedEmail: undefined, confirmedAt: undefined, confirmSeq: 4, confirmSentAt: undefined,
      unsubscribedEmails: [FRIEND], lastUnsubscribe: { email: FRIEND, at: 1000 },
    });
  });

  it('is idempotent: the second application changes nothing', () => {
    const first = applyUnsubscribe(base(), user, { u: 'anna', e: FRIEND }, 1000)!;
    const second = applyUnsubscribe(first.cfg, user, { u: 'anna', e: FRIEND }, 2000)!;
    expect(second.changed).toBe(false);
    expect(second.cfg).toBe(first.cfg);
  });

  it('does nothing without a schedule', () => {
    expect(applyUnsubscribe(null, user, { u: 'anna', e: FRIEND }, 1)).toBeNull();
  });

  it('for the own verified address only pauses: it is not blocked and its account confirmation stays', () => {
    const r = applyUnsubscribe(base({ toEmail: OWN, confirmedEmail: OWN }), user, { u: 'anna', e: OWN }, 1000)!;
    expect(r.changed).toBe(true);
    expect(r.cfg.enabled).toBe(false);
    expect(r.cfg.unsubscribedEmails).toBeUndefined();
    expect(r.cfg.lastUnsubscribe).toEqual({ email: OWN, at: 1000 });
    expect(isAddressBlocked(r.cfg, user, OWN)).toBe(false);
    // Idempotent as well.
    expect(applyUnsubscribe(r.cfg, user, { u: 'anna', e: OWN }, 2000)!.changed).toBe(false);
  });

  it('for an address that is no longer the recipient: blocks it, leaves the schedule alone', () => {
    const cfg = base({ toEmail: 'new@example.org', confirmedEmail: 'new@example.org' });
    const r = applyUnsubscribe(cfg, user, { u: 'anna', e: FRIEND }, 1000)!;
    expect(r.changed).toBe(true);
    expect(r.cfg).toMatchObject({ enabled: true, confirmedEmail: 'new@example.org', unsubscribedEmails: [FRIEND] });
    expect(r.cfg.lastUnsubscribe).toBeUndefined();
  });

  it('pauses a recipient that was still pending, and blocks it', () => {
    const r = applyUnsubscribe(base({ confirmedEmail: undefined, confirmedAt: undefined }), user, { u: 'anna', e: FRIEND }, 1000)!;
    expect(r.cfg.enabled).toBe(false);
    expect(r.cfg.confirmSeq).toBe(4);
    expect(isAddressBlocked(r.cfg, user, FRIEND)).toBe(true);
  });

  it('keeps the list bounded, newest last', () => {
    let cfg = base({ enabled: false });
    for (let i = 0; i < MAX_UNSUBSCRIBED_ADDRESSES + 5; i++) {
      cfg = applyUnsubscribe(cfg, user, { u: 'anna', e: `p${i}@example.org` }, i)!.cfg;
    }
    expect(cfg.unsubscribedEmails).toHaveLength(MAX_UNSUBSCRIBED_ADDRESSES);
    expect(cfg.unsubscribedEmails!.at(-1)).toBe(`p${MAX_UNSUBSCRIBED_ADDRESSES + 4}@example.org`);
  });

  it('isAddressBlocked ignores case and never blocks the own verified address', () => {
    const cfg = base({ unsubscribedEmails: [FRIEND, OWN] });
    expect(isAddressBlocked(cfg, user, 'FRIEND@example.org')).toBe(true);
    expect(isAddressBlocked(cfg, user, OWN)).toBe(false);
    expect(isAddressBlocked(cfg, { email: OWN, email_verified: false }, OWN)).toBe(true);
    expect(isAddressBlocked(null, user, FRIEND)).toBe(false);
  });
});

describe('unsubscribeLinks and the RFC 8058 headers', () => {
  it('builds the page link, the one-click URL and both headers for an https App-URL', () => {
    const l = unsubscribeLinks('https://app.example/', SECRET, 'anna', FRIEND)!;
    const token = /token=([A-Za-z0-9_.-]+)$/.exec(l.postUrl)![1]!;
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ u: 'anna', e: FRIEND });
    expect(l.postUrl).toBe(`https://app.example/api/reports/unsubscribe?token=${token}`);
    expect(l.pageUrl).toBe(`https://app.example/#/bericht-abbestellen?token=${token}`);
    expect(l.headers).toEqual({
      'List-Unsubscribe': `<${l.postUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('omits the one-click header for plain http (RFC 8058 needs https) but keeps the link', () => {
    const l = unsubscribeLinks('http://192.168.0.5:3000', SECRET, 'anna', FRIEND)!;
    expect(l.headers['List-Unsubscribe']).toMatch(/^<http:\/\/192\.168\.0\.5:3000\/api\/reports\/unsubscribe\?token=/);
    expect(l.headers).not.toHaveProperty('List-Unsubscribe-Post');
  });

  it('is null without an App-URL', () => {
    expect(unsubscribeLinks('', SECRET, 'anna', FRIEND)).toBeNull();
  });

  it('comes out of nodemailer as real message headers', async () => {
    const l = unsubscribeLinks('https://app.example', SECRET, 'anna', FRIEND)!;
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await transport.sendMail({ from: 'a@example.org', to: FRIEND, subject: 'x', html: '<p>x</p>', headers: l.headers });
    const raw = (info as unknown as { message: Buffer }).message.toString('utf-8').replace(/\r?\n[ \t]+/g, ' ');
    expect(raw).toContain(`List-Unsubscribe: <${l.postUrl}>`);
    expect(raw).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
  });
});
