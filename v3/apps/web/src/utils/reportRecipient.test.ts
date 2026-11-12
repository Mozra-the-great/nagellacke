import { describe, it, expect } from 'vitest';
import { confirmationMessage, recipientNotice, sendTargetLabel, sendTargetsNotice, pickSendTarget } from './reportRecipient';
import type { SendTarget } from './reportRecipient';
import { accountRouteForHash } from './account';

/** #449: what the settings page tells the user about the report recipient's confirmation. */
describe('recipientNotice', () => {
  it('says nothing without a saved recipient and an empty field', () => {
    expect(recipientNotice(null, '', '', null)).toBeNull();
    expect(recipientNotice({ status: 'none' }, '', '  ', true)).toBeNull();
  });

  it('warns that a new address will have to be confirmed', () => {
    const n = recipientNotice({ status: 'none' }, '', 'friend@example.org', true)!;
    expect(n.tone).toBe('info');
    expect(n.text).toContain('Bestätigungsmail');
    expect(n.canResend).toBe(false);
  });

  it('shows a pending recipient as "no report until confirmed" and offers a resend', () => {
    const n = recipientNotice({ status: 'pending', confirmationSentAt: 1 }, 'friend@example.org', 'friend@example.org', true)!;
    expect(n.tone).toBe('warn');
    expect(n.text).toContain('Noch nicht bestätigt');
    expect(n.text).toContain('friend@example.org');
    expect(n.text).toContain('kein Bericht');
    expect(n.canResend).toBe(true);
  });

  it('says when the confirmation mail has not gone out yet', () => {
    const n = recipientNotice({ status: 'pending' }, 'friend@example.org', 'friend@example.org', true)!;
    expect(n.text).toContain('noch nicht gesendet');
    expect(n.canResend).toBe(true);
  });

  it('shows a confirmed recipient, and says why', () => {
    const link = recipientNotice({ status: 'confirmed', via: 'link' }, 'a@x.org', 'a@x.org', true)!;
    expect(link).toMatchObject({ tone: 'ok', canResend: false });
    expect(link.text).toContain('Link');
    const account = recipientNotice({ status: 'confirmed', via: 'account' }, 'a@x.org', 'a@x.org', true)!;
    expect(account.text).toContain('verifizierte Adresse deines Kontos');
  });

  it('treats an edited address as a change that needs confirmation, whatever the saved state, but ignores case', () => {
    const changed = recipientNotice({ status: 'confirmed', via: 'link' }, 'a@x.org', 'b@x.org', true)!;
    expect(changed.tone).toBe('info');
    expect(changed.text).toContain('neu bestätigt');
    expect(changed.canResend).toBe(false);
    expect(recipientNotice({ status: 'confirmed', via: 'link' }, 'a@x.org', ' A@X.org ', true)!.tone).toBe('ok');
  });

  it('explains when the server cannot send the confirmation mail at all', () => {
    const n = recipientNotice({ status: 'pending' }, 'a@x.org', 'a@x.org', false)!;
    expect(n.tone).toBe('warn');
    expect(n.text).toContain('keine Bestätigungsmail senden');
    expect(n.canResend).toBe(false);
  });

  it('says the account\'s own verified address needs no confirmation', () => {
    const n = recipientNotice(null, '', 'Me@Example.org', true, 'me@example.org')!;
    expect(n).toMatchObject({ tone: 'ok', canResend: false });
    expect(n.text).toContain('braucht keine Bestätigung');
    // ... but only for that address, and only when it is verified (the caller passes '' otherwise).
    expect(recipientNotice(null, '', 'other@example.org', true, 'me@example.org')!.tone).toBe('info');
    expect(recipientNotice(null, '', 'me@example.org', true, '')!.tone).toBe('info');
  });
});

describe('confirmationMessage', () => {
  it('reports each outcome of a save', () => {
    expect(confirmationMessage('sent', ' friend@example.org ')).toMatchObject({ tone: 'ok' });
    expect(confirmationMessage('sent', 'friend@example.org')!.text).toContain('friend@example.org');
    expect(confirmationMessage('unavailable', 'a@x.org')).toMatchObject({ tone: 'warn' });
    expect(confirmationMessage('failed', 'a@x.org')!.text).toContain('erneut anfordern');
  });

  it('is silent when nothing needs saying', () => {
    expect(confirmationMessage('not-needed', 'a@x.org')).toBeNull();
    expect(confirmationMessage('pending', 'a@x.org')).toBeNull();
    expect(confirmationMessage(undefined, 'a@x.org')).toBeNull();
  });
});

describe('the confirmation link route', () => {
  it('opens the recipient page with the signed token from the fragment', () => {
    const token = 'eyJleHAiOjF9.c2ln-_x';
    expect(accountRouteForHash(`#/bericht-bestaetigen?token=${token}`)).toEqual({ kind: 'recipient', token });
  });

  it('still opens the page for a link without a token, and ignores near misses', () => {
    expect(accountRouteForHash('#/bericht-bestaetigen')).toEqual({ kind: 'recipient', token: '' });
    expect(accountRouteForHash('#/bericht-bestaetigen-x?token=a')).toBeNull();
  });
});

/** #456: which addresses "Jetzt per E-Mail senden" offers, and what it says when there are none. */
describe('send targets', () => {
  const own: SendTarget = { email: 'anna@example.org', kind: 'account' };
  const friend: SendTarget = { email: 'friend@example.org', kind: 'recipient' };

  it('labels each target by why it is allowed', () => {
    expect(sendTargetLabel(own)).toContain('Konto-Adresse');
    expect(sendTargetLabel(friend)).toContain('bestätigter Empfänger');
    expect(sendTargetLabel(friend)).toContain('friend@example.org');
  });

  it('keeps a still-allowed choice, otherwise falls back to the first target or nothing', () => {
    expect(pickSendTarget([own, friend], 'FRIEND@example.org')).toBe('friend@example.org');
    expect(pickSendTarget([own, friend], 'gone@example.org')).toBe('anna@example.org');
    expect(pickSendTarget([], 'anna@example.org')).toBe('');
  });

  it('says nothing until the list is loaded', () => {
    expect(sendTargetsNotice(null, '', null, null, '')).toBeNull();
  });

  it('explains an empty list: unverified own address, pending recipient', () => {
    const n = sendTargetsNotice([], 'anna@example.org', false, { status: 'pending' }, 'friend@example.org')!;
    expect(n.tone).toBe('warn');
    expect(n.text).toContain('nur an eine Adresse');
    expect(n.text).toContain('anna@example.org ist noch nicht verifiziert');
    expect(n.text).toContain('friend@example.org ist noch nicht bestätigt');
  });

  it('explains an empty list without any address on the account', () => {
    const n = sendTargetsNotice([], '', null, { status: 'none' }, '')!;
    expect(n.text).toContain('keine E-Mail-Adresse hinterlegt');
  });

  it('with targets it only informs, and still points to the schedule for other addresses', () => {
    const n = sendTargetsNotice([own], 'anna@example.org', true, { status: 'none' }, '')!;
    expect(n.tone).toBe('info');
    expect(n.text).toContain('Zeitplan');
    expect(n.text).not.toContain('nicht verifiziert');
  });
});
