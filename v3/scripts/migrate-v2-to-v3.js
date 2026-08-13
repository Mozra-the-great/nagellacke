#!/usr/bin/env node
/**
 * Migrate v2 data.json → v3 format
 *
 * Usage:
 *   node migrate-v2-to-v3.js /opt/nagellacke/backend/data/data.json > v3-data.json
 *
 * What changes:
 *   - polishes: adds UUID id (if missing), ensures updatedAt/createdAt
 *   - manicures: ensures UUID id, adds updatedAt
 *   - stickers: ensures UUID id, adds updatedAt
 *   - customCats: ensures UUID id, adds updatedAt
 *   - manicure.photos (v2 had single photo string) → photos array
 *   - polish.finish (v2 had a single finish string) → non-empty finish array
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

// Kept in sync with FINISH_OPTIONS in @nagellacke/core's constants.ts. This script is
// standalone (plain node, no workspace build step), so the list is duplicated here
// rather than imported.
const FINISH_VALUES = new Set([
  'Classic', 'Shimmer', 'Glitter', 'Metallic', 'Chrome', 'Matte', 'Satin', 'Duochrome',
  'Holographic', 'Jelly', 'Neon', 'Magnetic', 'Gel Look', 'Top Coat', 'Base Coat',
]);

// Mirrors normalizeFinish() in @nagellacke/core: v2 stored a single finish string,
// v3 stores a non-empty array of valid finishes.
function normalizeFinish(value) {
  if (Array.isArray(value)) {
    const filtered = [...new Set(value.filter((v) => typeof v === 'string' && FINISH_VALUES.has(v)))];
    return filtered.length > 0 ? filtered : ['Classic'];
  }
  if (typeof value === 'string' && FINISH_VALUES.has(value)) return [value];
  return ['Classic'];
}

function uuid() {
  return crypto.randomUUID();
}

function ts(val) {
  if (typeof val === 'number' && val > 0) return val;
  return Date.now();
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node migrate-v2-to-v3.js <path-to-data.json>');
  process.exit(1);
}

const raw = fs.readFileSync(inputPath, 'utf-8');
const v2 = JSON.parse(raw);

const v3 = {
  polishes: (v2.polishes ?? []).map((p) => ({
    id: p.id ?? uuid(),
    name: p.name ?? '',
    brand: p.brand ?? '',
    num: p.num ?? '',
    color: p.color ?? '#ff6699',
    finish: normalizeFinish(p.finish),
    status: p.status ?? 'ok',
    ...(p.count != null    ? { count: p.count }           : {}),
    ...(p.categories?.length ? { categories: p.categories } : {}),
    ...(p.notes            ? { notes: p.notes }            : {}),
    ...(p.rating           ? { rating: p.rating }          : {}),
    ...(p.photo            ? { photo: p.photo }            : {}),
    createdAt: ts(p.createdAt),
    updatedAt: ts(p.updatedAt ?? p.createdAt),
  })),

  customCats: (v2.customCats ?? []).map((c) => ({
    id: c.id ?? uuid(),
    label: c.label ?? '',
    updatedAt: ts(c.updatedAt),
  })),

  manicures: (v2.manicures ?? []).map((m) => {
    // v2 stored a single photo string; v3 stores an array
    const photos = m.photos
      ? (Array.isArray(m.photos) ? m.photos : [m.photos])
      : m.photo
        ? [m.photo]
        : [];
    return {
      id: m.id ?? uuid(),
      date: m.date ?? new Date().toISOString().slice(0, 10),
      polishes: m.polishes ?? [],
      ...(m.notes     ? { notes: m.notes }   : {}),
      ...(photos.length ? { photos }          : {}),
      createdAt: ts(m.createdAt),
      updatedAt: ts(m.updatedAt ?? m.createdAt),
    };
  }),

  stickers: (v2.stickers ?? []).map((s) => ({
    id: s.id ?? uuid(),
    name: s.name ?? '',
    ...(s.brand  ? { brand: s.brand }   : {}),
    ...(s.style  ? { style: s.style }   : {}),
    type: s.type ?? 'accent',
    ...(s.colors?.length ? { colors: s.colors } : {}),
    status: s.status ?? 'ok',
    ...(s.rating ? { rating: s.rating } : {}),
    ...(s.notes  ? { notes: s.notes }   : {}),
    ...(s.photo  ? { photo: s.photo }   : {}),
    createdAt: ts(s.createdAt),
    updatedAt: ts(s.updatedAt ?? s.createdAt),
  })),
};

process.stdout.write(JSON.stringify(v3, null, 2) + '\n');

// Print summary to stderr so it doesn't pollute the JSON output
const counts = {
  polishes: v3.polishes.length,
  categories: v3.customCats.length,
  manicures: v3.manicures.length,
  stickers: v3.stickers.length,
};
console.error(`Migration complete: ${JSON.stringify(counts)}`);
