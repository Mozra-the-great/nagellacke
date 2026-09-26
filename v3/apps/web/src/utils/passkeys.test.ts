import { describe, it, expect } from 'vitest';
import {
  base64UrlToBuffer, bufferToBase64Url, creationOptionsFromJSON, requestOptionsFromJSON, passkeyErrorMessage,
} from './passkeys';

describe('passkey encoding (#228)', () => {
  it('round-trips base64url, including lengths that need padding', () => {
    for (const len of [0, 1, 2, 3, 16, 31, 32]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 250) % 256);
      const enc = bufferToBase64Url(bytes.buffer);
      expect(enc).not.toMatch(/[+/=]/);
      expect([...new Uint8Array(base64UrlToBuffer(enc))]).toEqual([...bytes]);
    }
  });

  it('turns the binary fields of the server options into buffers and leaves the rest', () => {
    const created = creationOptionsFromJSON({
      challenge: 'AAEC', rp: { id: 'example.de', name: 'X' },
      user: { id: 'AwQF', name: 'anna', displayName: 'anna' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ id: 'BgcI', type: 'public-key', transports: ['internal'] }],
    });
    expect([...new Uint8Array(created.challenge as ArrayBuffer)]).toEqual([0, 1, 2]);
    expect([...new Uint8Array(created.user.id as ArrayBuffer)]).toEqual([3, 4, 5]);
    expect(created.user.name).toBe('anna');
    expect(created.rp).toEqual({ id: 'example.de', name: 'X' });
    expect([...new Uint8Array(created.excludeCredentials![0].id as ArrayBuffer)]).toEqual([6, 7, 8]);

    const requested = requestOptionsFromJSON({ challenge: 'AAEC', rpId: 'example.de', userVerification: 'required' });
    expect([...new Uint8Array(requested.challenge as ArrayBuffer)]).toEqual([0, 1, 2]);
    expect(requested.allowCredentials).toBeUndefined();
    expect(requested.userVerification).toBe('required');
  });

  it('turns browser errors into sentences', () => {
    expect(passkeyErrorMessage(new DOMException('x', 'NotAllowedError'))).toBe('Abgebrochen oder abgelaufen.');
    expect(passkeyErrorMessage(new Error('Server sagt nein'))).toBe('Server sagt nein');
  });
});
