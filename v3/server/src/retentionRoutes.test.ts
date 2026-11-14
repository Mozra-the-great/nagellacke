import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { plainPng } from './testImages';

/** Route level of #463 (admin deletion records its leftovers) and #464 (sync drops old markers). */
const DAY = 24 * 60 * 60 * 1000;
const tmpDirs: string[] = [];

async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-retention-route-'));
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
  return { app, db, ret, dir };
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.ALLOW_REGISTRATION;
});

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'password123' } });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const polish = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id, brand: 'B', num: '1', color: '#fff', finish: ['Classic'], status: 'ok', createdAt: 1, updatedAt: 1, ...extra,
});

describe('DELETE /api/admin/users/:username (#463)', () => {
  it('records the account\'s photos for the 30-day purge, which then removes them and nothing else', async () => {
    const { app, db, ret, dir } = await createTestApp();
    const owner = await register(app, 'owner');
    const anna = await register(app, 'anna');
    const up = await app.inject({
      method: 'POST', url: '/api/photos', headers: auth(anna),
      payload: { data: plainPng().toString('base64'), mimeType: 'image/png' },
    });
    expect(up.statusCode).toBe(200);
    const photo = (up.json() as { filename: string }).filename;
    db.setData('anna', { polishes: [polish('p1', { photo })], customCats: [], manicures: [], stickers: [] } as never);

    const t0 = Date.now();
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/users/anna', headers: auth(owner) });
    expect(del.statusCode).toBe(200);

    const pending = JSON.parse(fs.readFileSync(path.join(dir, 'pending_deletions.json'), 'utf-8')) as { entries: { photos: string[]; deletedAt: number }[] };
    expect(pending.entries).toHaveLength(1);
    expect(pending.entries[0].photos).toEqual([photo]);
    expect(Math.abs(pending.entries[0].deletedAt - t0)).toBeLessThan(5000);
    // Nothing is removed at deletion time (the policy says "initially remain") ...
    expect(fs.existsSync(path.join(dir, 'photos', photo))).toBe(true);
    expect(fs.readdirSync(path.join(dir, 'users', 'anna')).some((f) => f.startsWith('data.json.deleted-'))).toBe(true);

    // ... only 30 days later.
    const at = pending.entries[0].deletedAt;
    ret.runRetentionJobs(at + 29 * DAY, { log: vi.fn(), warn: vi.fn() });
    expect(fs.existsSync(path.join(dir, 'photos', photo))).toBe(true);
    ret.runRetentionJobs(at + 30 * DAY, { log: vi.fn(), warn: vi.fn() });
    expect(fs.existsSync(path.join(dir, 'photos', photo))).toBe(false);
    expect(db.getUser('owner')).toBeDefined();
  });

  it('a refused deletion (last admin, self) records nothing', async () => {
    const { app, dir } = await createTestApp();
    const owner = await register(app, 'owner');
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/users/owner', headers: auth(owner) });
    expect(res.statusCode).toBe(409);
    expect(fs.existsSync(path.join(dir, 'pending_deletions.json'))).toBe(false);
  });
});

describe('sync routes drop old deletion markers (#464)', () => {
  it('POST /api/sync and /api/sync/push store and return no marker older than 90 days', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'anna');
    const now = Date.now();
    const body = {
      data: {
        polishes: [
          polish('old', { deletedAt: now - 91 * DAY }),
          polish('young', { deletedAt: now - 89 * DAY }),
          polish('live'),
        ],
        customCats: [], manicures: [], stickers: [],
      },
    };
    const sync = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(token), payload: body });
    expect(sync.statusCode).toBe(200);
    expect((sync.json() as { data: { polishes: { id: string }[] } }).data.polishes.map((p) => p.id)).toEqual(['young', 'live']);
    expect(db.getData('anna').polishes.map((p) => p.id)).toEqual(['young', 'live']);

    const push = await app.inject({ method: 'POST', url: '/api/sync/push', headers: auth(token), payload: body });
    expect(push.statusCode).toBe(200);
    expect(db.getData('anna').polishes.map((p) => p.id)).toEqual(['young', 'live']);
  });
});
