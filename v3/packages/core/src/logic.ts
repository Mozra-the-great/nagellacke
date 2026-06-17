import type { Polish, Sticker, Manicure, Category, FilterState, AppData } from './types';
import { hexToHue } from './utils';

export function filterPolishes(polishes: Polish[], f: FilterState): Polish[] {
  return polishes.filter((p) => {
    if (p.deletedAt) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.finish && p.finish !== f.finish) return false;
    if (f.brand && p.brand !== f.brand) return false;
    if (f.category && !p.categories?.includes(f.category)) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.num.toLowerCase().includes(q) ||
        p.finish.toLowerCase().includes(q) ||
        (p.notes ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });
}

export function sortPolishes(polishes: Polish[], sort: FilterState['sort']): Polish[] {
  return [...polishes].sort((a, b) => {
    switch (sort) {
      case 'newest':  return b.createdAt - a.createdAt;
      case 'oldest':  return a.createdAt - b.createdAt;
      case 'name':    return a.name.localeCompare(b.name);
      case 'brand':   return a.brand.localeCompare(b.brand);
      case 'hue':     return hexToHue(a.color) - hexToHue(b.color);
      case 'rating':  return (b.rating ?? 0) - (a.rating ?? 0);
      default:        return 0;
    }
  });
}

export function filterStickers(stickers: Sticker[], search: string): Sticker[] {
  if (!search) return stickers.filter((s) => !s.deletedAt);
  const q = search.toLowerCase();
  return stickers.filter(
    (s) =>
      !s.deletedAt &&
      (s.name.toLowerCase().includes(q) ||
        (s.brand ?? '').toLowerCase().includes(q) ||
        (s.style ?? '').toLowerCase().includes(q)),
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
export function mergeData(local: AppData, remote: AppData): AppData {
  return {
    polishes:    mergeList(local.polishes, remote.polishes),
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
