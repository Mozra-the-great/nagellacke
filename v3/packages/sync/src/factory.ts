import type { SyncAdapter, SyncConfig } from './adapter';
import { ServerAdapter } from './adapters/server';
import { GoogleDriveAdapter } from './adapters/googledrive';
import { OneDriveAdapter } from './adapters/onedrive';
import { NextcloudAdapter } from './adapters/nextcloud';
import { DropboxAdapter } from './adapters/dropbox';

export function createAdapter(config: SyncConfig): SyncAdapter {
  switch (config.provider) {
    case 'server':      return new ServerAdapter(config);
    case 'googledrive': return new GoogleDriveAdapter(config);
    case 'onedrive':    return new OneDriveAdapter(config);
    case 'nextcloud':   return new NextcloudAdapter(config);
    case 'dropbox':     return new DropboxAdapter(config);
    default:
      throw new Error(`Unknown sync provider: ${(config as SyncConfig).provider}`);
  }
}
