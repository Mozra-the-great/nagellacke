import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { signPhotoToken, verifyPhotoToken, type PhotoTokenPayload } from './photoToken';

// Unit tests for the photo token (#269). photos.test.ts drives the same code through
// the routes; these pin the token format and every refusal path on their own, because
// a token that verifies when it should not opens /photos/* to anyone holding a link.

const SECRET = 'unit-test-jwt-secret';
const API_KEY = 'unit-test-api-key';
const NOW = 1_800_000_000_000; // ms
const EXP = NOW / 1000 + 3600; // seconds, one hour ahead

const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64url');

// The documented key derivation, written out independently of photoToken.ts so the two
// context strings are pinned: a round trip through sign + verify cannot see them change.
const baseSecret = (): Buffer => createHmac('sha256', SECRET).update('nagellacke:photo-token:v1').digest();
const apiKeySecret = (): Buffer =>
  createHmac('sha256', API_KEY).update(baseSecret()).update('nagellacke:photo-token:api-key:v1').digest();

/** A token whose body is the given raw JSON text, signed with the given secret. */
function forge(rawJson: string, secret: Buffer = baseSecret()): string {
  const body = b64(rawJson);
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

describe('signPhotoToken / verifyPhotoToken', () => {
  afterEach(() => vi.useRealTimers());

  it('round-trips a session token and returns the payload unchanged', () => {
    const payload: PhotoTokenPayload = { exp: EXP, u: 'alice', tv: 3 };
    const token = signPhotoToken(payload, SECRET);
    expect(verifyPhotoToken(token, SECRET, { now: NOW })).toEqual(payload);
  });

  it('round-trips a file token bound to a filename', () => {
    const payload: PhotoTokenPayload = { exp: EXP, u: 'alice', tv: 0, f: 'a.jpg' };
    expect(verifyPhotoToken(signPhotoToken(payload, SECRET), SECRET, { now: NOW })).toEqual(payload);
  });

  it('signs under the documented key derivation (pins both context strings)', () => {
    const user = JSON.stringify({ exp: EXP, u: 'alice', tv: 1 });
    expect(signPhotoToken({ exp: EXP, u: 'alice', tv: 1 }, SECRET)).toBe(forge(user));

    const keyed = JSON.stringify({ exp: EXP, u: '', k: true });
    expect(signPhotoToken({ exp: EXP, u: '', k: true }, SECRET, API_KEY)).toBe(forge(keyed, apiKeySecret()));
  });

  it('refuses a token signed with another secret, and a tampered body or signature', () => {
    const token = signPhotoToken({ exp: EXP, u: 'alice' }, SECRET);
    expect(verifyPhotoToken(token, 'another-secret', { now: NOW })).toBeNull();

    const [body, sig] = token.split('.');
    const otherBody = b64(JSON.stringify({ exp: EXP, u: 'mallory' }));
    expect(verifyPhotoToken(`${otherBody}.${sig}`, SECRET, { now: NOW })).toBeNull();
    const flipped = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyPhotoToken(`${body}.${flipped}`, SECRET, { now: NOW })).toBeNull();
  });

  it('answers a signature of the wrong length with null, not an exception', () => {
    const token = signPhotoToken({ exp: EXP, u: 'alice' }, SECRET);
    const [body, sig] = token.split('.');
    expect(verifyPhotoToken(`${body}.${sig.slice(1)}`, SECRET, { now: NOW })).toBeNull();
    expect(verifyPhotoToken(`${body}.${sig}A`, SECRET, { now: NOW })).toBeNull();
  });

  describe('expiry', () => {
    it('is valid up to the last millisecond before exp and refused from exp on', () => {
      const token = signPhotoToken({ exp: EXP, u: 'alice' }, SECRET);
      expect(verifyPhotoToken(token, SECRET, { now: EXP * 1000 - 1 })).not.toBeNull();
      expect(verifyPhotoToken(token, SECRET, { now: EXP * 1000 })).toBeNull();
      expect(verifyPhotoToken(token, SECRET, { now: EXP * 1000 + 1 })).toBeNull();
    });

    it('reads the clock when no `now` is given', () => {
      vi.useFakeTimers();
      const token = signPhotoToken({ exp: EXP, u: 'alice' }, SECRET);
      vi.setSystemTime(EXP * 1000 - 1000);
      expect(verifyPhotoToken(token, SECRET)).not.toBeNull();
      vi.setSystemTime(EXP * 1000 + 1000);
      expect(verifyPhotoToken(token, SECRET)).toBeNull();
    });

    it('refuses an exp that is not a finite number, even under a valid signature', () => {
      expect(verifyPhotoToken(forge('{"exp":1e999,"u":"alice"}'), SECRET, { now: NOW })).toBeNull(); // Infinity
      expect(verifyPhotoToken(forge(`{"exp":"${EXP}","u":"alice"}`), SECRET, { now: NOW })).toBeNull();
      expect(verifyPhotoToken(forge('{"exp":null,"u":"alice"}'), SECRET, { now: NOW })).toBeNull();
      expect(verifyPhotoToken(forge('{"u":"alice"}'), SECRET, { now: NOW })).toBeNull();
      // the same payload with a finite exp is fine, so only the exp made the difference
      expect(verifyPhotoToken(forge(`{"exp":${EXP},"u":"alice"}`), SECRET, { now: NOW })).not.toBeNull();
    });

    it('refuses a username that is not a string, even under a valid signature', () => {
      expect(verifyPhotoToken(forge(`{"exp":${EXP},"u":7}`), SECRET, { now: NOW })).toBeNull();
      expect(verifyPhotoToken(forge(`{"exp":${EXP}}`), SECRET, { now: NOW })).toBeNull();
      expect(verifyPhotoToken(forge(`{"exp":${EXP},"u":""}`), SECRET, { now: NOW })).not.toBeNull();
    });
  });

  describe('shape of the token string', () => {
    const good = (): string => signPhotoToken({ exp: EXP, u: 'alice' }, SECRET);

    it('refuses anything without a body and a signature around one dot', () => {
      const [body, sig] = good().split('.');
      for (const t of ['', 'nodot', `.${sig}`, `${body}.`, '.']) {
        expect(verifyPhotoToken(t, SECRET, { now: NOW })).toBeNull();
      }
    });

    it('refuses a non-string token without throwing', () => {
      for (const t of [undefined, null, 42, {}, ['a.b']]) {
        expect(verifyPhotoToken(t as unknown as string, SECRET, { now: NOW })).toBeNull();
      }
    });

    it('accepts a token of exactly 4096 characters and refuses 4097', () => {
      // Pad the filename until the whole token is exactly as long as the limit allows.
      const build = (len: number): string => signPhotoToken({ exp: EXP, u: 'alice', f: 'x'.repeat(len) }, SECRET);
      let len = 2900;
      while (build(len).length < 4096) len++;
      expect(build(len).length).toBe(4096);
      expect(verifyPhotoToken(build(len), SECRET, { now: NOW })).not.toBeNull();
      expect(build(len + 1).length).toBeGreaterThan(4096);
      expect(verifyPhotoToken(build(len + 1), SECRET, { now: NOW })).toBeNull();
    });

    it('refuses a body that is not JSON or not an object, even under a valid signature', () => {
      expect(verifyPhotoToken(forge('not json'), SECRET, { now: NOW })).toBeNull();
      expect(verifyPhotoToken(forge('null'), SECRET, { now: NOW })).toBeNull();
      expect(verifyPhotoToken(forge('123'), SECRET, { now: NOW })).toBeNull();
      expect(verifyPhotoToken(forge('"text"'), SECRET, { now: NOW })).toBeNull();
      expect(verifyPhotoToken(forge('true'), SECRET, { now: NOW })).toBeNull();
    });
  });

  describe('API-key tokens (k)', () => {
    const keyed: PhotoTokenPayload = { exp: EXP, u: '', k: true };

    it('refuses to sign one without the API key', () => {
      expect(() => signPhotoToken(keyed, SECRET)).toThrow(/API key/);
    });

    it('verifies only with the API key it was minted under', () => {
      const token = signPhotoToken(keyed, SECRET, API_KEY);
      expect(verifyPhotoToken(token, SECRET, { apiKey: API_KEY, now: NOW })).toEqual(keyed);
      expect(verifyPhotoToken(token, SECRET, { now: NOW })).toBeNull(); // no key in force
      expect(verifyPhotoToken(token, SECRET, { apiKey: 'rotated-key', now: NOW })).toBeNull();
      expect(verifyPhotoToken(token, 'another-secret', { apiKey: API_KEY, now: NOW })).toBeNull();
    });

    it('does not sign an ordinary token under the API key, whatever key is passed', () => {
      const plain: PhotoTokenPayload = { exp: EXP, u: 'alice' };
      expect(signPhotoToken(plain, SECRET, API_KEY)).toBe(signPhotoToken(plain, SECRET));
      expect(verifyPhotoToken(signPhotoToken(plain, SECRET, API_KEY), SECRET, { apiKey: API_KEY, now: NOW })).toEqual(plain);
    });

    it('cannot be downgraded: stripping k, or signing with the user secret, does not verify as an API-key token', () => {
      // A forger who knows the JWT secret but not the API key signs `k` tokens under the user secret.
      const forged = forge(JSON.stringify(keyed), baseSecret());
      expect(verifyPhotoToken(forged, SECRET, { apiKey: API_KEY, now: NOW })).toBeNull();
      // with no API key in force a `k` token must not fall back to the user secret either
      expect(verifyPhotoToken(forged, SECRET, { now: NOW })).toBeNull();
      // and a genuine API-key token with k removed fails against the user secret
      const [, sig] = signPhotoToken(keyed, SECRET, API_KEY).split('.');
      const stripped = `${b64(JSON.stringify({ exp: EXP, u: '' }))}.${sig}`;
      expect(verifyPhotoToken(stripped, SECRET, { apiKey: API_KEY, now: NOW })).toBeNull();
    });

    it('accepts k only as the literal true', () => {
      // Signed under the user secret, so a lenient reading of `k` would verify them.
      for (const k of ['false', '0', '"yes"', '1', 'null', '[]', '{}']) {
        const token = forge(`{"exp":${EXP},"u":"alice","k":${k}}`);
        expect(verifyPhotoToken(token, SECRET, { apiKey: API_KEY, now: NOW })).toBeNull();
        expect(verifyPhotoToken(token, SECRET, { now: NOW })).toBeNull();
      }
    });
  });
});
