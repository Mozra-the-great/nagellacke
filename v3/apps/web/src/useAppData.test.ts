import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AppData, Polish } from '@nagellacke/core';
import { mergeImport, loadLocal, STORAGE_KEY } from './useAppData';

function emptyAppData(): AppData {
  return { polishes: [], customCats: [], manicures: [], stickers: [] };
}

// Minimal in-memory Storage polyfill — this workspace's vitest config runs in
// the default `node` environment (no jsdom), so `localStorage` isn't defined
// on globalThis otherwise. Only the handful of methods loadLocal() actually
// calls are implemented.
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

describe('loadLocal', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeMockStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns empty data with no error when nothing was ever stored', () => {
    const { data, corrupted } = loadLocal();
    expect(corrupted).toBe(false);
    expect(data).toEqual(emptyAppData());
  });

  it('flags corruption instead of silently returning an empty collection when a polishes entry is malformed', () => {
    // hasLegacyFinish() throws on a non-object array element (e.g. `null`) —
    // this used to be swallowed by loadLocal()'s catch with no signal at all
    // that anything went wrong (#258).
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ polishes: [null, null], customCats: [], manicures: [], stickers: [] }));

    const { data, corrupted } = loadLocal();

    expect(corrupted).toBe(true);
    expect(data).toEqual(emptyAppData());
  });

  it('does not flag corruption for a normal, valid stored collection', () => {
    const stored: AppData = { ...emptyAppData(), polishes: [{
      id: 'p1', name: 'X', brand: 'Y', num: '1', color: '#fff', finish: ['Classic'],
      status: 'ok', createdAt: 1, updatedAt: 1,
    }] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { data, corrupted } = loadLocal();

    expect(corrupted).toBe(false);
    expect(data.polishes).toHaveLength(1);
  });
});

describe('mergeImport', () => {
  it('normalizes a legacy bare-string finish from an imported backup into an array', () => {
    // Simulates a backup exported before the finish migration, where `finish`
    // was a single string rather than an array. SettingsPage's import path
    // only checks `Array.isArray(imported.polishes)`, never the shape of each
    // polish's `finish`, so this exact payload can reach `importMerge()`.
    const legacyPolish = {
      id: 'p1',
      name: 'Test Polish',
      brand: 'Test Brand',
      num: '001',
      color: '#ff00ff',
      finish: 'Shimmer',
      status: 'ok',
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Polish;

    const imported: AppData = { ...emptyAppData(), polishes: [legacyPolish] };

    const result = mergeImport(emptyAppData(), imported);

    expect(Array.isArray(result.polishes[0].finish)).toBe(true);
    expect(result.polishes[0].finish).toEqual(['Shimmer']);
  });

  it('leaves already array-shaped finishes untouched', () => {
    const polish: Polish = {
      id: 'p2',
      name: 'Another Polish',
      brand: 'Brand',
      num: '002',
      color: '#00ff00',
      finish: ['Glitter', 'Top Coat'],
      status: 'ok',
      createdAt: 1,
      updatedAt: 1,
    };

    const imported: AppData = { ...emptyAppData(), polishes: [polish] };

    const result = mergeImport(emptyAppData(), imported);

    expect(result.polishes[0].finish).toEqual(['Glitter', 'Top Coat']);
  });
});
