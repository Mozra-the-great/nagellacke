import type { AppData } from '@nagellacke/core';
import { mergeData } from '@nagellacke/core';
import type { SyncAdapter, SyncConfig, SyncResult, PhotoUploadResult } from '../adapter';

export class ServerAdapter implements SyncAdapter {
  readonly type = 'server' as const;
  private baseUrl: string;
  private token: string;

  constructor(config: SyncConfig) {
    if (!config.serverToken) {
      throw new Error('ServerAdapter requires serverToken');
    }
    // Empty serverUrl = same-origin (app served from the same server)
    this.baseUrl = (config.serverUrl ?? '').replace(/\/$/, '');
    this.token = config.serverToken;
  }

  private headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  async sync(local: AppData): Promise<SyncResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/sync`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ data: local, clientTime: Date.now() }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const { data: remote } = await res.json() as { data: AppData };
      const merged = mergeData(local, remote);

      // Push merged result back
      const pushRes = await fetch(`${this.baseUrl}/api/sync/push`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ data: merged }),
      });
      if (!pushRes.ok) throw new Error(`Push failed: ${pushRes.status}`);

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
    const body = typeof data === 'string'
      ? JSON.stringify({ data, mimeType })
      : await blobToBase64Body(data, mimeType);

    const res = await fetch(`${this.baseUrl}/api/photos`, {
      method: 'POST',
      headers: this.headers(),
      body,
    });
    if (!res.ok) throw new Error(`Photo upload failed: ${res.status}`);
    const { filename } = await res.json() as { filename: string };
    return { filename, url: this.photoUrl(filename) };
  }

  async deletePhoto(filename: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/photos/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
  }

  photoUrl(filename: string): string {
    return `${this.baseUrl}/photos/${encodeURIComponent(filename)}`;
  }
}

async function blobToBase64Body(blob: Blob, mimeType: string): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  return JSON.stringify({ data: base64, mimeType });
}
