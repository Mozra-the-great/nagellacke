import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { resolveBranding, resolvePreset, parseBrandingInput } from './branding';

/** #324 S6: branding presets, custom branding and the public logo route. */
describe('resolveBranding', () => {
  it('keeps today\'s look by default', () => {
    expect(resolveBranding({ preset: 'nagellacke' })).toEqual({
      name: 'Nail Lacquer', title: 'Nagellacke', tagline: null, accentColor: null, logoUrl: null, introText: null,
    });
  });

  it('gives NailVault its name and the served placeholder wordmark', () => {
    expect(resolvePreset('nailvault')).toMatchObject({ name: 'NailVault', title: 'NailVault', accentColor: null });
    expect(resolvePreset('nailvault').logoUrl).toMatch(/^\/api\/branding\/logo\?v=/);
  });

  it('takes custom fields and falls back per field', () => {
    const r = resolveBranding({ preset: 'custom', custom: { name: 'Lackschrank', accentColor: '#aa3366', tagline: '  ' } });
    expect(r).toMatchObject({ name: 'Lackschrank', title: 'Lackschrank', accentColor: '#aa3366', tagline: null, logoUrl: null });
    expect(resolveBranding({ preset: 'custom' }).name).toBe('Nail Lacquer');
  });

  it('never passes on a stored colour that is not #rrggbb', () => {
    expect(resolveBranding({ preset: 'custom', custom: { accentColor: 'red;}body{display:none' } }).accentColor).toBeNull();
  });
});

describe('parseBrandingInput', () => {
  const current = { preset: 'nagellacke' as const };
  it('rejects an unknown preset, a loose colour and overlong text', () => {
    expect(parseBrandingInput({ preset: 'acme' }, current)).toHaveProperty('error');
    expect(parseBrandingInput({ preset: 'custom', custom: { accentColor: 'red' } }, current)).toHaveProperty('error');
    expect(parseBrandingInput({ preset: 'custom', custom: { accentColor: '#abc' } }, current)).toHaveProperty('error');
    expect(parseBrandingInput({ preset: 'custom', custom: { name: 'x'.repeat(61) } }, current)).toHaveProperty('error');
  });

  it('keeps fields not mentioned and clears the colour on an empty value', () => {
    const cur = { preset: 'custom' as const, custom: { name: 'A', accentColor: '#112233' } };
    const r = parseBrandingInput({ custom: { tagline: 'Hallo', accentColor: '' } }, cur);
    expect(r).toEqual({ settings: { preset: 'custom', custom: { name: 'A', tagline: 'Hallo', accentColor: undefined, introText: undefined } } });
  });
});

async function createTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-branding-test-'));
  process.env.DATA_DIR = dir;
  process.env.NAGELLACKE_NO_AUTOSTART = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  vi.resetModules();
  const mod = await import('./index');
  const app: FastifyInstance = await mod.buildApp();
  tmpDirs.push(dir);
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'owner', password: 'password123' } });
  const admin = { authorization: `Bearer ${(res.json() as { token: string }).token}` };
  return { app, admin, dir };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
  delete process.env.ALLOW_REGISTRATION;
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 7)]).toString('base64');

describe('branding routes', () => {
  it('saves a custom branding that /api/instance-config then reports resolved', async () => {
    const { app, admin } = await createTestApp();
    const save = await app.inject({
      method: 'POST', url: '/api/admin/branding', headers: admin,
      payload: { preset: 'custom', custom: { name: 'Lackschrank', accentColor: '#AA3366' } },
    });
    expect(save.statusCode).toBe(200);
    const cfg = (await app.inject({ method: 'GET', url: '/api/instance-config' })).json();
    expect(cfg.branding).toMatchObject({ name: 'Lackschrank', accentColor: '#aa3366' });
    expect(cfg.branding).not.toHaveProperty('preset');
  });

  it('answers 400 with a German message on invalid input', async () => {
    const { app, admin } = await createTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/admin/branding', headers: admin, payload: { preset: 'custom', custom: { accentColor: 'url(x)' } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/#rrggbb/);
  });

  it('is admin-only', async () => {
    const { app } = await createTestApp();
    process.env.ALLOW_REGISTRATION = 'true';
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob', password: 'password123' } });
    const bob = { authorization: `Bearer ${(reg.json() as { token: string }).token}` };
    expect((await app.inject({ method: 'GET', url: '/api/admin/branding', headers: bob })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/branding', headers: bob, payload: { preset: 'nailvault' } })).statusCode).toBe(403);
  });

  it('serves the NailVault wordmark publicly, and 404 when no logo applies', async () => {
    const { app, admin } = await createTestApp();
    expect((await app.inject({ method: 'GET', url: '/api/branding/logo' })).statusCode).toBe(404);
    await app.inject({ method: 'POST', url: '/api/admin/branding', headers: admin, payload: { preset: 'nailvault' } });
    const logo = await app.inject({ method: 'GET', url: '/api/branding/logo' });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(logo.body).toContain('NailVault');
  });

  it('accepts a PNG logo for custom branding and refuses an SVG', async () => {
    const { app, admin } = await createTestApp();
    await app.inject({ method: 'POST', url: '/api/admin/branding', headers: admin, payload: { preset: 'custom', custom: { name: 'X' } } });

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    expect((await app.inject({ method: 'POST', url: '/api/admin/branding/logo', headers: admin, payload: { data: svg } })).statusCode).toBe(400);

    const up = await app.inject({ method: 'POST', url: '/api/admin/branding/logo', headers: admin, payload: { data: PNG } });
    expect(up.statusCode).toBe(200);
    expect(up.json().resolved.logoUrl).toMatch(/^\/api\/branding\/logo\?v=\d+$/);
    const logo = await app.inject({ method: 'GET', url: '/api/branding/logo' });
    expect(logo.statusCode).toBe(200);
    expect(logo.headers['content-type']).toMatch(/image\/png/);

    // A later settings save cannot drop or forge the logo.
    await app.inject({ method: 'POST', url: '/api/admin/branding', headers: admin, payload: { preset: 'custom', custom: { logo: { filename: '../../users.json', mimeType: 'text/html' } } } });
    const again = await app.inject({ method: 'GET', url: '/api/branding/logo' });
    expect(again.headers['content-type']).toMatch(/image\/png/);

    expect((await app.inject({ method: 'DELETE', url: '/api/admin/branding/logo', headers: admin })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/branding/logo' })).statusCode).toBe(404);
  });
});
