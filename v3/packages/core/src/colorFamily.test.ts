import { describe, it, expect } from 'vitest';
import { colorFamily, colorLightness, groupByColorFamily, hexToHsl, COLOR_FAMILIES } from './colorFamily';
import type { FinishType, Polish } from './types';

const polish = (overrides: Partial<Polish> = {}): Polish => ({
  id: 'p1', name: 'Test', brand: 'OPI', num: '', color: '#ff0000',
  finish: ['Classic'], status: 'ok', createdAt: 1, updatedAt: 1,
  ...overrides,
});

describe('hexToHsl', () => {
  it('converts the primaries', () => {
    expect(hexToHsl('#ff0000')).toEqual({ h: 0, s: 1, l: 0.5 });
    expect(hexToHsl('#00ff00')?.h).toBe(120);
    expect(hexToHsl('#0000ff')?.h).toBe(240);
  });

  it('treats grays as saturation 0', () => {
    expect(hexToHsl('#808080')).toMatchObject({ h: 0, s: 0 });
    expect(hexToHsl('#ffffff')).toEqual({ h: 0, s: 0, l: 1 });
  });

  it('rejects anything that is not #rrggbb', () => {
    for (const bad of ['', 'red', '#fff', '#12345g', 'ff0000', undefined, null, 42]) {
      expect(hexToHsl(bad as unknown as string)).toBeNull();
    }
  });
});

describe('colorFamily', () => {
  const cases: [string, string, ReturnType<typeof colorFamily>][] = [
    ['classic red', '#cc0000', 'red'],
    ['wine', '#722f37', 'red'],
    ['salmon', '#fa8072', 'red'],
    ['baby pink (light red hue)', '#f4c2c2', 'pink'],
    ['hot pink', '#ff1493', 'pink'],
    ['dusty rose', '#c48b9f', 'pink'],
    ['coral', '#ff7f50', 'orange'],
    ['peach', '#ffcba4', 'orange'],
    ['mustard yellow', '#e1ad01', 'yellow'],
    ['lemon', '#fff44f', 'yellow'],
    ['olive-ish green', '#556b2f', 'green'],
    ['mint', '#98ff98', 'green'],
    ['teal counts as blue', '#008080', 'blue'],
    ['navy', '#1b2a6b', 'blue'],
    ['lavender', '#b57edc', 'purple'],
    ['plum (dark magenta)', '#4b1a3f', 'purple'],
    ['chocolate', '#5c3317', 'brown'],
    ['dull tan-orange', '#a0785a', 'brown'],
    ['beige nude', '#e8c8b0', 'nude'],
    ['rosy nude', '#e8c4c0', 'nude'],
    ['off white', '#fdfcf7', 'nude'],
    ['pure white', '#ffffff', 'nude'],
    ['light gray', '#d9d9d9', 'nude'],
    ['mid gray', '#808080', 'gray'],
    ['black', '#000000', 'gray'],
    ['near black with a hue', '#14101c', 'gray'],
  ];

  it.each(cases)('%s %s -> %s', (_label, hex, family) => {
    expect(colorFamily(hex)).toBe(family);
  });

  it('puts a missing or invalid colour with the grays, like the bottle fallback', () => {
    expect(colorFamily('')).toBe('gray');
    expect(colorFamily('nonsense')).toBe('gray');
    expect(colorFamily(undefined as unknown as string)).toBe('gray');
  });

  it('moves metallic, chrome, glitter and holographic finishes into "special"', () => {
    for (const f of ['Metallic', 'Chrome', 'Glitter', 'Holographic'] as FinishType[]) {
      expect(colorFamily('#cc0000', [f])).toBe('special');
    }
    expect(colorFamily('#cc0000', ['Classic', 'Glitter'])).toBe('special');
  });

  it('keeps other shimmer-ish finishes in their hue bucket', () => {
    for (const f of ['Shimmer', 'Duochrome', 'Magnetic', 'Matte', 'Jelly', 'Top Coat'] as FinishType[]) {
      expect(colorFamily('#cc0000', [f])).toBe('red');
    }
  });

  it('tolerates a legacy bare-string finish and a missing finish (#218)', () => {
    expect(colorFamily('#cc0000', 'Glitter')).toBe('special');
    expect(colorFamily('#cc0000', 'Classic')).toBe('red');
    expect(colorFamily('#cc0000', undefined)).toBe('red');
    expect(colorFamily('#cc0000', null)).toBe('red');
  });

  it('maps every hue to a known family, with no gaps at the boundaries', () => {
    const known = new Set(COLOR_FAMILIES.map((f) => f.id));
    for (let h = 0; h < 360; h += 1) {
      for (const [s, l] of [[1, 0.5], [0.6, 0.4], [0.3, 0.7], [0.9, 0.85]]) {
        // Build the hex from HSL so the sweep walks the real conversion path.
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = l - c / 2;
        const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
          : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
        const hex = '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
        expect(known.has(colorFamily(hex))).toBe(true);
      }
    }
  });
});

describe('colorLightness', () => {
  it('orders white above red above black', () => {
    expect(colorLightness('#ffffff')).toBeGreaterThan(colorLightness('#ff0000'));
    expect(colorLightness('#ff0000')).toBeGreaterThan(colorLightness('#000000'));
  });

  it('uses the fallback gray for an invalid colour', () => {
    expect(colorLightness('bogus')).toBeCloseTo(colorLightness('#888888'));
  });
});

describe('groupByColorFamily', () => {
  it('returns no groups for no polishes', () => {
    expect(groupByColorFamily([])).toEqual([]);
  });

  it('orders groups like COLOR_FAMILIES and omits empty ones', () => {
    const groups = groupByColorFamily([
      polish({ id: 'a', color: '#0000cc' }),
      polish({ id: 'b', color: '#cc0000' }),
      polish({ id: 'c', color: '#cc0000', finish: ['Glitter'] }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['red', 'blue', 'special']);
    expect(groups.map((g) => g.label)).toEqual(['Rottöne', 'Blautöne', 'Metallic & Glitzer']);
  });

  it('sorts a group light to dark, then by name, then by id', () => {
    const [group] = groupByColorFamily([
      polish({ id: '1', name: 'Dark', color: '#660000' }),
      polish({ id: '2', name: 'Bright', color: '#ff6666' }),
      polish({ id: '4', name: 'Same', color: '#cc0000' }),
      polish({ id: '3', name: 'Same', color: '#cc0000' }),
      polish({ id: '5', name: 'Alpha', color: '#cc0000' }),
    ]);
    expect(group.items.map((p) => p.id)).toEqual(['2', '5', '3', '4', '1']);
  });

  it('keeps every polish exactly once, even with a missing name or colour', () => {
    const input = [
      polish({ id: 'x', name: undefined as unknown as string, color: undefined as unknown as string }),
      polish({ id: 'y', color: '#00cc00' }),
      polish({ id: 'z', color: '#ffffff' }),
    ];
    const groups = groupByColorFamily(input);
    expect(groups.flatMap((g) => g.items).map((p) => p.id).sort()).toEqual(['x', 'y', 'z']);
  });

  it('does not mutate its input', () => {
    const input = [polish({ id: '1', color: '#660000' }), polish({ id: '2', color: '#ff6666' })];
    groupByColorFamily(input);
    expect(input.map((p) => p.id)).toEqual(['1', '2']);
  });
});
