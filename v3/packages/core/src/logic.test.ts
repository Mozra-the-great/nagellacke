import { describe, it, expect } from 'vitest';
import { mergeData, filterPolishes, sortPolishes } from './logic';
import type { AppData, Polish } from './types';

const emptyData = (): AppData => ({
  polishes: [], customCats: [], manicures: [], stickers: [],
});

const polish = (overrides: Partial<Polish> = {}): Polish => ({
  id: 'p1', name: 'Blue', brand: 'OPI', num: '001', color: '#0000ff',
  finish: 'Classic', status: 'ok', createdAt: 1000, updatedAt: 1000,
  ...overrides,
});

describe('mergeData', () => {
  it('keeps remote item when remote is newer', () => {
    const local = { ...emptyData(), polishes: [polish({ updatedAt: 1000 })] };
    const remote = { ...emptyData(), polishes: [polish({ name: 'Blue Updated', updatedAt: 2000 })] };
    const merged = mergeData(local, remote);
    expect(merged.polishes[0].name).toBe('Blue Updated');
  });

  it('keeps local item when local is newer', () => {
    const local = { ...emptyData(), polishes: [polish({ name: 'Blue Local', updatedAt: 3000 })] };
    const remote = { ...emptyData(), polishes: [polish({ updatedAt: 1000 })] };
    const merged = mergeData(local, remote);
    expect(merged.polishes[0].name).toBe('Blue Local');
  });

  it('adds new items from remote that do not exist locally', () => {
    const local = { ...emptyData(), polishes: [polish({ id: 'p1' })] };
    const remote = { ...emptyData(), polishes: [polish({ id: 'p2', name: 'Red' })] };
    const merged = mergeData(local, remote);
    expect(merged.polishes).toHaveLength(2);
  });

  it('preserves soft-deleted items', () => {
    const local = { ...emptyData(), polishes: [polish({ deletedAt: 9999 })] };
    const merged = mergeData(local, emptyData());
    expect(merged.polishes[0].deletedAt).toBe(9999);
  });
});

describe('filterPolishes', () => {
  const polishes = [
    polish({ id: 'p1', name: 'Blue Sky', brand: 'OPI', status: 'ok', finish: 'Classic' }),
    polish({ id: 'p2', name: 'Red Rose', brand: 'Catrice', status: 'wish', finish: 'Shimmer' }),
    polish({ id: 'p3', name: 'Green Leaf', brand: 'OPI', status: 'ok', finish: 'Classic', deletedAt: 1 }),
  ];
  const base = { search: '', finish: '' as const, category: '', status: '' as const, brand: '', sort: 'newest' as const };

  it('excludes deleted items', () => {
    const result = filterPolishes(polishes, base);
    expect(result).toHaveLength(2);
  });

  it('filters by search', () => {
    const result = filterPolishes(polishes, { ...base, search: 'blue' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });

  it('filters by status', () => {
    const result = filterPolishes(polishes, { ...base, status: 'wish' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p2');
  });
});

describe('sortPolishes', () => {
  const polishes = [
    polish({ id: 'p1', name: 'Banana', createdAt: 200, updatedAt: 200, rating: 3 }),
    polish({ id: 'p2', name: 'Apple',  createdAt: 100, updatedAt: 100, rating: 5 }),
    polish({ id: 'p3', name: 'Cherry', createdAt: 300, updatedAt: 300, rating: 1 }),
  ];

  it('sorts by newest first', () => {
    const sorted = sortPolishes(polishes, 'newest');
    expect(sorted.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
  });

  it('sorts by name', () => {
    const sorted = sortPolishes(polishes, 'name');
    expect(sorted.map((p) => p.name)).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('sorts by rating descending', () => {
    const sorted = sortPolishes(polishes, 'rating');
    expect(sorted.map((p) => p.rating)).toEqual([5, 3, 1]);
  });
});
