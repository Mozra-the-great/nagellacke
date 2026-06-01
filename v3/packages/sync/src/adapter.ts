import type { AppData } from '@nagellacke/core';

export type SyncProviderType = 'server' | 'googledrive' | 'onedrive' | 'nextcloud' | 'dropbox';

export interface SyncConfig {
  provider: SyncProviderType;
  // server
  serverUrl?: string;
  serverToken?: string;
  // oauth providers (google, onedrive, dropbox)
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  // nextcloud
  nextcloudUrl?: string;
  nextcloudUser?: string;
  nextcloudPassword?: string;
}

export interface SyncResult {
  success: boolean;
  error?: string;
  lastSyncAt: number;
  merged: AppData;
}

export interface PhotoUploadResult {
  filename: string;
  url: string;
}

export interface SyncAdapter {
  readonly type: SyncProviderType;

  /** Pull remote data, merge with local, push merged result back. Returns merged AppData. */
  sync(local: AppData): Promise<SyncResult>;

  /** Upload a photo (base64 or File) and return its server filename/URL. */
  uploadPhoto(data: string | Blob, mimeType: string): Promise<PhotoUploadResult>;

  /** Delete a photo by filename. */
  deletePhoto(filename: string): Promise<void>;

  /** Returns the public URL for a photo filename. */
  photoUrl(filename: string): string;
}
