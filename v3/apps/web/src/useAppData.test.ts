import { describe, it, expect } from 'vitest';
import type { AppData, Polish } from '@nagellacke/core';
import { mergeImport } from './useAppData';

function emptyAppData(): AppData {
  return { polishes: [], customCats: [], manicures: [], stickers: [] };
}

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
