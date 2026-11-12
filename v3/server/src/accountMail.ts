import * as crypto from 'node:crypto';

/**
 * Tokens and mails for password reset and e-mail verification (#324 S17, S19).
 *
 * A token is 32 random bytes, sent once by mail; only its sha256 is stored, so the
 * users file never holds a usable link. The links point at hash routes of the web app
 * (`#/passwort-neu?token=…`, `#/email-bestaetigen?token=…`), which keeps the token out
 * of server access logs and Referer headers: a URL fragment is never sent anywhere.
 */

export const RESET_TTL_MS = 60 * 60 * 1000;
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** A second reset mail to the same account within this window is silently skipped. */
export const RESET_RESEND_MS = 60 * 1000;
/** "Bestätigungsmail erneut senden" at most this often per account. */
export const VERIFY_RESEND_MS = 60 * 60 * 1000;

export function newAccountToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashAccountToken(token) };
}

export function hashAccountToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Tokens are 64 hex characters; anything else is refused before any lookup. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function mailHtml(title: string, intro: string, link: string, button: string, outro: string): string {
  const l = escapeHtml(link);
  return `<!doctype html><html lang="de"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#222">
<h2 style="font-weight:600">${escapeHtml(title)}</h2>
<p>${escapeHtml(intro)}</p>
<p><a href="${l}" style="display:inline-block;padding:10px 18px;background:#c2185b;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(button)}</a></p>
<p style="font-size:13px;color:#555">Falls der Knopf nicht funktioniert, diesen Link im Browser öffnen:<br><a href="${l}">${l}</a></p>
<p style="font-size:13px;color:#555">${escapeHtml(outro)}</p>
</body></html>`;
}

export function resetMail(appName: string, baseUrl: string, username: string, token: string): { subject: string; html: string } {
  return {
    subject: `${appName}: Passwort zurücksetzen`,
    html: mailHtml(
      'Passwort zurücksetzen',
      `Für das Konto „${username}“ wurde ein neues Passwort angefordert. Der Link gilt eine Stunde und nur einmal.`,
      `${baseUrl}/#/passwort-neu?token=${token}`,
      'Neues Passwort festlegen',
      'Wenn du das nicht angefordert hast, kannst du diese Mail ignorieren; dein Passwort bleibt unverändert.',
    ),
  };
}

/**
 * Confirmation request for the recipient of a scheduled report (#449). It goes to a
 * person who may never have heard of this server, so it says who asked, what would
 * be sent and what is stored, and that doing nothing means nothing is ever sent.
 * Those are the points Art. 14 GDPR asks to tell someone whose address was handed
 * to us by a third party.
 */
export function reportRecipientMail(
  appName: string, baseUrl: string, requester: string, frequency: 'weekly' | 'monthly', token: string,
): { subject: string; html: string } {
  const every = frequency === 'monthly' ? 'monatlich' : 'wöchentlich';
  return {
    subject: `${appName}: Bericht an diese Adresse erlauben?`,
    html: mailHtml(
      'Bericht an diese Adresse erlauben?',
      `Das Konto „${requester}“ auf ${appName} möchte ${every} eine E-Mail mit einem Bericht über die eigene Nagellack-Sammlung (Lacke, Sticker, Maniküren, Fotos) an diese Adresse senden. `
      + 'Der Link gilt 48 Stunden.',
      `${baseUrl}/#/bericht-bestaetigen?token=${token}`,
      'Ja, Berichte an diese Adresse senden',
      'Ohne deine Bestätigung wird nichts an diese Adresse gesendet; wenn du die Mail nicht erwartet hast, ignoriere sie einfach. '
      + 'Jeder Bericht enthält unten einen Link zum Abbestellen. '
      + 'Gespeichert wird nur deine E-Mail-Adresse, und nur zum Versand dieser Berichte. '
      + `Verantwortlich ist der Betreiber von ${appName}; Angaben zum Datenschutz stehen unter ${baseUrl}/#/datenschutz.`,
    ),
  };
}

export function verifyMail(appName: string, baseUrl: string, username: string, token: string): { subject: string; html: string } {
  return {
    subject: `${appName}: E-Mail-Adresse bestätigen`,
    html: mailHtml(
      'E-Mail-Adresse bestätigen',
      `Bitte bestätige, dass diese Adresse zum Konto „${username}“ gehört. Erst dann kann über sie ein vergessenes Passwort zurückgesetzt werden. Der Link gilt 24 Stunden.`,
      `${baseUrl}/#/email-bestaetigen?token=${token}`,
      'Adresse bestätigen',
      'Wenn du kein Konto angelegt hast, kannst du diese Mail ignorieren.',
    ),
  };
}
