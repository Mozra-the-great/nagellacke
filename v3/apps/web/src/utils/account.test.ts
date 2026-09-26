import { describe, it, expect } from 'vitest';
import { accountRouteForHash } from './account';

describe('accountRouteForHash (#324 S18, S19)', () => {
  const token = 'a'.repeat(64);

  it('recognises the two links the server mails', () => {
    expect(accountRouteForHash(`#/passwort-neu?token=${token}`)).toEqual({ kind: 'reset', token });
    expect(accountRouteForHash(`#/email-bestaetigen?token=${token}`)).toEqual({ kind: 'verify', token });
  });

  it('still opens the page for a link with a missing token, so it can say so', () => {
    expect(accountRouteForHash('#/passwort-neu')).toEqual({ kind: 'reset', token: '' });
  });

  it('ignores every other hash', () => {
    for (const h of ['', '#', '#/impressum', '#/passwort', `#/passwort-neu-x?token=${token}`]) {
      expect(accountRouteForHash(h)).toBeNull();
    }
  });
});
