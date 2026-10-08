import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  COLLECTION_VIEW_KEY, loadCollectionView, parseCollectionView, saveCollectionView,
} from './collectionView';

// Same in-memory Storage stand-in useAppData.test.ts uses: this workspace runs vitest in
// the plain node environment, so localStorage does not exist unless stubbed.
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

describe('parseCollectionView', () => {
  it('accepts the two known views', () => {
    expect(parseCollectionView('grid')).toBe('grid');
    expect(parseCollectionView('cards')).toBe('cards');
  });

  it('defaults to the original card view for anything else', () => {
    for (const raw of [null, undefined, '', 'GRID', 'list', '1']) {
      expect(parseCollectionView(raw)).toBe('cards');
    }
  });
});

describe('load/saveCollectionView', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeMockStorage()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('defaults to cards when nothing was ever chosen', () => {
    expect(loadCollectionView()).toBe('cards');
  });

  it('remembers the choice', () => {
    saveCollectionView('grid');
    expect(localStorage.getItem(COLLECTION_VIEW_KEY)).toBe('grid');
    expect(loadCollectionView()).toBe('grid');
    saveCollectionView('cards');
    expect(loadCollectionView()).toBe('cards');
  });

  it('does not throw when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(loadCollectionView()).toBe('cards');
    expect(() => saveCollectionView('grid')).not.toThrow();
  });
});
