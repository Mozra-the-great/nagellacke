import { loadSyncConfig, persistRefreshedTokens } from '../useAppData';

/**
 * Thrown when a token-authenticated request still comes back 401 after
 * authedFetch()'s transparent refresh-and-retry — i.e. the refresh token
 * itself is also expired/missing, not a transient network hiccup. Callers
 * (PhotoField.tsx) show `.message` directly instead of a bare status code
 * (#252) — previously "Upload fehlgeschlagen (401)" gave no indication the
 * fix is just to log in again.
 */
export class AuthExpiredError extends Error {
  constructor() {
    super('Sitzung abgelaufen — bitte in den Einstellungen neu anmelden');
    this.name = 'AuthExpiredError';
  }
}

function authHeaders(): Record<string, string> {
  const apiKey = localStorage.getItem('nagellacke_v3_apikey');
  if (apiKey) return { 'X-Api-Key': apiKey };
  const cfg = loadSyncConfig();
  if (cfg?.serverToken) return { 'Authorization': `Bearer ${cfg.serverToken}` };
  return {};
}

/**
 * Trades the stored refresh token for a fresh access token and persists it,
 * mirroring ServerAdapter.refreshAccessToken() in @nagellacke/sync (#109) —
 * this module talks to /api/photos directly instead of going through the
 * sync adapter, so it needs its own copy of the same retry-on-401 logic
 * rather than silently failing once the access token expires (#201).
 */
async function refreshAccessToken(): Promise<boolean> {
  const cfg = loadSyncConfig();
  if (!cfg || cfg.provider !== 'server' || !cfg.serverRefreshToken) return false;
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: cfg.serverRefreshToken }),
    });
    if (!res.ok) return false;
    const { token, refreshToken } = await res.json() as { token?: string; refreshToken?: string };
    if (!token || !refreshToken) return false;
    persistRefreshedTokens(token, refreshToken);
    return true;
  } catch {
    return false;
  }
}

/** fetch + one transparent retry after refreshing on a 401 (no-op when an
 *  X-Api-Key is in use, since that never expires and can't be refreshed). */
async function authedFetch(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, ...authHeaders() } });
  if (res.status !== 401 || localStorage.getItem('nagellacke_v3_apikey')) return res;
  if (!(await refreshAccessToken())) return res;
  return fetch(url, { ...init, headers: { ...init.headers, ...authHeaders() } });
}

/**
 * The photo endpoints require either an admin API key or a server-sync JWT
 * (see requireApiKeyOrJwt on the server) - mirrors authHeaders() so the UI can
 * gate the upload button instead of letting it fail with a raw 401.
 */
export function hasPhotoUploadAuth(): boolean {
  if (localStorage.getItem('nagellacke_v3_apikey')) return true;
  const cfg = loadSyncConfig();
  return !!(cfg?.provider === 'server' && cfg.serverToken);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadPhoto(file: File): Promise<string> {
  const data = await fileToBase64(file);
  const res = await authedFetch('/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, mimeType: file.type }),
  });
  if (!res.ok) {
    // A 401 that's *not* using an API key (which never expires) means
    // authedFetch already tried refreshing and it still failed - the
    // session itself is dead, not just this one request.
    if (res.status === 401 && !localStorage.getItem('nagellacke_v3_apikey')) {
      throw new AuthExpiredError();
    }
    throw new Error(`Upload fehlgeschlagen (${res.status})`);
  }
  const json = await res.json() as { filename: string };
  return json.filename;
}

export async function deletePhoto(filename: string): Promise<void> {
  await authedFetch(`/api/photos/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
}
