import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SyncConfig } from '@nagellacke/sync';
import { uploadPhoto, AuthExpiredError } from './photos';

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

  it('does not throw AuthExpiredError for a 401 while using an API key (never expires, so a different failure)', async () => {
    localStorage.setItem(API_KEY_KEY, 'some-key');

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadPhoto(makeFile())).rejects.toThrow('Upload fehlgeschlagen (401)');
  });
});
