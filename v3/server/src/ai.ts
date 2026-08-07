import { v4 as uuidv4 } from 'uuid';
import type { FinishType, Polish } from '@nagellacke/core';
import { FINISH_OPTIONS } from '@nagellacke/core';
import {
  getAiConfig, getNextPendingAiJob, updateAiJob, getData, setData,
} from './db';
import type { AiConfig, AiJob } from './db';
import type { WebSearchConfig } from './websearch';
import { isWebSearchConfigured } from './websearch';
import {
  FINAL_ROUND_NOTICE, MAX_TOOL_ROUNDS, geminiText, geminiToolSpec, openAiToolSpec,
  parseGeminiToolCalls, parseOpenAiToolCalls, runWebSearchTool,
} from './tooling';

const FINISH_VALUES = FINISH_OPTIONS.map((o) => o.value);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isConfigured(config: AiConfig): boolean {
  return config.provider === 'gemini' ? !!config.gemini.apiKey : !!config.openrouter.apiKey;
}

/**
 * The tool budget ran out without the model ever producing a final answer.
 *
 * Distinct from a transport, auth or quota failure: the requests all succeeded,
 * the model simply kept asking for more searches. That is a recoverable state —
 * the same question asked without tools still has an answer — so it is typed
 * separately and degraded in `callLlm` rather than failing the user's job.
 */
class ToolLoopExhaustedError extends Error {
  constructor(provider: string) {
    super(`${provider} hat nach ${MAX_TOOL_ROUNDS} Werkzeug-Runden keine Antwort geliefert`);
    this.name = 'ToolLoopExhaustedError';
  }
}

// ── Provider clients ───────────────────────────────────────────────────────────

/** OpenRouter's own free-model router: picks a free model per request and
 *  filters for the capabilities the request needs. */
const OPENROUTER_FREE_ROUTER = 'openrouter/free';

/**
 * Restricts a model id to free inference.
 *
 * ":free" is a *variant* suffix on a provider-hosted model
 * ("deepseek/deepseek-r1:free"). OpenRouter's own routers — "openrouter/auto",
 * "openrouter/free" — are not provider models, and appending the suffix to a
 * router asks it to resolve to a free endpoint: "openrouter/auto:free" is
 * rejected with 404 "No :free endpoints available for any resolved models",
 * because auto resolves to paid frontier models. Routers are mapped to the
 * free router instead, which is what the setting means anyway.
 */
function toFreeModel(model: string): string {
  if (model.startsWith('openrouter/')) return OPENROUTER_FREE_ROUTER;
  return model.endsWith(':free') ? model : `${model}:free`;
}

export async function callOpenRouter(
  config: AiConfig['openrouter'],
  systemPrompt: string,
  userPrompt: string,
  webSearch: boolean,
  search: WebSearchConfig,
): Promise<string> {
  if (!config.apiKey) throw new Error('OpenRouter-API-Schlüssel fehlt');
  let model = config.model || 'openrouter/auto';
  if (config.freeOnly) model = toFreeModel(model);

  // Research runs through our own `web_search` tool (websearch.ts), never
  // through OpenRouter's `web` plugin: the plugin is billed ~$0.005 per request
  // even when the model itself is a free variant costing $0 (#125). Tool calls
  // are ordinary completions, so this stays free on a free model.
  const messages: unknown[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // On the last round the tools are withdrawn, and any tool call that comes
    // back anyway is ignored rather than looped on — otherwise a model that
    // keeps requesting tools it was not offered would spin forever. Withdrawing
    // them silently is not enough, so the budget is also stated in-band.
    const lastRound = round === MAX_TOOL_ROUNDS;
    const offerTools = webSearch && !lastRound;
    if (lastRound && webSearch) messages.push({ role: 'user', content: FINAL_ROUND_NOTICE });
    const body: Record<string, unknown> = { model, messages };
    if (offerTools) body.tools = openAiToolSpec();

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
    const data = await res.json() as { choices?: { message?: Record<string, unknown> }[] };
    const message = data.choices?.[0]?.message;
    const calls = offerTools ? parseOpenAiToolCalls(message) : [];

    if (calls.length === 0) {
      const content = message?.content;
      // No tool calls and no text: the model has nothing more to say. If search
      // was in play this is the exhausted-loop case, which degrades rather than
      // failing the job.
      if (typeof content !== 'string' || !content) {
        if (webSearch) throw new ToolLoopExhaustedError('OpenRouter');
        throw new Error('OpenRouter hat keine Antwort geliefert');
      }
      return content;
    }

    // Echo the assistant turn back verbatim, then one tool result per call —
    // the API rejects a tool message that doesn't answer a preceding call.
    messages.push(message);
    for (const call of calls) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: await runWebSearchTool(call, search),
      });
    }
  }
  // The loop always returns or throws on its final iteration.
  throw new Error('OpenRouter hat keine Antwort geliefert');
}

export async function callGemini(
  config: AiConfig['gemini'],
  systemPrompt: string,
  userPrompt: string,
  webSearch: boolean,
  search: WebSearchConfig,
): Promise<string> {
  if (!config.apiKey) throw new Error('Gemini-API-Schlüssel fehlt');
  // "gemini-2.5-flash" is closed to new API keys — it answers 404 "no longer
  // available to new users", which made Gemini unusable out of the box on a
  // fresh install. The floating alias keeps working as Google retires versions.
  const model = config.model || 'gemini-flash-latest';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;

  // Our own tool rather than Gemini's googleSearch grounding, which is not in
  // the free tier and 429s on a free key (#120).
  const contents: unknown[] = [{ role: 'user', parts: [{ text: userPrompt }] }];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // See callOpenRouter: withdrawing the tools is not enough on its own.
    const lastRound = round === MAX_TOOL_ROUNDS;
    const offerTools = webSearch && !lastRound;
    if (lastRound && webSearch) contents.push({ role: 'user', parts: [{ text: FINAL_ROUND_NOTICE }] });
    const body: Record<string, unknown> = {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
    };
    if (offerTools) body.tools = geminiToolSpec();

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gemini-Fehler ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json() as { candidates?: { content?: { parts?: unknown[] } }[] };
    const parts = data.candidates?.[0]?.content?.parts;
    const calls = offerTools ? parseGeminiToolCalls(parts) : [];

    if (calls.length === 0) {
      const content = geminiText(parts);
      // A Gemini turn carrying only a (now unoffered) functionCall has no text
      // parts at all, so this is the shape the exhausted loop actually takes.
      if (!content) {
        if (webSearch) throw new ToolLoopExhaustedError('Gemini');
        throw new Error('Gemini hat keine Antwort geliefert');
      }
      return content;
    }

    contents.push({ role: 'model', parts });
    contents.push({
      role: 'user',
      parts: await Promise.all(calls.map(async (call) => ({
        functionResponse: {
          name: call.name,
          response: { results: await runWebSearchTool(call, search) },
        },
      }))),
    });
  }
  throw new Error('Gemini hat keine Antwort geliefert');
}

/**
 * Both providers bill web search separately from plain generation, and neither
 * includes it in their free tier — a free API key answers an ordinary request
 * fine but fails the same request with search enabled. Since every AI feature
 * here asks for research, that made the whole feature fail on exactly the keys
 * most users start with, and the surfaced error pointed at the wrong thing.
 *
 * The providers disagree on how they say it. Gemini uses 429/402. OpenRouter
 * lets the billed request through until the key's credit limit is spent and
 * then answers 403 "Key limit exceeded (total limit)" — a status that reads
 * like an auth failure but is purely about credit, and that a plain (unbilled)
 * call on the same key still passes. Matching 403 alone would swallow real
 * authorization failures, so it counts only alongside the limit wording.
 */
function isSearchQuotaError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  if (/\b(429|402)\b/.test(message)) return true;
  return /\b403\b/.test(message) && /limit exceeded/i.test(message);
}

interface LlmAnswer {
  text: string;
  /** False when the answer came from the model's own knowledge rather than
   *  from web research — either because the setting suppressed search, or
   *  because search was unavailable and we fell back. */
  webSearchUsed: boolean;
}

/**
 * Whether a web-researched answer is even attempted.
 *
 * Research now runs through our own server-side `web_search` tool, so this no
 * longer depends on the provider's plan at all — only on whether a search
 * backend is configured. "Nur kostenlose Modelle" stays free *and* researched.
 */
function webSearchAvailable(search: WebSearchConfig): boolean {
  return isWebSearchConfigured(search);
}

async function callLlm(
  config: AiConfig,
  search: WebSearchConfig,
  systemPrompt: string,
  userPrompt: string,
  webSearch = true,
): Promise<LlmAnswer> {
  const call = (useSearch: boolean) => config.provider === 'gemini'
    ? callGemini(config.gemini, systemPrompt, userPrompt, useSearch, search)
    : callOpenRouter(config.openrouter, systemPrompt, userPrompt, useSearch, search);

  const attemptSearch = webSearch && webSearchAvailable(search);
  if (!attemptSearch) return { text: await call(false), webSearchUsed: false };
  try {
    return { text: await call(true), webSearchUsed: true };
  } catch (e) {
    const exhausted = e instanceof ToolLoopExhaustedError;
    if (!exhausted && !isSearchQuotaError(e)) throw e;
    // A model that can't do tool calls at all, a provider-side limit, or one
    // that spent the whole tool budget without ever answering, should not sink
    // the job — retry plainly and mark the answer as unresearched.
    console.warn(exhausted
      ? '[ai] Werkzeug-Budget ohne Antwort aufgebraucht — Anfrage ohne Websuche wiederholt.'
      : '[ai] Werkzeug-Aufrufe nicht verfügbar — Anfrage ohne Websuche wiederholt.');
    return { text: await call(false), webSearchUsed: false };
  }
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

async function researchAutofill(config: AiConfig, search: WebSearchConfig, polish: { name: string; brand: string; num: string }): Promise<AutofillResult & { webSearchUsed: boolean }> {
  const canResearch = webSearchAvailable(search);
  const system = `Du bist ein Assistent, der Fakten zu Nagellacken ${canResearch ? 'recherchiert' : 'aus deinem Modellwissen beantwortet'}. ${canResearch ? '' : 'Du hast KEINEN Internetzugriff — schätze anhand dessen, was du über die Produktlinie weisst. '}Antworte AUSSCHLIESSLICH mit einem JSON-Objekt ohne weiteren Text im Format {"color": "#rrggbb", "finish": "<einer von: ${FINISH_VALUES.join(', ')}>"}. "color" ist die tatsächliche Lackfarbe als Hex-Code, "finish" die Oberflächenart.`;
  const user = `Nagellack: Name="${polish.name}", Nummer="${polish.num}", Hersteller="${polish.brand}". ${canResearch ? 'Recherchiere im Internet die tatsächliche' : 'Nenne die'} Farbe und das Finish dieses konkreten Lacks.`;
  const { text, webSearchUsed } = await callLlm(config, search, system, user, true);
  const parsed = extractJson(text) as Partial<AutofillResult>;
  const color = typeof parsed.color === 'string' && HEX_RE.test(parsed.color) ? parsed.color : '#ff6699';
  const finish = FINISH_VALUES.includes(parsed.finish as FinishType) ? (parsed.finish as FinishType) : 'Classic';
  return { color, finish, webSearchUsed };
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
  search: WebSearchConfig,
  prompt: string,
  collection: Polish[],
  cart: Polish[],
): Promise<{ suggestions: SmartCartSuggestion[]; webSearchUsed: boolean }> {
  const describe = (p: Polish) => `${p.brand} ${p.num} "${p.name}" (${p.color}, ${p.finish.join('/')})`;
  const collectionSummary = collection.map(describe).join('; ') || 'leer';
  const cartSummary = cart.map(describe).join('; ') || 'leer';

  const canResearch = webSearchAvailable(search);
  // Without web search the model cannot confirm a product exists. Demanding
  // "only confirmed-real products" anyway just pushes it to invent article
  // numbers that look verified — the worst outcome for a shopping list. Ask
  // for what it can actually deliver, and tell it to leave "num" empty rather
  // than guess one.
  const sourcing = canResearch
    ? 'und recherchiere im Internet nach ECHTEN, real existierenden Nagellackprodukten, die dazu passen. Schlage NUR Produkte vor, deren Existenz du durch Recherche bestätigen konntest — erfinde keine Produkte.'
    : 'und schlage anhand deines Modellwissens passende Produkte vor. Du hast KEINEN Internetzugriff und kannst nichts verifizieren: nenne nur Produktlinien, die du tatsächlich kennst, und lass "num" LEER, wenn du die genaue Artikelnummer nicht sicher weisst — rate keine Nummern.';
  const system = `Du bist ein Assistent für Nagellack-Kaufempfehlungen. Analysiere die bestehende Sammlung und den aktuellen Einkaufswagen des Nutzers, ermittle anhand des Nutzer-Prompts fehlende Eigenschaften (z.B. fehlende Farben), ${sourcing} Antworte AUSSCHLIESSLICH mit einem JSON-Array ohne weiteren Text im Format [{"name": "...", "brand": "...", "num": "...", "color": "#rrggbb", "finish": "<einer von: ${FINISH_VALUES.join(', ')}>"}]. Maximal 10 Vorschläge. Falls du keine passenden Produkte findest, gib ein leeres Array zurück.`;
  const user = `Bestehende Sammlung: ${collectionSummary}\nAktueller Einkaufswagen: ${cartSummary}\nAnfrage: ${prompt}`;

  const { text, webSearchUsed } = await callLlm(config, search, system, user, true);
  const parsed = extractJson(text);
  if (!Array.isArray(parsed)) return { suggestions: [], webSearchUsed };
  const suggestions = parsed
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
  return { suggestions, webSearchUsed };
}

// ── Job queue processing ──────────────────────────────────────────────────────
// Simple in-process, one-at-a-time queue — consistent with the existing
// setInterval-based report scheduler already in index.ts. Jobs are persisted to
// disk so pending work survives a restart.

let processing = false;

async function runJob(job: AiJob): Promise<void> {
  const config = getAiConfig();
  const search = config.webSearch;
  if (job.type === 'autofill') {
    const polish = job.input.polish;
    if (!polish) throw new Error('Lack-Daten fehlen');
    // The result is handed back via the job, not written to data.json here —
    // the client applies it to its own state and syncs, so this doesn't race
    // against the client's local edits/sync cycle.
    const result = await researchAutofill(config, search, polish);
    updateAiJob(job.id, { status: 'done', result });
  } else {
    const data = getData(job.username);
    const collection = data.polishes.filter((p) => !p.deletedAt && p.status !== 'wish');
    const cart = data.polishes.filter((p) => !p.deletedAt && p.status === 'wish');
    const { suggestions, webSearchUsed } = await researchSmartCart(config, search, job.input.prompt ?? '', collection, cart);
    const createdAt = Date.now();
    const newPolishes: Polish[] = suggestions.map((s) => ({
      id: uuidv4(),
      ...s,
      finish: [s.finish],
      status: 'wish',
      count: 1,
      categories: [],
      // Say plainly when a suggestion was never checked against the real
      // world, so an unverified article number isn't mistaken for a researched
      // one once it is sitting in the shopping cart.
      notes: webSearchUsed
        ? 'Von KI vorgeschlagen (Smart-Cart)'
        : 'Von KI vorgeschlagen (Smart-Cart) — ohne Web-Recherche, vor dem Kauf prüfen',
      rating: 0,
      createdAt,
      updatedAt: createdAt,
    }));
    // Re-read the current state right before writing — research above can take
    // tens of seconds, during which a concurrent client sync could have
    // written newer data; appending onto the stale `data` snapshot from the
    // start of this job would silently drop that.
    const latest = getData(job.username);
    setData(job.username, { ...latest, polishes: [...latest.polishes, ...newPolishes] });
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
