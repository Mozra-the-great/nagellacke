import { describe, it, expect } from 'vitest';
import { issuePowChallenge, PowVerifier, hasLeadingZeroBits, solvePowForTest, POW_TTL_MS } from './pow';

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
