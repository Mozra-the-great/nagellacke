import type { SyncAdapter, SyncConfig } from './adapter';
import { ServerAdapter } from './adapters/server';
import { GoogleDriveAdapter } from './adapters/googledrive';
import { OneDriveAdapter } from './adapters/onedrive';
import { NextcloudAdapter } from './adapters/nextcloud';
import { DropboxAdapter } from './adapters/dropbox';

/**
 * @param onTokensRefreshed called when the server adapter silently renews its
 *   access token (#109), so the caller can persist the new pair. Only the
 *   server provider refreshes; the OAuth adapters ignore it.
 */
export function createAdapter(
  config: SyncConfig,
  onTokensRefreshed?: (token: string, refreshToken?: string) => void,
): SyncAdapter {
  switch (config.provider) {
    case 'server':      return new ServerAdapter(config, onTokensRefreshed);
    case 'googledrive': return new GoogleDriveAdapter(config);
    case 'onedrive':    return new OneDriveAdapter(config);
    case 'nextcloud':   return new NextcloudAdapter(config);
    case 'dropbox':     return new DropboxAdapter(config);
    default:
      throw new Error(`Unknown sync provider: ${(config as SyncConfig).provider}`);
  }
}
