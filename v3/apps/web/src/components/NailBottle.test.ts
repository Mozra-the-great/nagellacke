import { describe, it, expect } from 'vitest';
import type { FinishType } from '@nagellacke/core';
import { buildGradientId, resolveFinishes } from './NailBottle';

/**
 * The two expressions in NailBottle that a corrupted record used to crash on (#218).
 * Both are exported as plain functions so they can be exercised without a DOM: this
 * workspace has no jsdom or Testing Library, and pulling either in just for these
 * would be a heavier change than the fix itself.
 */
describe('resolveFinishes', () => {
  it('passes a normal array through', () => {
    expect(resolveFinishes(['Glitter', 'Top Coat'])).toEqual(['Glitter', 'Top Coat']);
  });

  it('defaults to Classic when finish is missing', () => {
    expect(resolveFinishes(undefined)).toEqual(['Classic']);
  });

  it('defaults to Classic for an empty array', () => {
    expect(resolveFinishes([])).toEqual(['Classic']);
  });

  // The #218 case: a record written before the FinishType[] migration, or one that
  // arrived through a sync path that skipped normalization. `.some()` on a string
  // throws, which used to take the whole render tree down with it.
  it('wraps a legacy bare-string finish instead of throwing', () => {
    expect(resolveFinishes('Shimmer' as unknown as FinishType[])).toEqual(['Shimmer']);
  });

  it('survives a garbage finish value', () => {
    expect(resolveFinishes(42 as unknown as FinishType[])).toEqual(['Classic']);
    expect(resolveFinishes(null as unknown as FinishType[])).toEqual(['Classic']);
  });
});

describe('buildGradientId', () => {
  it('strips the hash from the colour and joins the finishes', () => {
    expect(buildGradientId('#ff6699', ['Glitter'])).toBe('ff6699_Glitter');
  });

  // Multi-word finishes carry a raw space, which is not valid in an SVG id: the
  // resulting url(#...) fails to resolve and the fill silently falls back to black (#191).
  it('replaces characters that are not valid in an SVG id', () => {
    expect(buildGradientId('#ff6699', ['Top Coat'])).toBe('ff6699_Top-Coat');
    expect(buildGradientId('#ff6699', ['Gel Look'])).toBe('ff6699_Gel-Look');
  });

  it('sorts finishes so the same set always yields the same id', () => {
    expect(buildGradientId('#ff6699', ['Top Coat', 'Glitter']))
      .toBe(buildGradientId('#ff6699', ['Glitter', 'Top Coat']));
  });

  it('falls back to a neutral colour when the record has none', () => {
    expect(buildGradientId(undefined as unknown as string, ['Classic'])).toBe('888888_Classic');
    expect(buildGradientId('', ['Classic'])).toBe('888888_Classic');
  });

  it('does not throw on a legacy bare-string finish', () => {
    expect(() => buildGradientId('#ff6699', 'Shimmer' as unknown as FinishType[])).not.toThrow();
  });
});
