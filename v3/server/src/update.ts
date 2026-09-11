/**
 * The self-update pipeline behind POST /api/update/apply (#335).
 *
 * Lives in its own module because the three bugs it fixes were all invisible
 * to a test that ran the steps in a developer shell: what broke the feature on
 * a real systemd install was the *environment* the steps inherited, the state
 * of the checkout they ran in, and the fact that nothing ever reported the
 * failure. Everything here is therefore injectable — the spawn function, the
 * environment, the clock — so the failure paths can be asserted without
 * running git or npm at all.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface UpdateStep {
  /** Shown in the status endpoint and the UI, so it is German like the rest of the surface. */
  label: string;
  cmd: string;
  args: string[];
  cwd: string;
  timeout: number;
}

export type UpdatePhase = 'running' | 'success' | 'failed';

export interface UpdateState {
  phase: UpdatePhase;
  /** Label of the step that is running, or the one that failed. */
  step: string;
  /** 0-based; equals totalSteps once every step is through. */
  stepIndex: number;
  totalSteps: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  /** Tail of the failing step's stderr. Admin-gated, like the endpoint serving it. */
  error?: string;
}

/**
 * A 'running' state older than this is treated as lost rather than shown as an
 * update that has been running for hours: the process can be killed (OOM on a
 * small box is the realistic case) between writing 'running' and any terminal
 * state, and nothing would ever correct the file. Comfortably above the sum of
 * every step timeout below (~8 min).
 */
export const UPDATE_STALE_MS = 20 * 60_000;

const STATE_FILE = 'update_state.json';

function stateFile(dataDir: string): string {
  return path.join(dataDir, STATE_FILE);
}

export function writeUpdateState(dataDir: string, state: UpdateState): void {
  try {
    fs.writeFileSync(stateFile(dataDir), JSON.stringify(state), { mode: 0o600 });
  } catch (e: unknown) {
    // Never let bookkeeping abort the update itself — a failed write costs
    // visibility, an exception here would cost the update.
    console.error('Update-Status konnte nicht geschrieben werden:', e instanceof Error ? e.message : e);
  }
}

export function readUpdateState(dataDir: string, now: number = Date.now()): UpdateState | null {
  let state: UpdateState;
  try {
    state = JSON.parse(fs.readFileSync(stateFile(dataDir), 'utf-8')) as UpdateState;
  } catch {
    return null;
  }
  if (state.phase === 'running' && now - state.updatedAt > UPDATE_STALE_MS) {
    return {
      ...state,
      phase: 'failed',
      finishedAt: state.updatedAt,
      error: 'Update-Status verloren — der Prozess wurde während des Updates beendet. Server-Logs prüfen.',
    };
  }
  return state;
}

/**
 * The environment the update's child processes run under.
 *
 * NODE_ENV is *removed*, and that is the whole point of this function: the
 * systemd unit sets NODE_ENV=production (install.sh), npm reads that as
 * `--omit=dev`, and `npm install` then prunes tsup/vite/typescript — the exact
 * packages the build steps are about to call. On the homelab box that produced
 * `sh: 1: tsup: not found` and left the install with new sources, no toolchain
 * and the old dist/ still running (#335).
 *
 * Removing it rather than forcing 'development' keeps npm and the build tools
 * on their own defaults; `vite build` sets production mode itself regardless.
 */
export function updateChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy.NODE_ENV;
  return copy;
}

/**
 * `git fetch` + `git reset --hard` rather than `git pull`: a deployment
 * directory is not a workspace. `npm install` during install.sh/the Ansible
 * deploy can leave package-lock.json modified, and a pull then refuses to run
 * at all ("Your local changes would be overwritten by merge") — which is where
 * both homelab instances were stuck. Only tracked files are reset; the data
 * directory is gitignored and untracked leftovers are left alone.
 */
export function buildUpdateSteps(appRoot: string): UpdateStep[] {
  const v3Dir = path.join(appRoot, 'v3');
  return [
    { label: 'Quellcode holen',        cmd: 'git', args: ['fetch', 'origin', 'main'],            cwd: appRoot, timeout: 30_000 },
    { label: 'Checkout aktualisieren', cmd: 'git', args: ['reset', '--hard', 'FETCH_HEAD'],      cwd: appRoot, timeout: 30_000 },
    // --include=dev belt-and-braces next to updateChildEnv(): it also covers an
    // npm that was configured with omit=dev in a config file rather than via
    // the environment.
    { label: 'Abhängigkeiten installieren', cmd: 'npm', args: ['install', '--include=dev', '--no-audit', '--no-fund'], cwd: v3Dir, timeout: 300_000 },
    { label: 'Paket core bauen',       cmd: 'npm', args: ['run', 'build:core'],                  cwd: v3Dir,  timeout: 60_000 },
    { label: 'Paket sync bauen',       cmd: 'npm', args: ['run', 'build:sync'],                  cwd: v3Dir,  timeout: 60_000 },
    { label: 'Server bauen',           cmd: 'npm', args: ['run', 'build:server'],                cwd: v3Dir,  timeout: 60_000 },
    { label: 'Web-App bauen',          cmd: 'npm', args: ['run', 'build:web'],                   cwd: v3Dir,  timeout: 180_000 },
  ];
}

export interface SpawnResult {
  status: number | null;
  stderr: string;
}

export type SpawnFn = (step: UpdateStep, env: NodeJS.ProcessEnv) => SpawnResult;

const defaultSpawn: SpawnFn = (step, env) => {
  const r = spawnSync(step.cmd, step.args, { cwd: step.cwd, stdio: 'pipe', timeout: step.timeout, env });
  // A timeout or a missing binary sets `error` and leaves status null with an
  // empty stderr, so the message is the only thing that says what happened.
  const stderr = r.stderr?.toString() ?? '';
  return { status: r.status, stderr: r.error ? `${stderr}${r.error.message}` : stderr };
};

/** Last ~2000 characters, which is where a build tool puts the actual error. */
function stderrTail(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed.length > 2000 ? `…${trimmed.slice(-2000)}` : trimmed;
}

/**
 * Replaces server/public with the fresh web build.
 *
 * Staged through a sibling directory and swapped at the end: the previous
 * version removed public/ first and copied into it afterwards, so a copy that
 * died halfway (disk full on a 8 GB LXC) left the SPA serving 404s with no
 * way back except a redeploy.
 */
export function publishWebBuild(appRoot: string, publicDir: string): void {
  const dist = path.join(appRoot, 'v3', 'apps', 'web', 'dist');
  if (!fs.existsSync(dist)) throw new Error(`Web-Build fehlt: ${dist}`);
  const staging = `${publicDir}.new`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(dist, staging, { recursive: true });
  fs.rmSync(publicDir, { recursive: true, force: true });
  fs.renameSync(staging, publicDir);
}

export interface RunUpdateOptions {
  appRoot: string;
  dataDir: string;
  /** Destination for the web build — server/public of the *running* server. */
  publicDir: string;
  spawn?: SpawnFn;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  publish?: (appRoot: string, publicDir: string) => void;
}

const PUBLISH_LABEL = 'Web-App veröffentlichen';

/**
 * Runs every step in order, persisting the state before and after each one, and
 * stops at the first failure. Returns the terminal state; the caller decides
 * what to do with it (index.ts restarts the process on success).
 */
export function runUpdate(options: RunUpdateOptions): UpdateState {
  const {
    appRoot, dataDir, publicDir,
    spawn = defaultSpawn,
    env = process.env,
    now = Date.now,
    publish = publishWebBuild,
  } = options;

  const steps = buildUpdateSteps(appRoot);
  const childEnv = updateChildEnv(env);
  // The publish step is not a spawn, but it can fail and the UI should be able
  // to say so — hence it counts towards the total.
  const totalSteps = steps.length + 1;
  const startedAt = now();

  let state: UpdateState = {
    phase: 'running', step: steps[0].label, stepIndex: 0, totalSteps, startedAt, updatedAt: startedAt,
  };
  writeUpdateState(dataDir, state);

  const fail = (step: string, exitCode: number | null, error: string): UpdateState => {
    const ts = now();
    state = { ...state, phase: 'failed', step, exitCode, error, finishedAt: ts, updatedAt: ts };
    writeUpdateState(dataDir, state);
    return state;
  };

  for (const [index, step] of steps.entries()) {
    state = { ...state, step: step.label, stepIndex: index, updatedAt: now() };
    writeUpdateState(dataDir, state);

    const result = spawn(step, childEnv);
    if (result.status !== 0) {
      return fail(step.label, result.status, stderrTail(result.stderr) || `${step.cmd} ${step.args.join(' ')} fehlgeschlagen`);
    }
  }

  state = { ...state, step: PUBLISH_LABEL, stepIndex: steps.length, updatedAt: now() };
  writeUpdateState(dataDir, state);
  try {
    publish(appRoot, publicDir);
  } catch (e: unknown) {
    return fail(PUBLISH_LABEL, null, e instanceof Error ? e.message : String(e));
  }

  const finishedAt = now();
  state = { ...state, phase: 'success', step: 'Fertig', stepIndex: totalSteps, finishedAt, updatedAt: finishedAt };
  writeUpdateState(dataDir, state);
  return state;
}
