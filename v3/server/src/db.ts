import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AppData } from '@nagellacke/core';
import type { WebSearchConfig } from './websearch';
import { DEFAULT_WEB_SEARCH } from './websearch';

export const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
export const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// ── App data ──────────────────────────────────────────────────────────────────
//
// Each user gets their own collection. Before this, getData()/setData() operated
// on one global data.json regardless of which account was authenticated, so any
// two registered accounts shared — and could silently overwrite — the same
// collection, sticker list and diary (#87).

const EMPTY_DATA: AppData = { polishes: [], customCats: [], manicures: [], stickers: [] };

const USER_DATA_DIR = path.join(DATA_DIR, 'users');

/**
 * Maps a username to a filesystem-safe directory name. Usernames are
 * user-supplied and reach us from the JWT, so they must never be interpolated
 * into a path unescaped — a name like `../../etc` would otherwise walk out of
 * DATA_DIR. Anything outside [A-Za-z0-9_-] is percent-escaped, which is
 * reversible and collision-free (unlike stripping).
 */
function userDirName(username: string): string {
  return encodeURIComponent(username).replace(/[.*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
}

function userDataFile(username: string): string {
  return path.join(USER_DATA_DIR, userDirName(username), 'data.json');
}

function readDataFile(file: string): AppData {
  try {
    if (!fs.existsSync(file)) return EMPTY_DATA;
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<AppData>;
    return {
      polishes:   (raw.polishes   ?? []).map((p) => p.count == null ? { ...p, count: 1 } : p),
      customCats: raw.customCats  ?? [],
      manicures:  raw.manicures   ?? [],
      stickers:   raw.stickers    ?? [],
    };
  } catch (e) {
    console.error(`${file} corrupt — returning empty:`, e);
    return EMPTY_DATA;
  }
}

function writeDataFile(file: string, data: AppData): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

export function getData(username: string): AppData {
  return readDataFile(userDataFile(username));
}

export function setData(username: string, data: AppData): void {
  writeDataFile(userDataFile(username), data);
}

/**
 * One-time migration of the pre-#87 global data.json into the first-registered
 * user's private collection. Runs at startup, before any request is served.
 *
 * The oldest account is the one that bootstrapped the server (registration is
 * gated on "no users exist yet" unless ALLOW_REGISTRATION is set), so it is the
 * one whose collection the global file actually represents. Every other account
 * starts empty — which is the point of the change, but does mean a shared
 * household deployment will see other members' collections go blank until they
 * re-sync from a device that still holds the data locally.
 *
 * The global file is renamed rather than deleted, so the pre-migration state
 * stays recoverable by hand.
 */
export function migrateGlobalDataToFirstUser(): void {
  if (!fs.existsSync(DATA_FILE)) return;

  const users = readUsers();
  if (users.length === 0) {
    console.warn('[migration] data.json exists but no users are registered — leaving it in place.');
    return;
  }

  const owner = users.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
  const target = userDataFile(owner.username);
  if (fs.existsSync(target)) {
    console.warn(`[migration] ${owner.username} already has a private collection — leaving data.json in place.`);
    return;
  }

  writeDataFile(target, readDataFile(DATA_FILE));
  fs.renameSync(DATA_FILE, `${DATA_FILE}.pre-user-isolation`);
  console.log(
    `[migration] Global collection assigned to first-registered user "${owner.username}" (#87). ` +
    `Previous file kept as data.json.pre-user-isolation. Other accounts now start with an empty collection.`,
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'user';

interface User {
  username: string;
  password_hash: string;
  created_at: number;
  email?: string;
  token_version?: number;
  /**
   * Absent on every row written before #173 — treated as 'user' everywhere
   * that reads it. Deliberately NOT carried in the JWT: tokenVersionValid()
   * already does a getUser() lookup on every authenticated request (to check
   * token_version), so role is read from that same lookup instead of adding a
   * second source of truth. A promotion/demotion therefore takes effect on the
   * very next request, not the next login.
   */
  role?: UserRole;
}

function readUsers(): User[] {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) as User[];
  } catch (e) {
    console.error('users.json corrupt — returning empty:', e);
    return [];
  }
}

function writeUsers(users: User[]): void {
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(users));
  fs.renameSync(tmp, USERS_FILE);
}

export function getUser(username: string): User | undefined {
  return readUsers().find((u) => u.username === username);
}

export function getUserCount(): number {
  return readUsers().length;
}

/**
 * The account that bootstrapped this server (registration is gated on "no users
 * exist yet" unless ALLOW_REGISTRATION is set). Used as the owner for data that
 * predates per-user isolation and carries no username of its own (#87).
 */
export function getFirstUsername(): string | undefined {
  const users = readUsers();
  if (users.length === 0) return undefined;
  return users.reduce((a, b) => (a.created_at <= b.created_at ? a : b)).username;
}

export function createUser(username: string, passwordHash: string, role?: UserRole): void {
  const users = readUsers();
  users.push({ username, password_hash: passwordHash, created_at: Date.now(), ...(role ? { role } : {}) });
  writeUsers(users);
}

// Bumps a user's token_version, immediately invalidating every previously
// issued JWT for that user (they carry the old version and get rejected by
// requireJwt). Returns the new version so callers don't need a second read.
export function bumpTokenVersion(username: string): number {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx < 0) return 0;
  const next = (users[idx].token_version ?? 0) + 1;
  users[idx] = { ...users[idx], token_version: next };
  writeUsers(users);
  return next;
}

export function updateUserEmail(username: string, email: string): void {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx >= 0) {
    users[idx] = { ...users[idx], email };
    writeUsers(users);
  }
}

// ── Admin / roles (#173) ────────────────────────────────────────────────────

export interface AdminUserView {
  username: string;
  email?: string;
  role: UserRole;
  createdAt: number;
}

function toAdminView(u: User): AdminUserView {
  // Project explicitly — never spread a raw User, it carries password_hash.
  return { username: u.username, email: u.email, role: u.role ?? 'user', createdAt: u.created_at };
}

export function isAdmin(username: string): boolean {
  return getUser(username)?.role === 'admin';
}

export function countAdmins(): number {
  return readUsers().filter((u) => u.role === 'admin').length;
}

export function listUsers(): AdminUserView[] {
  return readUsers().map(toAdminView);
}

export function setUserRole(username: string, role: UserRole): void {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx < 0) return;
  users[idx] = { ...users[idx], role };
  writeUsers(users);
}

/**
 * Removes a user's login. The user's collection file is renamed (not
 * deleted) — same "rename, never destroy" pattern as
 * migrateGlobalDataToFirstUser() above — so it stays recoverable by hand.
 * Does not touch schedule.json or ai_jobs.json; callers (index.ts) handle the
 * schedule-orphan cleanup, since that also has to talk to the report
 * scheduler's config shape.
 */
export function deleteUser(username: string): void {
  const users = readUsers().filter((u) => u.username !== username);
  writeUsers(users);
  const dataFile = userDataFile(username);
  if (fs.existsSync(dataFile)) {
    fs.renameSync(dataFile, `${dataFile}.deleted-${Date.now()}`);
  }
}

// ── Audit log (#173) ──────────────────────────────────────────────────────────

export interface AuditEntry {
  ts: number;
  actor: string;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
}

const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');
const MAX_AUDIT_ENTRIES = 500;

function readAudit(): AuditEntry[] {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    return JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8')) as AuditEntry[];
  } catch {
    return [];
  }
}

function writeAudit(entries: AuditEntry[]): void {
  const tmp = `${AUDIT_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries));
  fs.renameSync(tmp, AUDIT_FILE);
}

/**
 * Records one admin action. Never pass a secret value in `meta` — log that a
 * field changed ("smtp.pass changed"), not what it changed to.
 */
export function logAdminAction(actor: string, action: string, target?: string, meta?: Record<string, unknown>): void {
  const entries = readAudit();
  entries.push({ ts: Date.now(), actor, action, target, meta });
  writeAudit(entries.slice(-MAX_AUDIT_ENTRIES));
}

export function getAuditLog(): AuditEntry[] {
  // Newest first.
  return [...readAudit()].reverse();
}

/**
 * One-time migration promoting the earliest-registered user to admin.
 * Idempotent (no-op once any admin exists) and safe to call on every
 * startup, in the same slot as migrateGlobalDataToFirstUser() — before any
 * request is served.
 *
 * Covers the "existing install being upgraded" case from #173: an operator
 * who never opens the panel gets exactly one admin (the account that
 * bootstrapped the server) with zero action required. The "fresh install"
 * case is a no-op here (no users yet) and handled instead at
 * POST /api/auth/register, which promotes the very first registered user
 * directly so there's no window where that user isn't yet admin.
 */
export function migrateFirstUserToAdmin(): void {
  const users = readUsers();
  if (users.length === 0) return;
  if (users.some((u) => u.role === 'admin')) return;
  const owner = users.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
  const idx = users.findIndex((u) => u.username === owner.username);
  users[idx] = { ...users[idx], role: 'admin' };
  writeUsers(users);
  console.log(`[migration] "${owner.username}" (first-registered user) promoted to admin (#173).`);
}

// ── Server settings (registration / SMTP / app URL) (#173) ───────────────────
//
// PRECEDENCE RULE — the opposite of loadOrCreateSecret()'s env-then-file order
// in index.ts: a value saved here WINS over the corresponding environment
// variable when present; the env var is only the fallback for a field never
// touched in the admin panel. loadOrCreateSecret() protects JWT_SECRET, which
// must never silently change under an operator who deliberately pinned it via
// env — there is no such constraint on SMTP/registration/appUrl, and the
// issue's requirement ("every setting reachable through the web app") only
// holds if a value saved in the panel actually takes effect over a stale env
// var left set on the host.

export interface ServerSettings {
  /** Shadows ALLOW_REGISTRATION when set; env var is the fallback. */
  allowRegistration?: boolean;
  smtp?: { host: string; port: number; user: string; pass: string; from: string; secure?: boolean };
  /** Shadows APP_URL when set; env var is the fallback. */
  appUrl?: string;
}

const SERVER_SETTINGS_FILE = path.join(DATA_DIR, 'server_settings.json');

export function getServerSettings(): ServerSettings {
  try {
    if (!fs.existsSync(SERVER_SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SERVER_SETTINGS_FILE, 'utf-8')) as ServerSettings;
  } catch {
    return {};
  }
}

export function setServerSettings(settings: ServerSettings): void {
  const tmp = `${SERVER_SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings), { mode: 0o600 });
  fs.renameSync(tmp, SERVER_SETTINGS_FILE);
}

// ── Report schedule config ────────────────────────────────────────────────────

export interface ScheduleConfig {
  enabled: boolean;
  frequency: 'weekly' | 'monthly';
  toEmail: string;
  lastSentAt?: number;
  /**
   * Whose collection the scheduled report renders. There is still a single
   * schedule for the server, but collections are per-user since #87, so it has
   * to record which one it reports on — otherwise the hourly job would have no
   * way to pick, and could mail out an account's private collection under
   * another account's schedule. Absent on configs written before #87; those
   * fall back to the first-registered user.
   */
  username?: string;
}

const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');

export function getScheduleConfig(): ScheduleConfig | null {
  try {
    if (!fs.existsSync(SCHEDULE_FILE)) return null;
    return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8')) as ScheduleConfig;
  } catch {
    return null;
  }
}

export function setScheduleConfig(config: ScheduleConfig): void {
  const tmp = `${SCHEDULE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config));
  fs.renameSync(tmp, SCHEDULE_FILE);
}

// ── AI config (KI-Assistenz) ──────────────────────────────────────────────────

export type AiProvider = 'openrouter' | 'gemini';

export interface AiConfig {
  provider: AiProvider;
  openrouter: { apiKey: string; model: string; freeOnly: boolean };
  gemini: { apiKey: string; model: string };
  /** Server-side web search offered to the model as a tool (see websearch.ts). */
  webSearch: WebSearchConfig;
}

const AI_CONFIG_FILE = path.join(DATA_DIR, 'ai_config.json');

const DEFAULT_AI_CONFIG: AiConfig = {
  provider: 'openrouter',
  openrouter: { apiKey: '', model: 'openrouter/auto', freeOnly: false },
  gemini: { apiKey: '', model: 'gemini-flash-latest' },
  webSearch: DEFAULT_WEB_SEARCH,
};

export function getAiConfig(): AiConfig {
  try {
    if (!fs.existsSync(AI_CONFIG_FILE)) return DEFAULT_AI_CONFIG;
    const raw = JSON.parse(fs.readFileSync(AI_CONFIG_FILE, 'utf-8')) as Partial<AiConfig>;
    return {
      provider: raw.provider === 'gemini' ? 'gemini' : 'openrouter',
      openrouter: { ...DEFAULT_AI_CONFIG.openrouter, ...raw.openrouter },
      gemini: { ...DEFAULT_AI_CONFIG.gemini, ...raw.gemini },
      webSearch: { ...DEFAULT_WEB_SEARCH, ...raw.webSearch },
    };
  } catch {
    return DEFAULT_AI_CONFIG;
  }
}

export function setAiConfig(config: AiConfig): void {
  const tmp = `${AI_CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config), { mode: 0o600 });
  fs.renameSync(tmp, AI_CONFIG_FILE);
}

// ── AI background jobs (Auto-Fill / Smart-Cart) ───────────────────────────────

export type AiJobType = 'autofill' | 'smart-cart';
export type AiJobStatus = 'pending' | 'running' | 'done' | 'error';

export interface AiJobTraceStep {
  round: number;
  toolCalls: { name: string; query: string }[];
}

export interface AiJob {
  id: string;
  type: AiJobType;
  status: AiJobStatus;
  /**
   * Whose collection this job reads and writes. Collections are per-user since
   * #87, and jobs run detached from the request that created them, so the owner
   * has to be captured up front — there is no ambient "current user" later.
   */
  username: string;
  input: {
    // Auto-Fill only needs name/brand/num to research — no dependency on the
    // polish already existing server-side, so the client doesn't need to sync
    // before kicking off the job.
    polish?: { name: string; brand: string; num: string };
    prompt?: string;
  };
  result?: unknown;
  trace?: AiJobTraceStep[];
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const AI_JOBS_FILE = path.join(DATA_DIR, 'ai_jobs.json');
const MAX_STORED_AI_JOBS = 200;

function readAiJobs(): AiJob[] {
  try {
    if (!fs.existsSync(AI_JOBS_FILE)) return [];
    return JSON.parse(fs.readFileSync(AI_JOBS_FILE, 'utf-8')) as AiJob[];
  } catch {
    return [];
  }
}

function writeAiJobs(jobs: AiJob[]): void {
  const tmp = `${AI_JOBS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jobs));
  fs.renameSync(tmp, AI_JOBS_FILE);
}

export function getAiJob(id: string): AiJob | undefined {
  return readAiJobs().find((j) => j.id === id);
}

export function getNextPendingAiJob(): AiJob | undefined {
  return readAiJobs().find((j) => j.status === 'pending');
}

export function addAiJob(job: AiJob): void {
  const jobs = readAiJobs();
  jobs.push(job);
  // Keep the job log bounded — it's a processing queue/history, not primary data.
  writeAiJobs(jobs.slice(-MAX_STORED_AI_JOBS));
}

export function updateAiJob(id: string, changes: Partial<Omit<AiJob, 'id'>>): void {
  const jobs = readAiJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], ...changes, updatedAt: Date.now() };
    writeAiJobs(jobs);
  }
}
