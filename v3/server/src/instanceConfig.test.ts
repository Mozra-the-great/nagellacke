import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * #324, first two steps: the server-wide switches for photo uploads, AI and the
 * public-instance mode (S1), the public GET /api/instance-config that tells the web
 * app about them (S2), and their server-side enforcement (S4, S5). Each test gets
 * its own DATA_DIR and module graph, as in admin.test.ts.
 */
async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-instance-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  vi.resetModules();
  const mod = await import('./index');
  const db = await import('./db');
  const app: FastifyInstance = await mod.buildApp();
  const apiKey = fs.readFileSync(path.join(dir, '.api_key'), 'utf-8').trim();
  tmpDirs.push(dir);
  return { app, db, dir, apiKey };
}

const tmpDirs: string[] = [];
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

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 7)]).toString('base64');

describe('admin switches in /api/admin/settings (#324 S1)', () => {
  it('default to on/off with source "default", then round-trip as "panel" and survive a restart', async () => {
    const { app, db } = await createTestApp();
    const admin = await register(app, 'owner');
    const auth = { authorization: `Bearer ${admin}` };

    const before = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: auth })).json();
    expect(before).toMatchObject({
      photoUploadsEnabled: true, photoUploadsEnabledSource: 'default',
      aiEnabled: true, aiEnabledSource: 'default',
      publicInstance: false, publicInstanceSource: 'default',
    });

    const save = await app.inject({
      method: 'POST', url: '/api/admin/settings', headers: auth,
      payload: { photoUploadsEnabled: false, aiEnabled: false, publicInstance: true },
    });
    expect(save.statusCode).toBe(200);

    // Persisted in server_settings.json, i.e. what a restarted process reads.
    expect(db.getServerSettings()).toMatchObject({ photoUploadsEnabled: false, aiEnabled: false, publicInstance: { enabled: true } });
    const after = (await app.inject({ method: 'GET', url: '/api/admin/settings', headers: auth })).json();
    expect(after).toMatchObject({
      photoUploadsEnabled: false, photoUploadsEnabledSource: 'panel',
      aiEnabled: false, aiEnabledSource: 'panel',
      publicInstance: true, publicInstanceSource: 'panel',
    });
  });

  it('records which switches changed in the audit log, not their values', async () => {
    const { app, db } = await createTestApp();
    const admin = await register(app, 'owner');
    await app.inject({
      method: 'POST', url: '/api/admin/settings', headers: { authorization: `Bearer ${admin}` },
      payload: { aiEnabled: false },
    });
    const entry = db.getAuditLog().find((e) => e.action === 'server_settings.updated');
    expect(entry?.meta).toMatchObject({ aiEnabled: true, photoUploadsEnabled: false, publicInstance: false });
  });

  it('refuses a non-admin', async () => {
    const { app } = await createTestApp();
    await register(app, 'owner');
    process.env.ALLOW_REGISTRATION = 'true';
    const user = await register(app, 'bob');
    const res = await app.inject({
      method: 'POST', url: '/api/admin/settings', headers: { authorization: `Bearer ${user}` },
      payload: { aiEnabled: false },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/instance-config (#324 S2)', () => {
  it('answers without auth, with defaults on a fresh server', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/instance-config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      publicInstance: false, photoUploads: true, ai: true,
      branding: { name: 'Nail Lacquer' },
    });
  });

  it('mirrors the saved switches', async () => {
    const { app, db } = await createTestApp();
    db.setServerSettings({ photoUploadsEnabled: false, aiEnabled: false, publicInstance: { enabled: true } });
    expect((await app.inject({ method: 'GET', url: '/api/instance-config' })).json())
      .toMatchObject({ publicInstance: true, photoUploads: false, ai: false });
  });

  it('is rate-limited', async () => {
    const { app } = await createTestApp();
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await app.inject({ method: 'GET', url: '/api/instance-config' })).statusCode);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes[30]).toBe(429);
  });
});

describe('photo upload switch (#324 S4)', () => {
  it('blocks new uploads for JWT and X-Api-Key alike, but still serves and deletes existing photos', async () => {
    const { app, db, apiKey } = await createTestApp();
    const token = await register(app, 'owner');
    const auth = { authorization: `Bearer ${token}` };
    const up = await app.inject({ method: 'POST', url: '/api/photos', headers: auth, payload: { data: PNG, mimeType: 'image/png' } });
    const { filename } = up.json() as { filename: string };

    db.setServerSettings({ photoUploadsEnabled: false });

    const blocked = await app.inject({ method: 'POST', url: '/api/photos', headers: auth, payload: { data: PNG, mimeType: 'image/png' } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toMatch(/deaktiviert/);
    const blockedKey = await app.inject({ method: 'POST', url: '/api/photos', headers: { 'x-api-key': apiKey }, payload: { data: PNG, mimeType: 'image/png' } });
    expect(blockedKey.statusCode).toBe(403);

    expect((await app.inject({ method: 'GET', url: `/photos/${filename}`, headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/photos/${filename}`, headers: auth })).statusCode).toBe(200);
  });
});

describe('AI switch (#324 S5)', () => {
  it('refuses both enqueue routes with 403, even before checking the provider config', async () => {
    const { app, db } = await createTestApp();
    const token = await register(app, 'owner');
    db.setServerSettings({ aiEnabled: false });
    const auth = { authorization: `Bearer ${token}` };

    const autofill = await app.inject({ method: 'POST', url: '/api/ai/autofill', headers: auth, payload: { name: 'Rot' } });
    const cart = await app.inject({ method: 'POST', url: '/api/ai/smart-cart', headers: auth, payload: { prompt: 'rot' } });
    expect(autofill.statusCode).toBe(403);
    expect(cart.statusCode).toBe(403);
    expect(autofill.json().error).toMatch(/deaktiviert/);
  });

  it('leaves already queued jobs pending instead of spending provider quota on them', async () => {
    const { db } = await createTestApp();
    const ai = await import('./ai');
    db.addAiJob({
      id: 'j1', type: 'smart-cart', status: 'pending', username: 'owner',
      input: { prompt: 'rot' }, createdAt: Date.now(), updatedAt: Date.now(),
    } as import('./db').AiJob);
    db.setServerSettings({ aiEnabled: false });

    await ai.processAiJobQueue();

    expect(db.getAiJob('j1')?.status).toBe('pending');
  });
});
