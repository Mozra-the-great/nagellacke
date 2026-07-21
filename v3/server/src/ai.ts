import { v4 as uuidv4 } from 'uuid';
import type { FinishType, Polish } from '@nagellacke/core';
import { FINISH_OPTIONS } from '@nagellacke/core';
import {
  getAiConfig, getNextPendingAiJob, updateAiJob, getData, setData,
} from './db';
import type { AiConfig, AiJob } from './db';

const FINISH_VALUES = FINISH_OPTIONS.map((o) => o.value);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isConfigured(config: AiConfig): boolean {
  return config.provider === 'gemini' ? !!config.gemini.apiKey : !!config.openrouter.apiKey;
}

// ── Provider clients ───────────────────────────────────────────────────────────

async function callOpenRouter(
  config: AiConfig['openrouter'],
  systemPrompt: string,
  userPrompt: string,
  webSearch: boolean,
): Promise<string> {
  if (!config.apiKey) throw new Error('OpenRouter-API-Schlüssel fehlt');
  let model = config.model || 'openrouter/auto';
  // OpenRouter marks free variants of a model with a ":free" suffix.
  if (config.freeOnly && !model.endsWith(':free')) model = `${model}:free`;

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  if (webSearch) body.plugins = [{ id: 'web' }];

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter-Fehler ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenRouter hat keine Antwort geliefert');
  return content;
}

async function callGemini(
  config: AiConfig['gemini'],
  systemPrompt: string,
  userPrompt: string,
  webSearch: boolean,
): Promise<string> {
  if (!config.apiKey) throw new Error('Gemini-API-Schlüssel fehlt');
  const model = config.model || 'gemini-2.5-flash';

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
  };
  // Google AI Studio's web-grounding tool.
  if (webSearch) body.tools = [{ googleSearch: {} }];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini-Fehler ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!content) throw new Error('Gemini hat keine Antwort geliefert');
  return content;
}

async function callLlm(config: AiConfig, systemPrompt: string, userPrompt: string, webSearch = true): Promise<string> {
  return config.provider === 'gemini'
    ? callGemini(config.gemini, systemPrompt, userPrompt, webSearch)
    : callOpenRouter(config.openrouter, systemPrompt, userPrompt, webSearch);
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const firstBrace = candidate.search(/[{[]/);
  if (firstBrace === -1) throw new Error('Keine JSON-Antwort von der KI erhalten');
  const lastBrace = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  if (lastBrace < firstBrace) throw new Error('Keine gültige JSON-Antwort von der KI erhalten');
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

// ── Auto-Fill (color + finish research for a single polish) ──────────────────

interface AutofillResult {
  color: string;
  finish: FinishType;
}

async function researchAutofill(config: AiConfig, polish: { name: string; brand: string; num: string }): Promise<AutofillResult> {
  const system = `Du bist ein Assistent, der Fakten zu Nagellacken recherchiert. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt ohne weiteren Text im Format {"color": "#rrggbb", "finish": "<einer von: ${FINISH_VALUES.join(', ')}>"}. "color" ist die tatsächliche Lackfarbe als Hex-Code, "finish" die Oberflächenart.`;
  const user = `Nagellack: Name="${polish.name}", Nummer="${polish.num}", Hersteller="${polish.brand}". Recherchiere im Internet die tatsächliche Farbe und das Finish dieses konkreten Lacks.`;
  const text = await callLlm(config, system, user, true);
  const parsed = extractJson(text) as Partial<AutofillResult>;
  const color = typeof parsed.color === 'string' && HEX_RE.test(parsed.color) ? parsed.color : '#ff6699';
  const finish = FINISH_VALUES.includes(parsed.finish as FinishType) ? (parsed.finish as FinishType) : 'Classic';
  return { color, finish };
}

// ── Smart-Cart (prompt-driven product research) ───────────────────────────────

interface SmartCartSuggestion {
  name: string;
  brand: string;
  num: string;
  color: string;
  finish: FinishType;
}

async function researchSmartCart(
  config: AiConfig,
  prompt: string,
  collection: Polish[],
  cart: Polish[],
): Promise<SmartCartSuggestion[]> {
  const describe = (p: Polish) => `${p.brand} ${p.num} "${p.name}" (${p.color}, ${p.finish})`;
  const collectionSummary = collection.map(describe).join('; ') || 'leer';
  const cartSummary = cart.map(describe).join('; ') || 'leer';

  const system = `Du bist ein Assistent für Nagellack-Kaufempfehlungen. Analysiere die bestehende Sammlung und den aktuellen Einkaufswagen des Nutzers, ermittle anhand des Nutzer-Prompts fehlende Eigenschaften (z.B. fehlende Farben), und recherchiere im Internet nach ECHTEN, real existierenden Nagellackprodukten, die dazu passen. Schlage NUR Produkte vor, deren Existenz du durch Recherche bestätigen konntest — erfinde keine Produkte. Antworte AUSSCHLIESSLICH mit einem JSON-Array ohne weiteren Text im Format [{"name": "...", "brand": "...", "num": "...", "color": "#rrggbb", "finish": "<einer von: ${FINISH_VALUES.join(', ')}>"}]. Maximal 10 Vorschläge. Falls du keine passenden realen Produkte findest, gib ein leeres Array zurück.`;
  const user = `Bestehende Sammlung: ${collectionSummary}\nAktueller Einkaufswagen: ${cartSummary}\nAnfrage: ${prompt}`;

  const text = await callLlm(config, system, user, true);
  const parsed = extractJson(text);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item): SmartCartSuggestion => ({
      name: String(item.name ?? '').trim(),
      brand: String(item.brand ?? '').trim(),
      num: String(item.num ?? '').trim(),
      color: typeof item.color === 'string' && HEX_RE.test(item.color) ? item.color : '#ff6699',
      finish: FINISH_VALUES.includes(item.finish as FinishType) ? (item.finish as FinishType) : 'Classic',
    }))
    .filter((s) => s.name.length > 0)
    .slice(0, 10);
}

// ── Job queue processing ──────────────────────────────────────────────────────
// Simple in-process, one-at-a-time queue — consistent with the existing
// setInterval-based report scheduler already in index.ts. Jobs are persisted to
// disk so pending work survives a restart.

let processing = false;

async function runJob(job: AiJob): Promise<void> {
  const config = getAiConfig();
  if (job.type === 'autofill') {
    const polish = job.input.polish;
    if (!polish) throw new Error('Lack-Daten fehlen');
    // The result is handed back via the job, not written to data.json here —
    // the client applies it to its own state and syncs, so this doesn't race
    // against the client's local edits/sync cycle.
    const result = await researchAutofill(config, polish);
    updateAiJob(job.id, { status: 'done', result });
  } else {
    const data = getData();
    const collection = data.polishes.filter((p) => !p.deletedAt && p.status !== 'wish');
    const cart = data.polishes.filter((p) => !p.deletedAt && p.status === 'wish');
    const suggestions = await researchSmartCart(config, job.input.prompt ?? '', collection, cart);
    const createdAt = Date.now();
    const newPolishes: Polish[] = suggestions.map((s) => ({
      id: uuidv4(),
      ...s,
      status: 'wish',
      count: 1,
      categories: [],
      notes: 'Von KI vorgeschlagen (Smart-Cart)',
      rating: 0,
      createdAt,
      updatedAt: createdAt,
    }));
    // Re-read the current state right before writing — research above can take
    // tens of seconds, during which a concurrent client sync could have
    // written newer data; appending onto the stale `data` snapshot from the
    // start of this job would silently drop that.
    const latest = getData();
    setData({ ...latest, polishes: [...latest.polishes, ...newPolishes] });
    updateAiJob(job.id, { status: 'done', result: { added: newPolishes.length, items: newPolishes } });
  }
}

export async function processAiJobQueue(): Promise<void> {
  if (processing) return;
  const job = getNextPendingAiJob();
  if (!job) return;
  processing = true;
  updateAiJob(job.id, { status: 'running' });
  try {
    await runJob(job);
  } catch (e) {
    updateAiJob(job.id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
  } finally {
    processing = false;
    // Pick up any further pending jobs without waiting for the interval tick.
    setImmediate(() => { void processAiJobQueue(); });
  }
}

export function isAiConfigured(config: AiConfig = getAiConfig()): boolean {
  return isConfigured(config);
}
