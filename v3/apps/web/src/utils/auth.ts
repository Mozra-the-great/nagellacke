import { loadSyncConfig } from '../useAppData';

export type Role = 'admin' | 'user';

/**
 * App.tsx has no auth state of its own — login lives inside SettingsPage and
 * only ever wrote to localStorage. This is the standalone probe that lets the
 * top-level nav decide whether to show the Admin tab, without pulling auth
 * state into useAppData.ts (which already handles collection sync, not
 * identity).
 */
function serverContext(): { base: string; headers: Record<string, string> } | null {
  const config = loadSyncConfig();
  if (!config || config.provider !== 'server' || !config.serverToken) return null;
  return {
    base: (config.serverUrl ?? '').replace(/\/$/, ''),
    headers: { Authorization: `Bearer ${config.serverToken}` },
  };
}

/**
 * Resolves to null on any failure (offline, not logged in, or an
 * older/not-yet-upgraded server that omits `role` in GET /api/auth/me) — the
 * caller then simply doesn't render the Admin tab, no error surfaced.
 */
export async function fetchRole(signal?: AbortSignal): Promise<Role | null> {
  const ctx = serverContext();
  if (!ctx) return null;
  try {
    const res = await fetch(`${ctx.base}/api/auth/me`, { headers: ctx.headers, signal });
    if (!res.ok) return null;
    const data = await res.json() as { role?: string };
    return data.role === 'admin' ? 'admin' : 'user';
  } catch {
    return null;
  }
}
