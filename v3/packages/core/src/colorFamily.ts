import type { FinishType, Polish } from './types';

/**
 * Colour-family bucketing for the collection's swatch grid (#328).
 *
 * A polish only stores a hex colour and a list of finishes, so the family it is shown
 * under is derived, never stored. Rules, applied top to bottom — the first match wins
 * (HSL: hue 0-360, saturation and lightness 0-1):
 *
 *  1. special   a Metallic, Chrome, Glitter or Holographic finish (see SPECIAL_FINISHES).
 *               Their stored colour is mostly a guess at what is really a sparkle effect,
 *               so these are not forced into a hue bucket.
 *  2. gray      lightness <= 0.10 (near black), or saturation < 0.10 and lightness < 0.75
 *               — and also any colour that is missing or not a valid #rrggbb, matching the
 *               #888888 the bottle falls back to.
 *  3. nude      lightness >= 0.93, or saturation < 0.10 (lightness >= 0.75), or a warm hue
 *               (345-50) with saturation < 0.50 and lightness >= 0.60, or saturation < 0.65
 *               and lightness >= 0.75 — white, cream, beige, skin tones.
 *  4. brown     hue 10-50 with lightness < 0.42, or saturation < 0.55 and lightness < 0.60.
 *  5. hue       red 345-15 (lightness >= 0.72 counts as pink), orange 15-45, yellow 45-70,
 *               green 70-165, blue 165-255 (teal and turquoise included), purple 255-300,
 *               pink 300-345 (lightness < 0.30 counts as purple: plum, aubergine).
 */
export type ColorFamilyId =
  | 'red' | 'pink' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple'
  | 'brown' | 'nude' | 'gray' | 'special';

/** Display order of the groups (a rainbow, then neutrals, then sparkle). */
export const COLOR_FAMILIES: { id: ColorFamilyId; label: string }[] = [
  { id: 'red',     label: 'Rottöne' },
  { id: 'pink',    label: 'Rosatöne' },
  { id: 'orange',  label: 'Orangetöne' },
  { id: 'yellow',  label: 'Gelbtöne' },
  { id: 'green',   label: 'Grüntöne' },
  { id: 'blue',    label: 'Blautöne' },
  { id: 'purple',  label: 'Lilatöne' },
  { id: 'brown',   label: 'Brauntöne' },
  { id: 'nude',    label: 'Weiß & Nude' },
  { id: 'gray',    label: 'Grau & Schwarz' },
  { id: 'special', label: 'Metallic & Glitzer' },
];

/** Finishes that move a polish into the "special" group regardless of its colour. */
export const SPECIAL_FINISHES: ReadonlySet<FinishType> = new Set<FinishType>([
  'Metallic', 'Chrome', 'Glitter', 'Holographic',
]);

export interface Hsl { h: number; s: number; l: number }

const FALLBACK_HEX = '#888888';

/** Parses #rrggbb into HSL; null when the value is not a valid six-digit hex colour. */
export function hexToHsl(hex: string): Hsl | null {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** Lightness 0-1 of a polish colour; the grid sorts light to dark with it. */
export function colorLightness(hex: string): number {
  return (hexToHsl(hex) ?? hexToHsl(FALLBACK_HEX)!).l;
}

function inHueRange(h: number, from: number, to: number): boolean {
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/**
 * The family a colour belongs to when finishes are ignored. `finish` is read defensively:
 * a record that predates the array migration can still carry a bare string (#218).
 */
export function colorFamily(hex: string, finish?: FinishType[] | string | null): ColorFamilyId {
  const finishes: string[] = Array.isArray(finish) ? finish : typeof finish === 'string' ? [finish] : [];
  if (finishes.some((f) => SPECIAL_FINISHES.has(f as FinishType))) return 'special';

  const hsl = hexToHsl(hex);
  if (!hsl) return 'gray';
  const { h, s, l } = hsl;

  if (l <= 0.10) return 'gray';
  if (s < 0.10) return l >= 0.75 ? 'nude' : 'gray';
  if (l >= 0.93) return 'nude';
  if (inHueRange(h, 345, 50) && ((s < 0.50 && l >= 0.60) || (s < 0.65 && l >= 0.75))) return 'nude';
  if (inHueRange(h, 10, 50) && (l < 0.42 || (s < 0.55 && l < 0.60))) return 'brown';

  if (inHueRange(h, 345, 15)) return l >= 0.72 ? 'pink' : 'red';
  if (inHueRange(h, 15, 45)) return 'orange';
  if (inHueRange(h, 45, 70)) return 'yellow';
  if (inHueRange(h, 70, 165)) return 'green';
  if (inHueRange(h, 165, 255)) return 'blue';
  if (inHueRange(h, 255, 300)) return 'purple';
  return l < 0.30 ? 'purple' : 'pink';
}

export interface ColorFamilyGroup<T> {
  id: ColorFamilyId;
  label: string;
  items: T[];
}

/**
 * Splits polishes into colour-family groups in COLOR_FAMILIES order, dropping empty
 * ones. Within a group the order is light to dark, then by name, then by id — fully
 * deterministic, so the grid never reshuffles between renders.
 */
export function groupByColorFamily(polishes: Polish[]): ColorFamilyGroup<Polish>[] {
  const buckets = new Map<ColorFamilyId, Polish[]>();
  for (const p of polishes) {
    const id = colorFamily(p.color, p.finish);
    const list = buckets.get(id);
    if (list) list.push(p);
    else buckets.set(id, [p]);
  }
  const nameOf = (p: Polish) => (typeof p.name === 'string' ? p.name : '');
  return COLOR_FAMILIES.flatMap(({ id, label }) => {
    const items = buckets.get(id);
    if (!items) return [];
    items.sort((a, b) =>
      colorLightness(b.color) - colorLightness(a.color)
      || nameOf(a).localeCompare(nameOf(b))
      || a.id.localeCompare(b.id));
    return [{ id, label, items }];
  });
}
