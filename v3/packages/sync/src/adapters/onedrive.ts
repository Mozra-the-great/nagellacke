import type { AppData } from '@nagellacke/core';
import { mergeData } from '@nagellacke/core';
import type { SyncAdapter, SyncConfig, SyncResult, PhotoUploadResult } from '../adapter';

const GRAPH_API = 'https://graph.microsoft.com/v1.0/me/drive';
const DATA_PATH = 'nagellacke/nagellacke-data.json';
const PHOTO_FOLDER = 'nagellacke/photos';

export class OneDriveAdapter implements SyncAdapter {
  readonly type = 'onedrive' as const;
  private accessToken: string;

  constructor(config: SyncConfig) {
    if (!config.accessToken) throw new Error('OneDriveAdapter requires accessToken');
    this.accessToken = config.accessToken;
  }

  private headers(extra: HeadersInit = {}): HeadersInit {
    return { Authorization: `Bearer ${this.accessToken}`, ...extra };
  }

  async sync(local: AppData): Promise<SyncResult> {
    try {
      const getRes = await fetch(`${GRAPH_API}/root:/${DATA_PATH}:/content`, {
        headers: this.headers(),
      });
      const remote: AppData | null = getRes.ok ? await getRes.json() : null;
      const merged = remote ? mergeData(local, remote) : local;

      await fetch(`${GRAPH_API}/root:/${DATA_PATH}:/content`, {
        method: 'PUT',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(merged),
      });

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

  async uploadPhoto(data: string | Blob, mimeType: string): Promise<PhotoUploadResult> {
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const blob = typeof data === 'string' ? base64ToBlob(data, mimeType) : data;
    const res = await fetch(`${GRAPH_API}/root:/${PHOTO_FOLDER}/${filename}:/content`, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': mimeType }),
      body: blob,
    });
    const json = await res.json() as { id: string; '@microsoft.graph.downloadUrl'?: string };
    const url = json['@microsoft.graph.downloadUrl'] ?? '';
    return { filename, url };
  }

  async deletePhoto(filename: string): Promise<void> {
    await fetch(`${GRAPH_API}/root:/${PHOTO_FOLDER}/${filename}`, {
      method: 'DELETE',
      headers: this.headers(),
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
