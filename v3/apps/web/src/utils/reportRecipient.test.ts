import { describe, it, expect, vi, afterEach } from 'vitest';
import { confirmationMessage, recipientNotice, sendTargetLabel, sendTargetsNotice, pickSendTarget, unsubscribeNotice, unsubscribeFromReports } from './reportRecipient';
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

/** #457: the unsubscribe link in a report mail, its page, and what the owner is told. */
describe('unsubscribe (#457)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('knows the unsubscribe route and keeps the token', () => {
    expect(accountRouteForHash('#/bericht-abbestellen?token=a.b')).toEqual({ kind: 'unsubscribe', token: 'a.b' });
    expect(accountRouteForHash('#/bericht-abbestellen')).toEqual({ kind: 'unsubscribe', token: '' });
    expect(accountRouteForHash('#/bericht-abbestellen-x?token=a')).toBeNull();
  });

  it('tells the owner a third party opted out, and that the address will not be asked again', () => {
    const n = unsubscribeNotice({ status: 'pending', unsubscribedAt: Date.UTC(2026, 10, 16), blocked: true }, 'friend@example.org')!;
    expect(n.tone).toBe('warn');
    expect(n.text).toContain('pausiert');
    expect(n.text).toContain('friend@example.org');
    expect(n.text).toContain('abbestellt');
    expect(n.text).toContain('nicht noch einmal angeschrieben');
  });

  it('tells the owner their own address was paused and can be switched back on', () => {
    const n = unsubscribeNotice({ status: 'confirmed', via: 'account', unsubscribedAt: Date.UTC(2026, 10, 16) }, 'anna@example.org')!;
    expect(n.text).toContain('anna@example.org');
    expect(n.text).toContain('Schalte den Zeitplan wieder ein');
  });

  it('says nothing without an unsubscribe or without a saved address', () => {
    expect(unsubscribeNotice(null, 'a@example.org')).toBeNull();
    expect(unsubscribeNotice({ status: 'pending' }, 'a@example.org')).toBeNull();
    expect(unsubscribeNotice({ status: 'pending', unsubscribedAt: 1 }, '')).toBeNull();
  });

  it('a blocked recipient is shown as such and offers no resend', () => {
    const n = recipientNotice({ status: 'pending', blocked: true, confirmationSentAt: 1 }, 'friend@example.org', 'friend@example.org', true)!;
    expect(n.tone).toBe('warn');
    expect(n.text).toContain('abbestellt');
    expect(n.canResend).toBe(false);
    // Typing another address goes back to the normal "must be confirmed" hint.
    const other = recipientNotice({ status: 'pending', blocked: true }, 'friend@example.org', 'other@example.org', true)!;
    expect(other.text).toContain('neu bestätigt');
  });

  it('posts the token as JSON and returns the address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, email: 'friend@example.org' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(unsubscribeFromReports('tok.sig', 'https://app.example')).resolves.toBe('friend@example.org');
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe('https://app.example/api/reports/unsubscribe');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 'tok.sig' });
  });

  it('surfaces the server message for a bad link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Der Link ist ungültig.' }) }));
    await expect(unsubscribeFromReports('x', 'https://app.example')).rejects.toThrow('Der Link ist ungültig.');
  });
});
