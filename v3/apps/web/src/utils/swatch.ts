import { SHIMMER_FINISHES } from '@nagellacke/core';
import type { FinishType, Polish } from '@nagellacke/core';
import { resolveFinishes } from '../components/NailBottle';

const FALLBACK_COLOR = '#888888'; // same neutral the bottle falls back to for a missing colour

export interface SwatchStyle {
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize: string;
}

const METAL_FINISHES = new Set<FinishType>(['Metallic', 'Chrome', 'Holographic']);

/**
 * Background layers for a round swatch: the polish colour with a soft highlight, plus a
 * hint of the finish: fine specks for shimmer and glitter, a diagonal sheen for metals.
 * Deliberately subtle; matte has no highlight at all and satin a weak one.
 */
export function swatchStyle(color: string, finish: FinishType[] | undefined): SwatchStyle {
  const base = /^#[0-9a-fA-F]{6}$/.test(color ?? '') ? color : FALLBACK_COLOR;
  const finishes = resolveFinishes(finish);
  const layers: { image: string; size: string }[] = [];

  if (finishes.some((f) => SHIMMER_FINISHES.has(f))) {
    layers.push(
      { image: 'radial-gradient(circle at 25% 30%, rgba(255,255,255,0.55) 0 1px, transparent 1.6px)', size: '11px 11px' },
      { image: 'radial-gradient(circle at 70% 65%, rgba(255,255,255,0.4) 0 1px, transparent 1.6px)', size: '17px 17px' },
    );
  }
  if (finishes.some((f) => METAL_FINISHES.has(f))) {
    layers.push({
      image: 'linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 38%, rgba(0,0,0,0.22) 100%)',
      size: 'auto',
    });
  }
  const gloss = finishes.includes('Matte') ? 0 : finishes.includes('Satin') ? 0.2 : 0.38;
  if (gloss > 0) {
    layers.push({
      image: `radial-gradient(circle at 30% 26%, rgba(255,255,255,${gloss}), rgba(255,255,255,0) 46%)`,
      size: 'auto',
    });
  }

  return {
    backgroundColor: base,
    backgroundImage: layers.length > 0 ? layers.map((l) => l.image).join(', ') : 'none',
    backgroundSize: layers.length > 0 ? layers.map((l) => l.size).join(', ') : 'auto',
  };
}

/** Status words shown on a tile; swatchLabel() repeats them so the name contains what is visible. */
export const STATUS_BADGE: Partial<Record<Polish['status'], string>> = {
  wish: 'Wunschliste',
  empty: 'Leer',
  gone: 'Nicht mehr da',
};

/**
 * The tile's accessible name. Brand comes first because that is the order the tile shows
 * its text in, so the visible label is contained in the name (WCAG 2.5.3, label in name);
 * status and count follow, as the badges the tile draws (their words are repeated verbatim
 * for the same reason), and the rating comes last because the stars it is drawn with are
 * symbols that a label-in-name check ignores, so it must not sit between the words.
 */
export function swatchLabel(p: Pick<Polish, 'name' | 'brand' | 'rating' | 'count' | 'status'>): string {
  const parts: string[] = [];
  if (p.brand) parts.push(p.brand);
  parts.push(p.name || 'Unbenannt');
  const status = STATUS_BADGE[p.status];
  if (status) parts.push(status);
  if ((p.count ?? 1) > 1) parts.push(`${p.count}×`);
  if (p.rating) parts.push(`${p.rating} von 5 Sternen`);
  return parts.join(', ');
}
