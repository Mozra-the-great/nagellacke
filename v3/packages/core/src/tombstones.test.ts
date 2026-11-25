import { describe, it, expect } from 'vitest';
import {
  mergeData, purgeExpiredTombstones, isExpiredTombstone, TOMBSTONE_RETENTION_DAYS, TOMBSTONE_RETENTION_MS,
} from './logic';
import type { AppData, Polish } from './types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const emptyData = (): AppData => ({ polishes: [], customCats: [], manicures: [], stickers: [] });
const polish = (overrides: Partial<Polish> = {}): Polish => ({
  id: 'p1', name: 'Blue', brand: 'OPI', num: '001', color: '#0000ff',
  finish: ['Classic'], status: 'ok', createdAt: 1000, updatedAt: 1000,
  ...overrides,
});
const cat = (id: string, deletedAt?: number) => ({
  id, label: id, updatedAt: 1, ...(deletedAt === undefined ? {} : { deletedAt }),
});

describe('deletion marker purge (#464)', () => {
  it('keeps the retention at 90 days', () => {
    expect(TOMBSTONE_RETENTION_DAYS).toBe(90);
    expect(TOMBSTONE_RETENTION_MS).toBe(90 * DAY);
  });

  it('keeps a marker at day 89 and drops it from day 90 on', () => {
    expect(isExpiredTombstone({ deletedAt: NOW - 89 * DAY }, NOW)).toBe(false);
    expect(isExpiredTombstone({ deletedAt: NOW - 90 * DAY + 1 }, NOW)).toBe(false);
    expect(isExpiredTombstone({ deletedAt: NOW - 90 * DAY }, NOW)).toBe(true);
    expect(isExpiredTombstone({ deletedAt: NOW - 400 * DAY }, NOW)).toBe(true);
  });

  it('never expires live, malformed or future-dated entries', () => {
    expect(isExpiredTombstone({}, NOW)).toBe(false);
    expect(isExpiredTombstone({ deletedAt: undefined }, NOW)).toBe(false);
    expect(isExpiredTombstone({ deletedAt: 0 }, NOW)).toBe(false);
    expect(isExpiredTombstone({ deletedAt: '1' }, NOW)).toBe(false);
    expect(isExpiredTombstone({ deletedAt: Number.NaN }, NOW)).toBe(false);
    expect(isExpiredTombstone({ deletedAt: NOW + DAY }, NOW)).toBe(false);
    expect(isExpiredTombstone(null, NOW)).toBe(false);
  });

  it('purges polishes, stickers, manicures and categories', () => {
    const old = NOW - 100 * DAY;
    const fresh = NOW - 10 * DAY;
    const data: AppData = {
      polishes: [polish({ id: 'old', deletedAt: old }), polish({ id: 'fresh', deletedAt: fresh }), polish({ id: 'live' })],
      customCats: [cat('old', old), cat('fresh', fresh), cat('live')],
      manicures: [
        { id: 'old', date: '2026-01-01', createdAt: 1, updatedAt: 1, deletedAt: old },
        { id: 'fresh', date: '2026-01-01', createdAt: 1, updatedAt: 1, deletedAt: fresh },
        { id: 'live', date: '2026-01-01', createdAt: 1, updatedAt: 1 },
      ],
      stickers: [
        { id: 'old', name: 'S', type: 'accent', status: 'ok', createdAt: 1, updatedAt: 1, deletedAt: old },
        { id: 'fresh', name: 'S', type: 'accent', status: 'ok', createdAt: 1, updatedAt: 1, deletedAt: fresh },
        { id: 'live', name: 'S', type: 'accent', status: 'ok', createdAt: 1, updatedAt: 1 },
      ],
    };
    const out = purgeExpiredTombstones(data, NOW);
    expect(out.polishes.map((p) => p.id)).toEqual(['fresh', 'live']);
    expect(out.customCats.map((c) => c.id)).toEqual(['fresh', 'live']);
    expect(out.manicures.map((m) => m.id)).toEqual(['fresh', 'live']);
    expect(out.stickers.map((s) => s.id)).toEqual(['fresh', 'live']);
    expect(data.polishes).toHaveLength(3); // input untouched
  });

  it('returns the same object when nothing expired, and is idempotent', () => {
    const data: AppData = { ...emptyData(), polishes: [polish({ deletedAt: NOW - DAY }), polish({ id: 'p2' })] };
    expect(purgeExpiredTombstones(data, NOW)).toBe(data);
    const aged = { ...emptyData(), polishes: [polish({ deletedAt: NOW - 91 * DAY })] };
    const once = purgeExpiredTombstones(aged, NOW);
    expect(once.polishes).toEqual([]);
    expect(purgeExpiredTombstones(once, NOW)).toBe(once);
  });

  it.each(['polishes', 'customCats', 'manicures', 'stickers'] as const)(
    'purges when only %s holds an expired marker, and leaves the other collections alone',
    (key) => {
      const old = NOW - 100 * DAY;
      const base: AppData = {
        polishes: [polish({ id: 'p-live' })],
        customCats: [cat('c-live')],
        manicures: [{ id: 'm-live', date: '2026-01-01', createdAt: 1, updatedAt: 1 }],
        stickers: [{ id: 's-live', name: 'S', type: 'accent', status: 'ok', createdAt: 1, updatedAt: 1 }],
      };
      const expiredEntry = {
        polishes: polish({ id: 'p-old', deletedAt: old }),
        customCats: cat('c-old', old),
        manicures: { id: 'm-old', date: '2026-01-01', createdAt: 1, updatedAt: 1, deletedAt: old },
        stickers: { id: 's-old', name: 'S', type: 'accent', status: 'ok', createdAt: 1, updatedAt: 1, deletedAt: old },
      }[key];
      const data = { ...base, [key]: [...base[key], expiredEntry] } as AppData;

      const out = purgeExpiredTombstones(data, NOW);

      expect(out).not.toBe(data);
      expect(out[key]).toEqual(base[key]);
      for (const other of (['polishes', 'customCats', 'manicures', 'stickers'] as const).filter((k) => k !== key)) {
        expect(out[other]).toBe(data[other]); // untouched collections are passed through by reference
      }
    },
  );

  it('tolerates missing collections and keeps unknown fields', () => {
    const raw = { polishes: [polish({ deletedAt: NOW - 91 * DAY })], extra: 'kept' } as unknown as AppData;
    const out = purgeExpiredTombstones(raw, NOW) as AppData & { extra: string };
    expect(out.polishes).toEqual([]);
    expect(out.extra).toBe('kept');
    expect(out.manicures).toBeUndefined();
  });

  it('is not part of mergeData: an ancient tombstone still survives a merge', () => {
    // The shared fixtures rely on this (deletedAt 9999), and a sync must keep carrying a
    // deletion to the other device; the purge runs afterwards, where data is stored.
    const local = { ...emptyData(), polishes: [polish({ deletedAt: 9999 })] };
    expect(mergeData(local, emptyData()).polishes).toHaveLength(1);
    expect(purgeExpiredTombstones(mergeData(local, emptyData()), NOW).polishes).toHaveLength(0);
  });

  it('does not bring a purged marker back when two devices that both dropped it sync', () => {
    const a = purgeExpiredTombstones({ ...emptyData(), polishes: [polish({ deletedAt: NOW - 95 * DAY })] }, NOW);
    const b = purgeExpiredTombstones({ ...emptyData(), polishes: [polish({ deletedAt: NOW - 95 * DAY })] }, NOW);
    expect(purgeExpiredTombstones(mergeData(a, b), NOW).polishes).toEqual([]);
  });

  it('documented limit: a device still holding the entry alive re-uploads it', () => {
    const server = purgeExpiredTombstones({ ...emptyData(), polishes: [polish({ deletedAt: NOW - 95 * DAY, updatedAt: 5 })] }, NOW);
    const staleDevice = { ...emptyData(), polishes: [polish({ updatedAt: 1 })] };
    expect(purgeExpiredTombstones(mergeData(server, staleDevice), NOW).polishes.map((p) => p.id)).toEqual(['p1']);
  });
});
