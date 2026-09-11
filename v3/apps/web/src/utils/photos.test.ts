import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { SyncConfig } from '@nagellacke/sync';
import { saveSyncConfig } from '../useAppData';
import { uploadPhoto, AuthExpiredError, ApiKeyInvalidError } from './photos';
import { setStoredApiKey } from './apiKey';

const SYNC_CONFIG_KEY = 'nagellacke_v3_sync';
const API_KEY_KEY = 'nagellacke_v3_apikey';

// Minimal in-memory Storage polyfill - this workspace's vitest config runs in
// the default `node` environment (no jsdom), so `localStorage` isn't defined
// on globalThis otherwise.
function makeMockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}

/** Request headers of the nth fetch call, as a plain lookup. */
function headersOf(mock: Mock, n: number): Record<string, string> {
  return (mock.mock.calls[n][1] as RequestInit).headers as Record<string, string>;
}

function makeFile(): File {
  return new File(['x'], 'test.jpg', { type: 'image/jpeg' });
}

// vitest's default `node` environment has no FileReader - this mirrors just
// enough of the readAsDataURL contract for fileToBase64() in photos.ts.
class MockFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;
  readAsDataURL(file: File) {
    void file.arrayBuffer().then((buf) => {
      this.result = `data:${file.type};base64,${Buffer.from(buf).toString('base64')}`;
      this.onload?.();
    });
  }
}

describe('uploadPhoto', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMockStorage());
    vi.stubGlobal('FileReader', MockFileReader);
    // Both modules keep credentials in module state, which outlives a single
    // test - reset them so cases reusing the same key/token values stay
    // independent of whatever ran before them.
    saveSyncConfig(null);
    setStoredApiKey(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws AuthExpiredError when a 401 persists after a failed refresh attempt', async () => {
    const config: SyncConfig = { provider: 'server', serverToken: 'stale', serverRefreshToken: 'also-stale' };
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));

    const fetchMock = vi.fn()
      // 1) initial upload attempt -> 401
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      // 2) POST /api/auth/refresh -> also fails
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      // 3) retried upload -> still 401 (authedFetch bails before this if refresh failed)
      .mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadPhoto(makeFile())).rejects.toBeInstanceOf(AuthExpiredError);
    await expect(uploadPhoto(makeFile())).rejects.toThrow('Sitzung abgelaufen — bitte in den Einstellungen neu anmelden');
  });

  it('succeeds after a transparent refresh when the retry comes back ok', async () => {
    const config: SyncConfig = { provider: 'server', serverToken: 'stale', serverRefreshToken: 'still-valid' };
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'fresh', refreshToken: 'fresh-refresh' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ filename: 'abc.jpg' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadPhoto(makeFile())).resolves.toBe('abc.jpg');
  });

  it('names the API key as the problem when a keyed 401 has no session to fall back on', async () => {
    localStorage.setItem(API_KEY_KEY, 'rotated-away');

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    // A key cannot expire and cannot be refreshed, so "session expired" would be
    // actively misleading here - the key is what has to go (#330).
    await expect(uploadPhoto(makeFile())).rejects.toBeInstanceOf(ApiKeyInvalidError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the server session when the stored API key is stale (#330)', async () => {
    localStorage.setItem(API_KEY_KEY, 'rotated-away');
    const config: SyncConfig = { provider: 'server', serverToken: 'valid', serverRefreshToken: 'valid-refresh' };
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));

    const fetchMock = vi.fn()
      // 1) keyed attempt -> the server rejects the key outright
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      // 2) same request, retried on the JWT
      .mockResolvedValueOnce(new Response(JSON.stringify({ filename: 'abc.jpg' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadPhoto(makeFile())).resolves.toBe('abc.jpg');
    expect(headersOf(fetchMock, 0)['X-Api-Key']).toBe('rotated-away');
    expect(headersOf(fetchMock, 1).Authorization).toBe('Bearer valid');
  });

  it('stops sending a key the server already rejected', async () => {
    localStorage.setItem(API_KEY_KEY, 'rotated-away');
    const config: SyncConfig = { provider: 'server', serverToken: 'valid', serverRefreshToken: 'valid-refresh' };
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      // A fresh Response per call - a body can only be read once.
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ filename: 'abc.jpg' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadPhoto(makeFile())).resolves.toBe('abc.jpg');
    await expect(uploadPhoto(makeFile())).resolves.toBe('abc.jpg');

    // Three calls, not four: the second upload goes straight to the JWT instead
    // of burning another round trip on the dead key.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(headersOf(fetchMock, 2)['X-Api-Key']).toBeUndefined();
    expect(headersOf(fetchMock, 2).Authorization).toBe('Bearer valid');
  });

  it('targets the configured server in cross-origin mode instead of the web origin', async () => {
    const config: SyncConfig = { provider: 'server', serverUrl: 'https://api.example.test/', serverToken: 'valid' };
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ filename: 'abc.jpg' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadPhoto(makeFile())).resolves.toBe('abc.jpg');
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.test/api/photos');
  });
});
