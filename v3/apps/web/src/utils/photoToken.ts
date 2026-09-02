import { useEffect, useSyncExternalStore } from 'react';
import { authedFetch, hasPhotoUploadAuth } from './photos';

/**
 * Client side of the signed photo tokens (#269).
 *
 * `/photos/*` no longer serves anyone who knows the filename. An `<img>` tag
 * cannot send an Authorization header, so the browser fetches a short-lived,
 * signed token once (`GET /api/photos/token`) and appends it to every photo URL
 * as `?t=…`. The token covers all photos and is re-minted before it expires.
 *
 * The token is deliberately kept in module state only — never localStorage.
 * Persisting it would recreate exactly the problem this fixes: a credential
 * that outlives the session and can leak somewhere it can't be revoked.
 */

let token: string | null = null;
let expiresAt = 0;
let inFlight: Promise<void> | null = null;

/** Bumped on every token change so useSyncExternalStore re-renders subscribers. */
let version = 0;
const listeners = new Set<() => void>();

/** Re-mint this long before expiry, so an in-flight page load never races it. */
const REFRESH_MARGIN_MS = 60_000;

function notify(): void {
  version += 1;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function getSnapshot(): number {
  return version;
}

/** True while the current token is still usable. */
export function hasPhotoToken(): boolean {
  return !!token && Date.now() < expiresAt - REFRESH_MARGIN_MS;
}

/**
 * The `src` for a stored photo filename. Without a token this still returns the
 * plain path — the server answers 401 and the `<img>` simply doesn't render,
 * which is the same failure mode as a missing file and needs no extra UI.
 */
export function photoUrl(filename: string): string {
  const base = `/photos/${encodeURIComponent(filename)}`;
  return token ? `${base}?t=${encodeURIComponent(token)}` : base;
}

/**
 * Absolute variant of photoUrl(). The generated report is opened as a `blob:`
 * document, where a root-relative `/photos/...` would resolve against the blob
 * URL instead of the app's origin.
 */
export function absolutePhotoUrl(filename: string): string {
  return new URL(photoUrl(filename), window.location.origin).toString();
}

/**
 * Mints a token if there isn't a usable one. Concurrent callers share a single
 * request — every photo on the page calls this on mount.
 */
export async function ensurePhotoToken(): Promise<void> {
  if (hasPhotoToken()) return;
  // No credentials at all (local-only install, logged out): don't hammer the
  // endpoint with requests that can only 401.
  if (!hasPhotoUploadAuth()) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await authedFetch('/api/photos/token');
      if (!res.ok) return;
      const json = await res.json() as { token?: string; expiresAt?: number };
      if (!json.token || !json.expiresAt) return;
      token = json.token;
      expiresAt = json.expiresAt;
      notify();
    } catch {
      // Offline or server down — photos just don't load, same as before.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Drops the cached token — call on logout, or after switching accounts. */
export function clearPhotoToken(): void {
  token = null;
  expiresAt = 0;
  notify();
}

/**
 * Returns `photoUrl` and makes the calling component re-render once the token
 * arrives, so `<img>` tags rendered before it lands get a second, valid src.
 */
export function usePhotoUrl(): (filename: string) => string {
  useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => { void ensurePhotoToken(); }, []);
  return photoUrl;
}
