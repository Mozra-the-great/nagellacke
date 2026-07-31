/**
 * The `web_search` tool the model can call, plus the provider-specific wire
 * shapes for offering it and reading back a call.
 *
 * Kept separate from ai.ts so the loop's decision logic can be tested without
 * a network or an API key: everything here is pure except `runWebSearchTool`,
 * which takes its own fetch.
 */
import type { WebSearchConfig, FetchLike } from './websearch';
import { searchWeb, formatResults } from './websearch';

export const WEB_SEARCH_TOOL_NAME = 'web_search';

const DESCRIPTION =
  'Sucht im Web und liefert Titel, URL und Textausschnitt der Treffer. '
  + 'Nutze das Tool, um zu prüfen, ob ein Nagellack-Produkt wirklich existiert, '
  + 'und um Farbe, Finish und Artikelnummer zu belegen. Mehrere Suchen sind erlaubt.';

const PARAMETERS = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Die Suchanfrage, z.B. "Essie 162 Ballet Slippers Farbe"' },
  },
  required: ['query'],
} as const;

/** OpenAI-compatible tool definition (OpenRouter). */
export function openAiToolSpec() {
  return [{
    type: 'function',
    function: { name: WEB_SEARCH_TOOL_NAME, description: DESCRIPTION, parameters: PARAMETERS },
  }];
}

/** Gemini function-declaration tool definition. */
export function geminiToolSpec() {
  return [{
    functionDeclarations: [{ name: WEB_SEARCH_TOOL_NAME, description: DESCRIPTION, parameters: PARAMETERS }],
  }];
}

export interface ToolCall {
  /** Provider-assigned id; absent for Gemini, which matches on name instead. */
  id?: string;
  name: string;
  query: string;
}

/**
 * Reads tool calls out of an OpenAI-style message. Arguments arrive as a JSON
 * *string*, and a model can emit malformed JSON — a bad call is dropped rather
 * than failing the whole job.
 */
export function parseOpenAiToolCalls(message: unknown): ToolCall[] {
  const calls = (message as { tool_calls?: unknown[] })?.tool_calls;
  if (!Array.isArray(calls)) return [];
  const out: ToolCall[] = [];
  for (const c of calls) {
    const call = c as { id?: string; function?: { name?: string; arguments?: string } };
    const name = call.function?.name;
    if (name !== WEB_SEARCH_TOOL_NAME) continue;
    let query = '';
    try {
      query = String((JSON.parse(call.function?.arguments || '{}') as { query?: unknown }).query ?? '');
    } catch {
      continue;
    }
    if (query.trim()) out.push({ id: call.id, name, query });
  }
  return out;
}

/** Reads tool calls out of a Gemini candidate's parts. */
export function parseGeminiToolCalls(parts: unknown): ToolCall[] {
  if (!Array.isArray(parts)) return [];
  const out: ToolCall[] = [];
  for (const p of parts) {
    const fc = (p as { functionCall?: { name?: string; args?: { query?: unknown } } })?.functionCall;
    if (!fc || fc.name !== WEB_SEARCH_TOOL_NAME) continue;
    const query = String(fc.args?.query ?? '');
    if (query.trim()) out.push({ name: fc.name, query });
  }
  return out;
}

/** Concatenated text parts of a Gemini candidate. */
export function geminiText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (p as { text?: string })?.text ?? '').join('');
}

/**
 * Executes one tool call. Returns text for the model — never throws, so a dead
 * search backend costs a turn rather than the job.
 */
export async function runWebSearchTool(
  call: ToolCall,
  config: WebSearchConfig,
  doFetch?: FetchLike,
): Promise<string> {
  const results = await searchWeb(call.query, config, doFetch);
  return formatResults(results);
}

/**
 * How many model turns may request tools before we demand a final answer.
 * Each round is a full completion, so this bounds both latency and — on a paid
 * model — cost.
 */
export const MAX_TOOL_ROUNDS = 3;
