import { describe, it, expect, vi, afterEach } from 'vitest';
import { accountRouteForHash, removeEmailWarning, removeEmailMessage, emailChangeNeedsPassword, saveAccountEmail, removeAccountEmail, deleteOwnAccount, resetPassword, changePassword, newPasswordProblem, freshTokens, emailSavedMessage } from './account';
import { ApiError } from './reauth';
import { serverSession } from './serverBase';

vi.mock('./serverBase', () => ({
  serverBase: () => 'https://server.example',
  serverSession: vi.fn(),
}));

describe('accountRouteForHash (#324 S18, S19)', () => {
  const token = 'a'.repeat(64);

  it('recognises the two links the server mails', () => {
    expect(accountRouteForHash(`#/passwort-neu?token=${token}`)).toEqual({ kind: 'reset', token });
    expect(accountRouteForHash(`#/email-bestaetigen?token=${token}`)).toEqual({ kind: 'verify', token });
  });

  it('still opens the page for a link with a missing token, so it can say so', () => {
    expect(accountRouteForHash('#/passwort-neu')).toEqual({ kind: 'reset', token: '' });
  });

  it('ignores every other hash', () => {
    for (const h of ['', '#', '#/impressum', '#/passwort', `#/passwort-neu-x?token=${token}`]) {
      expect(accountRouteForHash(h)).toBeNull();
    }
  });
});

/** #471: what the user is told before and after removing the account address. */
describe('removeEmailWarning / removeEmailMessage', () => {
  it('names the address, keeps username login and warns that there is no password reset any more', () => {
    const w = removeEmailWarning(' anna@example.org ', false);
    expect(w).toContain('anna@example.org');
    expect(w).toContain('Benutzername und Passwort');
    expect(w).toContain('nicht mehr zurücksetzen');
    expect(w).toContain('neu bestätigt');
    expect(w).not.toContain('Berichtsplan');
  });

  it('mentions the report schedule only when it mails this address', () => {
    expect(removeEmailWarning('anna@example.org', true)).toContain('Berichtsplan');
    expect(removeEmailMessage({ scheduleCleared: true })).toContain('pausiert');
    expect(removeEmailMessage({ scheduleCleared: false })).toBe('Adresse entfernt.');
  });
});

describe('emailChangeNeedsPassword (#475)', () => {
  it('asks for the password only when the typed address differs from the saved one', () => {
    expect(emailChangeNeedsPassword('new@example.org', 'old@example.org')).toBe(true);
    expect(emailChangeNeedsPassword('new@example.org', null)).toBe(true);
    expect(emailChangeNeedsPassword('  OLD@example.org ', 'old@example.org')).toBe(false);
    expect(emailChangeNeedsPassword('', 'old@example.org')).toBe(false);
    expect(emailChangeNeedsPassword('   ', null)).toBe(false);
  });
});

describe('saveAccountEmail (#475)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(serverSession).mockReset(); });

  it('sends the password with the address and reports whether a mail went out', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, verificationSent: true, token: 'new-jwt', refreshToken: 'new-refresh' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    // The change ended every other session; the fresh pair comes back for this one (#480).
    expect(await saveAccountEmail('new@example.org', { password: 'secret-pw' })).toEqual({
      verificationSent: true, verificationThrottled: false, tokens: { token: 'new-jwt', refreshToken: 'new-refresh' },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://server.example/api/auth/me');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'new@example.org', password: 'secret-pw' });
  });

  it('surfaces the server error for a wrong password', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Passwort falsch' }), { status: 403 })));
    await expect(saveAccountEmail('new@example.org', { password: 'nope' })).rejects.toThrow('Passwort falsch');
  });

  it('sends the 2FA code along and reports a missing one as totpRequired (#479)', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Bitte gib den Code ein', totpRequired: true }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const err = await saveAccountEmail('new@example.org', { password: 'pw', code: '123456' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).totpRequired).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: 'new@example.org', password: 'pw', code: '123456' });
  });

  it('shows the lockout text on 429 (#479)', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Zu viele Fehlversuche. Bitte versuche es in 15 Minuten erneut.', locked: true }), { status: 429 })));
    const err = await saveAccountEmail('new@example.org', { password: 'pw' }).catch((e: unknown) => e) as ApiError;
    expect(err.locked).toBe(true);
    expect(err.message).toMatch(/15 Minuten/);
  });
});

describe('re-auth bodies of the other account routes (#479)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(serverSession).mockReset(); });

  it('removeAccountEmail and deleteOwnAccount send password and code', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, scheduleCleared: false }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await removeAccountEmail({ password: 'pw', code: 'ABCDE-12345' });
    await deleteOwnAccount({ password: 'pw' });
    const bodies = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => [url, JSON.parse(init.body as string)]);
    expect(bodies).toEqual([
      ['https://server.example/api/auth/email/remove', { password: 'pw', code: 'ABCDE-12345' }],
      ['https://server.example/api/me/delete', { password: 'pw' }],
    ]);
  });
});

describe('fresh tokens after a sensitive change (#480)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(serverSession).mockReset(); });

  it('freshTokens reads the pair, and null when the answer carries none (an unchanged address)', () => {
    expect(freshTokens({ token: 'a', refreshToken: 'b' })).toEqual({ token: 'a', refreshToken: 'b' });
    expect(freshTokens({ token: 'a' })).toEqual({ token: 'a' });
    expect(freshTokens({ ok: true, verificationSent: false })).toBeNull();
    expect(freshTokens({ token: '' })).toBeNull();
  });

  it('removeAccountEmail hands back the fresh pair', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, scheduleCleared: false, token: 't2', refreshToken: 'r2' }), { status: 200 })));
    expect((await removeAccountEmail({ password: 'pw' })).tokens).toEqual({ token: 't2', refreshToken: 'r2' });
  });

  it('changePassword sends current password, code and new password, and returns the fresh pair', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, token: 't3', refreshToken: 'r3' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await changePassword({ password: 'old-password', code: '123456' }, 'new-password')).toEqual({ token: 't3', refreshToken: 'r3' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://server.example/api/auth/password/change');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'old-password', code: '123456', newPassword: 'new-password' });
  });

  it('changePassword surfaces 403 and 429 as the server words them', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Passwort falsch' }), { status: 403 })));
    await expect(changePassword({ password: 'x' }, 'new-password')).rejects.toThrow('Passwort falsch');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Zu viele Fehlversuche. Bitte versuche es in 15 Minuten erneut.', locked: true }), { status: 429 })));
    const err = await changePassword({ password: 'x' }, 'new-password').catch((e: unknown) => e) as ApiError;
    expect(err.locked).toBe(true);
  });
});

describe('emailSavedMessage (#483)', () => {
  it('says whether the link went out, or why not', () => {
    expect(emailSavedMessage({ verificationSent: true, verificationThrottled: false })).toMatch(/Link in der Mail/);
    expect(emailSavedMessage({ verificationSent: false, verificationThrottled: true })).toMatch(/zu viele Bestätigungsmails/);
    expect(emailSavedMessage({ verificationSent: false, verificationThrottled: false })).toBe('Gespeichert.');
  });

  it('saveAccountEmail reads the throttle flag', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, verificationSent: false, verificationThrottled: true, token: 't' }), { status: 200 })));
    expect(await saveAccountEmail('x@example.org', { password: 'pw' })).toMatchObject({ verificationSent: false, verificationThrottled: true });
    vi.unstubAllGlobals();
    vi.mocked(serverSession).mockReset();
  });
});

describe('newPasswordProblem (#480)', () => {
  it('checks length, the repeat and that it differs from the current one', () => {
    expect(newPasswordProblem('short', 'short', 'old-password')).toMatch(/8 Zeichen/);
    expect(newPasswordProblem('new-password', 'new-passw0rd', 'old-password')).toMatch(/nicht überein/);
    expect(newPasswordProblem('old-password', 'old-password', 'old-password')).toMatch(/unterscheiden/);
    expect(newPasswordProblem('new-password', 'new-password', 'old-password')).toBeNull();
  });
});

describe('resetPassword (#478)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('asks to remove every passkey only when chosen', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await resetPassword('t', 'new-password');
    await resetPassword('t', 'new-password', true);
    const bodies = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([, init]) => JSON.parse(init.body as string));
    expect(bodies).toEqual([{ token: 't', password: 'new-password' }, { token: 't', password: 'new-password', removePasskeys: true }]);
  });
});
