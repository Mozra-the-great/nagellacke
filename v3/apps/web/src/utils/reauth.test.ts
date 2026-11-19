import { describe, it, expect } from 'vitest';
import { ApiError, apiError, needsTotpCode, reauthComplete, reauthPayload } from './reauth';

describe('reauthPayload (#479)', () => {
  it('sends the password alone without 2FA, even if a code was typed', () => {
    expect(reauthPayload('pw', '123456', false)).toEqual({ password: 'pw' });
  });

  it('adds the trimmed code when 2FA is on', () => {
    expect(reauthPayload('pw', ' 123456 ', true)).toEqual({ password: 'pw', code: '123456' });
    expect(reauthPayload('pw', '', true)).toEqual({ password: 'pw' });
  });
});

describe('reauthComplete (#479)', () => {
  it('needs the password, and the code only when 2FA is on', () => {
    expect(reauthComplete('', '', false)).toBe(false);
    expect(reauthComplete('pw', '', false)).toBe(true);
    expect(reauthComplete('pw', '  ', true)).toBe(false);
    expect(reauthComplete('pw', 'ABCDE-12345', true)).toBe(true);
  });
});

describe('apiError (#479)', () => {
  it('keeps the server text for a wrong password', () => {
    const e = apiError(403, { error: 'Passwort falsch' });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.message).toBe('Passwort falsch');
    expect(e.totpRequired).toBe(false);
    expect(e.locked).toBe(false);
  });

  it('marks a missing or wrong 2FA code', () => {
    const e = apiError(403, { error: 'Ungültiger Code', totpRequired: true });
    expect(e.totpRequired).toBe(true);
    expect(needsTotpCode(e)).toBe(true);
    expect(needsTotpCode(new Error('x'))).toBe(false);
  });

  it('marks a lockout and shows its text', () => {
    const e = apiError(429, { error: 'Zu viele Fehlversuche. Bitte versuche es in 15 Minuten erneut.', locked: true, retryAfter: 900 });
    expect(e.locked).toBe(true);
    expect(e.status).toBe(429);
    expect(e.message).toMatch(/15 Minuten/);
  });

  it('falls back to the status for an answer without text', () => {
    expect(apiError(500, {}).message).toBe('Fehler 500');
    expect(apiError(429, {}).locked).toBe(true);
  });
});
