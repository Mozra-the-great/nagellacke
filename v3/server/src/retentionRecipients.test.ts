import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * #470 (F116.5 a): report recipients that never confirmed are removed 48 h after the last
 * confirmation mail or recipient change. Time is injected through `now`; nothing waits.
 * db.ts captures DATA_DIR at import, so every test gets fresh modules on a fresh dir.
 */
const HOUR = 60 * 60 * 1000;
const T0 = 1_800_000_000_000;
const silent = { log: vi.fn(), warn: vi.fn() };
const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.ALLOW_REGISTRATION;
  silent.log.mockClear();
  silent.warn.mockClear();
});

async function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-recipient-retention-'));
  tmpDirs.push(dir);
  process.env.DATA_DIR = dir;
  vi.resetModules();
  const db = await import('./db');
  const ret = await import('./retention');
  return { db, ret, dir };
}

type Cfg = import('./db').ScheduleConfig;
const pendingCfg = (extra: Partial<Cfg> = {}): Cfg => ({
  enabled: true, frequency: 'weekly', toEmail: 'friend@example.org',
  confirmSeq: 3, confirmSentAt: T0, confirmMailsAt: [T0], recipientChangesAt: [T0], ...extra,
});

describe('purgeUnconfirmedRecipients (#470)', () => {
  it('keeps a pending recipient for 48 h and removes it afterwards, pausing the schedule', async () => {
    const { db, ret } = await fresh();
    db.createUser('alice', 'hash');
    db.setScheduleConfig('alice', pendingCfg());

    const before = ret.purgeUnconfirmedRecipients(T0 + 48 * HOUR - 1, silent);
    expect(before).toEqual({ removed: 0, waiting: 1, skipped: false });
    expect(db.getScheduleConfig('alice')?.toEmail).toBe('friend@example.org');

    const after = ret.purgeUnconfirmedRecipients(T0 + 48 * HOUR, silent);
    expect(after).toEqual({ removed: 1, waiting: 0, skipped: false });
    const cfg = db.getScheduleConfig('alice');
    expect(cfg).toMatchObject({ enabled: false, toEmail: '', frequency: 'weekly', confirmSeq: 4, recipientExpiredAt: T0 + 48 * HOUR });
    expect(cfg?.confirmSentAt).toBeUndefined();
    expect(cfg?.confirmedEmail).toBeUndefined();
    // The rate-limit history survives, so removing cannot reset the limits.
    expect(cfg?.confirmMailsAt).toEqual([T0]);
    expect(cfg?.recipientChangesAt).toEqual([T0]);
  });

  it('counts from the newest confirmation mail or change, so a resend restarts the 48 h', async () => {
    const { db, ret } = await fresh();
    db.createUser('alice', 'hash');
    db.setScheduleConfig('alice', pendingCfg({ confirmSentAt: T0 + 20 * HOUR, confirmMailsAt: [T0, T0 + 20 * HOUR] }));
    expect(ret.purgeUnconfirmedRecipients(T0 + 60 * HOUR, silent).removed).toBe(0);
    expect(ret.purgeUnconfirmedRecipients(T0 + 68 * HOUR, silent).removed).toBe(1);
  });

  it('removes a recipient saved before #449 that carries no timestamps at all', async () => {
    const { db, ret } = await fresh();
    db.createUser('alice', 'hash');
    db.setScheduleConfig('alice', { enabled: true, frequency: 'monthly', toEmail: 'old@example.org' });
    expect(ret.purgeUnconfirmedRecipients(T0, silent).removed).toBe(1);
    expect(db.getScheduleConfig('alice')).toMatchObject({ toEmail: '', enabled: false, frequency: 'monthly' });
  });

  it('leaves confirmed recipients, the verified own address and opted-out addresses alone', async () => {
    const { db, ret } = await fresh();
    for (const u of ['linked', 'ownverified', 'optedout']) db.createUser(u, 'hash');
    db.updateUserEmail('ownverified', 'me@example.org');
    db.patchUser('ownverified', { email_verified: true });
    db.setScheduleConfig('linked', pendingCfg({ confirmedEmail: 'friend@example.org', confirmedAt: T0 }));
    db.setScheduleConfig('ownverified', pendingCfg({ toEmail: 'me@example.org' }));
    db.setScheduleConfig('optedout', pendingCfg({
      enabled: false, unsubscribedEmails: ['friend@example.org'], lastUnsubscribe: { email: 'friend@example.org', at: T0 },
    }));
    const r = ret.purgeUnconfirmedRecipients(T0 + 30 * 24 * HOUR, silent);
    expect(r).toEqual({ removed: 0, waiting: 0, skipped: false });
    expect(db.getScheduleConfig('linked')?.toEmail).toBe('friend@example.org');
    expect(db.getScheduleConfig('ownverified')?.toEmail).toBe('me@example.org');
    expect(db.getScheduleConfig('optedout')?.toEmail).toBe('friend@example.org');
  });

  it('judges the own address like any other recipient while it is unverified (#483)', async () => {
    const { db, ret } = await fresh();
    db.createUser('ownunverified', 'hash');
    db.updateUserEmail('ownunverified', 'self@example.org');
    db.setScheduleConfig('ownunverified', pendingCfg({ toEmail: 'SELF@example.org' }));
    // Inside the link's lifetime it waits ...
    expect(ret.purgeUnconfirmedRecipients(T0 + 47 * HOUR, silent)).toEqual({ removed: 0, waiting: 1, skipped: false });
    expect(db.getScheduleConfig('ownunverified')?.toEmail).toBe('SELF@example.org');
    // ... after it, the unconfirmed address goes, like a third party's.
    expect(ret.purgeUnconfirmedRecipients(T0 + 49 * HOUR, silent).removed).toBe(1);
    expect(db.getScheduleConfig('ownunverified')).toMatchObject({ enabled: false, toEmail: '', recipientExpiredAt: T0 + 49 * HOUR });
    // The account address itself is the account's, not the schedule's: it stays.
    expect(db.getUser('ownunverified')?.email).toBe('self@example.org');
  });

  it('treats the schedule of a vanished account like any other (no user: not the own address)', async () => {
    const { db, ret } = await fresh();
    db.setScheduleConfig('ghost', pendingCfg());
    expect(ret.purgeUnconfirmedRecipients(T0 + 49 * HOUR, silent).removed).toBe(1);
  });

  it('is idempotent and does not rewrite the file when nothing is due', async () => {
    const { db, ret, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setScheduleConfig('alice', pendingCfg());
    ret.purgeUnconfirmedRecipients(T0 + 49 * HOUR, silent);
    const file = path.join(dir, 'schedule.json');
    const first = fs.readFileSync(file, 'utf-8');
    // Pin the mtime to an hour ago: on a file system with coarse timestamps (Linux CI) a rewrite within
    // the same clock tick would leave it unchanged and the check below could not see the rewrite.
    const past = new Date(Date.now() - HOUR);
    fs.utimesSync(file, past, past);
    const mtime = fs.statSync(file).mtimeMs;
    expect(ret.purgeUnconfirmedRecipients(T0 + 50 * HOUR, silent)).toEqual({ removed: 0, waiting: 0, skipped: false });
    expect(fs.readFileSync(file, 'utf-8')).toBe(first);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  it('changes nothing when schedule.json cannot be parsed (fail-closed)', async () => {
    const { db, ret, dir } = await fresh();
    db.createUser('alice', 'hash');
    const file = path.join(dir, 'schedule.json');
    fs.writeFileSync(file, '{"v":2,"schedules":{"alice":');
    const r = ret.purgeUnconfirmedRecipients(T0 + 49 * HOUR, silent);
    expect(r.skipped).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toBe('{"v":2,"schedules":{"alice":');
    // A pre-#353 single record is not the v2 shape either and stays for its migration.
    fs.writeFileSync(file, JSON.stringify({ enabled: true, frequency: 'weekly', toEmail: 'x@example.org' }));
    expect(ret.purgeUnconfirmedRecipients(T0 + 49 * HOUR, silent).skipped).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).toEmail).toBe('x@example.org');
  });

  it('changes nothing when users.json cannot be parsed, since the own-address rule needs it', async () => {
    const { db, ret, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setScheduleConfig('alice', pendingCfg());
    fs.writeFileSync(path.join(dir, 'users.json'), 'not json');
    expect(ret.purgeUnconfirmedRecipients(T0 + 49 * HOUR, silent).skipped).toBe(true);
    expect(db.getScheduleConfig('alice')?.toEmail).toBe('friend@example.org');
  });

  it('logs counts only, never an address or a username', async () => {
    const { db, ret, dir } = await fresh();
    db.createUser('alice', 'hash');
    db.setScheduleConfig('alice', pendingCfg());
    const out = ret.runRetentionJobs(T0 + 49 * HOUR, silent);
    expect(out.unconfirmedRecipientsRemoved).toBe(1);
    fs.writeFileSync(path.join(dir, 'schedule.json'), 'broken');
    ret.runRetentionJobs(T0 + 50 * HOUR, silent);
    const lines = [...silent.log.mock.calls, ...silent.warn.mock.calls].map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('1 unconfirmed report recipient(s) removed'))).toBe(true);
    expect(lines.some((l) => l.includes('schedule.json could not be parsed'))).toBe(true);
    for (const l of lines) {
      expect(l).not.toContain('friend@');
      expect(l).not.toContain('alice');
    }
  });
});

describe('schedule routes after a removed recipient (#470)', () => {
  async function createTestApp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-recipient-retention-route-'));
    tmpDirs.push(dir);
    process.env.DATA_DIR = dir;
    process.env.NAGELLACKE_NO_AUTOSTART = 'true';
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
    process.env.ALLOW_REGISTRATION = 'true';
    vi.resetModules();
    const mod = await import('./index');
    const db = await import('./db');
    const ret = await import('./retention');
    const app: FastifyInstance = await mod.buildApp();
    return { app, db, ret };
  }

  it('reports expiredAt while the field is empty and drops it once a recipient is saved again', async () => {
    const { app, db, ret } = await createTestApp();
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alice', password: 'password123' } });
    const headers = { authorization: `Bearer ${(reg.json() as { token: string }).token}` };
    const now = Date.now();
    db.setScheduleConfig('alice', pendingCfg({ confirmSentAt: now - 49 * HOUR, confirmMailsAt: [], recipientChangesAt: [] }));
    expect(ret.purgeUnconfirmedRecipients(now, silent).removed).toBe(1);

    const view = await app.inject({ method: 'GET', url: '/api/reports/schedule', headers });
    expect(view.statusCode).toBe(200);
    const body = view.json() as { config: { toEmail: string; enabled: boolean }; recipient: { status: string; expiredAt?: number } };
    expect(body.config).toMatchObject({ toEmail: '', enabled: false });
    expect(body.recipient).toEqual({ status: 'none', expiredAt: now });

    // Saving without a recipient (e.g. another frequency) keeps the notice ...
    const keep = await app.inject({ method: 'POST', url: '/api/reports/schedule', headers, payload: { enabled: false, frequency: 'monthly', toEmail: '' } });
    expect(keep.statusCode).toBe(200);
    expect((keep.json() as { recipient: { expiredAt?: number } }).recipient.expiredAt).toBe(now);
    // ... a new recipient ends it.
    const save = await app.inject({ method: 'POST', url: '/api/reports/schedule', headers, payload: { enabled: false, frequency: 'weekly', toEmail: 'new@example.org' } });
    expect(save.statusCode).toBe(200);
    expect((save.json() as { recipient: { expiredAt?: number } }).recipient.expiredAt).toBeUndefined();
    expect(db.getScheduleConfig('alice')?.recipientExpiredAt).toBeUndefined();
  });
});
