import { describe, it, expect, vi, afterEach } from 'vitest';
import { accountRouteForHash, removeEmailWarning, removeEmailMessage, emailChangeNeedsPassword, saveAccountEmail, removeAccountEmail, deleteOwnAccount, resetPassword } from './account';
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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, verificationSent: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await saveAccountEmail('new@example.org', { password: 'secret-pw' })).toBe(true);
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
