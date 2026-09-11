/**
 * Single owner of the browser-stored admin API key (#330).
 *
 * The key used to be read straight from localStorage in four places, which is
 * how the rotation path in AdminPage came to leave a key behind that the server
 * had just invalidated. Everything that touches it now goes through here.
 */

export const APIKEY_STORAGE = 'nagellacke_v3_apikey';

/**
 * Keys the server has answered 401 for in this session. Kept in module state
 * rather than dropped from localStorage on the spot: the key is something the
 * user typed in and can still be repaired in Settings, so silently deleting it
 * would trade one confusing failure for another. Remembering it here is enough
 * to stop re-sending a credential we know is dead — see usableApiKey().
 */
let rejectedKey: string | null = null;

/**
 * Run when the usable key changes (rejected, replaced, cleared). The photo
 * access token is signed with the API key when it was minted from one
 * (server: signPhotoToken({ k: true }, …, API_KEY)), so a key that stops
 * working takes its token down with it — and the client caches that token for
 * up to an hour. Without this, #330 would fix uploading while leaving every
 * <img> 401-ing until the TTL ran out.
 *
 * A callback rather than a direct import: photoToken.ts already imports
 * photos.ts, which imports this module, so calling the other way round would
 * close a cycle.
 */
const invalidationListeners = new Set<() => void>();

/** Registers `fn` to run whenever the usable key changes. */
export function onApiKeyInvalidated(fn: () => void): void {
  invalidationListeners.add(fn);
}

function notifyInvalidated(): void {
  for (const fn of invalidationListeners) fn();
}

export function storedApiKey(): string | null {
  try {
    return localStorage.getItem(APIKEY_STORAGE);
  } catch {
    return null;   // storage disabled (private mode, blocked cookies)
  }
}

/** Persists a key, or removes it when null/empty. A new value is trusted again. */
export function setStoredApiKey(key: string | null): void {
  const changed = storedApiKey() !== key;
  if (rejectedKey !== key) rejectedKey = null;
  try {
    if (key) localStorage.setItem(APIKEY_STORAGE, key);
    else localStorage.removeItem(APIKEY_STORAGE);
  } catch { /* storage disabled — nothing to persist, requests just go unkeyed */ }
  if (changed) notifyInvalidated();
}

/** Records that the server rejected `key`, so it is not sent again. */
export function markApiKeyRejected(key: string): void {
  if (rejectedKey === key) return;
  rejectedKey = key;
  notifyInvalidated();
}

/** True once the server has rejected the currently stored key. */
export function isStoredApiKeyRejected(): boolean {
  const key = storedApiKey();
  return !!key && key === rejectedKey;
}

/**
 * The key to actually send: the stored one, unless the server already told us
 * it is invalid. A rotated-away key must not keep vetoing a working session,
 * because the server's requireApiKeyOrJwt treats *any* present X-Api-Key as the
 * only credential it will consider and never falls through to the JWT.
 */
export function usableApiKey(): string | null {
  const key = storedApiKey();
  return key && key !== rejectedKey ? key : null;
}
