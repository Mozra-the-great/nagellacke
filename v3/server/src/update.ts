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

/**
 * Where the update check looks for releases when it cannot ask git (#340).
 *
 * `GET /api/update/check` used to derive owner/repo from `git remote get-url
 * origin` and, when that failed, return `updateAvailable: false` — which the
 * admin panel renders as "Version 3.3.0 — aktuell". In the container image
 * (v3/Dockerfile) that spawn *always* fails: `git` is not in node:20-alpine
 * and APP_ROOT is not a checkout. nailvault.de therefore reported itself
 * current for three releases running.
 *
 * The repository is static information, so it does not need git at all. This
 * constant is the fallback; NAGELLACKE_REPO overrides it for forks.
 */
export const DEFAULT_REPO_SLUG = 'Mozra-the-great/nagellacke';

/** owner/repo, the only shape the GitHub API paths below accept. */
const REPO_SLUG_RE = /^[\w.-]+\/[\w.-]+$/;

export function parseRepoSlug(remoteUrl: string): string | null {
  const match = remoteUrl.trim().match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!match) return null;
  const [owner, repo] = match[1].split('/');
  const slug = `${owner}/${repo}`;
  return owner && repo && REPO_SLUG_RE.test(slug) ? slug : null;
}

/**
 * Whether POST /api/update/apply can do anything on this deployment.
 *
 * 'unsupported' is not a failure — the container image updates by rebuilding,
 * which is a perfectly good deployment model. What it must not do is offer an
 * "Update installieren" button that can only ever fail at step 1.
 */
export type SelfUpdateSupport = 'supported' | 'unsupported';

export interface DeploymentInfo {
  repoSlug: string;
  selfUpdate: SelfUpdateSupport;
  /** German, user-facing; only set when selfUpdate is 'unsupported'. */
  selfUpdateReason?: string;
}

/** status is null when the binary is missing or the probe timed out. */
export type GitProbeFn = (args: string[], cwd: string) => { status: number | null; stdout: string };

const defaultGitProbe: GitProbeFn = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, stdio: 'pipe', timeout: 5_000 });
  return { status: r.error ? null : r.status, stdout: r.stdout?.toString().trim() ?? '' };
};

export interface DetectDeploymentOptions {
  appRoot: string;
  env?: NodeJS.ProcessEnv;
  gitProbe?: GitProbeFn;
}

/**
 * Resolves the repository to check *and* whether this deployment can update
 * itself. The two are deliberately separate: not being able to run the update
 * says nothing about not being able to see that one exists.
 *
 * Cache the result — nothing it probes can change while the process runs.
 */
export function detectDeployment(options: DetectDeploymentOptions): DeploymentInfo {
  const { appRoot, env = process.env, gitProbe = defaultGitProbe } = options;

  const configured = env.NAGELLACKE_REPO?.trim();
  const fromEnv = configured && REPO_SLUG_RE.test(configured) ? configured : null;
  const remote = gitProbe(['remote', 'get-url', 'origin'], appRoot);
  const fromGit = remote.status === 0 ? parseRepoSlug(remote.stdout) : null;
  // Explicit operator intent beats discovery, discovery beats the constant.
  const repoSlug = fromEnv ?? fromGit ?? DEFAULT_REPO_SLUG;

  if (gitProbe(['--version'], appRoot).status !== 0) {
    return {
      repoSlug,
      selfUpdate: 'unsupported',
      selfUpdateReason: 'git ist in diesem Deployment nicht verfügbar — Updates laufen über das Container-Image.',
    };
  }
  if (gitProbe(['rev-parse', '--git-dir'], appRoot).status !== 0) {
    return {
      repoSlug,
      selfUpdate: 'unsupported',
      selfUpdateReason: `${appRoot} ist kein git-Checkout — Updates laufen über das Deployment, nicht über die App.`,
    };
  }
  return { repoSlug, selfUpdate: 'supported' };
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
