import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { issuePowChallenge, PowVerifier, hasLeadingZeroBits, solvePowForTest, POW_TTL_MS, POW_DIFFICULTY } from './pow';

const SECRET = 'test-jwt-secret';

describe('hasLeadingZeroBits', () => {
  it('counts whole bytes and the bits of the next one', () => {
    expect(hasLeadingZeroBits(Uint8Array.from([0, 0, 0xff]), 16)).toBe(true);
    expect(hasLeadingZeroBits(Uint8Array.from([0, 1, 0xff]), 16)).toBe(false);
    expect(hasLeadingZeroBits(Uint8Array.from([0, 0x0f]), 12)).toBe(true);
    expect(hasLeadingZeroBits(Uint8Array.from([0, 0x10]), 12)).toBe(false);
    expect(hasLeadingZeroBits(Uint8Array.from([0xff]), 0)).toBe(true);
  });
});

describe('PowVerifier (#324 S13)', () => {
  const now = 1_700_000_000_000;

  it('accepts a solved challenge once', () => {
    const v = new PowVerifier(SECRET);
    const solved = solvePowForTest(issuePowChallenge(SECRET, now));
    expect(v.verify(solved, now + 1000)).toBeNull();
    expect(v.verify(solved, now + 2000)).toBe('replayed');
  });

  it('refuses an expired challenge', () => {
    const v = new PowVerifier(SECRET);
    const solved = solvePowForTest(issuePowChallenge(SECRET, now));
    expect(v.verify(solved, now + POW_TTL_MS)).toBe('expired');
  });

  it('refuses a challenge signed under another secret, or with a changed expiry', () => {
    const v = new PowVerifier(SECRET);
    const foreign = solvePowForTest(issuePowChallenge('other-secret', now));
    expect(v.verify(foreign, now)).toBe('signature');
    const solved = solvePowForTest(issuePowChallenge(SECRET, now));
    expect(v.verify({ ...solved, expires: solved.expires + 3_600_000 }, now)).toBe('signature');
  });

  it('refuses a challenge issued at a lower difficulty than the current one', () => {
    const v = new PowVerifier(SECRET);
    const easy = solvePowForTest(issuePowChallenge(SECRET, now, 4));
    expect(v.verify(easy, now)).toBe('signature');
  });

  it('refuses malformed input without throwing', () => {
    const v = new PowVerifier(SECRET);
    for (const input of [undefined, null, 'x', {}, { salt: 'zz', difficulty: 16, expires: now, sig: 'a', n: 1 },
      { ...issuePowChallenge(SECRET, now), n: -1 }, { ...issuePowChallenge(SECRET, now), n: 1.5 }]) {
      expect(v.verify(input, now)).toBe('malformed');
    }
  });

  it('forgets spent salts once they would have expired anyway', () => {
    const v = new PowVerifier(SECRET);
    const solved = solvePowForTest(issuePowChallenge(SECRET, now));
    expect(v.verify(solved, now)).toBeNull();
    // Past expiry the salt is pruned, and the challenge is refused as expired instead.
    expect(v.verify(solved, now + POW_TTL_MS + 1)).toBe('expired');
  });
});

describe('PowVerifier input validation, field by field (#498)', () => {
  const now = 1_700_000_000_000;
  // One valid solution; each case below breaks exactly one field of it.
  const valid = solvePowForTest(issuePowChallenge(SECRET, now));

  it('accepts the unmodified solution (so every refusal below is down to its one change)', () => {
    expect(new PowVerifier(SECRET).verify(valid, now)).toBeNull();
  });

  it.each<[string, unknown]>([
    ['salt that is not a string but stringifies to a valid one', [valid.salt]],
    ['salt with upper-case hex', 'ABCDEF0123456789ABCDEF0123456789'],
    ['salt with trailing garbage', `${valid.salt}x`],
    ['salt with leading garbage', `x${valid.salt}`],
    ['salt of the wrong length', valid.salt.slice(1)],
  ])('refuses a %s as malformed', (_name, salt) => {
    expect(new PowVerifier(SECRET).verify({ ...valid, salt }, now)).toBe('malformed');
  });

  it.each<[string, unknown]>([
    ['a string', '16'],
    ['a fraction', 16.5],
    ['NaN', Number.NaN],
    ['missing', undefined],
  ])('refuses a difficulty that is %s as malformed', (_name, difficulty) => {
    expect(new PowVerifier(SECRET).verify({ ...valid, difficulty }, now)).toBe('malformed');
  });

  it.each<[string, unknown]>([
    ['a string', String(valid.expires)],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['missing', undefined],
  ])('refuses an expiry that is %s as malformed', (_name, expires) => {
    expect(new PowVerifier(SECRET).verify({ ...valid, expires }, now)).toBe('malformed');
  });

  it('refuses a signature that is not a string, without throwing', () => {
    const v = new PowVerifier(SECRET);
    expect(v.verify({ ...valid, sig: 12345 }, now)).toBe('malformed');
    expect(v.verify({ ...valid, sig: undefined }, now)).toBe('malformed');
  });

  it('draws the line for the signature length at 128: 128 is checked, 129 is malformed', () => {
    const v = new PowVerifier(SECRET);
    expect(v.verify({ ...valid, sig: 'a'.repeat(128) }, now)).toBe('signature');
    expect(v.verify({ ...valid, sig: 'a'.repeat(129) }, now)).toBe('malformed');
  });

  it('answers a signature of the wrong length with "signature", not an exception', () => {
    const v = new PowVerifier(SECRET);
    expect(v.verify({ ...valid, sig: 'abc' }, now)).toBe('signature');
    expect(v.verify({ ...valid, sig: '' }, now)).toBe('signature');
    // same length, one character off: the comparison itself must refuse it
    const flipped = `${valid.sig.slice(0, -1)}${valid.sig.endsWith('A') ? 'B' : 'A'}`;
    expect(v.verify({ ...valid, sig: flipped }, now)).toBe('signature');
  });

  it.each<[string, unknown]>([
    ['a string', '1'],
    ['negative', -1],
    ['a fraction', 0.5],
    ['beyond the safe integers', Number.MAX_SAFE_INTEGER + 2],
    ['NaN', Number.NaN],
    ['missing', undefined],
  ])('refuses a counter that is %s as malformed', (_name, n) => {
    expect(new PowVerifier(SECRET).verify({ ...valid, n }, now)).toBe('malformed');
  });

  it('treats a counter of 0 as well-formed (a wrong solution, not a malformed one)', () => {
    // 1 in 65 536 salts has n = 0 as a real solution, hence "not malformed" rather than "solution".
    expect(new PowVerifier(SECRET).verify({ ...valid, n: 0 }, now)).not.toBe('malformed');
  });
});

describe('PowVerifier internals the contract depends on (#498)', () => {
  const now = 1_700_000_000_000;
  const spentCount = (v: PowVerifier): number => (v as unknown as { spent: Map<string, number> }).spent.size;

  it('signs under the documented, domain-separated key', () => {
    // Known answer, computed here from the spec in pow.ts: HMAC(HMAC(secret, context), "salt.difficulty.expires").
    // Pins the context string, which no round trip through issue + verify can: both sides share it.
    const salt = '0123456789abcdef0123456789abcdef';
    const expires = now + POW_TTL_MS;
    const key = createHmac('sha256', SECRET).update('nagellacke:registration-pow:v1').digest();
    const sig = createHmac('sha256', key).update(`${salt}.${POW_DIFFICULTY}.${expires}`).digest('base64url');
    const solved = solvePowForTest({ salt, difficulty: POW_DIFFICULTY, expires, sig });
    expect(new PowVerifier(SECRET).verify(solved, now)).toBeNull();
  });

  it('drops spent salts once they have expired, and only then', () => {
    const v = new PowVerifier(SECRET);
    const first = solvePowForTest(issuePowChallenge(SECRET, now));
    expect(v.verify(first, now)).toBeNull();
    expect(spentCount(v)).toBe(1);

    // One millisecond before the first challenge's expiry it is still remembered...
    const second = solvePowForTest(issuePowChallenge(SECRET, now + 1));
    expect(v.verify(second, first.expires - 1)).toBeNull();
    expect(spentCount(v)).toBe(2);

    // ...and at the expiry itself it is forgotten (expires <= now), the second one is not.
    const third = solvePowForTest(issuePowChallenge(SECRET, now + 2));
    expect(v.verify(third, first.expires)).toBeNull();
    expect(spentCount(v)).toBe(2);
  });
});
