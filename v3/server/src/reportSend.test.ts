import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { adHocTargets, decideAdHocTarget } from './reportRecipient';
import type { ScheduleConfig } from './db';

/**
 * #456: the ad-hoc send ("Jetzt per E-Mail senden") may only go to the account's own
 * verified address or to the currently confirmed report recipient. Mail delivery is a recorder.
 */
const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
const smtp = vi.hoisted(() => ({ configured: true }));
vi.mock('./email', () => ({
  isEmailConfigured: () => smtp.configured,
  sendHtmlEmail: async (to: string, subject: string, html: string) => { sent.push({ to, subject, html }); },
  sendTestEmail: async () => {},
}));

const tmpDirs: string[] = [];

async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-send-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  process.env.APP_URL = 'https://app.example';
  process.env.ALLOW_REGISTRATION = 'true';
  vi.resetModules();
  const mod = await import('./index');
  const app: FastifyInstance = await mod.buildApp();
  tmpDirs.push(dir);
  return { app };
}

beforeEach(() => { sent.length = 0; smtp.configured = true; });
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

function send(app: FastifyInstance, token: string, toEmail: unknown) {
  return app.inject({ method: 'POST', url: '/api/reports/send', headers: auth(token), payload: { period: 'week', toEmail } });
}
function save(app: FastifyInstance, token: string, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/reports/schedule', headers: auth(token), payload: body });
}
async function verifyOwnAddress(app: FastifyInstance, token: string, email: string): Promise<void> {
  const res = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(token), payload: { email } });
  expect(res.json()).toMatchObject({ ok: true, verificationSent: true });
  const mail = sent.pop()!;
  const link = /#\/email-bestaetigen\?token=([0-9a-f]{64})/.exec(mail.html)![1];
  expect((await app.inject({ method: 'POST', url: '/api/auth/email/verify', payload: { token: link } })).statusCode).toBe(200);
}
function confirmationToken(mail: { html: string }): string {
  return /#\/bericht-bestaetigen\?token=([A-Za-z0-9_.-]+)/.exec(mail.html)![1]!;
}
async function confirmRecipient(app: FastifyInstance, token: string, email: string): Promise<void> {
  await save(app, token, { enabled: true, frequency: 'weekly', toEmail: email });
  const t = confirmationToken(sent.pop()!);
  expect((await app.inject({ method: 'POST', url: '/api/reports/schedule/confirm', payload: { token: t } })).statusCode).toBe(200);
}

const OWN = 'anna@example.org';
const FRIEND = 'friend@example.org';
const STRANGER = 'victim@example.org';

type Denied = { error: string; code: string; reason: string; allowed: string[] };

describe('POST /api/reports/send only mails addresses that agreed (#456)', () => {
  it('refuses an arbitrary address with a 403 that says why, and sends nothing', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    const res = await send(app, token, STRANGER);
    expect(res.statusCode).toBe(403);
    const body = res.json() as Denied;
    expect(body.code).toBe('recipient-not-allowed');
    expect(body.reason).toBe('not-allowed');
    expect(body.error).toContain('verifizierte Adresse');
    expect(body.error).toContain('Zeitplan');
    expect(body.allowed).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it('refuses even when the address is typed in another case or with spaces', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    expect((await send(app, token, `  ${STRANGER.toUpperCase()} `)).statusCode).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('sends to the own verified address, whatever its case', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await verifyOwnAddress(app, token, OWN);
    const res = await send(app, token, 'Anna@Example.org');
    expect(res.statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(OWN); // the stored address, not the typed spelling
  });

  it('refuses the own address while it is unverified, and says to verify it', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: auth(token), payload: { email: OWN } });
    sent.length = 0;
    const res = await send(app, token, OWN);
    expect(res.statusCode).toBe(403);
    expect((res.json() as Denied).reason).toBe('own-unverified');
    expect((res.json() as Denied).error).toContain('verifiziert');
    expect(sent).toHaveLength(0);
  });

  it('refuses a pending recipient, then sends once its owner confirmed', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await save(app, token, { enabled: true, frequency: 'weekly', toEmail: FRIEND });
    const confirmationMail = sent.pop()!;

    const denied = await send(app, token, FRIEND);
    expect(denied.statusCode).toBe(403);
    expect((denied.json() as Denied).reason).toBe('recipient-pending');
    expect(sent).toHaveLength(0);

    await app.inject({ method: 'POST', url: '/api/reports/schedule/confirm', payload: { token: confirmationToken(confirmationMail) } });
    const ok = await send(app, token, FRIEND);
    expect(ok.statusCode).toBe(200);
    expect(sent.map((m) => m.to)).toEqual([FRIEND]);
  });

  it('allows a confirmed recipient even while the schedule is switched off', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await confirmRecipient(app, token, FRIEND);
    await save(app, token, { enabled: false, frequency: 'weekly', toEmail: FRIEND });
    expect((await send(app, token, FRIEND)).statusCode).toBe(200);
  });

  it('a changed recipient is not allowed, and neither is the previous one', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await confirmRecipient(app, token, FRIEND);
    // Past the 2 minute spacing between confirmation mails, so the change is accepted.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 60 * 1000);
    expect((await save(app, token, { enabled: true, frequency: 'weekly', toEmail: STRANGER })).statusCode).toBe(200);
    sent.length = 0;
    expect((await send(app, token, STRANGER)).statusCode).toBe(403);
    expect((await send(app, token, FRIEND)).statusCode).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('one account cannot use another account\'s confirmed recipient', async () => {
    const { app } = await createTestApp();
    const anna = await register(app, 'anna');
    const bob = await register(app, 'bob');
    await confirmRecipient(app, anna, FRIEND);
    expect((await send(app, bob, FRIEND)).statusCode).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it('lists the allowed targets in the 403 and in the schedule view', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await verifyOwnAddress(app, token, OWN);
    await confirmRecipient(app, token, FRIEND);
    const denied = await send(app, token, STRANGER);
    expect((denied.json() as Denied).allowed).toEqual([OWN, FRIEND]);
    const view = (await app.inject({ method: 'GET', url: '/api/reports/schedule', headers: auth(token) })).json() as { sendTargets: { email: string; kind: string }[] };
    expect(view.sendTargets).toEqual([{ email: OWN, kind: 'account' }, { email: FRIEND, kind: 'recipient' }]);
  });

  it('lists the own verified address even before any schedule exists', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await verifyOwnAddress(app, token, OWN);
    const view = (await app.inject({ method: 'GET', url: '/api/reports/schedule', headers: auth(token) })).json() as { config: unknown; sendTargets: { email: string }[] };
    expect(view.config).toBeNull();
    expect(view.sendTargets.map((t) => t.email)).toEqual([OWN]);
  });

  it('keeps the 400 for a missing or malformed address, the 503 without SMTP and the login requirement', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    expect((await send(app, token, '')).statusCode).toBe(400);
    expect((await send(app, token, 'not-an-address')).statusCode).toBe(400);
    expect((await send(app, token, 42)).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/reports/send', payload: { toEmail: OWN } })).statusCode).toBe(401);
    smtp.configured = false;
    expect((await send(app, token, OWN)).statusCode).toBe(503);
  });

  it('cannot smuggle a second recipient past the check', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await verifyOwnAddress(app, token, OWN);
    expect((await send(app, token, `${OWN},${STRANGER}`)).statusCode).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('keeps the rate limit: the 11th call within the hour is a 429', async () => {
    const { app } = await createTestApp();
    const token = await register(app, 'anna');
    await verifyOwnAddress(app, token, OWN);
    for (let i = 0; i < 10; i++) expect((await send(app, token, OWN)).statusCode).toBe(200);
    expect((await send(app, token, OWN)).statusCode).toBe(429);
    expect(sent).toHaveLength(10);
  });
});

describe('adHocTargets / decideAdHocTarget (pure)', () => {
  const user = { email: OWN, email_verified: true };
  const cfg = (extra: Partial<ScheduleConfig>): ScheduleConfig => ({ enabled: true, frequency: 'weekly', toEmail: FRIEND, ...extra });

  it('own verified plus confirmed recipient, no duplicates', () => {
    expect(adHocTargets(cfg({ confirmedEmail: FRIEND }), user).map((t) => t.kind)).toEqual(['account', 'recipient']);
    expect(adHocTargets(cfg({ toEmail: OWN }), user)).toEqual([{ email: OWN, kind: 'account' }]);
  });
  it('nothing for an unverified account and an unconfirmed recipient', () => {
    expect(adHocTargets(cfg({}), { email: OWN, email_verified: false })).toEqual([]);
    expect(adHocTargets(null, null)).toEqual([]);
  });
  it('a stale confirmation for another address does not count', () => {
    expect(adHocTargets(cfg({ confirmedEmail: 'old@example.org' }), undefined)).toEqual([]);
  });
  it('decides with the right reason', () => {
    expect(decideAdHocTarget(cfg({}), user, FRIEND)).toMatchObject({ allowed: false, reason: 'recipient-pending' });
    expect(decideAdHocTarget(null, { email: OWN, email_verified: false }, OWN)).toMatchObject({ allowed: false, reason: 'own-unverified' });
    expect(decideAdHocTarget(null, user, STRANGER)).toMatchObject({ allowed: false, reason: 'not-allowed' });
    expect(decideAdHocTarget(null, user, OWN.toUpperCase())).toMatchObject({ allowed: true });
  });
});
