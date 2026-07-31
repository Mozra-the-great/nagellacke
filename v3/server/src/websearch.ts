/**
 * Server-side web search, exposed to the LLM as a callable tool.
 *
 * Both providers sell web search as a billed add-on — OpenRouter's `web` plugin
 * costs ~$0.005 per request even when the model itself is free (#125), and
 * Gemini's grounding is not in the free tier at all. Running the search here
 * instead keeps research available on a free key, and keeps what gets searched
 * visible in this repo rather than inside a provider's black box.
 */

/** Minimal fetch shape, injectable so the parsing can be tested offline. */
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchBackend = 'duckduckgo' | 'searxng' | 'brave' | 'off';

export interface WebSearchConfig {
  backend: SearchBackend;
  /** Base URL of a self-hosted SearXNG instance, e.g. https://searx.example.org */
  searxngUrl: string;
  /** Brave Search API key. Brave is the only backend here that needs one. */
  braveApiKey: string;
}

export const DEFAULT_WEB_SEARCH: WebSearchConfig = {
  backend: 'duckduckgo',
  searxngUrl: '',
  braveApiKey: '',
};

const MAX_RESULTS = 6;
const TIMEOUT_MS = 12_000;
/** Snippets go straight into the model's context; cap them so a hostile or
 *  merely verbose page can't crowd out the actual instructions. */
const MAX_SNIPPET = 300;
const MAX_TITLE = 200;

export function isWebSearchConfigured(config: WebSearchConfig): boolean {
  switch (config.backend) {
    case 'duckduckgo': return true;            // no key, no setup
    case 'searxng':    return !!config.searxngUrl;
    case 'brave':      return !!config.braveApiKey;
    case 'off':        return false;
  }
}

function clean(s: string, max: number): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent: string) => {
      // NOTE: entities are decoded *after* tag stripping, so an encoded
      // "&lt;b&gt;" turns back into markup here. The second strip below
      // removes it. Decoding first would be worse: it would let encoded
      // markup through as if it had been in the source.
      const named: Record<string, string> = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
      };
      if (named[ent] !== undefined) return named[ent];
      if (ent.startsWith('#x') || ent.startsWith('#X')) return String.fromCharCode(parseInt(ent.slice(2), 16));
      if (ent.startsWith('#')) return String.fromCharCode(parseInt(ent.slice(1), 10));
      return m;
    })
    // Second pass: removes markup that only existed in encoded form, and any
    // stray angle brackets. The result goes into a prompt as plain text.
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * DuckDuckGo redirects outbound links through /l/?uddg=<encoded>. Unwrap so the
 * model sees the real destination.
 */
export function unwrapDuckDuckGoUrl(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (!m) return href.startsWith('//') ? `https:${href}` : href;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return href;
  }
}

/** Parses DuckDuckGo's HTML-only endpoint. Exported for testing. */
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  // Each result is an <a class="result__a" href="...">title</a> followed
  // somewhere by an <a class="result__snippet">snippet</a>.
  const blocks = html.split(/class="result__body"|class="result results_links/);
  for (const block of blocks.slice(1)) {
    const link = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const snippet = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    const url = unwrapDuckDuckGoUrl(link[1]);
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      title: clean(link[2], MAX_TITLE),
      url,
      snippet: snippet ? clean(snippet[1], MAX_SNIPPET) : '',
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/** Parses SearXNG's JSON API. Exported for testing. */
export function parseSearxngJson(payload: unknown): SearchResult[] {
  const results = (payload as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      title: clean(String(r.title ?? ''), MAX_TITLE),
      url: String(r.url ?? ''),
      snippet: clean(String(r.content ?? ''), MAX_SNIPPET),
    }))
    .filter((r) => /^https?:\/\//i.test(r.url))
    .slice(0, MAX_RESULTS);
}

/** Parses Brave's Search API JSON. Exported for testing. */
export function parseBraveJson(payload: unknown): SearchResult[] {
  const results = (payload as { web?: { results?: unknown[] } })?.web?.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      title: clean(String(r.title ?? ''), MAX_TITLE),
      url: String(r.url ?? ''),
      snippet: clean(String(r.description ?? ''), MAX_SNIPPET),
    }))
    .filter((r) => /^https?:\/\//i.test(r.url))
    .slice(0, MAX_RESULTS);
}

/**
 * Runs one search. Never throws: research is an enhancement, so a failing
 * backend degrades to "no results" and the caller answers from model knowledge
 * rather than failing the whole job.
 */
export async function searchWeb(
  query: string,
  config: WebSearchConfig,
  doFetch: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q || !isWebSearchConfigured(config)) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    switch (config.backend) {
      case 'duckduckgo': {
        const res = await doFetch(
          `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
          {
            // The HTML endpoint returns an empty page without a browser-ish UA.
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nagellacke/1.0)' },
            signal: controller.signal,
          },
        );
        if (!res.ok) return [];
        return parseDuckDuckGoHtml(await res.text());
      }
      case 'searxng': {
        const base = config.searxngUrl.replace(/\/$/, '');
        const res = await doFetch(
          `${base}/search?q=${encodeURIComponent(q)}&format=json`,
          { headers: { Accept: 'application/json' }, signal: controller.signal },
        );
        if (!res.ok) return [];
        return parseSearxngJson(await res.json());
      }
      case 'brave': {
        const res = await doFetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${MAX_RESULTS}`,
          {
            headers: { Accept: 'application/json', 'X-Subscription-Token': config.braveApiKey },
            signal: controller.signal,
          },
        );
        if (!res.ok) return [];
        return parseBraveJson(await res.json());
      }
      case 'off':
        return [];
    }
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Renders results for the model. Kept deliberately plain: search snippets are
 * attacker-influenceable text, so they are labelled as quoted search output
 * rather than blended into the instructions.
 */
export function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return 'Keine Suchergebnisse gefunden.';
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
    .join('\n\n');
}
