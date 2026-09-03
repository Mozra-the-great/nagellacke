import type { AppData } from '@nagellacke/core';
import { mergeData } from '@nagellacke/core';
import type { SyncAdapter, SyncConfig, SyncResult, PhotoUploadResult } from '../adapter';

export class ServerAdapter implements SyncAdapter {
  readonly type = 'server' as const;
  private baseUrl: string;
  private token: string;
  private refreshToken?: string;
  private onTokensRefreshed?: (token: string, refreshToken?: string) => void;

  constructor(config: SyncConfig, onTokensRefreshed?: (token: string, refreshToken?: string) => void) {
    if (!config.serverToken) {
      throw new Error('ServerAdapter requires serverToken');
    }
    // Empty serverUrl = same-origin (app served from the same server)
    this.baseUrl = (config.serverUrl ?? '').replace(/\/$/, '');
    this.token = config.serverToken;
    this.refreshToken = config.serverRefreshToken;
    this.onTokensRefreshed = onTokensRefreshed;
  }

  private headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  /**
   * Trades the refresh token for a fresh access token. Returns false when there
   * is nothing to refresh with or the server rejects it — the caller then
   * surfaces the original 401 rather than retrying forever.
   */
  private async refreshAccessToken(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST',
        // Since #299 the browser's refresh token is an httpOnly cookie rather than
        // anything this object holds, and a cookie only travels when credentials are
        // requested. A body token is still sent when one is in hand — a session
        // predating the cookie, or a non-browser caller — so this works either way.
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Nagellacke-Refresh': '1' },
        body: JSON.stringify(this.refreshToken ? { refreshToken: this.refreshToken } : {}),
      });
      if (!res.ok) return false;
      // No refreshToken comes back on the cookie path, by design: handing one to a
      // script is precisely what #299 set out to stop. Only `token` is required.
      const { token, refreshToken } = await res.json() as { token?: string; refreshToken?: string };
      if (!token) return false;
      this.token = token;
      if (refreshToken) this.refreshToken = refreshToken;
      this.onTokensRefreshed?.(token, refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * fetch + one transparent retry after refreshing on a 401, so an expired
   * access token renews itself instead of surfacing as a sync error.
   */
  private async authedFetch(url: string, init: RequestInit): Promise<Response> {
    const res = await fetch(url, { ...init, headers: this.headers() });
    if (res.status !== 401) return res;
    if (!(await this.refreshAccessToken())) return res;
    return fetch(url, { ...init, headers: this.headers() });
  }

  async sync(local: AppData): Promise<SyncResult> {
    try {
      const res = await this.authedFetch(`${this.baseUrl}/api/sync`, {
        method: 'POST',
        body: JSON.stringify({ data: local, clientTime: Date.now() }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const { data: remote } = await res.json() as { data: AppData };
      const merged = mergeData(local, remote);

      // Push merged result back
      const pushRes = await this.authedFetch(`${this.baseUrl}/api/sync/push`, {
        method: 'POST',
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

    const res = await this.authedFetch(`${this.baseUrl}/api/photos`, {
      method: 'POST',
      body,
    });
    if (!res.ok) throw new Error(`Photo upload failed: ${res.status}`);
    const { filename } = await res.json() as { filename: string };
    return { filename, url: this.photoUrl(filename) };
  }

  async deletePhoto(filename: string): Promise<void> {
    await this.authedFetch(`${this.baseUrl}/api/photos/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
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
