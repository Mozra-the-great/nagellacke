import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { signRecipientToken } from './reportRecipient';
import { verifyUnsubscribeToken } from './reportUnsubscribe';

/**
 * #457: every report mail carries a signed unsubscribe link and the RFC 8058 headers; using it
 * pauses the schedule, removes the confirmation, is idempotent and tells the owner. Mail delivery
 * is a recorder that keeps the headers.
 */
interface Mail { to: string; subject: string; html: string; headers?: Record<string, string> }
const sent = vi.hoisted(() => [] as Mail[]);
vi.mock('./email', () => ({
  isEmailConfigured: () => true,
  sendHtmlEmail: async (to: string, subject: string, html: string, headers?: Record<string, string>) => {
    sent.push({ to, subject, html, headers });
  },
  sendTestEmail: async () => {},
}));

const SECRET = 'test-jwt-secret-do-not-use-in-prod';
const MONDAY_8_UTC = new Date(Date.UTC(2026, 10, 16, 8, 0, 0));
const tmpDirs: string[] = [];

async function createTestApp(appUrl = 'https://app.example') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-unsub-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = SECRET;
  if (appUrl) process.env.APP_URL = appUrl; else delete process.env.APP_URL;
  process.env.ALLOW_REGISTRATION = 'true';
  vi.resetModules();
  const mod = await import('./index');
  const app: FastifyInstance = await mod.buildApp();
  tmpDirs.push(dir);
  return { app, mod, dir };
}

beforeEach(() => { sent.length = 0; });
afterEach(() => {
  vi.useRealTimers();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.APP_URL;
  delete process.env.ALLOW_REGISTRATION;
});

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'password123' } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

function save(app: FastifyInstance, token: string, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/reports/schedule', headers: auth(token), payload: body });
}
type View = {
  config: { enabled: boolean; toEmail: string } | null;
  recipient: { status: string; via?: string; unsubscribedAt?: number; blocked?: boolean };
  sendTargets: { email: string }[];
};
async function view(app: FastifyInstance, token: string): Promise<View> {
  return (await app.inject({ method: 'GET', url: '/api/reports/schedule', headers: auth(token) })).json() as View;
}
function confirmationToken(mail: Mail): string {
  return /#\/bericht-bestaetigen\?token=([A-Za-z0-9_.-]+)/.exec(mail.html)![1]!;
}
async function confirmRecipient(app: FastifyInstance, token: string, email: string): Promise<void> {
  expect((await save(app, token, { enabled: true, frequency: 'weekly', toEmail: email })).statusCode).toBe(200);
  const res = await app.inject({ method: 'POST', url: '/api/reports/schedule/confirm', payload: { token: confirmationToken(sent.pop()!) } });
  expect(res.statusCode).toBe(200);
}
async function verifyOwnAddress(app: FastifyInstance, token: string, email: string): Promise<void> {
  await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(token), payload: { email } });
  const link = /#\/email-bestaetigen\?token=([0-9a-f]{64})/.exec(sent.pop()!.html)![1];
  expect((await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: link } })).statusCode).toBe(200);
}

/** The unsubscribe token as the recipient's mail client would find it in the List-Unsubscribe header. */
function headerToken(mail: Mail): string {
  const value = mail.headers?.['List-Unsubscribe'];
  expect(value).toBeDefined();
  const m = /^<https?:\/\/[^/]+\/api\/reports\/unsubscribe\?token=([A-Za-z0-9_.-]+)>$/.exec(value!);
  expect(m).not.toBeNull();
  return m![1]!;
}
const oneClick = (app: FastifyInstance, token: string) => app.inject({
  method: 'POST',
  url: `/api/reports/unsubscribe?token=${token}`,
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  payload: 'List-Unsubscribe=One-Click',
});
const viaPage = (app: FastifyInstance, token: unknown) => app.inject({ method: 'POST', url: '/api/reports/unsubscribe', payload: { token } });

const FRIEND = 'friend@example.org';
const OWN = 'anna@example.org';

/** A confirmed third-party schedule and the first scheduled mail it sends. */
async function scheduledMailToFriend(ctx: Awaited<ReturnType<typeof createTestApp>>) {
  const token = await register(ctx.app, 'anna');
  await confirmRecipient(ctx.app, token, FRIEND);
  await ctx.mod.runReportSchedules(MONDAY_8_UTC);
  expect(sent).toHaveLength(1);
  return { token, mail: sent[0]! };
}

describe('every report mail carries the link and the headers (#457)', () => {
  it('the scheduled mail has List-Unsubscribe, List-Unsubscribe-Post and a footer link for the same address', async () => {
    const ctx = await createTestApp();
    const { mail } = await scheduledMailToFriend(ctx);
    expect(mail.to).toBe(FRIEND);
    expect(mail.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const token = headerToken(mail);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual({ u: 'anna', e: FRIEND });
    expect(mail.html).toContain(`https://app.example/#/bericht-abbestellen?token=${token}`);
    expect(mail.html).toContain('Abbestellen');
  });

  it('the ad-hoc mail to the confirmed recipient has them too', async () => {
    const ctx = await createTestApp();
    const token = await register(ctx.app, 'anna');
    await confirmRecipient(ctx.app, token, FRIEND);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/reports/send', headers: auth(token), payload: { period: 'week', toEmail: FRIEND } });
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers!['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(verifyUnsubscribeToken(headerToken(sent[0]!), SECRET)).toEqual({ u: 'anna', e: FRIEND });
    expect(sent[0]!.html).toContain('#/bericht-abbestellen?token=');
  });

  it('the own address gets them as well', async () => {
    const ctx = await createTestApp();
    const token = await register(ctx.app, 'anna');
    await verifyOwnAddress(ctx.app, token, OWN);
    await ctx.app.inject({ method: 'POST', url: '/api/reports/send', headers: auth(token), payload: { period: 'week', toEmail: OWN } });
    expect(verifyUnsubscribeToken(headerToken(sent[0]!), SECRET)).toEqual({ u: 'anna', e: OWN });
  });

  it('a plain http App-URL gets the link but no one-click header', async () => {
    const ctx = await createTestApp('http://192.168.0.5:3000');
    const token = await register(ctx.app, 'anna');
    await confirmRecipient(ctx.app, token, FRIEND);
    await ctx.mod.runReportSchedules(MONDAY_8_UTC);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.headers!['List-Unsubscribe']).toContain('http://192.168.0.5:3000/api/reports/unsubscribe?token=');
    expect(sent[0]!.headers).not.toHaveProperty('List-Unsubscribe-Post');
  });

  it('the preview is not a mail and has no link', async () => {
    const ctx = await createTestApp();
    const token = await register(ctx.app, 'anna');
    const res = await ctx.app.inject({ method: 'GET', url: '/api/reports/preview?period=week', headers: auth(token) });
    expect(res.body).not.toContain('bericht-abbestellen');
  });

  it('the confirmation mail tells the recipient that every report has an unsubscribe link', async () => {
    const ctx = await createTestApp();
    const token = await register(ctx.app, 'anna');
    await save(ctx.app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    expect(sent[0]!.html).toContain('Link zum Abbestellen');
  });
});

describe('POST /api/reports/unsubscribe (#457)', () => {
  it('one-click from a mail client (form body, token in the query): pauses, unconfirms, blocks, tells the owner', async () => {
    const ctx = await createTestApp();
    const { token, mail } = await scheduledMailToFriend(ctx);
    const res = await oneClick(ctx.app, headerToken(mail));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, email: FRIEND });

    const v = await view(ctx.app, token);
    expect(v.config).toMatchObject({ enabled: false, toEmail: FRIEND });
    expect(v.recipient.status).toBe('pending'); // the confirmation is gone
    expect(v.recipient.blocked).toBe(true);
    expect(v.recipient.unsubscribedAt).toBeGreaterThan(0); // the in-UI notice for the owner
    expect(v.sendTargets.map((t) => t.email)).not.toContain(FRIEND);

    sent.length = 0;
    await ctx.mod.runReportSchedules(new Date(MONDAY_8_UTC.getTime() + 7 * 86_400_000));
    expect(sent).toHaveLength(0);
  });

  it('from the web page (JSON body) it does the same and names the address', async () => {
    const ctx = await createTestApp();
    const { token, mail } = await scheduledMailToFriend(ctx);
    const res = await viaPage(ctx.app, headerToken(mail));
    expect(res.json()).toEqual({ ok: true, email: FRIEND });
    expect((await view(ctx.app, token)).config!.enabled).toBe(false);
  });

  it('is idempotent: repeated calls answer 200 and change nothing on disk', async () => {
    const ctx = await createTestApp();
    const { mail } = await scheduledMailToFriend(ctx);
    const t = headerToken(mail);
    expect((await oneClick(ctx.app, t)).statusCode).toBe(200);
    const file = path.join(ctx.dir, 'schedule.json');
    const before = fs.readFileSync(file, 'utf-8');
    for (let i = 0; i < 3; i++) {
      expect((await oneClick(ctx.app, t)).statusCode).toBe(200);
      expect((await viaPage(ctx.app, t)).statusCode).toBe(200);
    }
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
  });

  it('refuses tampered, foreign and malformed tokens with 400 and changes nothing', async () => {
    const ctx = await createTestApp();
    const { mail } = await scheduledMailToFriend(ctx);
    const file = path.join(ctx.dir, 'schedule.json');
    const before = fs.readFileSync(file, 'utf-8');
    const good = headerToken(mail);
    const [body, sig] = good.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ p: 'unsub', u: 'anna', e: 'other@example.org' })).toString('base64url');
    const confirmTokenForSameSchedule = signRecipientToken({ exp: Math.floor(Date.now() / 1000) + 3600, u: 'anna', e: FRIEND, c: 1 }, SECRET);
    for (const bad of [`${forged}.${sig}`, `${body}.${sig.slice(0, -3)}AAA`, good.slice(0, -1), 'garbage', '', confirmTokenForSameSchedule]) {
      expect((await viaPage(ctx.app, bad)).statusCode).toBe(400);
      expect((await oneClick(ctx.app, bad)).statusCode).toBe(400);
    }
    expect((await viaPage(ctx.app, undefined)).statusCode).toBe(400);
    expect((await viaPage(ctx.app, 12345)).statusCode).toBe(400);
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
  });

  it('works long after the mail was sent (no expiry), also after later confirmation mails', async () => {
    const ctx = await createTestApp();
    const { token, mail } = await scheduledMailToFriend(ctx);
    // Another confirmation round bumps the confirmation sequence; the unsubscribe link must not care.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 60 * 1000);
    expect((await app_resend(ctx.app, token)).statusCode).toBe(200);
    vi.setSystemTime(Date.now() + 2 * 365 * 86_400_000);
    expect((await oneClick(ctx.app, headerToken(mail))).statusCode).toBe(200);
    // (The account's own session has expired by then; the file is the evidence.)
    expect(JSON.parse(fs.readFileSync(path.join(ctx.dir, 'schedule.json'), 'utf-8')).schedules.anna.enabled).toBe(false);
  });

  it('a token for an unknown or erased account is a harmless 200', async () => {
    const ctx = await createTestApp();
    const { signUnsubscribeToken } = await import('./reportUnsubscribe');
    const res = await viaPage(ctx.app, signUnsubscribeToken({ u: 'nobody', e: FRIEND }, SECRET));
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(ctx.dir, 'schedule.json'))).toBe(false);
  });

  it('a link for an address that is no longer the recipient blocks that address and leaves the schedule running', async () => {
    const ctx = await createTestApp();
    const { token, mail } = await scheduledMailToFriend(ctx);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 60 * 1000);
    expect((await save(ctx.app, token, { enabled: true, frequency: 'weekly', toEmail: 'new@example.org' })).statusCode).toBe(200);
    expect((await oneClick(ctx.app, headerToken(mail))).statusCode).toBe(200);
    const v = await view(ctx.app, token);
    expect(v.config).toMatchObject({ enabled: true, toEmail: 'new@example.org' });
    expect(v.recipient.unsubscribedAt).toBeUndefined();
    // ... but the old address can not be put back.
    vi.setSystemTime(Date.now() + 3 * 60 * 1000);
    expect((await save(ctx.app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND })).statusCode).toBe(409);
  });

  it('does not leak internals in the schedule view', async () => {
    const ctx = await createTestApp();
    const { token, mail } = await scheduledMailToFriend(ctx);
    await oneClick(ctx.app, headerToken(mail));
    const text = JSON.stringify(await view(ctx.app, token));
    for (const internal of ['unsubscribedEmails', 'lastUnsubscribe', 'confirmSeq', 'confirmedEmail']) expect(text).not.toContain(internal);
  });

  it('accepts form bodies on this route only, not on the rest of the API', async () => {
    const ctx = await createTestApp();
    const token = await register(ctx.app, 'anna');
    const res = await ctx.app.inject({
      method: 'POST', url: '/api/reports/schedule',
      headers: { ...auth(token), 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'enabled=true',
    });
    expect(res.statusCode).toBe(415);
  });
});

function app_resend(app: FastifyInstance, token: string) {
  return app.inject({ method: 'POST', url: '/api/reports/schedule/confirmation', headers: auth(token) });
}

describe('GET /api/reports/unsubscribe', () => {
  it('sends a browser to the confirmation page, and refuses a bad token', async () => {
    const ctx = await createTestApp();
    const { mail } = await scheduledMailToFriend(ctx);
    const t = headerToken(mail);
    const res = await ctx.app.inject({ method: 'GET', url: `/api/reports/unsubscribe?token=${t}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`https://app.example/#/bericht-abbestellen?token=${t}`);
    // A GET never changes anything: the page asks for the press of the button.
    expect(JSON.parse(fs.readFileSync(path.join(ctx.dir, 'schedule.json'), 'utf-8')).schedules.anna.enabled).toBe(true);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/reports/unsubscribe?token=nope' })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/reports/unsubscribe' })).statusCode).toBe(400);
  });
});

describe('what an unsubscribed address can no longer do', () => {
  it('the owner cannot switch it back on, resend, send ad hoc, or confirm with an old link', async () => {
    const ctx = await createTestApp();
    const token = await register(ctx.app, 'anna');
    await save(ctx.app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    const staleConfirmation = confirmationToken(sent.pop()!);
    await ctx.app.inject({ method: 'POST', url: '/api/reports/schedule/confirm', payload: { token: staleConfirmation } });
    await ctx.mod.runReportSchedules(MONDAY_8_UTC);
    await oneClick(ctx.app, headerToken(sent.pop()!));

    const on = await save(ctx.app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    expect(on.statusCode).toBe(409);
    expect(on.json()).toMatchObject({ code: 'recipient-unsubscribed' });
    expect((on.json() as { error: string }).error).toContain('abbestellt');

    expect((await app_resend(ctx.app, token)).statusCode).toBe(409);

    const adhoc = await ctx.app.inject({ method: 'POST', url: '/api/reports/send', headers: auth(token), payload: { period: 'week', toEmail: FRIEND } });
    expect(adhoc.statusCode).toBe(403);
    expect(adhoc.json()).toMatchObject({ code: 'recipient-not-allowed', reason: 'recipient-unsubscribed' });

    // The confirmation link that was already out cannot bring it back.
    const stale = await ctx.app.inject({ method: 'POST', url: '/api/reports/schedule/confirm', payload: { token: staleConfirmation } });
    expect(stale.statusCode).toBe(400);
    expect(sent).toHaveLength(0);
    expect((await view(ctx.app, token)).recipient.status).toBe('pending');
  });

  it('the owner can still pause it and choose another address, which is confirmed as usual', async () => {
    const ctx = await createTestApp();
    const { token, mail } = await scheduledMailToFriend(ctx);
    await oneClick(ctx.app, headerToken(mail));
    sent.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 60 * 1000);
    expect((await save(ctx.app, token, { enabled: false, frequency: 'weekly', toEmail: FRIEND })).statusCode).toBe(200);
    const other = await save(ctx.app, token, { enabled: true, frequency: 'weekly', toEmail: 'other@example.org' });
    expect(other.statusCode).toBe(200);
    expect(other.json()).toMatchObject({ confirmation: 'sent' });
    expect(sent[0]!.to).toBe('other@example.org');
    const v = await view(ctx.app, token);
    expect(v.recipient.blocked).toBeUndefined();
    expect(v.recipient.unsubscribedAt).toBeUndefined(); // the notice ends with the new recipient
  });
});

describe('unsubscribing the account\'s own address', () => {
  it('pauses the schedule and tells the owner, but the owner can switch it back on', async () => {
    const ctx = await createTestApp();
    const token = await register(ctx.app, 'anna');
    await verifyOwnAddress(ctx.app, token, OWN);
    expect((await save(ctx.app, token, { enabled: true, frequency: 'weekly', toEmail: OWN })).statusCode).toBe(200);
    await ctx.mod.runReportSchedules(MONDAY_8_UTC);
    expect(sent).toHaveLength(1);

    expect((await oneClick(ctx.app, headerToken(sent[0]!))).statusCode).toBe(200);
    let v = await view(ctx.app, token);
    expect(v.config!.enabled).toBe(false);
    expect(v.recipient).toMatchObject({ status: 'confirmed', via: 'account' }); // the account still vouches for it
    expect(v.recipient.unsubscribedAt).toBeGreaterThan(0);
    expect(v.recipient.blocked).toBeUndefined();
    expect(v.sendTargets.map((t) => t.email)).toContain(OWN);

    sent.length = 0;
    await ctx.mod.runReportSchedules(new Date(MONDAY_8_UTC.getTime() + 7 * 86_400_000));
    expect(sent).toHaveLength(0);

    expect((await save(ctx.app, token, { enabled: true, frequency: 'weekly', toEmail: OWN })).statusCode).toBe(200);
    v = await view(ctx.app, token);
    expect(v.config!.enabled).toBe(true);
    expect(v.recipient.unsubscribedAt).toBeUndefined();
  });
});

describe('the hourly job and a missing App-URL (#457)', () => {
  it('does not mail a third party without a way to unsubscribe, but still mails the owner\'s own address', async () => {
    const ctx = await createTestApp();
    const token = await register(ctx.app, 'anna');
    await confirmRecipient(ctx.app, token, FRIEND);
    // The App-URL is removed after the confirmation.
    delete process.env.APP_URL;
    await ctx.mod.runReportSchedules(MONDAY_8_UTC);
    expect(sent).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(path.join(ctx.dir, 'schedule.json'), 'utf-8')).schedules.anna.lastSentAt).toBeUndefined();

    // Own verified address: sent, without a link (there is nothing to point it at).
    process.env.APP_URL = 'https://app.example';
    await verifyOwnAddress(ctx.app, token, OWN);
    delete process.env.APP_URL;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 60 * 1000);
    process.env.APP_URL = 'https://app.example';
    expect((await save(ctx.app, token, { enabled: true, frequency: 'weekly', toEmail: OWN })).statusCode).toBe(200);
    delete process.env.APP_URL;
    sent.length = 0;
    await ctx.mod.runReportSchedules(MONDAY_8_UTC);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(OWN);
    expect(sent[0]!.headers).toBeUndefined();
  });
});
