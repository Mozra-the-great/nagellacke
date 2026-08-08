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
 *  falling back to whatever is already configured for any field left out. */
export async function sendTestEmail(to: string, override?: Partial<SmtpConfig>): Promise<void> {
  const base = getSmtpConfig();
  const cfg: SmtpConfig | null = override
    ? {
        host: override.host || base?.host || '',
        port: override.port || base?.port || 587,
        user: override.user || base?.user || '',
        pass: override.pass || base?.pass || '',
        from: override.from || base?.from || override.user || base?.user || '',
        secure: override.secure ?? base?.secure ?? (override.port === 465),
      }
    : base;
  if (!cfg || !cfg.host || !cfg.user || !cfg.pass) {
    throw new Error('SMTP-Konfiguration unvollständig — Host, Benutzer und Passwort erforderlich.');
  }
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
  await transporter.sendMail({
    from: cfg.from,
    to,
    subject: '💅 Nagellacke — Test-E-Mail',
    html: '<p>Diese Test-E-Mail bestätigt, dass die SMTP-Konfiguration funktioniert.</p>',
  });
}
