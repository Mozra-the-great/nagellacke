import { loadSyncConfig } from '../useAppData';

/**
 * Origin prefix for API calls, '' when the app and server share an origin.
 *
 * Bare relative fetches only ever worked because most install.sh deployments
 * are same-origin; in "Eigener Server" mode (and for the container image from
 * #321) the web app and the API live on different hosts. admin.ts and
 * SettingsPage learned this in #173 — photos.ts did not, which is why photo
 * upload, display and delete were still aimed at the wrong origin (#330).
 */
export function serverBase(): string {
  const config = loadSyncConfig();
  return config?.provider === 'server' ? (config.serverUrl ?? '').replace(/\/$/, '') : '';
}

/** Resolves an API path against the configured server. */
export function serverUrl(path: string): string {
  return `${serverBase()}${path}`;
}
