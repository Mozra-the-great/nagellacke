import type { AppData, Polish } from '@nagellacke/core';
import { loadSyncConfig } from '../useAppData';

export interface AiJob {
  id: string;
  type: 'autofill' | 'smart-cart';
  status: 'pending' | 'running' | 'done' | 'error';
  result?: unknown;
  error?: string;
}

export interface AiSettings {
  configured: boolean;
  provider: string | null;
  model: string | null;
}

// AI features run server-side (they need a server-held API key and make
// outbound web-search calls) — only available when synced against our own
// server, same restriction as reports in SettingsPage.
function serverAuth(): { base: string; headers: Record<string, string> } | null {
  const config = loadSyncConfig();
  if (config?.provider !== 'server' || !config.serverToken) return null;
  return {
    base: (config.serverUrl ?? '').replace(/\/$/, ''),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.serverToken}` },
  };
}

export function aiAvailable(): boolean {
  return serverAuth() !== null;
}

export async function getAiSettings(): Promise<AiSettings> {
  const auth = serverAuth();
  if (!auth) return { configured: false, provider: null, model: null };
  const res = await fetch(`${auth.base}/api/ai/settings`, { headers: auth.headers });
  if (!res.ok) throw new Error(`Fehler ${res.status}`);
  return res.json() as Promise<AiSettings>;
}

export async function saveAiSettings(apiKey: string, model: string): Promise<void> {
  const auth = serverAuth();
  if (!auth) throw new Error('KI erfordert Server-Sync');
  const res = await fetch(`${auth.base}/api/ai/settings`, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify({ apiKey, model }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? `Fehler ${res.status}`);
  }
}

async function startJob(path: string, body: unknown): Promise<string> {
  const auth = serverAuth();
  if (!auth) throw new Error('KI erfordert Server-Sync mit KI-Konfiguration');
  const res = await fetch(`${auth.base}${path}`, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { jobId?: string; error?: string };
  if (!res.ok || !data.jobId) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data.jobId;
}

// A freshly-added polish only exists in local state — the server-side Auto-Fill
// job needs it to exist in data.json to write its result back, so we push this
// one item up first (merge-safe: /api/sync/push merges rather than overwrites,
// so this can't clobber anything else server-side).
async function pushPolishToServer(item: Polish): Promise<void> {
  const auth = serverAuth();
  if (!auth) throw new Error('KI erfordert Server-Sync');
  const payload: AppData = { polishes: [item], customCats: [], manicures: [], stickers: [] };
  const res = await fetch(`${auth.base}/api/sync/push`, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify({ data: payload }),
  });
  if (!res.ok) throw new Error(`Fehler ${res.status}`);
}

export async function requestAutofillForNewPolish(item: Polish): Promise<string> {
  await pushPolishToServer(item);
  return startJob('/api/ai/autofill', { polishId: item.id });
}

export function requestSmartCart(prompt: string): Promise<string> {
  return startJob('/api/ai/smart-cart', { prompt });
}

export async function fetchAiJob(jobId: string): Promise<AiJob> {
  const auth = serverAuth();
  if (!auth) throw new Error('KI erfordert Server-Sync');
  const res = await fetch(`${auth.base}/api/ai/jobs/${jobId}`, { headers: auth.headers });
  const data = await res.json().catch(() => ({})) as { job?: AiJob; error?: string };
  if (!res.ok || !data.job) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data.job;
}

// Polls a job until it's done/error, or the timeout elapses.
export async function pollAiJob(jobId: string, { intervalMs = 2500, timeoutMs = 120_000 } = {}): Promise<AiJob> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await fetchAiJob(jobId);
    if (job.status === 'done' || job.status === 'error') return job;
    if (Date.now() >= deadline) throw new Error('Zeitüberschreitung beim Warten auf die KI-Antwort');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
