import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// nodemailer is mocked at the module level (not per-test resetModules) so we
// can assert whether a connection was even attempted, and inspect exactly
// which credential/host it would have used, without ever touching a real
// network socket.
interface TransportOptions {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}

const sendMail = vi.fn().mockResolvedValue(undefined);
const createTransport = vi.fn((_opts: TransportOptions) => ({ sendMail }));
vi.mock('nodemailer', () => ({ createTransport }));

/**
 * Regression tests for PR #216 review blocker 1 (SMTP test-send credential
 * exfiltration): `sendTestEmail()`'s override logic let `host` be freely
 * overridden while `pass` silently fell back to the stored/env password.
 * Anyone holding an admin bearer token (no SMTP password needed) could send
 * POST /api/admin/settings/smtp/test with an attacker-controlled host and
 * have the server authenticate there with the real stored SMTP_PASS via
 * AUTH LOGIN/PLAIN, defeating the `hasPassword`-masking guarantee of
 * GET /api/admin/settings.
 *
 * db.ts captures DATA_DIR at import time, so DATA_DIR must be set *before*
 * the first import in each test — vi.resetModules() + a fresh dynamic
 * import per test gives full isolation (see admin.test.ts/db.test.ts for
 * the same pattern).
 */
async function freshEmail(smtp?: { host: string; port: number; user: string; pass: string; from: string; secure: boolean }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-email-test-'));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  const db = await import('./db');
  if (smtp) db.setServerSettings({ smtp });
  const email = await import('./email');
  return { email, dir };
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  createTransport.mockClear();
  sendMail.mockClear();
});

const storedSmtp = {
  host: 'smtp.stored.example', port: 587, user: 'stored-user',
  pass: 'real-secret-pass', from: 'a@b.c', secure: false,
};

describe('sendTestEmail — credential/host binding (PR #216 review item 1)', () => {
  it('rejects a test-send to an overridden host without an explicit password, and never attempts a connection', async () => {
    const { email, dir } = await freshEmail(storedSmtp);
    tmpDirs.push(dir);
    await expect(email.sendTestEmail('x@evil.example', { host: 'attacker.example', port: 2525, secure: false }))
      .rejects.toThrow(/unvollständig/);
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects a test-send with an overridden user (stored host) without an explicit password', async () => {
    const { email, dir } = await freshEmail(storedSmtp);
    tmpDirs.push(dir);
    await expect(email.sendTestEmail('x@evil.example', { user: 'someone-else' }))
      .rejects.toThrow(/unvollständig/);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('rejects entirely when nothing is stored yet and no password is supplied, host overridden', async () => {
    const { email, dir } = await freshEmail(); // no stored SMTP config at all
    tmpDirs.push(dir);
    await expect(email.sendTestEmail('x@evil.example', { host: 'attacker.example', user: 'u' }))
      .rejects.toThrow(/unvollständig/);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('uses only the explicitly supplied password for an overridden host — never the stored one', async () => {
    const { email, dir } = await freshEmail(storedSmtp);
    tmpDirs.push(dir);
    await email.sendTestEmail('x@evil.example', { host: 'attacker.example', pass: 'attacker-supplied-pass' });
    expect(createTransport).toHaveBeenCalledTimes(1);
    const cfg = createTransport.mock.calls[0][0];
    expect(cfg.host).toBe('attacker.example');
    expect(cfg.auth.pass).toBe('attacker-supplied-pass');
    expect(cfg.auth.pass).not.toBe(storedSmtp.pass);
  });

  it('still falls back to the stored password for a plain test-send that overrides neither host nor user', async () => {
    const { email, dir } = await freshEmail(storedSmtp);
    tmpDirs.push(dir);
    await email.sendTestEmail('x@ok.example', { port: 465, secure: true });
    expect(createTransport).toHaveBeenCalledTimes(1);
    const cfg = createTransport.mock.calls[0][0];
    expect(cfg.host).toBe(storedSmtp.host);
    expect(cfg.auth.pass).toBe(storedSmtp.pass);
  });

  it('rejects when the override host is identical to the stored host but no password is given and none is stored', async () => {
    const { email, dir } = await freshEmail({ ...storedSmtp, pass: '' });
    tmpDirs.push(dir);
    await expect(email.sendTestEmail('x@ok.example', { host: storedSmtp.host }))
      .rejects.toThrow(/unvollständig/);
  });

  // A blank `""` password must be treated the same as "not supplied" - not
  // as "explicitly confirmed empty", which would otherwise be a second way
  // to smuggle the stored password's *absence* past the guard while still
  // technically satisfying `pass !== undefined`. (The web admin panel
  // already normalizes a blank password field to `undefined` before
  // sending, but the server-side guard must not depend on that.)
  it('an explicit empty-string password does not count as an override — still rejects the changed-host case', async () => {
    const { email, dir } = await freshEmail(storedSmtp);
    tmpDirs.push(dir);
    await expect(email.sendTestEmail('x@evil.example', { host: 'attacker.example', pass: '' }))
      .rejects.toThrow(/unvollständig/);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('an explicit empty-string password still falls back to the stored one on the unchanged-host path', async () => {
    const { email, dir } = await freshEmail(storedSmtp);
    tmpDirs.push(dir);
    await email.sendTestEmail('x@ok.example', { pass: '' });
    expect(createTransport).toHaveBeenCalledTimes(1);
    const cfg = createTransport.mock.calls[0][0];
    expect(cfg.auth.pass).toBe(storedSmtp.pass);
  });

  // The finding explicitly calls out that this must hold for an env-pinned
  // SMTP_PASS the operator deliberately never put in the admin panel, not
  // just a panel-stored one.
  it('never falls back to an env-pinned SMTP_PASS for an overridden host either', async () => {
    process.env.SMTP_HOST = 'smtp.env.example';
    process.env.SMTP_USER = 'env-user';
    process.env.SMTP_PASS = 'env-secret-pass';
    const { email, dir } = await freshEmail(); // nothing in the panel - env only
    tmpDirs.push(dir);
    await expect(email.sendTestEmail('x@evil.example', { host: 'attacker.example' }))
      .rejects.toThrow(/unvollständig/);
    expect(createTransport).not.toHaveBeenCalled();
  });
});
