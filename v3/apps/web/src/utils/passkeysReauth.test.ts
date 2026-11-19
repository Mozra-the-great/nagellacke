import { describe, it, expect, vi, afterEach } from 'vitest';
import { addPasskey, removePasskey } from './passkeys';
import { ApiError } from './reauth';
import { serverSession } from './serverBase';

vi.mock('./serverBase', () => ({
  serverBase: () => 'https://server.example',
  serverSession: vi.fn(),
}));

/** #478: adding and removing a passkey carry the re-auth fields; refusals keep their shape. */
describe('passkey re-auth (#478)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.mocked(serverSession).mockReset(); });

  it('removePasskey sends password and code as a JSON body', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await removePasskey('a/b', { password: 'pw', code: '123456' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://server.example/api/auth/passkeys/a%2Fb');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'pw', code: '123456' });
  });

  it('addPasskey asks for the challenge with the password and stops on a refusal, before the browser prompt', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Ungültiger Code', totpRequired: true }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const create = vi.fn();
    vi.stubGlobal('navigator', { credentials: { create } });
    const err = await addPasskey('Handy', { password: 'pw', code: '000000' }).catch((e: unknown) => e) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.totpRequired).toBe(true);
    expect(create).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://server.example/api/auth/passkeys/register/options');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'pw', code: '000000' });
  });

  it('a lockout reads as the server says', async () => {
    vi.mocked(serverSession).mockReturnValue({ base: 'https://server.example', token: 'jwt' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Zu viele Fehlversuche. Bitte versuche es in 3 Minuten erneut.', locked: true }), { status: 429 })));
    await expect(removePasskey('x', { password: 'pw' })).rejects.toThrow(/3 Minuten/);
  });
});
