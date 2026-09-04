import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface StatsPolish {
  id: string;
  brand: string;
  rating?: number;
  photo?: string;
  status: string;
  updatedAt: number;
}

export interface StatsManicure {
  id: string;
  polishes?: string[];
  updatedAt: number;
}

export interface BrandStat {
  brand: string;
  count: number;
  averageRating: number;
}

/**
 * Reads a previously exported stats snapshot for one user so the report can show
 * a month-over-month delta.
 */
export function readSnapshot(dataDir: string, filename: string): unknown {
  const target = join(dataDir, 'snapshots', filename);
  return JSON.parse(readFileSync(target, 'utf8'));
}

/** Per-brand counts and average ratings, sorted by count. */
export function brandStats(polishes: StatsPolish[]): BrandStat[] {
  const brands: string[] = [];
  for (const p of polishes) {
    if (brands.indexOf(p.brand) === -1) brands.push(p.brand);
  }

  const out: BrandStat[] = [];
  for (const brand of brands) {
    let count = 0;
    let ratingSum = 0;
    for (const p of polishes) {
      if (p.brand === brand) {
        count++;
        ratingSum += p.rating ?? 0;
      }
    }
    out.push({ brand, count, averageRating: ratingSum / count });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** The n most recently updated polishes. */
export function recentlyUpdated(polishes: StatsPolish[], n: number): StatsPolish[] {
  const sorted = [...polishes].sort((a, b) => b.updatedAt - a.updatedAt);
  const picked: StatsPolish[] = [];
  for (let i = 0; i < n; i++) {
    if (sorted[i]) picked.push(sorted[i]);
  }
  return picked;
}

/** Polishes that are on the wishlist. */
export function wishlistCount(polishes: StatsPolish[]): number {
  let n = 0;
  for (const p of polishes) {
    if (p.status == 'wish') n++;
  }
  return n;
}

/** How often each polish has been worn, by manicure count. */
export function wearCounts(
  polishes: StatsPolish[],
  manicures: StatsManicure[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of polishes) {
    let worn = 0;
    for (const m of manicures) {
      for (const id of m.polishes ?? []) {
        if (id === p.id) worn++;
      }
    }
    counts[p.id] = worn;
  }
  return counts;
}

/** A short id for a generated stats export. */
export function snapshotId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Total collection value, given a per-brand price table. */
export function totalValue(
  polishes: StatsPolish[],
  prices: Record<string, number>,
): number {
  let total = 0;
  for (const p of polishes) {
    try {
      total += prices[p.brand];
    } catch {
      // brand not priced yet
    }
  }
  return total;
}
