import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { normalizeFinish, type AppData } from '@nagellacke/core';
import type { WebSearchConfig } from './websearch';
import { DEFAULT_WEB_SEARCH } from './websearch';
import { hashRecoveryCode } from './totp';

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
      polishes:   (raw.polishes   ?? []).map((p) => ({
        ...(p.count == null ? { ...p, count: 1 } : p),
        finish: normalizeFinish((p as { finish?: unknown }).finish),
      })),
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
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
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

export interface User {
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
  // TOTP (2FA, #174). Zero-migration: readUsers() has no normalizer, so
  // existing records simply lack these keys and read back as undefined —
  // every call site that gates on them already treats undefined as "off".
  totp_secret?: string;          // base32, set by setTotpPending; only "live" once totp_enabled is true
  totp_enabled?: boolean;        // false/undefined until verify-before-enable succeeds
  totp_last_counter?: number;    // replay guard — see totp.ts / login/verify
  recovery_codes?: string[];     // sha256 hex hashes, single-use
  // Account-scoped brute-force lockout for /api/auth/login/verify (#174
  // follow-up security review). Independent of source IP and of the
  // per-challenge (`jti`) attempt cap in index.ts's in-memory mfaAttempts map —
  // both of those reset for an attacker who rotates IP or mints a fresh
  // challenge (a fresh challenge just needs the password again, which is
  // exactly the case this guards: an attacker who already has the password).
  // Persisted here (rather than in-memory) so a server restart doesn't reset
  // it — seemed clearly worth doing since the field already lives right next
  // to totp_last_counter with the same persistence story.
  totp_fail_count?: number;
  totp_locked_until?: number;    // epoch ms; login/verify rejects while in the future
  // Account-scoped brute-force lockout for plain (non-2FA) /api/auth/login
  // (#259 hardening pass) — same shape and reasoning as totp_fail_count /
  // totp_locked_until above, kept as separate fields since a wrong password
  // and a wrong TOTP code are different failure modes with independent budgets.
  login_fail_count?: number;
  login_locked_until?: number;
  // WebAuthn/passkeys (follow-up issue, not this PR — see #174 plan §9: no
  // single fixed RP ID across this app's self-hosted deployment topologies).
  // webauthn_credentials?: WebAuthnCredential[];
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

// Holds password hashes and, as of #174, TOTP secrets and recovery-code
// hashes — the same trust boundary as .jwt_secret and .api_key (DATA_DIR,
// host-level trust; no separate encryption layer, see #174 plan §2).
function writeUsers(users: User[]): void {
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(users), { mode: 0o600 });
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

// ── TOTP (2FA, #174) ─────────────────────────────────────────────────────────

/**
 * Stores a freshly generated, *unverified* TOTP secret. `totp_enabled` is
 * deliberately left untouched — enable-before-verify never happens; only
 * enableTotp() (called after a successful code check) flips it. Calling this
 * again (e.g. the user re-scans) simply replaces the pending secret.
 */
export function setTotpPending(username: string, secret: string): void {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx >= 0) {
    users[idx] = { ...users[idx], totp_secret: secret, totp_enabled: false };
    writeUsers(users);
  }
}

/**
 * Flips totp_enabled on and stores recovery-code hashes. Only ever called
 * after a verify step succeeds.
 *
 * Also bumps token_version (security review of #174 — BLOCKER 1): without
 * this, a refresh token stolen *before* enrollment stays valid forever after
 * 2FA is turned on, since /api/auth/refresh only checks tokenVersion, never
 * totp_enabled. Bumping it here invalidates every session that predates
 * enrollment, including the enrolling user's own — the caller (POST
 * /api/auth/totp/enable) mints and returns a fresh pair in the same response
 * so the UI doesn't 401 mid-flow, mirroring what disableTotp() already does.
 * Returns the new token_version so the caller doesn't need a second read.
 *
 * Clears any stale account-lockout counters too, so a locked-out account that
 * disables and re-enrolls 2FA doesn't start back at zero attempts already
 * spent.
 */
export function enableTotp(username: string, recoveryCodeHashes: string[]): number {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx < 0) return 0;
  const nextVersion = (users[idx].token_version ?? 0) + 1;
  const { totp_fail_count, totp_locked_until, ...rest } = users[idx];
  void totp_fail_count; void totp_locked_until;
  users[idx] = {
    ...rest,
    totp_enabled: true,
    totp_last_counter: -1,
    recovery_codes: recoveryCodeHashes,
    token_version: nextVersion,
  };
  writeUsers(users);
  return nextVersion;
}

/**
 * Clears all TOTP fields and bumps token_version, so a leaked session from
 * before the disable cannot be used to silently re-enable 2FA (e.g. under an
 * attacker-controlled authenticator) on the same account.
 */
export function disableTotp(username: string): void {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx >= 0) {
    const { totp_secret, totp_enabled, totp_last_counter, recovery_codes, totp_fail_count, totp_locked_until, ...rest } = users[idx];
    void totp_secret; void totp_enabled; void totp_last_counter; void recovery_codes;
    void totp_fail_count; void totp_locked_until;
    users[idx] = { ...rest, token_version: (rest.token_version ?? 0) + 1 };
    writeUsers(users);
  }
}

/**
 * Replaces recovery-code hashes without touching totp_enabled/totp_last_counter
 * — used by the "regenerate recovery codes" endpoint, which must not reset the
 * replay-guard counter the way enableTotp() (re-enrollment) does.
 */
export function setRecoveryCodes(username: string, hashes: string[]): void {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx >= 0) {
    users[idx] = { ...users[idx], recovery_codes: hashes };
    writeUsers(users);
  }
}

/** Persists the replay-guard counter after an accepted TOTP code. */
export function updateTotpCounter(username: string, counter: number): void {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx >= 0) {
    users[idx] = { ...users[idx], totp_last_counter: counter };
    writeUsers(users);
  }
}

/**
 * Hashes `code`, scans recovery_codes for a match with a constant-time
 * comparison (avoids a timing side channel across candidates), splices the
 * matched hash out (single-use) and persists. Returns whether a match was found.
 */
export function consumeRecoveryCode(username: string, code: string): boolean {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx < 0) return false;
  const hashes = users[idx].recovery_codes ?? [];
  const candidate = hashRecoveryCode(code);
  const candidateBuf = Buffer.from(candidate);
  const matchIdx = hashes.findIndex((h) => {
    const hBuf = Buffer.from(h);
    return hBuf.length === candidateBuf.length && crypto.timingSafeEqual(hBuf, candidateBuf);
  });
  if (matchIdx < 0) return false;
  const remaining = hashes.slice(0, matchIdx).concat(hashes.slice(matchIdx + 1));
  users[idx] = { ...users[idx], recovery_codes: remaining };
  writeUsers(users);
  return true;
}

// Account-scoped brute-force lockout for /api/auth/login/verify (security
// review of #174, hardening items 3+4). The route rate limit (per IP) and the
// per-challenge attempt cap in index.ts's mfaAttempts map (per `jti`) both
// reset for an attacker who rotates IP or mints a fresh challenge — minting a
// fresh challenge only needs the password again, and this guards exactly the
// case where the attacker already has it. This counter is keyed on the
// account alone and persisted here, so it survives both.
const TOTP_ACCOUNT_MAX_FAILURES = 10;
const TOTP_ACCOUNT_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Records one failed TOTP/recovery-code verification against `username`. On
 * the Nth consecutive failure (no successful verification in between —
 * clearTotpFailures resets the counter), locks the account for
 * TOTP_ACCOUNT_LOCKOUT_MS. Returns the lockout expiry (epoch ms) if the
 * account is now locked, or 0 otherwise. Already-locked accounts are left
 * untouched rather than having their lockout extended by further attempts —
 * the fixed window is enough to make guessing impractical without also
 * giving an attacker a way to keep a victim locked out indefinitely.
 */
export function recordTotpFailure(username: string): number {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx < 0) return 0;
  const now = Date.now();
  const user = users[idx];
  if (user.totp_locked_until && user.totp_locked_until > now) {
    return user.totp_locked_until;
  }
  const count = (user.totp_fail_count ?? 0) + 1;
  if (count >= TOTP_ACCOUNT_MAX_FAILURES) {
    const lockedUntil = now + TOTP_ACCOUNT_LOCKOUT_MS;
    users[idx] = { ...user, totp_fail_count: 0, totp_locked_until: lockedUntil };
    writeUsers(users);
    return lockedUntil;
  }
  users[idx] = { ...user, totp_fail_count: count };
  writeUsers(users);
  return 0;
}

/** Resets the failure counter after a successful verification. */
export function clearTotpFailures(username: string): void {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx < 0) return;
  if (!users[idx].totp_fail_count && !users[idx].totp_locked_until) return;
  const { totp_fail_count, totp_locked_until, ...rest } = users[idx];
  void totp_fail_count; void totp_locked_until;
  users[idx] = rest;
  writeUsers(users);
}

/** Returns the lockout expiry (epoch ms) if `username` is currently locked out, or 0 otherwise. */
export function totpLockedUntil(username: string): number {
  const user = getUser(username);
  if (!user?.totp_locked_until) return 0;
  return user.totp_locked_until > Date.now() ? user.totp_locked_until : 0;
}

// Account-scoped brute-force lockout for plain (non-2FA) /api/auth/login
// (#259 hardening pass). The route already has a per-IP rate limit (10
// req/15min), but that alone doesn't stop an attacker distributing password
// guesses for one known username across many source IPs — 2FA's login/verify
// already had this account-scoped backstop, plain login didn't. Mirrors
// recordTotpFailure/clearTotpFailures/totpLockedUntil above exactly, just
// keyed on a separate pair of fields.
const LOGIN_MAX_FAILURES = 10;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Records one failed password check against `username`. On the Nth
 * consecutive failure, locks the account for LOGIN_LOCKOUT_MS. Returns the
 * lockout expiry (epoch ms) if the account is now locked, or 0 otherwise.
 */
export function recordLoginFailure(username: string): number {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx < 0) return 0;
  const now = Date.now();
  const user = users[idx];
  if (user.login_locked_until && user.login_locked_until > now) {
    return user.login_locked_until;
  }
  const count = (user.login_fail_count ?? 0) + 1;
  if (count >= LOGIN_MAX_FAILURES) {
    const lockedUntil = now + LOGIN_LOCKOUT_MS;
    users[idx] = { ...user, login_fail_count: 0, login_locked_until: lockedUntil };
    writeUsers(users);
    return lockedUntil;
  }
  users[idx] = { ...user, login_fail_count: count };
  writeUsers(users);
  return 0;
}

/** Resets the failure counter after a successful login. */
export function clearLoginFailures(username: string): void {
  const users = readUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx < 0) return;
  if (!users[idx].login_fail_count && !users[idx].login_locked_until) return;
  const { login_fail_count, login_locked_until, ...rest } = users[idx];
  void login_fail_count; void login_locked_until;
  users[idx] = rest;
  writeUsers(users);
}

/** Returns the lockout expiry (epoch ms) if `username` is currently locked out, or 0 otherwise. */
export function loginLockedUntil(username: string): number {
  const user = getUser(username);
  if (!user?.login_locked_until) return 0;
  return user.login_locked_until > Date.now() ? user.login_locked_until : 0;
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
  fs.writeFileSync(tmp, JSON.stringify(entries), { mode: 0o600 });
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
  fs.writeFileSync(tmp, JSON.stringify(config), { mode: 0o600 });
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
  fs.writeFileSync(tmp, JSON.stringify(jobs), { mode: 0o600 });
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
