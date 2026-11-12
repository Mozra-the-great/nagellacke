import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * #449: the recipient of a report schedule is confirmed by double opt-in. Mail
 * delivery is replaced by a recorder; links are read back out of the mails the way
 * the recipient would get them.
 */
const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
const smtp = vi.hoisted(() => ({ configured: true, failNext: false }));
vi.mock('./email', () => ({
  isEmailConfigured: () => smtp.configured,
  sendHtmlEmail: async (to: string, subject: string, html: string) => {
    if (smtp.failNext) { smtp.failNext = false; throw new Error('smtp down'); }
    sent.push({ to, subject, html });
  },
  sendTestEmail: async () => {},
}));

const tmpDirs: string[] = [];

async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-recipient-test-'));
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
  return { app, db, dir };
}

beforeEach(() => { sent.length = 0; smtp.configured = true; smtp.failNext = false; });
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

function getSchedule(app: FastifyInstance, token: string) {
  return app.inject({ method: 'GET', url: '/api/reports/schedule', headers: auth(token) });
}

function confirm(app: FastifyInstance, token: unknown) {
  return app.inject({ method: 'POST', url: '/api/reports/schedule/confirm', payload: { token } });
}

function linkTokenFrom(mail: { html: string }): string {
  const m = /#\/bericht-bestaetigen\?token=([A-Za-z0-9_.-]+)/.exec(mail.html);
  expect(m).not.toBeNull();
  return m![1]!;
}

/** Verifies the account's own address through the real mail link. */
async function verifyOwnAddress(app: FastifyInstance, token: string, email: string): Promise<void> {
  const res = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(token), payload: { email } });
  expect(res.json()).toMatchObject({ ok: true, verificationSent: true });
  const mail = sent.pop()!;
  const link = /#\/email-bestaetigen\?token=([0-9a-f]{64})/.exec(mail.html)![1];
  const verify = await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: link } });
  expect(verify.statusCode).toBe(200);
}

const FRIEND = 'friend@example.org';

describe('a new recipient needs confirmation (#449)', () => {
  it('is pending, mails a confirmation to the recipient and nothing else', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');

    const res = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { confirmation: string; recipient: { status: string; confirmationSentAt?: number }; config: Record<string, unknown> };
    expect(body.confirmation).toBe('sent');
    expect(body.recipient.status).toBe('pending');
    expect(body.recipient.confirmationSentAt).toBeGreaterThan(0);
    expect(body.config).toMatchObject({ enabled: true, toEmail: FRIEND });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(FRIEND);
    // Says who asked and what it is about, and links to the SPA's hash route (token stays out of server logs).
    expect(sent[0]!.html).toContain('anna');
    expect(sent[0]!.html).toContain('https://app.example/#/bericht-bestaetigen?token=');
    expect(sent[0]!.html).toContain('#/datenschutz');
  });

  it('becomes confirmed when the recipient opens the link, and the view says so', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });

    const res = await confirm(app, linkTokenFrom(sent[0]!));
    expect(res.statusCode).toBe(200);

    const view = (await getSchedule(app, token)).json() as { recipient: { status: string; via?: string }; confirmationAvailable: boolean };
    expect(view.recipient).toEqual({ status: 'confirmed', via: 'link' });
    expect(view.confirmationAvailable).toBe(true);
  });

  it('does not leak counters or sequence numbers through the API', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    const res = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    const text = JSON.stringify(res.json()) + JSON.stringify((await getSchedule(app, token)).json());
    for (const internal of ['confirmSeq', 'confirmMailsAt', 'recipientChangesAt', 'confirmedEmail']) {
      expect(text).not.toContain(internal);
    }
  });

  it('keeps the confirmation when only frequency or the on/off switch changes', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    await confirm(app, linkTokenFrom(sent[0]!));

    const res = await save(app, token, { enabled: true, frequency: 'monthly', toEmail: FRIEND });
    expect((res.json() as { recipient: { status: string } }).recipient.status).toBe('confirmed');
    expect(sent).toHaveLength(1); // no second mail
    expect((await save(app, token, { enabled: false, frequency: 'monthly', toEmail: FRIEND })).statusCode).toBe(200);
    expect(((await getSchedule(app, token)).json() as { recipient: { status: string } }).recipient.status).toBe('confirmed');
  });

  it('is case-insensitive: re-saving the same address in another spelling is not a change', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    await confirm(app, linkTokenFrom(sent[0]!));
    const res = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: 'Friend@Example.ORG' });
    expect((res.json() as { recipient: { status: string } }).recipient.status).toBe('confirmed');
    expect(sent).toHaveLength(1);
  });

  it('a changed recipient is pending again and the old link no longer works', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    const oldLink = linkTokenFrom(sent[0]!);
    await confirm(app, oldLink);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5 * 60 * 1000 }); // past the mail spacing
    const res = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: 'other@example.org' });
    expect((res.json() as { recipient: { status: string }; confirmation: string })).toMatchObject({ recipient: { status: 'pending' }, confirmation: 'sent' });
    expect(sent[1]!.to).toBe('other@example.org');

    // The link for the first address cannot confirm the second one, nor can it be replayed.
    expect((await confirm(app, oldLink)).statusCode).toBe(400);
    expect(((await getSchedule(app, token)).json() as { recipient: { status: string } }).recipient.status).toBe('pending');
    expect((await confirm(app, linkTokenFrom(sent[1]!))).statusCode).toBe(200);
  });

  it('switching back to an earlier address needs a fresh confirmation too', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    await confirm(app, linkTokenFrom(sent[0]!));
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5 * 60 * 1000 });
    await save(app, token, { enabled: false, frequency: 'weekly', toEmail: 'other@example.org' });
    vi.setSystemTime(Date.now() + 5 * 60 * 1000);
    const back = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    expect((back.json() as { recipient: { status: string } }).recipient.status).toBe('pending');
  });

  it('saving a disabled schedule with a new recipient sends no mail until it is enabled', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    const off = await save(app, token, { enabled: false, frequency: 'weekly', toEmail: FRIEND });
    expect(off.json()).toMatchObject({ confirmation: 'not-needed', recipient: { status: 'pending' } });
    expect(sent).toHaveLength(0);
    const on = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    expect(on.json()).toMatchObject({ confirmation: 'sent' });
    expect(sent).toHaveLength(1);
  });

  it('an enabled, still unconfirmed schedule that is saved again does not mail the recipient again', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    const again = await save(app, token, { enabled: true, frequency: 'monthly', toEmail: FRIEND });
    expect(again.json()).toMatchObject({ confirmation: 'pending', recipient: { status: 'pending' } });
    expect(sent).toHaveLength(1);
  });
});

describe('the account\'s own address (#449 decision for existing and new schedules)', () => {
  it('is confirmed at once when it is verified, with no mail', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await verifyOwnAddress(app, token, 'anna@example.org');
    sent.length = 0;

    const res = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: 'Anna@Example.org' });
    expect(res.json()).toMatchObject({ confirmation: 'not-needed', recipient: { status: 'confirmed', via: 'account' } });
    expect(sent).toHaveLength(0);
  });

  it('still needs confirmation while the account address is unverified', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(token), payload: { email: 'anna@example.org' } });
    sent.length = 0;
    const res = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: 'anna@example.org' });
    expect(res.json()).toMatchObject({ confirmation: 'sent', recipient: { status: 'pending' } });
    expect(sent[0]!.to).toBe('anna@example.org');
  });
});

describe('confirmation links', () => {
  it('rejects a tampered link', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    const link = linkTokenFrom(sent[0]!);
    const [body, sig] = link.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString('utf-8')), e: 'victim@example.org' }), 'utf-8').toString('base64url');

    expect((await confirm(app, `${forgedBody}.${sig}`)).statusCode).toBe(400);
    expect((await confirm(app, `${body}.${sig!.slice(0, -2)}xx`)).statusCode).toBe(400);
    expect(((await getSchedule(app, token)).json() as { recipient: { status: string } }).recipient.status).toBe('pending');
  });

  it('rejects an expired link (48 h) and accepts the same link before that', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    const link = linkTokenFrom(sent[0]!);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 49 * 60 * 60 * 1000 });
    const late = await confirm(app, link);
    expect(late.statusCode).toBe(400);
    expect(late.json()).toEqual({ error: 'Der Link ist ungültig oder abgelaufen.' });

    vi.setSystemTime(Date.now() - 2 * 60 * 60 * 1000); // 47 h after the mail
    expect((await confirm(app, link)).statusCode).toBe(200);
  });

  it.each([undefined, null, '', 'garbage', 42, { a: 1 }])('rejects the non-token %j', async (value) => {
    const { app } = await createTestApp();
    expect((await confirm(app, value)).statusCode).toBe(400);
  });

  it('works without a session (the recipient has no account) and does not accept a login token as a link', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    expect((await confirm(app, token)).statusCode).toBe(400); // a JWT is not a recipient token
    expect((await confirm(app, linkTokenFrom(sent[0]!))).statusCode).toBe(200);
  });

  it('a link for a deleted account is invalid', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    db.deleteScheduleConfig('anna');
    expect((await confirm(app, linkTokenFrom(sent[0]!))).statusCode).toBe(400);
  });
});

describe('rate limits (#449)', () => {
  it('limits recipient changes to 5 per day per account and leaves the schedule as it was', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    for (let i = 0; i < 5; i += 1) {
      const res = await save(app, token, { enabled: false, frequency: 'weekly', toEmail: `r${i}@example.org` });
      expect(res.statusCode).toBe(200);
    }
    const blocked = await save(app, token, { enabled: false, frequency: 'weekly', toEmail: 'r5@example.org' });
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: string }).error).toContain('zu oft geändert');
    expect(((await getSchedule(app, token)).json() as { config: { toEmail: string } }).config.toEmail).toBe('r4@example.org');

    // A day later it works again.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 25 * 60 * 60 * 1000 });
    expect((await save(app, token, { enabled: false, frequency: 'weekly', toEmail: 'r5@example.org' })).statusCode).toBe(200);
  });

  it('spaces confirmation mails: a second recipient within 2 minutes is refused and not saved', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });

    const second = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: 'other@example.org' });
    expect(second.statusCode).toBe(429);
    expect((second.json() as { error: string }).error).toContain('kurz her');
    expect(sent).toHaveLength(1);
    expect(((await getSchedule(app, token)).json() as { config: { toEmail: string } }).config.toEmail).toBe(FRIEND);
  });

  it('caps confirmation mails at 5 per day per account', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    const start = Date.now();
    const at = (minutes: number) => vi.setSystemTime(start + minutes * 60 * 1000);
    const resend = () => app.inject({ method: 'POST', url: '/api/reports/schedule/confirmation', headers: auth(token) });
    vi.useFakeTimers({ toFake: ['Date'], now: start });

    // Address A: the first mail plus two resends (3 per address per day).
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    at(3); expect((await resend()).statusCode).toBe(200);
    at(6); expect((await resend()).statusCode).toBe(200);
    at(9); expect((await resend()).statusCode).toBe(429); // the address cap, not the account cap
    // Address B: mails 4 and 5 of the day.
    at(12); expect((await save(app, token, { enabled: true, frequency: 'weekly', toEmail: 'other@example.org' })).statusCode).toBe(200);
    at(15); expect((await resend()).statusCode).toBe(200);
    expect(sent).toHaveLength(5);

    at(18);
    const sixth = await resend();
    expect(sixth.statusCode).toBe(429);
    expect((sixth.json() as { error: string }).error).toContain('zu viele Bestätigungsmails');
    expect(sent).toHaveLength(5);

    at(25 * 60);
    expect((await resend()).statusCode).toBe(200);
  });

  it('caps confirmation mails per target address across ALL accounts (3 per day)', async () => {
    const { app } = await createTestApp();
    const tokens = [await register(app, 'u1'), await register(app, 'u2'), await register(app, 'u3'), await register(app, 'u4')];
    for (const t of tokens.slice(0, 3)) {
      expect((await save(app, t, { enabled: true, frequency: 'weekly', toEmail: 'Victim@Example.org' })).statusCode).toBe(200);
    }
    const fourth = await save(app, tokens[3]!, { enabled: true, frequency: 'weekly', toEmail: 'victim@example.org' });
    expect(fourth.statusCode).toBe(429);
    expect((fourth.json() as { error: string }).error).toContain('An diese Adresse');
    expect(sent.filter((m) => m.to.toLowerCase() === 'victim@example.org')).toHaveLength(3);
    // Another address is unaffected.
    expect((await save(app, tokens[3]!, { enabled: true, frequency: 'weekly', toEmail: 'fine@example.org' })).statusCode).toBe(200);
  });

  it('the resend route is limited like the first mail', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    const again = await app.inject({ method: 'POST', url: '/api/reports/schedule/confirmation', headers: auth(token) });
    expect(again.statusCode).toBe(429);
    expect(sent).toHaveLength(1);
  });
});

describe('resend route and mail trouble', () => {
  it('resends to the pending recipient and the newest link wins', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    const first = linkTokenFrom(sent[0]!);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5 * 60 * 1000 });

    const res = await app.inject({ method: 'POST', url: '/api/reports/schedule/confirmation', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(2);
    expect((await confirm(app, first)).statusCode).toBe(400);
    expect((await confirm(app, linkTokenFrom(sent[1]!))).statusCode).toBe(200);
  });

  it('says so when there is nothing to resend or nothing left to confirm', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    const none = await app.inject({ method: 'POST', url: '/api/reports/schedule/confirmation', headers: auth(token) });
    expect(none.statusCode).toBe(400);

    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    await confirm(app, linkTokenFrom(sent[0]!));
    const done = await app.inject({ method: 'POST', url: '/api/reports/schedule/confirmation', headers: auth(token) });
    expect(done.json()).toEqual({ ok: true, alreadyConfirmed: true });
    expect(sent).toHaveLength(1);
  });

  it('requires a login', async () => {
    const { app } = await createTestApp();
    expect((await app.inject({ method: 'POST', url: '/api/reports/schedule/confirmation' })).statusCode).toBe(401);
  });

  it('without SMTP the schedule is saved but stays pending, and the response says no mail was sent', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    smtp.configured = false;
    const res = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    expect(res.json()).toMatchObject({ confirmation: 'unavailable', recipient: { status: 'pending' } });
    expect(sent).toHaveLength(0);
    const resend = await app.inject({ method: 'POST', url: '/api/reports/schedule/confirmation', headers: auth(token) });
    expect(resend.statusCode).toBe(503);
    expect(((await getSchedule(app, token)).json() as { confirmationAvailable: boolean }).confirmationAvailable).toBe(false);
  });

  it('a failing SMTP send leaves the recipient pending and reports it, and a later resend works', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    smtp.failNext = true;
    const res = await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ confirmation: 'failed', recipient: { status: 'pending' } });
    expect(sent).toHaveLength(0);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5 * 60 * 1000 });
    const resend = await app.inject({ method: 'POST', url: '/api/reports/schedule/confirmation', headers: auth(token) });
    expect(resend.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('still validates the address as before', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    expect((await save(app, token, { enabled: true, frequency: 'weekly', toEmail: 'a@x.org,b@y.org' })).statusCode).toBe(400);
    expect((await save(app, token, { enabled: true, frequency: 'weekly', toEmail: '' })).statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe('migrateScheduleRecipients (existing schedules, #449)', () => {
  /** Writes schedules the way a pre-#449 server left them: no confirmation fields at all. */
  function legacy(db: typeof import('./db'), username: string, toEmail: string, enabled = true): void {
    db.setScheduleConfig(username, { enabled, frequency: 'weekly', toEmail, lastSentAt: 123 });
  }

  it('keeps a schedule to the account\'s own verified address running and pauses every other one', async () => {
    const { app, db } = await createTestApp();
    const anna = await register(app, 'anna');
    await verifyOwnAddress(app, anna, 'anna@example.org');
    await register(app, 'ben');
    await register(app, 'cleo');
    legacy(db, 'anna', 'Anna@Example.org');
    legacy(db, 'ben', 'someone-else@example.org');
    legacy(db, 'cleo', 'cleo@example.org', false);

    const result = db.migrateScheduleRecipients();
    expect(result).toEqual({ confirmed: 1, pending: 1 }); // cleo is disabled, so nothing is "paused"

    const { recipientStatus } = await import('./reportRecipient');
    const status = (u: string) => recipientStatus(db.getScheduleConfig(u), db.getUser(u)).status;
    expect(status('anna')).toBe('confirmed');
    expect(status('ben')).toBe('pending');
    expect(status('cleo')).toBe('pending');
    // The confirmation of the own address is recorded, not only derived.
    expect(db.getScheduleConfig('anna')).toMatchObject({ confirmedEmail: 'anna@example.org', lastSentAt: 123 });
    expect(db.getScheduleConfig('ben')!.confirmedEmail).toBeUndefined();
  });

  it('does not mail anyone at startup', async () => {
    const { app, db } = await createTestApp();
    await register(app, 'ben');
    legacy(db, 'ben', 'someone-else@example.org');
    sent.length = 0;
    db.migrateScheduleRecipients();
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(0);
  });

  it('is idempotent: a second run changes nothing in the file', async () => {
    const { app, db, dir } = await createTestApp();
    const anna = await register(app, 'anna');
    await verifyOwnAddress(app, anna, 'anna@example.org');
    await register(app, 'ben');
    legacy(db, 'anna', 'anna@example.org');
    legacy(db, 'ben', 'x@example.org');

    db.migrateScheduleRecipients();
    const file = path.join(dir, 'schedule.json');
    const once = fs.readFileSync(file, 'utf-8');
    const again = db.migrateScheduleRecipients();
    expect(fs.readFileSync(file, 'utf-8')).toBe(once);
    expect(again.confirmed).toBe(0);
  });

  it('does not confirm the own address while it is unverified', async () => {
    const { app, db } = await createTestApp();
    const anna = await register(app, 'anna');
    await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(anna), payload: { email: 'anna@example.org' } });
    legacy(db, 'anna', 'anna@example.org');
    expect(db.migrateScheduleRecipients()).toEqual({ confirmed: 0, pending: 1 });
  });

  it('runs at startup: a legacy schedule written before buildApp() is migrated by it', async () => {
    const { app, db, dir } = await createTestApp();
    const anna = await register(app, 'anna');
    await verifyOwnAddress(app, anna, 'anna@example.org');
    legacy(db, 'anna', 'anna@example.org');
    expect(db.getScheduleConfig('anna')!.confirmedEmail).toBeUndefined();

    // A second server start on the same data directory.
    process.env.DATA_DIR = dir;
    vi.resetModules();
    const mod = await import('./index');
    await mod.buildApp();
    const db2 = await import('./db');
    expect(db2.getScheduleConfig('anna')!.confirmedEmail).toBe('anna@example.org');
  });

  it('a paused schedule can be confirmed in Settings and then counts as confirmed', async () => {
    const { app, db } = await createTestApp();
    const ben = await register(app, 'ben');
    legacy(db, 'ben', 'someone-else@example.org');
    db.migrateScheduleRecipients();
    expect(((await getSchedule(app, ben)).json() as { recipient: { status: string } }).recipient.status).toBe('pending');

    const res = await app.inject({ method: 'POST', url: '/api/reports/schedule/confirmation', headers: auth(ben) });
    expect(res.statusCode).toBe(200);
    expect(sent[0]!.to).toBe('someone-else@example.org');
    expect((await confirm(app, linkTokenFrom(sent[0]!))).statusCode).toBe(200);
    expect(((await getSchedule(app, ben)).json() as { recipient: { status: string } }).recipient.status).toBe('confirmed');
  });
});
