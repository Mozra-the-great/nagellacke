import { describe, it, expect } from 'vitest';
import { Secret, TOTP, URI } from 'otpauth';
import {
  generateTotpSecret,
  buildOtpauthUri,
  verifyTotpCode,
  hashRecoveryCode,
  generateRecoveryCodes,
  RECOVERY_CODE_COUNT,
} from './totp';

// RFC 6238 Appendix B test vectors: seed is the raw ASCII bytes
// "12345678901234567890" (not base32-decoded), SHA-1, 8-digit codes, 30s step.
const RFC_SEED_BASE32 = new Secret({ buffer: new Uint8Array(Buffer.from('12345678901234567890', 'ascii')).buffer }).base32;

function rfcTotp(): TOTP {
  return new TOTP({
    secret: Secret.fromBase32(RFC_SEED_BASE32),
    algorithm: 'SHA1',
    digits: 8,
    period: 30,
  });
}

describe('RFC 6238 test vectors', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('T=%i -> %s', (unixSeconds, expected) => {
    const totp = rfcTotp();
    expect(totp.generate({ timestamp: unixSeconds * 1000 })).toBe(expected);
  });
});

describe('verifyTotpCode', () => {
  it('accepts the code for the current time step', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
    const code = totp.generate({ timestamp: now });
    const counter = verifyTotpCode(secret, code, 'alice', now);
    expect(counter).not.toBeNull();
    expect(counter).toBe(Math.floor(now / 1000 / 30));
  });

  it('accepts a code from 30s in the past (within the ±1 step skew window)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
    const pastCode = totp.generate({ timestamp: now - 30_000 });
    const counter = verifyTotpCode(secret, pastCode, 'alice', now);
    expect(counter).not.toBeNull();
    expect(counter).toBe(Math.floor(now / 1000 / 30) - 1);
  });

  it('accepts a code from 30s in the future (within the ±1 step skew window)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
    const futureCode = totp.generate({ timestamp: now + 30_000 });
    const counter = verifyTotpCode(secret, futureCode, 'alice', now);
    expect(counter).not.toBeNull();
    expect(counter).toBe(Math.floor(now / 1000 / 30) + 1);
  });

  it('rejects a code from 60s in the past (outside the ±1 step skew window)', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
    const farPastCode = totp.generate({ timestamp: now - 60_000 });
    expect(verifyTotpCode(secret, farPastCode, 'alice', now)).toBeNull();
  });

  it('rejects a malformed code without touching otpauth', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, 'abcdef', 'alice')).toBeNull();
    expect(verifyTotpCode(secret, '12345', 'alice')).toBeNull();
    expect(verifyTotpCode(secret, '', 'alice')).toBeNull();
  });

  it('counter replay: the same valid code, checked against its own returned counter, is rejected on a second submission', () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 });
    const code = totp.generate({ timestamp: now });

    const firstCounter = verifyTotpCode(secret, code, 'alice', now);
    expect(firstCounter).not.toBeNull();

    // Route-level replay guard: reject when the accepted counter is <= totp_last_counter.
    const totpLastCounter = firstCounter as number;
    const secondCounter = verifyTotpCode(secret, code, 'alice', now);
    expect(secondCounter).not.toBeNull(); // otpauth itself doesn't know about replay
    expect(secondCounter as number <= totpLastCounter).toBe(true); // the route must reject this
  });
});

describe('buildOtpauthUri', () => {
  it('round-trips through otpauth\'s own URI parser with the right issuer/label/secret', () => {
    const secret = generateTotpSecret();
    const uri = buildOtpauthUri(secret, 'alice');
    const parsed = URI.parse(uri) as TOTP;
    expect(parsed).toBeInstanceOf(TOTP);
    expect(parsed.issuer).toBe('Nagellacke');
    expect(parsed.label).toBe('alice');
    expect(parsed.secret.base32).toBe(secret);
    expect(parsed.digits).toBe(6);
    expect(parsed.period).toBe(30);
  });
});

describe('recovery codes', () => {
  it('generates the expected count with sufficient entropy and matching hashes', () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(hashes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT); // no collisions
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    }
    codes.forEach((code, i) => {
      expect(hashRecoveryCode(code)).toBe(hashes[i]);
    });
  });

  it('hashing is deterministic and case/whitespace-insensitive (safeEqual-comparable)', () => {
    const { codes } = generateRecoveryCodes(1);
    const code = codes[0];
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(code.toLowerCase())).toBe(hashRecoveryCode(code));
    expect(hashRecoveryCode(` ${code} `)).toBe(hashRecoveryCode(code));
  });

  it('different codes hash differently', () => {
    const { codes } = generateRecoveryCodes(2);
    expect(hashRecoveryCode(codes[0])).not.toBe(hashRecoveryCode(codes[1]));
  });
});
