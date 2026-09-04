import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mergeData } from './logic';
import type { AppData } from './types';

// The other half of this suite is
// android/app/src/test/java/de/nagellacke/domain/MergeFixturesTest.kt, which feeds the
// same files to the Kotlin port of mergeData. Neither implementation owns the fixtures;
// see fixtures/merge/README.md for the format and for why `expected` is a projection.
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures/merge');

interface Fixture {
  name: string;
  description: string;
  local: Partial<AppData>;
  remote: Partial<AppData>;
  expected: {
    polishes: unknown[];
    customCats: unknown[];
    manicures: unknown[];
    stickers: unknown[];
  };
}

// `deletedAt` is emitted as an explicit null when absent so that "live record" and
// "field missing" cannot be confused across the two languages.
const orNull = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

function project(merged: AppData) {
  return {
    polishes: merged.polishes.map((p) => ({
      id: p.id, name: p.name, updatedAt: p.updatedAt, deletedAt: orNull(p.deletedAt), finish: p.finish,
    })),
    customCats: merged.customCats.map((c) => ({
      id: c.id, label: c.label, updatedAt: c.updatedAt, deletedAt: orNull(c.deletedAt),
    })),
    manicures: merged.manicures.map((m) => ({
      id: m.id, date: m.date, updatedAt: m.updatedAt, deletedAt: orNull(m.deletedAt),
    })),
    stickers: merged.stickers.map((s) => ({
      id: s.id, name: s.name, updatedAt: s.updatedAt, deletedAt: orNull(s.deletedAt),
    })),
  };
}

const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();

describe('mergeData shared fixtures', () => {
  // A missing or empty directory would otherwise turn this whole suite into a silent
  // no-op — the exact failure mode the fixtures exist to prevent.
  it('finds the shared fixture directory', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture;

    it(`${fixture.name}: ${fixture.description}`, () => {
      // Cast rather than validate: the fixtures deliberately carry pre-migration shapes
      // (a bare-string `finish`) that do not satisfy AppData, because that is precisely
      // what real sync payloads can contain and what mergeData has to survive.
      const merged = mergeData(fixture.local as AppData, fixture.remote as AppData);
      expect(project(merged)).toEqual(fixture.expected);
    });
  }
});
