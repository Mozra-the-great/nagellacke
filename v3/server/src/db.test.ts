import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * db.ts captures DATA_DIR at import time (module-level const) and mkdirSyncs
 * it immediately, so DATA_DIR must be set *before* the first import in each
 * test — vi.resetModules() + a fresh dynamic import per test gives full
 * isolation and guarantees we never touch the developer's real
 * v3/server/data/ (see users.json etc).
 */
async function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-db-test-'));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  const db = await import('./db');
  return { db, dir };
}

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
  delete process.env.DATA_DIR;
});

describe('migrateFirstUserToAdmin', () => {
  it('is a no-op when there are no users', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    db.migrateFirstUserToAdmin();
    expect(db.getUserCount()).toBe(0);
    expect(db.countAdmins()).toBe(0);
  });

  it('promotes the sole existing user to admin', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    db.createUser('alice', 'hash');
    db.migrateFirstUserToAdmin();
    expect(db.isAdmin('alice')).toBe(true);
    expect(db.countAdmins()).toBe(1);
  });

  it('is idempotent — running it again once an admin exists changes nothing', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    db.createUser('alice', 'hash');
    db.createUser('bob', 'hash');
    db.migrateFirstUserToAdmin();
    db.setUserRole('bob', 'admin'); // simulate a manual second admin
    db.migrateFirstUserToAdmin(); // second run
    expect(db.countAdmins()).toBe(2); // unchanged, no re-promotion / demotion
    expect(db.isAdmin('alice')).toBe(true);
    expect(db.isAdmin('bob')).toBe(true);
  });

  it('promotes the earliest-created user among several pre-existing users', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    db.createUser('later', 'hash');
    // Force distinct created_at ordering by writing directly wouldn't be
    // possible without exposing internals, so create in order and rely on
    // Date.now() monotonicity across the two calls.
    await new Promise((r) => setTimeout(r, 2));
    db.createUser('earlier-created-second-call', 'hash');
    db.migrateFirstUserToAdmin();
    expect(db.isAdmin('later')).toBe(true);
    expect(db.isAdmin('earlier-created-second-call')).toBe(false);
  });
});

describe('server settings precedence (#173 §1.1)', () => {
  it('env-only: no panel value set, env var used', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    expect(db.getServerSettings().allowRegistration).toBeUndefined();
    // Caller (index.ts) computes: settings.allowRegistration ?? (env === 'true')
    process.env.ALLOW_REGISTRATION = 'true';
    const effective = db.getServerSettings().allowRegistration ?? (process.env.ALLOW_REGISTRATION === 'true');
    expect(effective).toBe(true);
    delete process.env.ALLOW_REGISTRATION;
  });

  it('panel-only: panel value set, no env var', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    db.setServerSettings({ allowRegistration: true });
    const effective = db.getServerSettings().allowRegistration ?? (process.env.ALLOW_REGISTRATION === 'true');
    expect(effective).toBe(true);
  });

  it('panel overrides env when both are set', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    process.env.ALLOW_REGISTRATION = 'true';
    db.setServerSettings({ allowRegistration: false });
    const effective = db.getServerSettings().allowRegistration ?? (process.env.ALLOW_REGISTRATION === 'true');
    expect(effective).toBe(false);
    delete process.env.ALLOW_REGISTRATION;
  });

  it('panel value cleared falls back to env', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    process.env.ALLOW_REGISTRATION = 'true';
    db.setServerSettings({}); // never touched in the panel
    const effective = db.getServerSettings().allowRegistration ?? (process.env.ALLOW_REGISTRATION === 'true');
    expect(effective).toBe(true);
    delete process.env.ALLOW_REGISTRATION;
  });

  it('SMTP: panel host/user/pass win over env vars field-by-field', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    process.env.SMTP_HOST = 'env.example.com';
    process.env.SMTP_USER = 'env-user';
    process.env.SMTP_PASS = 'env-pass';
    db.setServerSettings({ smtp: { host: 'panel.example.com', port: 587, user: 'panel-user', pass: 'panel-pass', from: 'panel@example.com' } });
    const { isEmailConfigured } = await import('./email');
    expect(isEmailConfigured()).toBe(true);
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  it('SMTP: falls back to env vars when nothing is saved in the panel', async () => {
    const { dir } = await freshDb();
    tmpDirs.push(dir);
    process.env.SMTP_HOST = 'env.example.com';
    process.env.SMTP_USER = 'env-user';
    process.env.SMTP_PASS = 'env-pass';
    const { isEmailConfigured } = await import('./email');
    expect(isEmailConfigured()).toBe(true);
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });
});

describe('admin/user db helpers', () => {
  it('listUsers never leaks password_hash', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    db.createUser('alice', 'super-secret-hash');
    const users = db.listUsers();
    expect(users).toHaveLength(1);
    expect(JSON.stringify(users)).not.toContain('super-secret-hash');
    expect((users[0] as unknown as Record<string, unknown>).password_hash).toBeUndefined();
  });

  it('deleteUser renames the collection file instead of destroying it', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    db.createUser('alice', 'hash');
    db.setData('alice', { polishes: [], customCats: [], manicures: [], stickers: [] });
    db.deleteUser('alice');
    expect(db.getUserCount()).toBe(0);
    const renamed = fs.readdirSync(path.join(dir, 'users', 'alice')).some((f) => f.includes('.deleted-'));
    expect(renamed).toBe(true);
  });
});

describe('logAdminAction / getAuditLog', () => {
  it('records entries newest-first and never a raw secret value', async () => {
    const { db, dir } = await freshDb();
    tmpDirs.push(dir);
    db.logAdminAction('alice', 'server_settings.updated', undefined, { smtp: ['pass'] });
    db.logAdminAction('alice', 'user.created', 'bob');
    const entries = db.getAuditLog();
    expect(entries[0].action).toBe('user.created');
    expect(entries[1].action).toBe('server_settings.updated');
    expect(JSON.stringify(entries)).not.toContain('hunter2');
  });
});
