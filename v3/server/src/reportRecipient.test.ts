import { describe, expect, it } from 'vitest';
import * as crypto from 'node:crypto';
import type { ScheduleConfig } from './db';
import {
  AddressThrottle, DAY_MS, MAX_CONFIRM_MAILS_PER_ADDRESS_PER_DAY, MAX_CONFIRM_MAILS_PER_DAY, MAX_RECIPIENT_CHANGES_PER_DAY,
  MIN_CONFIRM_INTERVAL_MS, RECIPIENT_CONFIRM_TTL_MS, applyConfirmation, checkChangeLimit, checkMailLimit, isRecipientConfirmed,
  issueConfirmation, normalizeEmail, recent, recipientStatus, signRecipientToken, verifyRecipientToken,
} from './reportRecipient';

/**
 * #449: a schedule's recipient must be confirmed by its owner before any report is
 * sent. This file covers the pure parts: the signed token, what counts as confirmed,
 * the rate limits. The routes are covered in reportRecipientRoutes.test.ts.
 */
const SECRET = 'test-jwt-secret-do-not-use-in-prod';
const NOW = 1_800_000_000_000;

function schedule(extra: Partial<ScheduleConfig> = {}): ScheduleConfig {
  return { enabled: true, frequency: 'weekly', toEmail: 'Friend@Example.org', username: 'anna', ...extra };
}

describe('recipient token', () => {
  const payload = { exp: Math.floor((NOW + RECIPIENT_CONFIRM_TTL_MS) / 1000), u: 'anna', e: 'friend@example.org', c: 3 };

  it('round-trips a valid token', () => {
    const token = signRecipientToken(payload, SECRET);
    expect(verifyRecipientToken(token, SECRET, NOW)).toEqual(payload);
  });

  it('rejects an expired token, up to the second', () => {
    const token = signRecipientToken(payload, SECRET);
    expect(verifyRecipientToken(token, SECRET, payload.exp * 1000 - 1)).not.toBeNull();
    expect(verifyRecipientToken(token, SECRET, payload.exp * 1000)).toBeNull();
    expect(verifyRecipientToken(token, SECRET, payload.exp * 1000 + DAY_MS)).toBeNull();
  });

  it('rejects a token whose payload was changed, even with the old signature', () => {
    const [body, sig] = signRecipientToken(payload, SECRET).split('.');
    for (const forged of [{ ...payload, e: 'victim@example.org' }, { ...payload, u: 'mallory' }, { ...payload, c: 99 }, { ...payload, exp: payload.exp + 9999 }]) {
      const forgedBody = Buffer.from(JSON.stringify(forged), 'utf-8').toString('base64url');
      expect(verifyRecipientToken(`${forgedBody}.${sig}`, SECRET, NOW)).toBeNull();
    }
    expect(body).toBeTruthy();
  });

  it('rejects a token with a damaged signature or body', () => {
    const token = signRecipientToken(payload, SECRET);
    const flip = (s: string, i: number): string => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
    expect(verifyRecipientToken(flip(token, token.length - 1), SECRET, NOW)).toBeNull();
    expect(verifyRecipientToken(flip(token, 0), SECRET, NOW)).toBeNull();
    expect(verifyRecipientToken(token.slice(0, -4), SECRET, NOW)).toBeNull();
  });

  it('rejects a token signed with another secret, and one from another purpose', () => {
    expect(verifyRecipientToken(signRecipientToken(payload, 'another-secret'), SECRET, NOW)).toBeNull();
    // A photo-style token is signed under a different derived key and must not verify here.
    const body = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    const photoKey = crypto.createHmac('sha256', SECRET).update('nagellacke:photo-token:v1').digest();
    const sig = crypto.createHmac('sha256', photoKey).update(body).digest('base64url');
    expect(verifyRecipientToken(`${body}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it.each([undefined, null, 42, '', '.', 'abc', 'a.b.c.d', 'x'.repeat(5000)])('rejects the non-token %j', (value) => {
    expect(verifyRecipientToken(value, SECRET, NOW)).toBeNull();
  });

  it('rejects a correctly signed payload of the wrong shape', () => {
    for (const bad of [{ ...payload, c: 1.5 }, { ...payload, exp: 'soon' }, { ...payload, u: 7 }, { ...payload, e: null }, [1, 2], 'str']) {
      const body = Buffer.from(JSON.stringify(bad), 'utf-8').toString('base64url');
      const sig = signRecipientToken(payload, SECRET).split('.')[1]!;
      expect(verifyRecipientToken(`${body}.${sig}`, SECRET, NOW)).toBeNull();
    }
  });
});

describe('recipientStatus / isRecipientConfirmed', () => {
  it('is "none" without a recipient', () => {
    expect(recipientStatus(null, undefined).status).toBe('none');
    expect(recipientStatus(schedule({ toEmail: '' }), undefined).status).toBe('none');
    expect(isRecipientConfirmed(schedule({ toEmail: '  ' }), undefined)).toBe(false);
  });

  it('is pending for a legacy schedule and for an address nobody confirmed', () => {
    expect(recipientStatus(schedule(), undefined)).toEqual({ status: 'pending' });
    expect(recipientStatus(schedule(), { email: 'someone@else.org', email_verified: true })).toEqual({ status: 'pending' });
  });

  it('treats the account\'s own VERIFIED address as confirmed, whatever the case', () => {
    expect(recipientStatus(schedule({ toEmail: 'Anna@Example.org' }), { email: 'anna@example.org', email_verified: true }))
      .toEqual({ status: 'confirmed', via: 'account' });
  });

  it('does not trust the account\'s own address while it is unverified', () => {
    expect(recipientStatus(schedule({ toEmail: 'anna@example.org' }), { email: 'anna@example.org', email_verified: false }).status).toBe('pending');
    expect(recipientStatus(schedule({ toEmail: 'anna@example.org' }), { email: 'anna@example.org' }).status).toBe('pending');
  });

  it('is confirmed once the link confirmed exactly this address', () => {
    expect(recipientStatus(schedule({ confirmedEmail: 'friend@example.org' }), undefined)).toEqual({ status: 'confirmed', via: 'link' });
    // Another address than the confirmed one: not covered.
    expect(recipientStatus(schedule({ toEmail: 'other@example.org', confirmedEmail: 'friend@example.org' }), undefined).status).toBe('pending');
  });
});

describe('issueConfirmation / applyConfirmation', () => {
  it('bumps the sequence, records the mail and signs a token that confirms the address', () => {
    const { cfg, token } = issueConfirmation(schedule({ confirmSeq: 4 }), 'anna', SECRET, NOW);
    expect(cfg).toMatchObject({ confirmSeq: 5, confirmSentAt: NOW, confirmMailsAt: [NOW] });
    const payload = verifyRecipientToken(token, SECRET, NOW)!;
    expect(payload).toMatchObject({ u: 'anna', e: 'friend@example.org', c: 5 });
    expect(payload.exp * 1000).toBe(Math.floor((NOW + RECIPIENT_CONFIRM_TTL_MS) / 1000) * 1000);

    const confirmed = applyConfirmation(cfg, payload, NOW + 1000);
    expect(confirmed).toMatchObject({ confirmedEmail: 'friend@example.org', confirmedAt: NOW + 1000 });
    expect(isRecipientConfirmed(confirmed, undefined)).toBe(true);
  });

  it('applying the newest link twice is harmless', () => {
    const { cfg, token } = issueConfirmation(schedule(), 'anna', SECRET, NOW);
    const payload = verifyRecipientToken(token, SECRET, NOW)!;
    const once = applyConfirmation(cfg, payload, NOW)!;
    expect(applyConfirmation(once, payload, NOW + 5)).toMatchObject({ confirmedEmail: 'friend@example.org' });
  });

  it('an older link dies as soon as a newer mail was issued', () => {
    const first = issueConfirmation(schedule(), 'anna', SECRET, NOW);
    const second = issueConfirmation(first.cfg, 'anna', SECRET, NOW + MIN_CONFIRM_INTERVAL_MS);
    expect(applyConfirmation(second.cfg, verifyRecipientToken(first.token, SECRET, NOW)!, NOW)).toBeNull();
    expect(applyConfirmation(second.cfg, verifyRecipientToken(second.token, SECRET, NOW)!, NOW)).not.toBeNull();
  });

  it('a link for a replaced address does not confirm the new one', () => {
    const { cfg, token } = issueConfirmation(schedule(), 'anna', SECRET, NOW);
    const payload = verifyRecipientToken(token, SECRET, NOW)!;
    expect(applyConfirmation({ ...cfg, toEmail: 'new@example.org' }, payload, NOW)).toBeNull();
  });

  it('refuses without a schedule or a recipient', () => {
    const payload = { exp: 1, u: 'anna', e: 'friend@example.org', c: 0 };
    expect(applyConfirmation(null, payload, NOW)).toBeNull();
    expect(applyConfirmation(schedule({ toEmail: '' }), payload, NOW)).toBeNull();
  });
});

describe('rate limits', () => {
  it('allows MAX_RECIPIENT_CHANGES_PER_DAY recipient changes per 24 h, then blocks until the oldest ages out', () => {
    const stamps = Array.from({ length: MAX_RECIPIENT_CHANGES_PER_DAY }, (_, i) => NOW - i * 1000);
    expect(checkChangeLimit(schedule({ recipientChangesAt: stamps.slice(1) }), NOW)).toBeNull();
    expect(checkChangeLimit(schedule({ recipientChangesAt: stamps }), NOW)).toBe('changes');
    const oldest = Math.min(...stamps);
    expect(checkChangeLimit(schedule({ recipientChangesAt: stamps }), oldest + DAY_MS)).toBeNull();
    expect(checkChangeLimit(null, NOW)).toBeNull();
  });

  it('spaces confirmation mails by MIN_CONFIRM_INTERVAL_MS', () => {
    const cfg = schedule({ confirmMailsAt: [NOW] });
    expect(checkMailLimit(cfg, NOW + MIN_CONFIRM_INTERVAL_MS - 1)).toBe('too-soon');
    expect(checkMailLimit(cfg, NOW + MIN_CONFIRM_INTERVAL_MS)).toBeNull();
    expect(checkMailLimit(schedule(), NOW)).toBeNull();
  });

  it('caps confirmation mails per account at MAX_CONFIRM_MAILS_PER_DAY in 24 h', () => {
    const stamps = Array.from({ length: MAX_CONFIRM_MAILS_PER_DAY }, (_, i) => NOW - (i + 1) * MIN_CONFIRM_INTERVAL_MS);
    expect(checkMailLimit(schedule({ confirmMailsAt: stamps }), NOW)).toBe('daily');
    expect(checkMailLimit(schedule({ confirmMailsAt: stamps }), Math.min(...stamps) + DAY_MS)).toBeNull();
  });

  it('recent() drops entries outside the window and from the future', () => {
    expect(recent([NOW - DAY_MS - 1, NOW - DAY_MS, NOW - 5, NOW + 5], NOW)).toEqual([NOW - 5]);
    expect(recent(undefined, NOW)).toEqual([]);
  });

  describe('AddressThrottle', () => {
    it('caps mails per address across callers and ignores case and whitespace', () => {
      const t = new AddressThrottle();
      for (let i = 0; i < MAX_CONFIRM_MAILS_PER_ADDRESS_PER_DAY; i += 1) {
        expect(t.allowed('Victim@Example.org', NOW + i)).toBe(true);
        t.record(i % 2 ? ' victim@example.org ' : 'VICTIM@example.org', NOW + i);
      }
      expect(t.allowed('victim@example.org', NOW + 10)).toBe(false);
      expect(t.allowed('someone-else@example.org', NOW + 10)).toBe(true);
      expect(t.allowed('victim@example.org', NOW + DAY_MS + 1)).toBe(true);
    });

    it('stays bounded: the least recently used address is forgotten first', () => {
      const t = new AddressThrottle(1, 3);
      for (const a of ['a@x.org', 'b@x.org', 'c@x.org', 'd@x.org']) t.record(a, NOW);
      expect(t.allowed('a@x.org', NOW)).toBe(true); // evicted
      expect(t.allowed('d@x.org', NOW)).toBe(false);
    });
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Anna@Example.ORG ')).toBe('anna@example.org');
  });
});
