import { describe, it, expect } from 'vitest';
import { accountRouteForHash, removeEmailWarning, removeEmailMessage } from './account';

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

/** #471: what the user is told before and after removing the account address. */
describe('removeEmailWarning / removeEmailMessage', () => {
  it('names the address, keeps username login and warns that there is no password reset any more', () => {
    const w = removeEmailWarning(' anna@example.org ', false);
    expect(w).toContain('anna@example.org');
    expect(w).toContain('Benutzername und Passwort');
    expect(w).toContain('nicht mehr zurücksetzen');
    expect(w).toContain('neu bestätigt');
    expect(w).not.toContain('Berichtsplan');
  });

  it('mentions the report schedule only when it mails this address', () => {
    expect(removeEmailWarning('anna@example.org', true)).toContain('Berichtsplan');
    expect(removeEmailMessage({ scheduleCleared: true })).toContain('pausiert');
    expect(removeEmailMessage({ scheduleCleared: false })).toBe('Adresse entfernt.');
  });
});
