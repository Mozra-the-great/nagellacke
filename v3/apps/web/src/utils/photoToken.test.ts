import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SyncConfig } from '@nagellacke/sync';
import { saveSyncConfig } from '../useAppData';
import { APIKEY_STORAGE, markApiKeyRejected, setStoredApiKey } from './apiKey';
import { clearPhotoToken, ensurePhotoToken, hasPhotoToken, photoUrl } from './photoToken';

const SYNC_CONFIG_KEY = 'nagellacke_v3_sync';

// Same reason as photos.test.ts: this workspace's vitest runs in the default
// `node` environment, so localStorage has to be provided.
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

function tokenResponse(token: string): Response {
  return new Response(JSON.stringify({ token, expiresAt: Date.now() + 3_600_000 }), { status: 200 });
}

describe('photoToken', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMockStorage());
    vi.stubGlobal('window', { location: { origin: 'http://web.test' } });
    // Module state outlives a single test in all three modules involved.
    saveSyncConfig(null);
    setStoredApiKey(null);
    clearPhotoToken();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('drops a cached token once the API key it was minted from is rejected (#330)', async () => {
    localStorage.setItem(APIKEY_STORAGE, 'a-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse('minted-from-key')));

    await ensurePhotoToken();
    expect(hasPhotoToken()).toBe(true);
    expect(photoUrl('a.jpg')).toContain('t=minted-from-key');

    // The server signs a key-minted token with the API key itself, so the token
    // dies with the key - serving it for the rest of its hour-long TTL would
    // leave every <img> 401-ing even though the upload path has recovered.
    markApiKeyRejected('a-key');

    expect(hasPhotoToken()).toBe(false);
    expect(photoUrl('a.jpg')).not.toContain('t=');
  });

  it('drops a cached token when the stored key is replaced or cleared', async () => {
    localStorage.setItem(APIKEY_STORAGE, 'a-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse('minted-from-key')));

    await ensurePhotoToken();
    expect(hasPhotoToken()).toBe(true);

    setStoredApiKey('a-different-key');
    expect(hasPhotoToken()).toBe(false);
  });

  it('points photo URLs at the configured server in cross-origin mode', () => {
    const config: SyncConfig = { provider: 'server', serverUrl: 'https://api.example.test/', serverToken: 'valid' };
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));

    expect(photoUrl('a b.jpg')).toBe('https://api.example.test/photos/a%20b.jpg');
  });

  it('stays on a bare relative path for a same-origin install', () => {
    expect(photoUrl('a.jpg')).toBe('/photos/a.jpg');
  });
});
