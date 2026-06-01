import type { AppData } from '@nagellacke/core';
import { mergeData } from '@nagellacke/core';
import type { SyncAdapter, SyncConfig, SyncResult, PhotoUploadResult } from '../adapter';

const API = 'https://api.dropboxapi.com/2';
const CONTENT_API = 'https://content.dropboxapi.com/2';
const DATA_PATH = '/nagellacke/nagellacke-data.json';
const PHOTO_FOLDER = '/nagellacke/photos';

export class DropboxAdapter implements SyncAdapter {
  readonly type = 'dropbox' as const;
  private accessToken: string;

  constructor(config: SyncConfig) {
    if (!config.accessToken) throw new Error('DropboxAdapter requires accessToken');
    this.accessToken = config.accessToken;
  }

  private authHeader(): HeadersInit {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  async sync(local: AppData): Promise<SyncResult> {
    try {
      const remote = await this.downloadJson();
      const merged = remote ? mergeData(local, remote) : local;
      await this.uploadJson(merged);
      return { success: true, lastSyncAt: Date.now(), merged };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        lastSyncAt: Date.now(),
        merged: local,
      };
    }
  }

  private async downloadJson(): Promise<AppData | null> {
    const res = await fetch(`${CONTENT_API}/files/download`, {
      method: 'POST',
      headers: {
        ...this.authHeader(),
        'Dropbox-API-Arg': JSON.stringify({ path: DATA_PATH }),
      },
    });
    if (res.status === 409) return null; // file not found
    if (!res.ok) throw new Error(`Dropbox download failed: ${res.status}`);
    return res.json() as Promise<AppData>;
  }

  private async uploadJson(data: AppData): Promise<void> {
    await fetch(`${CONTENT_API}/files/upload`, {
      method: 'POST',
      headers: {
        ...this.authHeader(),
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path: DATA_PATH, mode: 'overwrite' }),
      },
      body: JSON.stringify(data),
    });
  }

  async uploadPhoto(data: string | Blob, mimeType: string): Promise<PhotoUploadResult> {
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const path = `${PHOTO_FOLDER}/${filename}`;
    const blob = typeof data === 'string' ? base64ToBlob(data, mimeType) : data;
    const res = await fetch(`${CONTENT_API}/files/upload`, {
      method: 'POST',
      headers: {
        ...this.authHeader(),
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path, mode: 'add' }),
      },
      body: blob,
    });
    if (!res.ok) throw new Error(`Dropbox photo upload failed: ${res.status}`);

    // Get a temporary link for the uploaded file
    const linkRes = await fetch(`${API}/files/get_temporary_link`, {
      method: 'POST',
      headers: { ...this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const linkJson = await linkRes.json() as { link: string };
    return { filename, url: linkJson.link ?? '' };
  }

  async deletePhoto(filename: string): Promise<void> {
    await fetch(`${API}/files/delete_v2`, {
      method: 'POST',
      headers: { ...this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: `${PHOTO_FOLDER}/${filename}` }),
    });
  }

  photoUrl(filename: string): string {
    return filename;
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
