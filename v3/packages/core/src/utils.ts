import type { FinishType } from './types';
import { FINISH_VALUES } from './constants';

const FINISH_TYPES = new Set<FinishType>(FINISH_VALUES);

/**
 * Normalizes a polish's `finish` field, which may still be the old
 * pre-migration shape (a bare string) on data that hasn't been touched since
 * the multi-finish change. Never throws, never drops data: an unrecognized or
 * missing value falls back to 'Classic' rather than an empty array, so a
 * polish is never left with zero finish tags.
 */
export function normalizeFinish(value: unknown): FinishType[] {
  if (Array.isArray(value)) {
    const filtered = value.filter((v): v is FinishType => typeof v === 'string' && FINISH_TYPES.has(v as FinishType));
    return filtered.length > 0 ? Array.from(new Set(filtered)) : ['Classic'];
  }
  if (typeof value === 'string' && FINISH_TYPES.has(value as FinishType)) return [value as FinishType];
  return ['Classic'];
}

export function hexToHue(hex: string): number {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return Math.round(h * 60 + 360) % 360;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function now(): number {
  return Date.now();
}
