import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  buildUpdateSteps, updateChildEnv, runUpdate, readUpdateState, writeUpdateState,
  publishWebBuild, UPDATE_STALE_MS, detectDeployment, parseRepoSlug, DEFAULT_REPO_SLUG, spawnStep,
} from './update';
import type { SpawnFn, UpdateStep, GitProbeFn } from './update';

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
    return Promise.resolve(step.label === failAt ? { status: 1, stderr } : { status: 0, stderr: '' });
  };
  return { spawn, calls };
}

/**
 * A git that behaves like the one in the container image: not installed, so
 * every spawn fails before the arguments matter (`spawn git ENOENT` leaves
 * status null). Overrides let a single probe be answered differently.
 */
function gitProbe(answers: Record<string, { status: number | null; stdout?: string }> = {}): GitProbeFn {
  return (args) => {
    const key = args.join(' ');
    const answer = answers[key] ?? { status: null };
    return { status: answer.status, stdout: answer.stdout ?? '' };
  };
}

describe('parseRepoSlug', () => {
  it('reads owner/repo from both the SSH and the HTTPS remote form', () => {
    expect(parseRepoSlug('https://github.com/Mozra-the-great/nagellacke.git')).toBe('Mozra-the-great/nagellacke');
    expect(parseRepoSlug('git@github.com:Mozra-the-great/nagellacke.git')).toBe('Mozra-the-great/nagellacke');
    expect(parseRepoSlug('  https://github.com/Mozra-the-great/nagellacke  ')).toBe('Mozra-the-great/nagellacke');
  });

  it('rejects anything that is not a github owner/repo', () => {
    expect(parseRepoSlug('')).toBeNull();
    expect(parseRepoSlug('https://gitlab.com/owner/repo.git')).toBeNull();
    // Extra path segments are dropped rather than folded into the slug: the
    // GitHub API path is /repos/<owner>/<repo>, so a third segment would build
    // a URL that 404s.
    expect(parseRepoSlug('https://github.com/owner/repo/extra')).toBe('owner/repo');
  });
});

describe('detectDeployment', () => {
  it('falls back to the constant repo when git is missing, instead of giving up', () => {
    // The #340 regression in one assertion: the container has no git, and the
    // old code answered that with latestVersion: null / updateAvailable: false,
    // which the UI renders as "aktuell". The repo is static information.
    const info = detectDeployment({ appRoot: '/', env: {}, gitProbe: gitProbe() });
    expect(info.repoSlug).toBe(DEFAULT_REPO_SLUG);
    expect(info.selfUpdate).toBe('unsupported');
    expect(info.selfUpdateReason).toMatch(/git/);
  });

  it('reports unsupported when git exists but APP_ROOT is not a checkout', () => {
    const info = detectDeployment({
      appRoot: '/app',
      env: {},
      gitProbe: gitProbe({ '--version': { status: 0, stdout: 'git version 2.43.0' } }),
    });
    expect(info.selfUpdate).toBe('unsupported');
    expect(info.selfUpdateReason).toContain('/app');
  });

  it('reports supported and the discovered repo on a real checkout', () => {
    const info = detectDeployment({
      appRoot: '/opt/nagellacke',
      env: {},
      gitProbe: gitProbe({
        'remote get-url origin': { status: 0, stdout: 'https://github.com/someone/fork.git' },
        '--version': { status: 0, stdout: 'git version 2.43.0' },
        'rev-parse --git-dir': { status: 0, stdout: '.git' },
      }),
    });
    expect(info).toEqual({ repoSlug: 'someone/fork', selfUpdate: 'supported' });
  });

  it('lets NAGELLACKE_REPO win over the discovered remote', () => {
    const info = detectDeployment({
      appRoot: '/opt/nagellacke',
      env: { NAGELLACKE_REPO: 'someone/fork' },
      gitProbe: gitProbe({
        'remote get-url origin': { status: 0, stdout: 'https://github.com/Mozra-the-great/nagellacke.git' },
        '--version': { status: 0, stdout: 'git version 2.43.0' },
        'rev-parse --git-dir': { status: 0, stdout: '.git' },
      }),
    });
    expect(info.repoSlug).toBe('someone/fork');
  });

  it('ignores a malformed NAGELLACKE_REPO rather than building a broken API URL', () => {
    const info = detectDeployment({
      appRoot: '/',
      env: { NAGELLACKE_REPO: 'https://github.com/owner/repo' },
      gitProbe: gitProbe(),
    });
    expect(info.repoSlug).toBe(DEFAULT_REPO_SLUG);
  });
});

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

  it('runs every step with an environment free of NODE_ENV=production', async () => {
    const dir = tmp();
    const { spawn, calls } = recordingSpawn();
    const state = await runUpdate(options(dir, spawn));
    expect(state.phase).toBe('success');
    expect(calls).toHaveLength(buildUpdateSteps('/opt/nagellacke').length);
    for (const call of calls) expect(call.env.NODE_ENV).toBeUndefined();
  });

  it('stops at the first failing step and records which one it was', async () => {
    const dir = tmp();
    const { spawn, calls } = recordingSpawn('Paket core bauen', 'sh: 1: tsup: not found');
    const state = await runUpdate(options(dir, spawn));

    expect(state.phase).toBe('failed');
    expect(state.step).toBe('Paket core bauen');
    expect(state.exitCode).toBe(1);
    expect(state.error).toContain('tsup: not found');
    // build:sync, build:server and build:web must not have been attempted.
    expect(calls.map((c) => c.step.label)).toEqual([
      'Quellcode holen', 'Checkout aktualisieren', 'Abhängigkeiten installieren', 'Paket core bauen',
    ]);
  });

  it('persists the failure so a later GET /api/update/status can report it', async () => {
    const dir = tmp();
    const { spawn } = recordingSpawn('Quellcode holen', 'fatal: could not read from remote');
    await runUpdate(options(dir, spawn));

    const persisted = readUpdateState(dir);
    expect(persisted?.phase).toBe('failed');
    expect(persisted?.step).toBe('Quellcode holen');
    expect(persisted?.error).toContain('could not read from remote');
  });

  it('reports progress while it runs', async () => {
    const dir = tmp();
    const seen: (string | undefined)[] = [];
    const spawn: SpawnFn = () => {
      // What a client polling mid-update would see.
      seen.push(readUpdateState(dir)?.step);
      return Promise.resolve({ status: 0, stderr: '' });
    };
    await runUpdate(options(dir, spawn));
    expect(seen[0]).toBe('Quellcode holen');
    expect(seen).toContain('Web-App bauen');
  });

  it('lets a concurrent poller see more than one step go by (#338)', async () => {
    const dir = tmp();
    // Steps that finish on a macrotask, the way a real child process does.
    const spawn: SpawnFn = () => new Promise(resolve => setTimeout(() => resolve({ status: 0, stderr: '' }), 2));
    const seen: (string | undefined)[] = [];
    const poller = setInterval(() => { seen.push(readUpdateState(dir)?.step); }, 1);
    const state = await runUpdate(options(dir, spawn));
    clearInterval(poller);

    expect(state.phase).toBe('success');
    // The per-step display in AdminPage/SettingsPage was unreachable before:
    // no poll could land between two steps.
    expect(new Set(seen.filter(Boolean)).size).toBeGreaterThan(1);
  });

  it('counts publishing as a step and fails visibly when it throws', async () => {
    const dir = tmp();
    const { spawn } = recordingSpawn();
    const state = await runUpdate(options(dir, spawn, () => { throw new Error('Web-Build fehlt'); }));

    expect(state.phase).toBe('failed');
    expect(state.step).toBe('Web-App veröffentlichen');
    expect(state.error).toBe('Web-Build fehlt');
    expect(state.totalSteps).toBe(buildUpdateSteps('/opt/nagellacke').length + 1);
  });

  it('falls back to the command line when a step fails without stderr', async () => {
    const dir = tmp();
    // A missing binary arrives as status null with empty stderr.
    const spawn: SpawnFn = () => Promise.resolve({ status: null, stderr: '' });
    const state = await runUpdate(options(dir, spawn));
    expect(state.phase).toBe('failed');
    expect(state.exitCode).toBeNull();
    expect(state.error).toBe('git fetch origin main fehlgeschlagen');
  });

  it('marks success only after publishing', async () => {
    const dir = tmp();
    const { spawn } = recordingSpawn();
    let published = false;
    const state = await runUpdate(options(dir, spawn, () => { published = true; }));
    expect(published).toBe(true);
    expect(state.phase).toBe('success');
    expect(state.stepIndex).toBe(state.totalSteps);
    expect(readUpdateState(dir)?.phase).toBe('success');
  });
});

describe('spawnStep', () => {
  /** Runs node itself rather than git/npm — real process, no side effects. */
  function nodeStep(script: string, timeout = 10_000): UpdateStep {
    return { label: 'test', cmd: process.execPath, args: ['-e', script], cwd: process.cwd(), timeout };
  }

  it('resolves with the exit code and the captured stderr', async () => {
    const result = await spawnStep(nodeStep('process.stderr.write("kaputt"); process.exit(3);'), process.env);
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('kaputt');
  });

  it('does not block the event loop while the child runs (#338)', async () => {
    // The whole point of the change: under spawnSync nothing else could run
    // for the duration of a step, so GET /api/update/status — and every other
    // request — went unanswered for the entire update.
    let ticked = false;
    const timer = setTimeout(() => { ticked = true; }, 10);
    const result = await spawnStep(nodeStep('setTimeout(() => {}, 200);'), process.env);
    clearTimeout(timer);
    expect(result.status).toBe(0);
    expect(ticked).toBe(true);
  });

  it('reports a missing binary as status null with the reason', async () => {
    const step: UpdateStep = {
      label: 'test', cmd: 'definitely-not-a-real-binary-nagellacke', args: [], cwd: process.cwd(), timeout: 5_000,
    };
    const result = await spawnStep(step, process.env);
    expect(result.status).toBeNull();
    expect(result.stderr).toContain('ENOENT');
  });

  it('kills a step that outruns its timeout and says so', async () => {
    const result = await spawnStep(nodeStep('setTimeout(() => {}, 30_000);', 150), process.env);
    expect(result.status).toBeNull();
    expect(result.stderr).toContain('abgebrochen');
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
