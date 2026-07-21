import { v4 as uuidv4 } from 'uuid';
import type { AppData, FinishType, Polish } from '@nagellacke/core';
import {
  getAiConfig, getData, setData,
  createAiJob, getAiJob, getNextPendingAiJob, updateAiJob, requeueStaleAiJobs,
} from './db';
import type { AiConfig, AiJob } from './db';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const FINISH_VALUES: FinishType[] = [
  'Classic', 'Shimmer', 'Glitter', 'Metallic', 'Chrome',
  'Matte', 'Satin', 'Duochrome', 'Holographic', 'Jelly',
  'Neon', 'Magnetic', 'Gel Look', 'Top Coat', 'Base Coat',
];

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

async function callOpenRouter(cfg: AiConfig, messages: ChatMessage[]): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        // OpenRouter's "web" plugin runs a web search and injects the results
        // into context before the model answers — this is our web-research
        // step, no separate search-API integration required.
        plugins: [{ id: 'web', max_results: 5 }],
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch (e: unknown) {
    throw new Error(e instanceof Error && e.name === 'AbortError' ? 'OpenRouter-Anfrage: Timeout' : `OpenRouter-Anfrage fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter-Fehler ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter: leere Antwort erhalten');
  return content;
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch { /* fall through to extraction below */ }
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch { /* give up below */ }
  }
  throw new Error('Konnte KI-Antwort nicht als JSON interpretieren');
}

function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isValidFinish(value: unknown): value is FinishType {
  return typeof value === 'string' && (FINISH_VALUES as string[]).includes(value);
}

// ── Auto-Fill: research color + finish for one polish ────────────────────────

export interface AutofillInput {
  polishId: string;
  name: string;
  brand: string;
  num: string;
}

interface AutofillResult {
  color: string;
  finish: FinishType;
}

async function researchAutofill(cfg: AiConfig, input: AutofillInput): Promise<AutofillResult> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'Du bist ein Experte für Nagellacke. Nutze die Websuche, um exakte Produktdaten zu ermitteln. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Fließtext oder Markdown.',
    },
    {
      role: 'user',
      content:
        `Recherchiere im Internet den folgenden Nagellack:\n` +
        `Marke: ${input.brand || '(unbekannt)'}\n` +
        `Name: ${input.name}\n` +
        `Nummer/Code: ${input.num || '(unbekannt)'}\n\n` +
        `Ermittle die exakte Farbe als Hex-Code und das Finish (Oberflächentyp).\n` +
        `Gültige Finish-Werte: ${FINISH_VALUES.join(', ')}.\n` +
        `Antworte NUR als JSON-Objekt in genau diesem Format: {"color": "#rrggbb", "finish": "<einer der gültigen Werte>"}`,
    },
  ];
  const content = await callOpenRouter(cfg, messages);
  const parsed = extractJson(content) as { color?: unknown; finish?: unknown };
  if (!isValidHexColor(parsed.color)) throw new Error('KI lieferte keine gültige Farbe');
  if (!isValidFinish(parsed.finish)) throw new Error('KI lieferte kein gültiges Finish');
  return { color: parsed.color.toLowerCase(), finish: parsed.finish };
}

// ── Smart-Cart: analyze collection + prompt, research real products ──────────

export interface SmartCartInput {
  prompt: string;
}

export interface SmartCartSuggestion {
  name: string;
  brand: string;
  num: string;
  color: string;
  finish: FinishType;
  reason: string;
}

function summarizePolishes(polishes: Polish[]): string {
  if (polishes.length === 0) return '(leer)';
  return polishes
    .map((p) => `- ${p.brand ? `${p.brand} ` : ''}${p.name}${p.num ? ` (${p.num})` : ''} — ${p.color}, ${p.finish}`)
    .join('\n');
}

async function researchSmartCart(cfg: AiConfig, input: SmartCartInput, data: AppData): Promise<SmartCartSuggestion[]> {
  const collection = data.polishes.filter((p) => !p.deletedAt && p.status !== 'wish');
  const cart = data.polishes.filter((p) => !p.deletedAt && p.status === 'wish');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'Du bist ein Assistent für eine Nagellack-Sammlung. Du bekommst die bestehende Sammlung, den aktuellen ' +
        'Einkaufswagen und einen Nutzerwunsch. Finde per Websuche reale, aktuell existierende Nagellack-Produkte, ' +
        'die dem Wunsch entsprechen und noch nicht in Sammlung oder Einkaufswagen enthalten sind. ' +
        'Schlage NUR Produkte vor, die du über die Websuche als real existierend bestätigen konntest — ' +
        'erfinde keine Produktnamen oder -nummern. Wenn du dir unsicher bist, lasse den Vorschlag weg. ' +
        'Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Fließtext oder Markdown.',
    },
    {
      role: 'user',
      content:
        `Bestehende Sammlung (bereits vorhanden):\n${summarizePolishes(collection)}\n\n` +
        `Aktueller Einkaufswagen (bereits geplant):\n${summarizePolishes(cart)}\n\n` +
        `Nutzerwunsch: "${input.prompt}"\n\n` +
        `Antworte NUR als JSON-Objekt in genau diesem Format (maximal 8 Vorschläge):\n` +
        `{"suggestions": [{"name": "...", "brand": "...", "num": "...", "color": "#rrggbb", "finish": "<Finish>", "reason": "kurze Begründung auf Deutsch"}]}\n` +
        `Gültige Finish-Werte: ${FINISH_VALUES.join(', ')}.`,
    },
  ];

  const content = await callOpenRouter(cfg, messages);
  const parsed = extractJson(content) as { suggestions?: unknown };
  if (!Array.isArray(parsed.suggestions)) throw new Error('KI lieferte keine Vorschlagsliste');

  const valid: SmartCartSuggestion[] = [];
  for (const raw of parsed.suggestions as Record<string, unknown>[]) {
    if (typeof raw.name !== 'string' || !raw.name.trim()) continue;
    if (!isValidHexColor(raw.color)) continue;
    if (!isValidFinish(raw.finish)) continue;
    valid.push({
      name: raw.name.trim(),
      brand: typeof raw.brand === 'string' ? raw.brand.trim() : '',
      num: typeof raw.num === 'string' ? raw.num.trim() : '',
      color: raw.color.toLowerCase(),
      finish: raw.finish,
      reason: typeof raw.reason === 'string' ? raw.reason.trim() : '',
    });
  }
  return valid.slice(0, 8);
}

// ── Job queue ─────────────────────────────────────────────────────────────────
// Single in-process worker, one job at a time — matches the app's existing
// setInterval-based report scheduler in scale; a real queue (Redis/BullMQ)
// would be overkill for a personal, single-instance deployment.

let queueRunning = false;

function kickAiQueue(): void {
  if (queueRunning) return;
  queueRunning = true;
  setImmediate(() => { void processQueue(); });
}

async function processQueue(): Promise<void> {
  try {
    for (;;) {
      const job = getNextPendingAiJob();
      if (!job) return;
      updateAiJob(job.id, { status: 'running' });
      try {
        const cfg = getAiConfig();
        if (!cfg) throw new Error('KI ist nicht konfiguriert');
        if (job.type === 'autofill') {
          const result = await researchAutofill(cfg, job.input as AutofillInput);
          applyAutofillResult(job.input as AutofillInput, result);
          updateAiJob(job.id, { status: 'done', result });
        } else {
          const data = getData();
          const suggestions = await researchSmartCart(cfg, job.input as SmartCartInput, data);
          const added = applySmartCartSuggestions(suggestions);
          updateAiJob(job.id, { status: 'done', result: { added } });
        }
      } catch (e: unknown) {
        updateAiJob(job.id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    }
  } finally {
    queueRunning = false;
  }
}

function applyAutofillResult(input: AutofillInput, result: AutofillResult): void {
  const data = getData();
  const idx = data.polishes.findIndex((p) => p.id === input.polishId);
  if (idx < 0) return; // deleted meanwhile — nothing to fill in
  const updated = [...data.polishes];
  updated[idx] = { ...updated[idx], color: result.color, finish: result.finish, updatedAt: Date.now() };
  setData({ ...data, polishes: updated });
}

function applySmartCartSuggestions(suggestions: SmartCartSuggestion[]): Polish[] {
  if (suggestions.length === 0) return [];
  const data = getData();
  const now = Date.now();
  const added: Polish[] = suggestions.map((s) => ({
    id: uuidv4(),
    name: s.name,
    brand: s.brand,
    num: s.num,
    color: s.color,
    finish: s.finish,
    status: 'wish',
    count: 1,
    notes: s.reason ? `KI-Vorschlag: ${s.reason}` : 'KI-Vorschlag',
    rating: 0,
    createdAt: now,
    updatedAt: now,
  }));
  setData({ ...data, polishes: [...data.polishes, ...added] });
  return added;
}

// ── Public API used by index.ts ───────────────────────────────────────────────

export function enqueueAutofillJob(input: AutofillInput): AiJob {
  const job = createAiJob(uuidv4(), 'autofill', input);
  kickAiQueue();
  return job;
}

export function enqueueSmartCartJob(input: SmartCartInput): AiJob {
  const job = createAiJob(uuidv4(), 'smart-cart', input);
  kickAiQueue();
  return job;
}

export function getAiJobStatus(id: string): AiJob | undefined {
  return getAiJob(id);
}

// Called once at server startup.
export function initAiQueue(): void {
  requeueStaleAiJobs();
  kickAiQueue();
}
