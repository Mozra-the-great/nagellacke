import type { AppData } from '@nagellacke/core';
import { mergeData } from '@nagellacke/core';
import type { SyncAdapter, SyncConfig, SyncResult, PhotoUploadResult } from '../adapter';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const DATA_FILENAME = 'nagellacke-data.json';
const PHOTO_FOLDER = 'nagellacke-photos';

export class GoogleDriveAdapter implements SyncAdapter {
  readonly type = 'googledrive' as const;
  private accessToken: string;

  constructor(config: SyncConfig) {
    if (!config.accessToken) throw new Error('GoogleDriveAdapter requires accessToken');
    this.accessToken = config.accessToken;
  }

  private authHeader(): HeadersInit {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  private async findFile(name: string, folderId?: string): Promise<string | null> {
    const query = folderId
      ? `name='${name}' and '${folderId}' in parents and trashed=false`
      : `name='${name}' and trashed=false`;
    const res = await fetch(
      `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)`,
      { headers: this.authHeader() },
    );
    const json = await res.json() as { files: { id: string }[] };
    return json.files[0]?.id ?? null;
  }

  private async downloadJson(fileId: string): Promise<AppData | null> {
    const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers: this.authHeader(),
    });
    if (!res.ok) return null;
    return res.json() as Promise<AppData>;
  }

  private async uploadJson(data: AppData, fileId?: string): Promise<string> {
    const body = JSON.stringify(data);
    if (fileId) {
      const res = await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { ...this.authHeader(), 'Content-Type': 'application/json' },
        body,
      });
      const json = await res.json() as { id: string };
      return json.id;
    } else {
      const meta = JSON.stringify({ name: DATA_FILENAME, mimeType: 'application/json' });
      const form = `--boundary\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--boundary\r\nContent-Type: application/json\r\n\r\n${body}\r\n--boundary--`;
      const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
        method: 'POST',
        headers: { ...this.authHeader(), 'Content-Type': 'multipart/related; boundary=boundary' },
        body: form,
      });
      const json = await res.json() as { id: string };
      return json.id;
    }
  }

  async sync(local: AppData): Promise<SyncResult> {
    try {
      const fileId = await this.findFile(DATA_FILENAME);
      const remote = fileId ? await this.downloadJson(fileId) : null;
      const merged = remote ? mergeData(local, remote) : local;
      await this.uploadJson(merged, fileId ?? undefined);
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
    const folderId = await this.ensurePhotoFolder();
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const blob = typeof data === 'string' ? base64ToBlob(data, mimeType) : data;
    const meta = JSON.stringify({ name: filename, parents: [folderId] });
    const form = new FormData();
    form.append('metadata', new Blob([meta], { type: 'application/json' }));
    form.append('file', blob);
    const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: 'POST',
      headers: this.authHeader(),
      body: form,
    });
    const json = await res.json() as { id: string };
    return { filename, url: `${DRIVE_API}/files/${json.id}?alt=media` };
  }

  async deletePhoto(filename: string): Promise<void> {
    const fileId = await this.findFile(filename);
    if (fileId) {
      await fetch(`${DRIVE_API}/files/${fileId}`, {
        method: 'DELETE',
        headers: this.authHeader(),
      });
    }
  }

  photoUrl(filename: string): string {
    // Actual URL is returned during uploadPhoto; this is a placeholder for stored filenames
    return filename;
  }

  private async ensurePhotoFolder(): Promise<string> {
    const existing = await this.findFile(PHOTO_FOLDER);
    if (existing) return existing;
    const res = await fetch(`${DRIVE_API}/files`, {
      method: 'POST',
      headers: { ...this.authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: PHOTO_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
    });
    const json = await res.json() as { id: string };
    return json.id;
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}
