import { loadSyncConfig } from '../useAppData';
import { serverBase } from './serverBase';
import { setStoredApiKey, storedApiKey } from './apiKey';

export type Role = 'admin' | 'user';

export interface AdminUser {
  username: string;
  email?: string;
  role: Role;
  createdAt: number;
}

export interface AdminSettings {
  allowRegistration: boolean;
  allowRegistrationSource: 'panel' | 'env' | 'default';
  smtp: {
    host: string;
    port: number;
    user: string;
    from: string;
    secure?: boolean;
    hasPassword: boolean;
    source: 'panel' | 'env' | 'default';
  };
  appUrl: string;
  appUrlSource: 'panel' | 'env' | 'default';
  appUrlRequiresRestart: boolean;
  ai: {
    provider: 'openrouter' | 'gemini';
    openrouter: { model: string; freeOnly: boolean; hasApiKey: boolean };
    gemini: { model: string; hasApiKey: boolean };
    webSearch: { backend: string; searxngUrl: string; hasBraveApiKey: boolean };
  };
  env: {
    port: number;
    allowedOrigin: string;
    serviceName: string;
    dataDir: string;
    jwtAccessTtl: string;
    jwtRefreshTtl: string;
  };
}

export interface AuditEntry {
  ts: number;
  actor: string;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
}

function bearerHeaders(hasBody: boolean): Record<string, string> {
  const config = loadSyncConfig();
  const token = config?.provider === 'server' ? config.serverToken : undefined;
  return {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${serverBase()}${path}`, { ...init, headers: { ...bearerHeaders(init?.body != null), ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data;
}

export function listUsers(): Promise<{ users: AdminUser[] }> {
  return request('/api/admin/users');
}

export function createUser(input: { username: string; password: string; role?: Role }): Promise<{ ok: true }> {
  return request('/api/admin/users', { method: 'POST', body: JSON.stringify(input) });
}

export function setUserRole(username: string, role: Role): Promise<{ ok: true }> {
  return request(`/api/admin/users/${encodeURIComponent(username)}/role`, { method: 'PATCH', body: JSON.stringify({ role }) });
}

export function deleteUser(username: string): Promise<{ ok: true }> {
  return request(`/api/admin/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
}

export function getSettings(): Promise<AdminSettings> {
  return request('/api/admin/settings');
}

export interface AdminSettingsInput {
  allowRegistration?: boolean;
  appUrl?: string;
  smtp?: { host?: string; port?: number; user?: string; pass?: string; from?: string; secure?: boolean };
}

export function saveSettings(input: AdminSettingsInput): Promise<{ ok: true }> {
  return request('/api/admin/settings', { method: 'POST', body: JSON.stringify(input) });
}

export function testSmtp(input: { toEmail: string; host?: string; port?: number; user?: string; pass?: string; from?: string; secure?: boolean }): Promise<{ ok: true }> {
  return request('/api/admin/settings/smtp/test', { method: 'POST', body: JSON.stringify(input) });
}

export function testAi(provider: 'openrouter' | 'gemini'): Promise<{ ok: true; model: string }> {
  return request('/api/admin/settings/ai/test', { method: 'POST', body: JSON.stringify({ provider }) });
}

export function getAuditLog(): Promise<{ entries: AuditEntry[] }> {
  return request('/api/admin/audit');
}

export interface UpdateInfo {
  current: string;
  latestVersion: string | null;
  updateAvailable: boolean;
}

/**
 * Admin-panel equivalents of the update-check/rotate flow that used to be
 * X-Api-Key-only (#173 §2.3). Authorized with the admin's own JWT — an admin
 * who is logged in doesn't need to also know the raw API key any more.
 */
export function checkUpdate(): Promise<UpdateInfo> {
  return request('/api/update/check');
}

/**
 * POST /api/update/apply keeps its extra bar under the admin-JWT path (§6):
 * it is a documented RCE surface, so a fresh password re-confirmation is
 * required even though the caller already holds a valid admin session.
 *
 * Resolving means the update *started*, nothing more — the server answers
 * before the first step runs. Poll getUpdateStatus() for the outcome (#335).
 */
export function applyUpdate(password: string): Promise<{ ok: true }> {
  return request('/api/update/apply', { method: 'POST', body: JSON.stringify({ password }) });
}

export interface UpdateProgress {
  phase: 'running' | 'success' | 'failed';
  step: string;
  stepIndex: number;
  totalSteps: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  error?: string;
}

export interface UpdateStatus {
  /** Version currently running — the new one once the server has restarted. */
  version: string;
  update: UpdateProgress | null;
}

export function getUpdateStatus(): Promise<UpdateStatus> {
  return request('/api/update/status');
}

/**
 * Rotates the server's root API key and drops this browser's now-dead copy.
 *
 * The browser doing the rotation is precisely the one holding the key the call
 * just invalidated; leaving it behind made photo upload, display and delete
 * 401 forever against a key the server no longer knows (#330).
 *
 * It is *removed*, not replaced with the fresh key. Rotation exists to burn a
 * leaked copy, and if the leak was persistent XSS or a shared browser profile,
 * writing the new key straight back into localStorage would hand the same
 * vector the same root credential again — one that skips the password
 * re-confirmation guarding /api/update/apply. Nothing is lost by dropping it:
 * reaching this call already required an admin JWT session, which is the
 * credential everything here keeps using.
 */
export async function rotateApiKey(): Promise<{ apiKey: string; rotatedAt: number }> {
  const result = await request<{ apiKey: string; rotatedAt: number }>('/api/admin/api-key/rotate', { method: 'POST' });
  if (storedApiKey()) setStoredApiKey(null);
  return result;
}

/**
 * Exchanges the root X-Api-Key for an admin session, once (#173 §3.3).
 * Clears the stored API key from localStorage on success — its job in the
 * browser is done. Throws (with the server's 409 message) if an admin
 * account already exists, so the caller can fall back to "please log in
 * with your admin account".
 *
 * Deliberately does NOT persist the returned JWTs itself (#277): the caller
 * owns the component-level login state (config/serverToken/etc.) and must
 * run the same "just logged in" bookkeeping a regular login does — e.g.
 * SettingsPage's `applyLoginTokens` — so the sync box reflects the new
 * session immediately instead of only after a reload.
 */
export async function bootstrapAdmin(serverUrl: string, apiKey: string, username: string, password: string): Promise<{ token: string; refreshToken?: string }> {
  const base = serverUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/admin/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({})) as { token?: string; refreshToken?: string; error?: string };
  if (!res.ok || !data.token) throw new Error(data.error ?? `Fehler ${res.status}`);
  setStoredApiKey(null);
  return { token: data.token, refreshToken: data.refreshToken };
}
