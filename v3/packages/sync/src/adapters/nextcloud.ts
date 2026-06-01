import type { AppData } from '@nagellacke/core';
import { mergeData } from '@nagellacke/core';
import type { SyncAdapter, SyncConfig, SyncResult, PhotoUploadResult } from '../adapter';

export class NextcloudAdapter implements SyncAdapter {
  readonly type = 'nextcloud' as const;
  private baseUrl: string;
  private authHeader: string;

  constructor(config: SyncConfig) {
    if (!config.nextcloudUrl || !config.nextcloudUser || !config.nextcloudPassword) {
      throw new Error('NextcloudAdapter requires nextcloudUrl, nextcloudUser, nextcloudPassword');
    }
    this.baseUrl = config.nextcloudUrl.replace(/\/$/, '');
    this.authHeader = 'Basic ' + btoa(`${config.nextcloudUser}:${config.nextcloudPassword}`);
  }

  private webdavUrl(path: string): string {
    return `${this.baseUrl}/remote.php/dav/files/${path}`;
  }

  private headers(extra: HeadersInit = {}): HeadersInit {
    return { Authorization: this.authHeader, ...extra };
  }

  async sync(local: AppData): Promise<SyncResult> {
    try {
      await this.ensureDir('nagellacke');
      const dataUrl = this.webdavUrl('nagellacke/nagellacke-data.json');
      const getRes = await fetch(dataUrl, { headers: this.headers() });
      const remote: AppData | null = getRes.ok ? await getRes.json() : null;
      const merged = remote ? mergeData(local, remote) : local;

      await fetch(dataUrl, {
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
    await this.ensureDir('nagellacke/photos');
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const blob = typeof data === 'string' ? base64ToBlob(data, mimeType) : data;
    const url = this.webdavUrl(`nagellacke/photos/${filename}`);
    await fetch(url, {
      method: 'PUT',
      headers: this.headers({ 'Content-Type': mimeType }),
      body: blob,
    });
    return { filename, url };
  }

  async deletePhoto(filename: string): Promise<void> {
    const url = this.webdavUrl(`nagellacke/photos/${filename}`);
    await fetch(url, { method: 'DELETE', headers: this.headers() });
  }

  photoUrl(filename: string): string {
    return this.webdavUrl(`nagellacke/photos/${filename}`);
  }

  private async ensureDir(path: string): Promise<void> {
    const url = this.webdavUrl(path);
    const check = await fetch(url, { method: 'PROPFIND', headers: this.headers() });
    if (!check.ok) {
      await fetch(url, { method: 'MKCOL', headers: this.headers() });
    }
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
