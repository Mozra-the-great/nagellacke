import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * #324 S7: the web app asks the server what it offers. Every failure has to mean
 * "behave as before" (null), so an older server or a static host never loses a
 * feature, and a malformed answer never hides one the server did not switch off.
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

async function freshModule() {
  vi.resetModules();
  return import('./instance');
}

describe('fetchInstanceConfig (#324)', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeMockStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('reads the flags from the configured server', async () => {
    localStorage.setItem('nagellacke_v3_sync', JSON.stringify({ provider: 'server', serverUrl: 'https://srv.example/' }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ publicInstance: true, photoUploads: false, ai: false, branding: { name: 'X' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchInstanceConfig } = await freshModule();

    const cfg = await fetchInstanceConfig();
    expect(fetchMock.mock.calls[0][0]).toBe('https://srv.example/api/instance-config');
    expect(cfg).toMatchObject({ publicInstance: true, photoUploads: false, ai: false, branding: { name: 'X' } });
  });

  it('asks its own origin when no server is configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchInstanceConfig } = await freshModule();
    await fetchInstanceConfig();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/instance-config');
  });

  it('returns null on a 404 from an older server and on a network error', async () => {
    const { fetchInstanceConfig } = await freshModule();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }));
    expect(await fetchInstanceConfig()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchInstanceConfig()).toBeNull();
  });

  it('never hides a feature on a malformed answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ai: 'no', photoUploads: 0, publicInstance: 'yes' }) }));
    const { fetchInstanceConfig, aiOffered, photoUploadsOffered } = await freshModule();
    const cfg = await fetchInstanceConfig();
    expect(cfg).toMatchObject({ ai: true, photoUploads: true, publicInstance: false });
    expect(aiOffered(null)).toBe(true);
    expect(photoUploadsOffered(null)).toBe(true);
  });
});
