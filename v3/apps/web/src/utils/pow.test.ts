import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { hasLeadingZeroBits, searchPow, solveOnMainThread } from './pow';

describe('registration proof of work, client side (#324 S14)', () => {
  it('finds an n the server-side check accepts', async () => {
    const salt = '0123456789abcdef0123456789abcdef';
    const n = await solveOnMainThread(salt, 12);
    const hash = createHash('sha256').update(`${salt}${n}`).digest();
    expect(hasLeadingZeroBits(hash, 12)).toBe(true);
  });

  it('returns the smallest solution within a batch, and null when there is none', async () => {
    const salt = 'fedcba9876543210fedcba9876543210';
    const n = await solveOnMainThread(salt, 8);
    expect(await searchPow(salt, 8, 0, n + 1)).toBe(n);
    expect(await searchPow(salt, 8, 0, n)).toBeNull();
  });

  it('counts leading zero bits across a byte boundary', () => {
    expect(hasLeadingZeroBits(Uint8Array.from([0, 0x0f]), 12)).toBe(true);
    expect(hasLeadingZeroBits(Uint8Array.from([0, 0x10]), 12)).toBe(false);
  });
});
