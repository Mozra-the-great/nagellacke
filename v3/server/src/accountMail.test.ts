import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * #324 S17 (password reset, live App-URL) and S19 (address verification). Mail
 * delivery is replaced by a recorder; the tokens are read back out of the mails the
 * way a user would get them.
 */
const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
const smtp = vi.hoisted(() => ({ configured: true }));
vi.mock('./email', () => ({
  isEmailConfigured: () => smtp.configured,
  sendHtmlEmail: async (to: string, subject: string, html: string) => { sent.push({ to, subject, html }); },
  sendTestEmail: async () => {},
}));

async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-account-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.APP_URL = 'https://app.example';
  process.env.ALLOW_REGISTRATION = 'true';
  vi.resetModules();
  const mod = await import('./index');
  const db = await import('./db');
  const app: FastifyInstance = await mod.buildApp();
  tmpDirs.push(dir);
  return { app, db };
}

const tmpDirs: string[] = [];
beforeEach(() => { sent.length = 0; smtp.configured = true; });
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.APP_URL;
  delete process.env.ALLOW_REGISTRATION;
});

async function register(app: FastifyInstance, username: string, password = 'password123'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function tokenFrom(mail: { html: string }, route: string): string {
  const m = new RegExp(`#/${route}\\?token=([0-9a-f]{64})`).exec(mail.html);
  expect(m).not.toBeNull();
  return m![1];
}

/** Mails for forgot-password go out after the response. */
const flush = () => new Promise((r) => setImmediate(r));

async function setEmail(app: FastifyInstance, token: string, email: string) {
  return app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` }, payload: { email, password: 'password123' } });
}

async function verifiedUser(app: FastifyInstance, username: string, email: string): Promise<string> {
  const token = await register(app, username);
  const res = await setEmail(app, token, email);
  expect(res.json()).toMatchObject({ ok: true, verificationSent: true });
  const mail = sent.pop()!;
  expect(mail.to).toBe(email);
  const verify = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: tokenFrom(mail, 'email-bestaetigen') } });
  expect(verify.statusCode).toBe(200);
  // Setting the address ended the registration session and returned a fresh one (#480).
  expect(token).not.toBe(res.json().token);
  return (res.json() as { token: string }).token;
}

describe('e-mail verification (#324 S19)', () => {
  it('mails a link when an address is set, and the link marks it verified', async () => {
    const { app } = await createTestApp();
    const first = await register(app, 'anna');
    const token = (await setEmail(app, first, 'Anna@Example.org')).json().token as string;
    const mail = sent.pop()!;
    expect(mail.to).toBe('anna@example.org');
    expect(mail.html).toContain('https://app.example/#/email-bestaetigen?token=');

    const me = async () => (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } })).json();
    expect((await me()).emailVerified).toBe(false);
    const res = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: tokenFrom(mail, 'email-bestaetigen') } });
    expect(res.statusCode).toBe(200);
    expect((await me()).emailVerified).toBe(true);
    // Single use.
    expect((await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: tokenFrom(mail, 'email-bestaetigen') } })).statusCode).toBe(400);
  });

  it('makes a changed address unverified again, and leaves an unchanged one alone', async () => {
    const { app, db } = await createTestApp();
    const token = await verifiedUser(app, 'anna', 'anna@example.org');
    expect((await setEmail(app, token, 'anna@example.org')).json()).toMatchObject({ verificationSent: false });
    expect(db.getUser('anna')?.email_verified).toBe(true);
    expect((await setEmail(app, token, 'new@example.org')).json()).toMatchObject({ verificationSent: true });
    expect(db.getUser('anna')?.email_verified).toBeUndefined();
  });

  it('refuses a resend within the hour', async () => {
    const { app } = await createTestApp();
    const first = await register(app, 'anna');
    const token = (await setEmail(app, first, 'anna@example.org')).json().token as string;
    const res = await app.inject({ method: 'POST', url: '/api/auth/email/resend', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(429);
  });

  it('takes an optional address at registration and mails the link after the response', async () => {
    const { app, db } = await createTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'anna', password: 'password123', email: ' Anna@Example.org ' } });
    expect(res.statusCode).toBe(200);
    expect(db.getUser('anna')?.email).toBe('anna@example.org');
    await flush();
    expect(sent.map((m) => m.to)).toEqual(['anna@example.org']);

    const bad = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ben', password: 'password123', email: 'nope' } });
    expect(bad.statusCode).toBe(400);
    expect(db.getUser('ben')).toBeUndefined();
  });

  it('refuses an address that nodemailer would parse as more than one recipient (#409)', async () => {
    const candidates = ['a@example.org,b@example.org', 'a@example.org;b@example.org', 'x<b@example.org>@example.org', 'a@example.org (c@example.org)', 'a b@example.org', '"a"@example.org'];
    for (const [i, email] of candidates.entries()) {
      // A fresh app per address: registration is rate-limited per IP.
      const { app, db } = await createTestApp();
      const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: `user${i}`, password: 'password123', email } });
      expect(res.statusCode, email).toBe(400);
      expect(db.getUser(`user${i}`)).toBeUndefined();
    }
    await flush();
    expect(sent).toHaveLength(0);
  });

  it('refuses a malformed or unknown token', async () => {
    const { app } = await createTestApp();
    for (const token of ['x', 'a'.repeat(64), undefined]) {
      expect((await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token } })).statusCode).toBe(400);
    }
  });
});

describe('password reset (#324 S17)', () => {
  it('mails a one-hour link for a verified address; the new password works and old sessions die', async () => {
    const { app } = await createTestApp();
    const oldToken = await verifiedUser(app, 'anna', 'anna@example.org');

    const forgot = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna@example.org' } });
    expect(forgot.statusCode).toBe(200);
    await flush();
    const mail = sent.pop()!;
    expect(mail.to).toBe('anna@example.org');
    const resetToken = tokenFrom(mail, 'passwort-neu');

    const reset = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token: resetToken, password: 'brand-new-secret' } });
    expect(reset.statusCode).toBe(200);

    const login = (password: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'anna', password } });
    expect((await login('password123')).statusCode).toBe(401);
    expect((await login('brand-new-secret')).statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${oldToken}` } });
    expect(me.statusCode).toBe(401);

    // The link works once.
    const again = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token: resetToken, password: 'another-secret' } });
    expect(again.statusCode).toBe(400);
  });

  it('also finds the account by username', async () => {
    const { app } = await createTestApp();
    await verifiedUser(app, 'anna', 'anna@example.org');
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('answers identically for an unknown account, an unverified address and a known one, and mails only the last', async () => {
    const { app } = await createTestApp();
    await verifiedUser(app, 'anna', 'anna@example.org');
    const unverified = await register(app, 'ben');
    await setEmail(app, unverified, 'ben@example.org');
    sent.length = 0;

    const bodies = [];
    for (const identifier of ['nobody@example.org', 'ben@example.org', 'anna@example.org']) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier } });
      bodies.push([res.statusCode, res.body]);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    await flush();
    expect(sent.map((m) => m.to)).toEqual(['anna@example.org']);
  });

  it('does not mail the same account twice within a minute', async () => {
    const { app } = await createTestApp();
    await verifiedUser(app, 'anna', 'anna@example.org');
    for (let i = 0; i < 2; i++) await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('refuses an expired link', async () => {
    const { app, db } = await createTestApp();
    await verifiedUser(app, 'anna', 'anna@example.org');
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await flush();
    const token = tokenFrom(sent.pop()!, 'passwort-neu');
    db.patchUser('anna', { reset_expires: Date.now() - 1 });
    const res = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password: 'brand-new-secret' } });
    expect(res.statusCode).toBe(400);
  });

  it('says so when the server cannot send mail, and registration-status reports it', async () => {
    const { app } = await createTestApp();
    await register(app, 'owner');
    smtp.configured = false;
    expect((await app.inject({ method: 'GET', url: '/api/auth/registration-status' })).json()).toMatchObject({ passwordReset: false });
    const res = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'owner' } });
    expect(res.statusCode).toBe(503);
    smtp.configured = true;
    expect((await app.inject({ method: 'GET', url: '/api/auth/registration-status' })).json()).toMatchObject({ passwordReset: true });
  });
});

describe('App-URL read live (#324 S17)', () => {
  it('uses a value saved in the panel for links right away, without a restart', async () => {
    const { app } = await createTestApp();
    const admin = await register(app, 'owner');
    const auth = { authorization: `Bearer ${admin}` };
    const save = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: auth, payload: { appUrl: 'https://panel.example/' } });
    expect(save.statusCode).toBe(200);
    const settings = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: auth })).json();
    expect(settings).toMatchObject({ appUrl: 'https://panel.example', appUrlSource: 'panel', appUrlRequiresRestart: false });

    await setEmail(app, admin, 'owner@example.org');
    expect(sent.pop()!.html).toContain('https://panel.example/#/email-bestaetigen?token=');
  });

  it('refuses anything but a plain http(s) URL', async () => {
    const { app } = await createTestApp();
    const admin = await register(app, 'owner');
    for (const appUrl of ['javascript:alert(1)', 'https://x.example/?a=1', 'https://x.example/#f', 'https://u:p@x.example', 'not a url']) {
      const res = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: { authorization: `Bearer ${admin}` }, payload: { appUrl } });
      expect(res.statusCode, appUrl).toBe(400);
    }
  });
});

describe('removing the account address (#471)', () => {
  it('a verified link that went out before still dies, and a later reset mails nothing', async () => {
    const { app } = await createTestApp();
    const token = await verifiedUser(app, 'anna', 'anna@example.org');
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier: 'anna' } });
    await flush();
    const resetToken = tokenFrom(sent.pop()!, 'passwort-neu');

    const removed = await app.inject({
      method: 'POST', url: '/api/auth/email/remove', headers: { authorization: `Bearer ${token}` }, payload: { password: 'password123' },
    });
    expect(removed.statusCode).toBe(200);
    // The reset link mailed to the removed address no longer works.
    const reset = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token: resetToken, password: 'brand-new-secret' } });
    expect(reset.statusCode).toBe(400);

    for (const identifier of ['anna@example.org', 'anna']) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { identifier } });
      expect(res.statusCode).toBe(200);
    }
    await flush();
    expect(sent).toHaveLength(0);
  });
});

describe('account mails, piece by piece (#498)', () => {
  // The mail module is pure; no app, no mail transport.
  const load = () => import('./accountMail');
  const TOKEN = 'ab'.repeat(32);

  /** Pulls the visible parts out of mailHtml()'s fixed template. */
  function parts(html: string) {
    const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    const title = /<h2[^>]*>(.*?)<\/h2>/s.exec(html)?.[1] ?? '';
    const paragraphs = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gs)].map((m) => m[1]);
    const href = /<a href="([^"]*)"/.exec(html)?.[1] ?? '';
    const button = /<a href="[^"]*"[^>]*>(.*?)<\/a>/s.exec(html)?.[1] ?? '';
    return { title: decode(title), paragraphs: paragraphs.map(decode), href: decode(href), button: decode(button) };
  }

  describe('tokens', () => {
    it('hands out 64 hex characters, stores only their sha256, and never repeats', async () => {
      const m = await load();
      const a = m.newAccountToken();
      const b = m.newAccountToken();
      expect(a.token).toMatch(/^[0-9a-f]{64}$/);
      expect(a.token).not.toBe(b.token);
      expect(a.hash).toBe(m.hashAccountToken(a.token));
      expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(a.hash).not.toBe(a.token);
      // sha256("abc"), so the hash really is sha256 hex
      expect(m.hashAccountToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('recognises a well-formed token by shape alone', async () => {
      const m = await load();
      expect(m.isWellFormedToken(TOKEN)).toBe(true);
      for (const bad of [undefined, null, 5, {}, [TOKEN], '', TOKEN.slice(1), `${TOKEN}0`, TOKEN.toUpperCase(),
        `${TOKEN.slice(1)}g`, ` ${TOKEN}`, `${TOKEN}\n`, `x${TOKEN}`]) {
        expect(m.isWellFormedToken(bad)).toBe(false);
      }
    });

    it('keeps the documented lifetimes', async () => {
      const m = await load();
      expect(m.RESET_TTL_MS).toBe(3_600_000);
      expect(m.VERIFY_TTL_MS).toBe(86_400_000);
      expect(m.RESET_RESEND_MS).toBe(60_000);
      expect(m.VERIFY_RESEND_MS).toBe(3_600_000);
    });
  });

  describe('maskEmail', () => {
    it('keeps the first letter and the domain, and shows nothing for something that is no address', async () => {
      const m = await load();
      expect(m.maskEmail('jane@example.org')).toBe('j***@example.org');
      expect(m.maskEmail('a@b.de')).toBe('a***@b.de');
      expect(m.maskEmail('x@y@z.de')).toBe('x***@z.de'); // the last @ is the separator
      expect(m.maskEmail('@example.org')).toBe('***'); // nothing before the @
      expect(m.maskEmail('no-at-sign')).toBe('***');
      expect(m.maskEmail('')).toBe('***');
    });
  });

  describe('reset mail', () => {
    it('carries a one-use hash link to the reset page, and says so', async () => {
      const m = await load();
      const mail = m.resetMail('NailVault', 'https://app.example', 'jane', TOKEN);
      const p = parts(mail.html);
      expect(mail.subject).toBe('NailVault: Passwort zurücksetzen');
      expect(p.title).toBe('Passwort zurücksetzen');
      expect(p.paragraphs[0]).toBe('Für das Konto „jane“ wurde ein neues Passwort angefordert. Der Link gilt eine Stunde und nur einmal.');
      expect(p.href).toBe(`https://app.example/#/passwort-neu?token=${TOKEN}`);
      expect(p.button).toBe('Neues Passwort festlegen');
      expect(p.paragraphs.at(-1)).toBe('Wenn du das nicht angefordert hast, kannst du diese Mail ignorieren; dein Passwort bleibt unverändert.');
      // the fallback paragraph repeats the link as text
      expect(p.paragraphs[2]).toContain(p.href);
    });

    it('escapes everything it interpolates', async () => {
      const m = await load();
      const mail = m.resetMail('A&B', 'https://app.example', '<b>"x"&</b>', TOKEN);
      expect(mail.html).not.toContain('<b>');
      expect(mail.html).toContain('&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;');
      // a quote in the link cannot break out of the href attribute
      const evil = m.resetMail('A', 'https://app.example/"onmouseover="x', 'u', TOKEN);
      expect(evil.html).toContain('href="https://app.example/&quot;onmouseover=&quot;x/#/passwort-neu');
      expect(evil.html).not.toContain('href="https://app.example/"');
    });
  });

  describe('verification mail', () => {
    it('links to the verification page and states the 24 hours', async () => {
      const m = await load();
      const mail = m.verifyMail('NailVault', 'https://app.example', 'jane', TOKEN);
      const p = parts(mail.html);
      expect(mail.subject).toBe('NailVault: E-Mail-Adresse bestätigen');
      expect(p.title).toBe('E-Mail-Adresse bestätigen');
      expect(p.paragraphs[0]).toBe('Bitte bestätige, dass diese Adresse zum Konto „jane“ gehört. Erst dann kann über sie ein vergessenes Passwort zurückgesetzt werden. Der Link gilt 24 Stunden.');
      expect(p.href).toBe(`https://app.example/#/email-bestaetigen?token=${TOKEN}`);
      expect(p.button).toBe('Adresse bestätigen');
      expect(p.paragraphs.at(-1)).toBe('Wenn du kein Konto angelegt hast, kannst du diese Mail ignorieren.');
    });
  });

  describe('report recipient mail (#449)', () => {
    it.each<['weekly' | 'monthly', string]>([['weekly', 'wöchentlich'], ['monthly', 'monatlich']])(
      'names the sender, the %s rhythm, what is stored and how to ignore it', async (frequency, word) => {
        const m = await load();
        const mail = m.reportRecipientMail('NailVault', 'https://app.example', 'jane', frequency, TOKEN);
        const p = parts(mail.html);
        expect(mail.subject).toBe('NailVault: Bericht an diese Adresse erlauben?');
        expect(p.title).toBe('Bericht an diese Adresse erlauben?');
        expect(p.paragraphs[0]).toBe(
          `Das Konto „jane“ auf NailVault möchte ${word} eine E-Mail mit einem Bericht über die eigene Nagellack-Sammlung (Lacke, Sticker, Maniküren, Fotos) an diese Adresse senden. Der Link gilt 48 Stunden.`,
        );
        expect(p.href).toBe(`https://app.example/#/bericht-bestaetigen?token=${TOKEN}`);
        expect(p.button).toBe('Ja, Berichte an diese Adresse senden');
        expect(p.paragraphs.at(-1)).toBe(
          'Ohne deine Bestätigung wird nichts an diese Adresse gesendet; wenn du die Mail nicht erwartet hast, ignoriere sie einfach. '
          + 'Jeder Bericht enthält unten einen Link zum Abbestellen. '
          + 'Gespeichert wird nur deine E-Mail-Adresse, und nur zum Versand dieser Berichte. '
          + 'Verantwortlich ist der Betreiber von NailVault; Angaben zum Datenschutz stehen unter https://app.example/#/datenschutz.',
        );
      });
  });

  describe('notices without a link', () => {
    it('tells the old address that the address changed, shows only a masked new one, and carries the takeover advice', async () => {
      const m = await load();
      const mail = m.emailChangedMail('NailVault', 'jane', 'jane.doe@example.org');
      const p = parts(mail.html);
      expect(mail.subject).toBe('NailVault: E-Mail-Adresse deines Kontos geändert');
      expect(p.title).toBe('E-Mail-Adresse geändert');
      expect(p.paragraphs[0]).toBe('Die E-Mail-Adresse des Kontos „jane“ wurde auf j***@example.org geändert. Alle bis jetzt verschickten Links zum Zurücksetzen des Passworts und zum Bestätigen einer Adresse sind ungültig.');
      expect(p.paragraphs[1]).toBe(m.TAKEOVER_ADVICE);
      expect(mail.html).not.toContain('jane.doe');
      expect(mail.html).not.toContain('<a ');
    });

    it('tells the account address that the password changed', async () => {
      const m = await load();
      const mail = m.passwordChangedMail('NailVault', 'jane');
      const p = parts(mail.html);
      expect(mail.subject).toBe('NailVault: Passwort geändert');
      expect(p.title).toBe('Passwort geändert');
      expect(p.paragraphs[0]).toBe('Das Passwort des Kontos „jane“ wurde in der App geändert. Alle anderen Sitzungen dieses Kontos sind damit beendet.');
      expect(p.paragraphs[1]).toBe(
        'Warst du das nicht, setze das Passwort sofort über „Passwort vergessen?“ zurück, prüfe unter Einstellungen → Sicherheit die Liste deiner Passkeys '
        + 'und entferne jeden, den du nicht kennst, und sage dem Betreiber Bescheid.',
      );
      expect(mail.html).not.toContain('<a ');
    });

    it.each<['added' | 'removed', string, string, string]>([
      ['added', 'hinzugefügt', 'Neuer Passkey',
        'Zum Konto „jane“ wurde der Passkey „Phone“ hinzugefügt. Mit ihm kann man sich ohne Passwort und ohne 2FA-Code anmelden.'],
      ['removed', 'entfernt', 'Passkey entfernt',
        'Vom Konto „jane“ wurde der Passkey „Phone“ entfernt. Mit ihm ist keine Anmeldung mehr möglich.'],
    ])('describes a passkey that was %s', async (kind, word, title, text) => {
      const m = await load();
      const mail = m.passkeyChangedMail('NailVault', 'jane', kind, 'Phone');
      const p = parts(mail.html);
      expect(mail.subject).toBe(`NailVault: Passkey ${word}`);
      expect(p.title).toBe(title);
      expect(p.paragraphs[0]).toBe(text);
      expect(p.paragraphs[1]).toBe(m.TAKEOVER_ADVICE);
      expect(mail.html).not.toContain('<a ');
    });

    it('gives advice that covers every way back in', async () => {
      const m = await load();
      expect(m.TAKEOVER_ADVICE).toBe(
        'Warst du das nicht, kennt jemand dein Passwort: Melde dich an, stelle unter Einstellungen → Sync deine Adresse wieder ein und bestätige sie, '
        + 'ändere dann unter Einstellungen → Sicherheit dein Passwort (oder setze es über „Passwort vergessen?“ zurück), melde dich über „Von allen Geräten abmelden…“ überall ab, '
        + 'prüfe unter Einstellungen → Sicherheit die Liste deiner Passkeys und entferne jeden, den du nicht kennst, und sage dem Betreiber Bescheid.',
      );
    });
  });
});
