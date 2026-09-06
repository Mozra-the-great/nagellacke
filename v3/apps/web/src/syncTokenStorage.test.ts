import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SyncConfig } from '@nagellacke/sync';

const SYNC_CONFIG_KEY = 'nagellacke_v3_sync';

/**
 * #299: both sync JWTs were persisted to localStorage, so an XSS anywhere in the SPA
 * could lift a refresh token good for 30 days — and because a refresh token silently
 * re-mints access tokens, the shorter access TTL bounded nothing at all.
 *
 * These tests assert the property directly: what lands on disk. The server half (the
 * httpOnly cookie that keeps the session alive across a reload instead) is covered by
 * server/src/refreshCookie.test.ts.
 */
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

const CONFIG: SyncConfig = {
  provider: 'server',
  serverUrl: 'https://nagellacke.example',
  serverToken: 'access-token-value',
  serverRefreshToken: 'refresh-token-value',
};

/** The raw JSON as it actually sits in localStorage. */
function persisted(): Record<string, unknown> {
  const raw = localStorage.getItem(SYNC_CONFIG_KEY);
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

// Module state holds the tokens for the tab, so each test needs a fresh module graph.
async function freshModule() {
  vi.resetModules();
  return import('./useAppData');
}

describe('sync token storage (#299)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMockStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('never writes either JWT to localStorage', async () => {
    const { saveSyncConfig } = await freshModule();

    saveSyncConfig(CONFIG);

    const stored = persisted();
    expect(stored).not.toHaveProperty('serverToken');
    expect(stored).not.toHaveProperty('serverRefreshToken');
    // Belt and braces: neither value appears anywhere in the serialised blob.
    expect(localStorage.getItem(SYNC_CONFIG_KEY)).not.toContain('access-token-value');
    expect(localStorage.getItem(SYNC_CONFIG_KEY)).not.toContain('refresh-token-value');
  });

  it('still persists the non-secret parts, so the server stays configured', async () => {
    const { saveSyncConfig } = await freshModule();

    saveSyncConfig(CONFIG);

    const stored = persisted();
    expect(stored.provider).toBe('server');
    expect(stored.serverUrl).toBe('https://nagellacke.example');
  });

  it('serves the tokens back within the same tab', async () => {
    const { saveSyncConfig, loadSyncConfig } = await freshModule();

    saveSyncConfig(CONFIG);

    // Not persisted is not the same as not usable — the session has to keep working
    // for the life of the tab without a round trip per request.
    expect(loadSyncConfig()?.serverToken).toBe('access-token-value');
    expect(loadSyncConfig()?.serverRefreshToken).toBe('refresh-token-value');
  });

  it('loses the tokens when the module state does, which is the point', async () => {
    const { saveSyncConfig } = await freshModule();
    saveSyncConfig(CONFIG);

    // A fresh module graph stands in for a page reload.
    const { loadSyncConfig } = await freshModule();

    expect(loadSyncConfig()?.serverToken).toBeUndefined();
    expect(loadSyncConfig()?.serverUrl).toBe('https://nagellacke.example');
  });

  /**
   * Anyone upgrading has tokens sitting in localStorage from before this change.
   * Reading them once keeps them logged in; the same read must also scrub them, or
   * the credential this issue is about would simply stay on disk forever.
   */
  it('adopts and then scrubs tokens left behind by an older version', async () => {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(CONFIG));
    const { loadSyncConfig } = await freshModule();

    expect(loadSyncConfig()?.serverToken).toBe('access-token-value');

    const stored = persisted();
    expect(stored).not.toHaveProperty('serverToken');
    expect(stored).not.toHaveProperty('serverRefreshToken');
  });

  it('clears the in-memory tokens on disconnect', async () => {
    const { saveSyncConfig, loadSyncConfig } = await freshModule();
    saveSyncConfig(CONFIG);

    saveSyncConfig(null);

    expect(loadSyncConfig()).toBeNull();
    expect(localStorage.getItem(SYNC_CONFIG_KEY)).toBeNull();
  });

  it('restoreSession trades the cookie for an access token, sending credentials', async () => {
    const { saveSyncConfig, restoreSession, loadSyncConfig } = await freshModule();
    // A reload leaves the config but no token.
    saveSyncConfig({ provider: 'server', serverUrl: 'https://nagellacke.example' } as SyncConfig);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'renewed-access-token' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(restoreSession()).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://nagellacke.example/api/auth/refresh');
    // Without this the httpOnly cookie is simply not attached and the reload logs out.
    expect(init.credentials).toBe('include');
    expect(loadSyncConfig()?.serverToken).toBe('renewed-access-token');
  });

  it('restoreSession reports failure when there is no usable cookie', async () => {
    const { saveSyncConfig, restoreSession } = await freshModule();
    saveSyncConfig({ provider: 'server', serverUrl: 'https://nagellacke.example' } as SyncConfig);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    await expect(restoreSession()).resolves.toBe(false);
  });

  it('restoreSession does not persist the renewed token either', async () => {
    const { saveSyncConfig, restoreSession } = await freshModule();
    saveSyncConfig({ provider: 'server', serverUrl: 'https://nagellacke.example' } as SyncConfig);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'renewed-access-token' }),
    }));

    await restoreSession();

    expect(localStorage.getItem(SYNC_CONFIG_KEY)).not.toContain('renewed-access-token');
  });
});
