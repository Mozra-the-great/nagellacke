import * as nodemailer from 'nodemailer';
import { getServerSettings } from './db';

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
}

/**
 * A panel value (server_settings.json) wins over the corresponding env var
 * per field — see the precedence-rule comment on ServerSettings in db.ts.
 * The whole config counts as "configured" only once host/user/pass are
 * present from either source; a field missing from both is empty.
 */
function getSmtpConfig(): SmtpConfig | null {
  const panel = getServerSettings().smtp;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const host = panel?.host || SMTP_HOST;
  const user = panel?.user || SMTP_USER;
  const pass = panel?.pass || SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = panel?.port || parseInt(SMTP_PORT ?? '587', 10);
  const from = panel?.from || SMTP_FROM || user;
  const secure = panel?.secure ?? (port === 465);
  return { host, port, user, pass, from, secure };
}

export function isEmailConfigured(): boolean {
  return getSmtpConfig() !== null;
}

export async function sendHtmlEmail(to: string, subject: string, html: string): Promise<void> {
  const cfg = getSmtpConfig();
  if (!cfg) throw new Error('E-Mail nicht konfiguriert. Bitte SMTP unter Admin → Server-Einstellungen oder als Umgebungsvariablen (SMTP_HOST, SMTP_USER, SMTP_PASS) setzen.');

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  await transporter.sendMail({
    from: cfg.from,
    to,
    subject,
    html,
  });
}

/** Sends a test email using an inline config override (before it's saved),
 *  falling back to whatever is already configured for any field left out.
 *
 *  SECURITY: the stored/env password must never be reused against a
 *  *different* destination than the one it was configured for. Overriding
 *  `host` or `user` therefore requires `pass` to be supplied in the very
 *  same call — otherwise an admin bearer token alone (no knowledge of the
 *  real SMTP password) could redirect this test-send to an
 *  attacker-controlled host and have the server authenticate there with the
 *  real stored/env credential, exfiltrating it via the SMTP handshake. This
 *  was a review finding on PR #216 — see the regression tests in
 *  email.test.ts. */
export async function sendTestEmail(to: string, override?: Partial<SmtpConfig>): Promise<void> {
  const base = getSmtpConfig();
  let cfg: SmtpConfig | null;
  if (override) {
    const hostChanged = override.host !== undefined && override.host !== base?.host;
    const userChanged = override.user !== undefined && override.user !== base?.user;
    // Only fall back to the stored/env password when neither host nor user
    // actually changed — an explicit, non-empty override.pass always wins
    // regardless. A truthy check (not `!== undefined`) is deliberate: an
    // empty-string pass from a caller means "no override supplied" (the web
    // admin panel's password field already normalizes to `undefined` on
    // blank, but this must hold for any client, including one that sends a
    // literal `""`) — it must never itself count as "explicitly confirmed
    // empty password" and thus bypass the stored-password fallback guard.
    const pass = override.pass
      ? override.pass
      : (hostChanged || userChanged ? '' : base?.pass ?? '');
    // The same reasoning applies to turning TLS *off*: with an unchanged
    // host/user the stored password is reused, so honouring `secure: false`
    // would put that credential on the wire in the clear against the real
    // server. An explicit pass in the request is the caller confirming which
    // credential they are exposing; without it, a downgrade keeps the stored
    // setting. Raising security (secure: true) needs no such confirmation.
    const usingStoredPass = !override.pass;
    const downgradingTls = override.secure === false;
    const secure = usingStoredPass && downgradingTls
      ? (base?.secure ?? (override.port === 465))
      : (override.secure ?? base?.secure ?? (override.port === 465));
    cfg = {
      host: override.host || base?.host || '',
      port: override.port || base?.port || 587,
      user: override.user || base?.user || '',
      pass,
      from: override.from || base?.from || override.user || base?.user || '',
      secure,
    };
  } else {
    cfg = base;
  }
  if (!cfg || !cfg.host || !cfg.user || !cfg.pass) {
    throw new Error('SMTP-Konfiguration unvollständig — Host, Benutzer und Passwort erforderlich.');
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  // NOTE (checked, not changed - PR #216 review item 5's "does it echo
  // credentials back" question): no code path here ever places cfg.pass
  // into a thrown Error's message - nodemailer's connection/auth failures
  // ("Invalid login: 535 ...") surface the destination host/port and the
  // upstream SMTP server's own response text, not the credential we sent.
  // The same holds for callGemini/callOpenRouter in ai.ts, whose thrown
  // errors are built from `res.text()` — the provider's own response body,
  // never something this client writes the API key into.
  await transporter.sendMail({
    from: cfg.from,
    to,
    subject: '💅 Nagellacke — Test-E-Mail',
    html: '<p>Diese Test-E-Mail bestätigt, dass die SMTP-Konfiguration funktioniert.</p>',
  });
}
