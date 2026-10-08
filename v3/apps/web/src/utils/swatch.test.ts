import { describe, it, expect } from 'vitest';
import type { FinishType } from '@nagellacke/core';
import { swatchStyle, swatchLabel } from './swatch';

const SPECKS = 'rgba(255,255,255,0.55) 0 1px';

describe('swatchStyle', () => {
  it('uses the polish colour as the base', () => {
    expect(swatchStyle('#cc0000', ['Classic']).backgroundColor).toBe('#cc0000');
  });

  it('falls back to a neutral gray for a missing or invalid colour', () => {
    expect(swatchStyle('', ['Classic']).backgroundColor).toBe('#888888');
    expect(swatchStyle(undefined as unknown as string, ['Classic']).backgroundColor).toBe('#888888');
    expect(swatchStyle('red; background: url(x)', ['Classic']).backgroundColor).toBe('#888888');
  });

  it('adds one highlight to a plain finish and none to matte', () => {
    expect(swatchStyle('#cc0000', ['Classic']).backgroundImage).toContain('radial-gradient');
    expect(swatchStyle('#cc0000', ['Matte']).backgroundImage).toBe('none');
  });

  it('gives shimmer and glitter fine specks, but not a plain finish', () => {
    expect(swatchStyle('#cc0000', ['Glitter']).backgroundImage).toContain(SPECKS);
    expect(swatchStyle('#cc0000', ['Shimmer']).backgroundImage).toContain(SPECKS);
    expect(swatchStyle('#cc0000', ['Classic']).backgroundImage).not.toContain(SPECKS);
  });

  it('adds a sheen to metals only', () => {
    for (const f of ['Metallic', 'Chrome', 'Holographic'] as FinishType[]) {
      expect(swatchStyle('#cc0000', [f]).backgroundImage).toContain('linear-gradient');
    }
    expect(swatchStyle('#cc0000', ['Shimmer']).backgroundImage).not.toContain('linear-gradient');
  });

  it('keeps one background-size entry per image layer', () => {
    for (const f of [['Classic'], ['Satin'], ['Glitter'], ['Chrome', 'Glitter']] as FinishType[][]) {
      const s = swatchStyle('#cc0000', f);
      const layers = s.backgroundImage.split(/,\s*(?=radial-gradient|linear-gradient)/).length;
      expect(s.backgroundSize.split(', ').length).toBe(layers);
    }
  });

  it('survives a legacy bare-string finish (#218)', () => {
    expect(() => swatchStyle('#cc0000', 'Shimmer' as unknown as FinishType[])).not.toThrow();
  });
});

describe('swatchLabel', () => {
  it('names brand first, then the polish, in the order the tile shows them', () => {
    expect(swatchLabel({ name: 'Ruby', brand: 'OPI', status: 'ok' })).toBe('OPI, Ruby');
  });

  it('adds rating, count and status when present', () => {
    expect(swatchLabel({ name: 'Ruby', brand: 'OPI', rating: 4, count: 2, status: 'wish' }))
      .toBe('OPI, Ruby, Wunschliste, 2×, 4 von 5 Sternen');
  });

  it('omits an empty brand and a count of one', () => {
    expect(swatchLabel({ name: 'Ruby', brand: '', count: 1, status: 'empty' })).toBe('Ruby, Leer');
  });

  it('survives a record without a name (#218)', () => {
    expect(swatchLabel({ name: undefined as unknown as string, brand: '', status: 'ok' })).toBe('Unbenannt');
  });
});
