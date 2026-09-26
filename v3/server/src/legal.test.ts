import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/** #324 S11: Impressum and Datenschutz, maintained in the panel and served publicly. */
async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-legal-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  vi.resetModules();
  const mod = await import('./index');
  const db = await import('./db');
  const app: FastifyInstance = await mod.buildApp();
  tmpDirs.push(dir);
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'owner', password: 'password123' } });
  return { app, db, dir, admin: { authorization: `Bearer ${(res.json() as { token: string }).token}` } };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.ALLOW_REGISTRATION;
});

describe('legal pages (#324 S11)', () => {
  it('are null until maintained, then served publicly', async () => {
    const { app, admin } = await createTestApp();
    expect((await app.inject({ method: 'GET', url: '/api/legal' })).json()).toEqual({ impressum: null, datenschutz: null });

    const save = await app.inject({
      method: 'POST', url: '/api/admin/legal', headers: admin,
      payload: { impressum: { title: 'Impressum', body: 'Max Muster\nBeispielweg 1' } },
    });
    expect(save.statusCode).toBe(200);

    const pub = (await app.inject({ method: 'GET', url: '/api/legal' })).json();
    expect(pub.impressum).toMatchObject({ title: 'Impressum', body: 'Max Muster\nBeispielweg 1' });
    expect(typeof pub.impressum.updatedAt).toBe('number');
    expect(pub.datenschutz).toBeNull();
  });

  it('leaves an omitted page alone and removes one sent as null or empty', async () => {
    const { app, admin } = await createTestApp();
    await app.inject({ method: 'POST', url: '/api/admin/legal', headers: admin, payload: { impressum: { title: 'I', body: 'a' }, datenschutz: { title: 'D', body: 'b' } } });
    await app.inject({ method: 'POST', url: '/api/admin/legal', headers: admin, payload: { datenschutz: { title: 'D', body: '   ' } } });
    const pub = (await app.inject({ method: 'GET', url: '/api/legal' })).json();
    expect(pub.impressum?.body).toBe('a');
    expect(pub.datenschutz).toBeNull();
  });

  it('stores the file 0600 and audits without content', async () => {
    const { app, admin, db, dir } = await createTestApp();
    await app.inject({ method: 'POST', url: '/api/admin/legal', headers: admin, payload: { impressum: { title: 'I', body: 'Geheimer Text' } } });
    expect(fs.statSync(path.join(dir, 'legal.json')).mode & 0o777).toBe(0o600);
    const entry = db.getAuditLog().find((e) => e.action === 'legal.updated');
    expect(entry?.meta).toEqual({ pages: ['impressum'] });
    expect(JSON.stringify(entry)).not.toContain('Geheimer Text');
  });

  it('rejects malformed input and non-admins', async () => {
    const { app, admin } = await createTestApp();
    expect((await app.inject({ method: 'POST', url: '/api/admin/legal', headers: admin, payload: { impressum: { body: 5 } } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/admin/legal', headers: admin, payload: { impressum: { title: 'x', body: 'y'.repeat(50_001) } } })).statusCode).toBe(400);
    process.env.ALLOW_REGISTRATION = 'true';
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob', password: 'password123' } });
    const bob = { authorization: `Bearer ${(reg.json() as { token: string }).token}` };
    expect((await app.inject({ method: 'POST', url: '/api/admin/legal', headers: bob, payload: { impressum: { title: 'x', body: 'y' } } })).statusCode).toBe(403);
  });
});
