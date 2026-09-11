import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  buildUpdateSteps, updateChildEnv, runUpdate, readUpdateState, writeUpdateState,
  publishWebBuild, UPDATE_STALE_MS,
} from './update';
import type { SpawnFn, UpdateStep } from './update';

/**
 * The bugs in #335 were all environment-shaped: every step of the update ran
 * fine in a developer shell and failed on a real systemd install. These tests
 * therefore assert the *arguments and the environment* the steps are given and
 * the state they leave behind — never a real git/npm invocation, which is also
 * why the accept path of POST /api/update/apply is still never injected.
 */

const tmpDirs: string[] = [];

function tmp(prefix = 'nagellacke-update-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.NAGELLACKE_NO_AUTOSTART;
});

/** Records every step it is handed and succeeds, unless told to fail at one. */
function recordingSpawn(failAt?: string, stderr = 'boom'): { spawn: SpawnFn; calls: { step: UpdateStep; env: NodeJS.ProcessEnv }[] } {
  const calls: { step: UpdateStep; env: NodeJS.ProcessEnv }[] = [];
  const spawn: SpawnFn = (step, env) => {
    calls.push({ step, env });
    return step.label === failAt ? { status: 1, stderr } : { status: 0, stderr: '' };
  };
  return { spawn, calls };
}

describe('buildUpdateSteps', () => {
  it('syncs the checkout with fetch + reset instead of pull', () => {
    const steps = buildUpdateSteps('/opt/nagellacke');
    expect(steps.map((s) => `${s.cmd} ${s.args.join(' ')}`).slice(0, 2)).toEqual([
      'git fetch origin main',
      'git reset --hard FETCH_HEAD',
    ]);
    // A pull is what aborted on the deploy-modified package-lock.json.
    expect(steps.some((s) => s.args.includes('pull'))).toBe(false);
  });

  it('installs dev dependencies explicitly', () => {
    const install = buildUpdateSteps('/opt/nagellacke').find((s) => s.args[0] === 'install');
    expect(install?.args).toContain('--include=dev');
  });

  it('builds every workspace package the server needs', () => {
    const steps = buildUpdateSteps('/opt/nagellacke');
    for (const target of ['build:core', 'build:sync', 'build:server', 'build:web']) {
      expect(steps.some((s) => s.args.includes(target))).toBe(true);
    }
  });

  it('runs git in the app root and npm in v3/', () => {
    const steps = buildUpdateSteps(path.join('/opt', 'nagellacke'));
    for (const step of steps) {
      const expected = step.cmd === 'git' ? path.join('/opt', 'nagellacke') : path.join('/opt', 'nagellacke', 'v3');
      expect(step.cwd).toBe(expected);
    }
  });
});

describe('updateChildEnv', () => {
  // The whole bug: systemd sets NODE_ENV=production, npm reads it as
  // --omit=dev and prunes tsup/vite/typescript right before the build steps
  // call them ("sh: 1: tsup: not found").
  it('drops NODE_ENV=production so npm keeps devDependencies', () => {
    const env = updateChildEnv({ NODE_ENV: 'production', PATH: '/usr/bin' });
    expect(env.NODE_ENV).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  it('does not mutate the environment it was given', () => {
    const original = { NODE_ENV: 'production' };
    updateChildEnv(original);
    expect(original.NODE_ENV).toBe('production');
  });
});

describe('runUpdate', () => {
  function options(dir: string, spawn: SpawnFn, publish = (): void => {}) {
    return {
      appRoot: '/opt/nagellacke',
      dataDir: dir,
      publicDir: path.join(dir, 'public'),
      spawn,
      env: { NODE_ENV: 'production' },
      publish,
    };
  }

  it('runs every step with an environment free of NODE_ENV=production', () => {
    const dir = tmp();
    const { spawn, calls } = recordingSpawn();
    const state = runUpdate(options(dir, spawn));
    expect(state.phase).toBe('success');
    expect(calls).toHaveLength(buildUpdateSteps('/opt/nagellacke').length);
    for (const call of calls) expect(call.env.NODE_ENV).toBeUndefined();
  });

  it('stops at the first failing step and records which one it was', () => {
    const dir = tmp();
    const { spawn, calls } = recordingSpawn('Paket core bauen', 'sh: 1: tsup: not found');
    const state = runUpdate(options(dir, spawn));

    expect(state.phase).toBe('failed');
    expect(state.step).toBe('Paket core bauen');
    expect(state.exitCode).toBe(1);
    expect(state.error).toContain('tsup: not found');
    // build:sync, build:server and build:web must not have been attempted.
    expect(calls.map((c) => c.step.label)).toEqual([
      'Quellcode holen', 'Checkout aktualisieren', 'Abhängigkeiten installieren', 'Paket core bauen',
    ]);
  });

  it('persists the failure so a later GET /api/update/status can report it', () => {
    const dir = tmp();
    const { spawn } = recordingSpawn('Quellcode holen', 'fatal: could not read from remote');
    runUpdate(options(dir, spawn));

    const persisted = readUpdateState(dir);
    expect(persisted?.phase).toBe('failed');
    expect(persisted?.step).toBe('Quellcode holen');
    expect(persisted?.error).toContain('could not read from remote');
  });

  it('reports progress while it runs', () => {
    const dir = tmp();
    const seen: (string | undefined)[] = [];
    const spawn: SpawnFn = () => {
      // What a client polling mid-update would see.
      seen.push(readUpdateState(dir)?.step);
      return { status: 0, stderr: '' };
    };
    runUpdate(options(dir, spawn));
    expect(seen[0]).toBe('Quellcode holen');
    expect(seen).toContain('Web-App bauen');
  });

  it('counts publishing as a step and fails visibly when it throws', () => {
    const dir = tmp();
    const { spawn } = recordingSpawn();
    const state = runUpdate(options(dir, spawn, () => { throw new Error('Web-Build fehlt'); }));

    expect(state.phase).toBe('failed');
    expect(state.step).toBe('Web-App veröffentlichen');
    expect(state.error).toBe('Web-Build fehlt');
    expect(state.totalSteps).toBe(buildUpdateSteps('/opt/nagellacke').length + 1);
  });

  it('falls back to the command line when a step fails without stderr', () => {
    const dir = tmp();
    // spawnSync reports a missing binary as status null with empty stderr.
    const spawn: SpawnFn = () => ({ status: null, stderr: '' });
    const state = runUpdate(options(dir, spawn));
    expect(state.phase).toBe('failed');
    expect(state.exitCode).toBeNull();
    expect(state.error).toBe('git fetch origin main fehlgeschlagen');
  });

  it('marks success only after publishing', () => {
    const dir = tmp();
    const { spawn } = recordingSpawn();
    let published = false;
    const state = runUpdate(options(dir, spawn, () => { published = true; }));
    expect(published).toBe(true);
    expect(state.phase).toBe('success');
    expect(state.stepIndex).toBe(state.totalSteps);
    expect(readUpdateState(dir)?.phase).toBe('success');
  });
});

describe('readUpdateState', () => {
  it('returns null when no update has ever run', () => {
    expect(readUpdateState(tmp())).toBeNull();
  });

  it('reports a state left running past the stale window as failed', () => {
    const dir = tmp();
    const startedAt = Date.now() - UPDATE_STALE_MS - 1000;
    writeUpdateState(dir, {
      phase: 'running', step: 'Web-App bauen', stepIndex: 6, totalSteps: 8,
      startedAt, updatedAt: startedAt,
    });
    const state = readUpdateState(dir);
    // An OOM-killed build would otherwise leave the UI polling forever.
    expect(state?.phase).toBe('failed');
    expect(state?.error).toMatch(/verloren/);
  });

  it('leaves a recently updated running state alone', () => {
    const dir = tmp();
    writeUpdateState(dir, {
      phase: 'running', step: 'Web-App bauen', stepIndex: 6, totalSteps: 8,
      startedAt: Date.now(), updatedAt: Date.now(),
    });
    expect(readUpdateState(dir)?.phase).toBe('running');
  });

  it('survives a corrupt state file', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'update_state.json'), '{ not json');
    expect(readUpdateState(dir)).toBeNull();
  });
});

describe('publishWebBuild', () => {
  function appRootWithDist(contents: Record<string, string>): string {
    const root = tmp();
    const dist = path.join(root, 'v3', 'apps', 'web', 'dist');
    fs.mkdirSync(dist, { recursive: true });
    for (const [name, body] of Object.entries(contents)) fs.writeFileSync(path.join(dist, name), body);
    return root;
  }

  it('replaces the previous build', () => {
    const root = appRootWithDist({ 'index.html': 'neu' });
    const publicDir = path.join(tmp(), 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(path.join(publicDir, 'index.html'), 'alt');
    fs.writeFileSync(path.join(publicDir, 'stale-asset.js'), 'alt');

    publishWebBuild(root, publicDir);

    expect(fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8')).toBe('neu');
    expect(fs.existsSync(path.join(publicDir, 'stale-asset.js'))).toBe(false);
  });

  it('throws instead of silently skipping when the build is missing', () => {
    const root = tmp();
    const publicDir = path.join(tmp(), 'public');
    // The old code treated a missing dist as "nothing to copy" and restarted
    // the server anyway, hiding a failed build:web behind a normal restart.
    expect(() => publishWebBuild(root, publicDir)).toThrow(/Web-Build fehlt/);
  });

  it('stages the copy beside the target and leaves nothing behind', () => {
    const root = appRootWithDist({ 'index.html': 'neu' });
    const publicDir = path.join(tmp(), 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    // A copy that dies halfway used to leave the SPA serving 404s, because the
    // old public/ was removed first. The staging directory is what makes the
    // switch survivable; it must not outlive the publish either.
    fs.mkdirSync(`${publicDir}.new`, { recursive: true });
    fs.writeFileSync(path.join(`${publicDir}.new`, 'leftover.js'), 'vom letzten Fehlversuch');

    publishWebBuild(root, publicDir);

    expect(fs.existsSync(`${publicDir}.new`)).toBe(false);
    expect(fs.readdirSync(publicDir)).toEqual(['index.html']);
  });

  it('works on an install that has no public/ yet', () => {
    const root = appRootWithDist({ 'index.html': 'neu' });
    const publicDir = path.join(tmp(), 'public');
    publishWebBuild(root, publicDir);
    expect(fs.readFileSync(path.join(publicDir, 'index.html'), 'utf-8')).toBe('neu');
  });
});

describe('GET /api/update/status', () => {
  async function createTestApp(): Promise<{ app: FastifyInstance; dir: string; apiKey: string }> {
    const dir = tmp('nagellacke-update-route-');
    process.env.DATA_DIR = dir;
    process.env.NAGELLACKE_NO_AUTOSTART = 'true';
    process.env.NODE_ENV = 'test';
    vi.resetModules();
    const mod = await import('./index');
    const app = await mod.buildApp();
    const apiKey = fs.readFileSync(path.join(dir, '.api_key'), 'utf-8').trim();
    return { app, dir, apiKey };
  }

  it('401s without credentials', async () => {
    const { app } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/update/status' });
    expect(res.statusCode).toBe(401);
  });

  it('reports no update for a fresh install', async () => {
    const { app, apiKey } = await createTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/update/status', headers: { 'x-api-key': apiKey } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { version: string; update: unknown };
    expect(body.update).toBeNull();
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('hands the persisted failure back to the client', async () => {
    const { app, dir, apiKey } = await createTestApp();
    writeUpdateState(dir, {
      phase: 'failed', step: 'Paket core bauen', stepIndex: 3, totalSteps: 8,
      startedAt: Date.now(), updatedAt: Date.now(), finishedAt: Date.now(),
      exitCode: 1, error: 'sh: 1: tsup: not found',
    });
    const res = await app.inject({ method: 'GET', url: '/api/update/status', headers: { 'x-api-key': apiKey } });
    const body = res.json() as { update: { phase: string; step: string; error: string } };
    expect(body.update.phase).toBe('failed');
    expect(body.update.step).toBe('Paket core bauen');
    expect(body.update.error).toContain('tsup');
  });
});
