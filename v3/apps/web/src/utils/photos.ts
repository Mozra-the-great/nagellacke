import { loadSyncConfig, persistRefreshedTokens } from '../useAppData';
import { markApiKeyRejected, usableApiKey } from './apiKey';
import { serverUrl } from './serverBase';

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

/**
 * Thrown when the stored X-Api-Key is the thing the server rejects and there is
 * no server session to fall back on (#330). The other half of the bare-401
 * problem #252 fixed: a key left behind by an admin-panel rotation, or by a
 * server whose data directory was recreated, is not an expired session and
 * logging in again does not help — the key has to go.
 */
export class ApiKeyInvalidError extends Error {
  constructor() {
    super('API-Schlüssel ist ungültig — in den Einstellungen entfernen oder erneuern');
    this.name = 'ApiKeyInvalidError';
  }
}

/** The server-sync access token, if a server session exists. */
function serverToken(): string | undefined {
  const cfg = loadSyncConfig();
  return cfg?.provider === 'server' ? cfg.serverToken : undefined;
}

function authHeaders(opts: { skipApiKey?: boolean } = {}): Record<string, string> {
  if (!opts.skipApiKey) {
    const apiKey = usableApiKey();
    if (apiKey) return { 'X-Api-Key': apiKey };
  }
  const token = serverToken();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
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
  if (!cfg || cfg.provider !== 'server') return false;
  try {
    const res = await fetch(serverUrl('/api/auth/refresh'), {
      method: 'POST',
      // The refresh token is normally the httpOnly cookie now (#299), which only
      // travels when credentials are requested. serverRefreshToken is sent when one
      // is still in memory — that covers a session started before the cookie existed
      // and an older server that never sets one.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Nagellacke-Refresh': '1' },
      body: JSON.stringify(cfg.serverRefreshToken ? { refreshToken: cfg.serverRefreshToken } : {}),
    });
    if (!res.ok) return false;
    // refreshToken is absent on the cookie path by design — the renewed one lives in
    // the Set-Cookie the browser just applied, where a script cannot reach it.
    const { token, refreshToken } = await res.json() as { token?: string; refreshToken?: string };
    if (!token) return false;
    persistRefreshedTokens(token, refreshToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * fetch against the configured server, with the credentials this install has
 * and one recovery attempt on a 401:
 *
 *  - keyed request rejected -> the key is dead (rotated away, or minted by a
 *    different instance). It cannot be refreshed, so stop sending it and retry
 *    on the server session instead. Before #330 this branch simply gave up,
 *    letting one stale key permanently veto a perfectly valid login.
 *  - token request rejected -> refresh the access token once and retry.
 */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const target = serverUrl(url);
  const sentKey = usableApiKey();

  let res = await fetch(target, { ...init, headers: { ...init.headers, ...authHeaders() } });
  if (res.status !== 401) return res;

  if (sentKey) {
    markApiKeyRejected(sentKey);
    if (!serverToken()) return res;
    res = await fetch(target, { ...init, headers: { ...init.headers, ...authHeaders({ skipApiKey: true }) } });
    if (res.status !== 401) return res;
  }

  if (!(await refreshAccessToken())) return res;
  return fetch(target, { ...init, headers: { ...init.headers, ...authHeaders({ skipApiKey: true }) } });
}

/**
 * The photo endpoints require either an admin API key or a server-sync JWT
 * (see requireApiKeyOrJwt on the server) - mirrors authHeaders() so the UI can
 * gate the upload button instead of letting it fail with a raw 401.
 */
export function hasPhotoUploadAuth(): boolean {
  return !!usableApiKey() || !!serverToken();
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

/**
 * Turns a still-401 response into the error that names what the user has to do.
 * authedFetch has already exhausted every automatic recovery by this point, so
 * the only question left is which credential is the broken one.
 */
function authFailure(sentKey: string | null): Error {
  // The key was the credential in play and it was refused: say so, because
  // "log in again" is the one piece of advice that cannot help here.
  if (sentKey) return new ApiKeyInvalidError();
  return new AuthExpiredError();
}

export async function uploadPhoto(file: File): Promise<string> {
  const data = await fileToBase64(file);
  const sentKey = usableApiKey();
  const res = await authedFetch('/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, mimeType: file.type }),
  });
  if (!res.ok) {
    if (res.status === 401) throw authFailure(sentKey);
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
