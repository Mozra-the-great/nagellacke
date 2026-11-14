import type { Polish, Sticker, Manicure, Category, FilterState, AppData } from './types';
import { hexToHue, normalizeFinish } from './utils';

/**
 * Case-folds a field for substring matching, tolerating a missing value.
 *
 * `name`/`brand`/`num` are typed as required, but a v2 import, an AI autofill or a
 * corrupted sync can still leave them undefined at runtime — the same class of bad
 * record #218 already guards against elsewhere. In the search chain below that was
 * not merely a wrong result but a crash: the `||` chain short-circuits, so a query
 * matching `name` never evaluated `num`, while a query that matched nothing earlier
 * — a *number*, typically — reached `p.num.toLowerCase()` and threw a TypeError that
 * took the whole collection view down (#284).
 */
function lc(value: string | undefined | null): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

export function filterPolishes(polishes: Polish[], f: FilterState): Polish[] {
  return polishes.filter((p) => {
    if (p.deletedAt) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.finish && !p.finish?.includes(f.finish)) return false;
    if (f.brand && p.brand !== f.brand) return false;
    if (f.category && !p.categories?.includes(f.category)) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      return (
        lc(p.name).includes(q) ||
        lc(p.brand).includes(q) ||
        lc(p.num).includes(q) ||
        (p.finish ?? []).some((fn) => lc(fn).includes(q)) ||
        lc(p.notes).includes(q)
      );
    }
    return true;
  });
}

export function sortPolishes(polishes: Polish[], sort: FilterState['sort']): Polish[] {
  // Same missing-field tolerance as filterPolishes: sorting runs on the very same
  // records, so a name/brand that is undefined at runtime would throw here instead
  // (#284). An entry without the sort key just sorts as if it were empty.
  return [...polishes].sort((a, b) => {
    switch (sort) {
      case 'newest':  return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      case 'oldest':  return (a.createdAt ?? 0) - (b.createdAt ?? 0);
      case 'name':    return lc(a.name).localeCompare(lc(b.name));
      case 'brand':   return lc(a.brand).localeCompare(lc(b.brand));
      case 'hue':     return hexToHue(a.color) - hexToHue(b.color);
      case 'rating':  return (b.rating ?? 0) - (a.rating ?? 0);
      default:        return 0;
    }
  });
}

export function filterStickers(stickers: Sticker[], search: string): Sticker[] {
  if (!search) return stickers.filter((s) => !s.deletedAt);
  const q = search.toLowerCase();
  // `name` is required on the type but can be missing on an imported record, and a
  // sticker search hits the same crash as #284 does for polishes.
  return stickers.filter(
    (s) =>
      !s.deletedAt &&
      (lc(s.name).includes(q) || lc(s.brand).includes(q) || lc(s.style).includes(q)),
  );
}

export function filterManicures(manicures: Manicure[]): Manicure[] {
  return manicures.filter((m) => !m.deletedAt);
}

export function activeCategories(cats: Category[]): Category[] {
  return cats.filter((c) => !c.deletedAt);
}

// Merge two AppData objects: last updatedAt wins per item.
// Items with deletedAt are kept (soft-delete) so other devices can remove them.
//
// `finish` is normalized on the way out. mergeData is the single choke point every
// path that mixes in foreign data goes through — the web sync flow, the server's
// POST /api/sync and /api/sync/push (which merge a raw request body and persist the
// result), and all four file-based cloud adapters (which merge a remote JSON that may
// predate the FinishType -> FinishType[] migration and upload the result back). A
// legacy bare-string `finish` winning last-write-wins would otherwise be persisted
// and then crash consumers that call `finish.map`/`finish.some` on it.
export function mergeData(local: AppData, remote: AppData): AppData {
  return {
    polishes:    mergeList(local.polishes, remote.polishes).map((p) => ({ ...p, finish: normalizeFinish(p.finish) })),
    customCats:  mergeList(local.customCats, remote.customCats),
    manicures:   mergeList(local.manicures, remote.manicures),
    stickers:    mergeList(local.stickers, remote.stickers),
  };
}

function mergeList<T extends { id: string; updatedAt: number }>(
  local: T[] | null | undefined,
  remote: T[] | null | undefined,
): T[] {
  const map = new Map<string, T>();
  for (const item of (local ?? [])) map.set(item.id, item);
  for (const item of (remote ?? [])) {
    const existing = map.get(item.id);
    if (!existing || item.updatedAt > existing.updatedAt) {
      map.set(item.id, item);
    }
  }
  return Array.from(map.values());
}

// ── Deletion markers (tombstones) ────────────────────────────────────────────

/**
 * How long an entry that was deleted (`deletedAt` set) is kept so that other devices can
 * still learn about the deletion (#464, decision F101.5). The number is also stated in the
 * privacy policy (sections 3 and 8) - change both together.
 */
export const TOMBSTONE_RETENTION_DAYS = 90;
export const TOMBSTONE_RETENTION_MS = TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Whether `item` is a deletion marker old enough to be removed for good: it carries a
 * `deletedAt` that is at least TOMBSTONE_RETENTION_DAYS before `now`. Day 89 is kept,
 * day 90 on is dropped. A missing, non-numeric or future `deletedAt` (clock skew) never
 * expires, so a malformed record is never removed by this rule.
 */
export function isExpiredTombstone(
  item: { deletedAt?: unknown } | null | undefined,
  now: number = Date.now(),
): boolean {
  const at = item?.deletedAt;
  return typeof at === 'number' && Number.isFinite(at) && at > 0 && now - at >= TOMBSTONE_RETENTION_MS;
}

function dropExpired<T>(list: T[] | null | undefined, now: number): T[] | null | undefined {
  if (!Array.isArray(list)) return list;
  const kept = list.filter((item) => !isExpiredTombstone(item as { deletedAt?: unknown }, now));
  // Same array back when nothing expired, so callers can tell "unchanged" by reference.
  return kept.length === list.length ? list : kept;
}

/**
 * Removes every expired deletion marker (see isExpiredTombstone) from all four
 * collections. A separate step on purpose, not part of mergeData(): the merge decides
 * which side wins and must keep a tombstone so a sync can carry the deletion to the
 * other device; the purge is applied after it, wherever a collection is stored or
 * loaded (server write, server start, web local copy).
 *
 * Returns the very same object when nothing expired. Fields it does not know about are
 * left alone. Idempotent.
 *
 * Known limit: a device that was offline for longer than the retention and still holds
 * the entry as *alive* uploads it again on its next sync - the deletion comes back,
 * because the tombstone that would have beaten it is gone everywhere.
 */
export function purgeExpiredTombstones<T extends Partial<AppData>>(data: T, now: number = Date.now()): T {
  const polishes = dropExpired(data.polishes, now);
  const customCats = dropExpired(data.customCats, now);
  const manicures = dropExpired(data.manicures, now);
  const stickers = dropExpired(data.stickers, now);
  if (
    polishes === data.polishes && customCats === data.customCats &&
    manicures === data.manicures && stickers === data.stickers
  ) return data;
  return { ...data, polishes, customCats, manicures, stickers };
}
