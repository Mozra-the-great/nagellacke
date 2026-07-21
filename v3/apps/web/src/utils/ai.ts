import { loadSyncConfig } from '../useAppData';

export type AiProvider = 'openrouter' | 'gemini';

export interface AiSettings {
  provider: AiProvider;
  openrouter: { model: string; freeOnly: boolean; hasApiKey: boolean };
  gemini: { model: string; hasApiKey: boolean };
}

export interface AiSettingsInput {
  provider: AiProvider;
  openrouter: { apiKey?: string; model: string; freeOnly: boolean };
  gemini: { apiKey?: string; model: string };
}

export interface AiJob {
  id: string;
  type: 'autofill' | 'smart-cart';
  status: 'pending' | 'running' | 'done' | 'error';
  input: { polish?: { name: string; brand: string; num: string }; prompt?: string };
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

function serverContext(): { base: string; headers: Record<string, string> } | null {
  const config = loadSyncConfig();
  if (!config || config.provider !== 'server' || !config.serverToken) return null;
  return {
    base: (config.serverUrl ?? '').replace(/\/$/, ''),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.serverToken}` },
  };
}

export function hasServerSync(): boolean {
  return serverContext() !== null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const ctx = serverContext();
  if (!ctx) throw new Error('KI-Funktionen benötigen Server-Sync (Einstellungen → Sync)');
  const res = await fetch(`${ctx.base}${path}`, { ...init, headers: { ...ctx.headers, ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data;
}

export function getAiSettings(): Promise<AiSettings> {
  return request<AiSettings>('/api/ai/settings');
}

export function saveAiSettings(config: AiSettingsInput): Promise<{ ok: true }> {
  return request('/api/ai/settings', { method: 'POST', body: JSON.stringify(config) });
}

export function startAutofillJob(polish: { name: string; brand: string; num: string }): Promise<{ jobId: string }> {
  return request('/api/ai/autofill', { method: 'POST', body: JSON.stringify(polish) });
}

export function startSmartCartJob(prompt: string): Promise<{ jobId: string }> {
  return request('/api/ai/smart-cart', { method: 'POST', body: JSON.stringify({ prompt }) });
}

function getAiJobStatus(jobId: string): Promise<{ job: AiJob }> {
  return request(`/api/ai/jobs/${encodeURIComponent(jobId)}`);
}

export async function pollAiJob(jobId: string, { intervalMs = 2000, timeoutMs = 120_000 } = {}): Promise<AiJob> {
  const start = Date.now();
  for (;;) {
    const { job } = await getAiJobStatus(jobId);
    if (job.status === 'done' || job.status === 'error') return job;
    if (Date.now() - start > timeoutMs) throw new Error('Zeitüberschreitung bei der KI-Anfrage');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
