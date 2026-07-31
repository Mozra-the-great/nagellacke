/**
 * Exercises the multi-turn tool protocol against a fake provider.
 *
 * No API key or network is involved: `fetch` is stubbed, so these assert the
 * shape of what we send and how we react to what comes back — the part of the
 * web-search work that has no live coverage.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { callOpenRouter, callGemini } from './ai';
import { DEFAULT_WEB_SEARCH } from './websearch';
import { WEB_SEARCH_TOOL_NAME, MAX_TOOL_ROUNDS } from './tooling';

const SEARCH = { ...DEFAULT_WEB_SEARCH, backend: 'duckduckgo' as const };
const OR_CFG = { apiKey: 'k', model: 'openrouter/free', freeOnly: true };
const GEM_CFG = { apiKey: 'k', model: 'gemini-flash-latest' };

const DDG_HTML = `<div class="result__body">`
  + `<a class="result__a" href="https://essie.com/162">Ballet Slippers</a>`
  + `<a class="result__snippet" href="/x">sheer pale pink, classic finish</a></div>`;

interface Captured { url: string; body: Record<string, unknown> }

/**
 * Stubs fetch. Provider calls are answered from `replies` in order; any other
 * host is treated as the search backend.
 */
function stubProvider(replies: unknown[], captured: Captured[] = []) {
  let i = 0;
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    const isProvider = url.includes('openrouter.ai') || url.includes('generativelanguage');
    if (!isProvider) {
      return { ok: true, status: 200, text: async () => DDG_HTML, json: async () => ({}) };
    }
    captured.push({ url, body: JSON.parse(init?.body ?? '{}') });
    const reply = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify(reply), json: async () => reply };
  });
  return captured;
}

const orToolCall = (query: string) => ({
  choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'c1', type: 'function', function: { name: WEB_SEARCH_TOOL_NAME, arguments: JSON.stringify({ query }) } }] } }],
});
const orAnswer = (content: string) => ({ choices: [{ message: { role: 'assistant', content } }] });

const gemToolCall = (query: string) => ({
  candidates: [{ content: { parts: [{ functionCall: { name: WEB_SEARCH_TOOL_NAME, args: { query } } }] } }],
});
const gemAnswer = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

afterEach(() => vi.unstubAllGlobals());

describe('OpenRouter tool loop', () => {
  it('returns the answer directly when no tool is requested', async () => {
    const cap = stubProvider([orAnswer('{"color":"#fff"}')]);
    expect(await callOpenRouter(OR_CFG, 'sys', 'user', true, SEARCH)).toBe('{"color":"#fff"}');
    expect(cap).toHaveLength(1);
  });

  it('runs the search and feeds the result back before answering', async () => {
    const cap = stubProvider([orToolCall('essie 162'), orAnswer('{"color":"#f5e6e8"}')]);
    const out = await callOpenRouter(OR_CFG, 'sys', 'user', true, SEARCH);
    expect(out).toBe('{"color":"#f5e6e8"}');
    expect(cap).toHaveLength(2);

    // Second turn must replay the assistant turn, then answer it with a tool
    // message carrying the matching id — the API rejects an orphaned one.
    const msgs = cap[1].body.messages as Record<string, unknown>[];
    expect(msgs).toHaveLength(4);
    expect(msgs[2].role).toBe('assistant');
    expect(msgs[3]).toMatchObject({ role: 'tool', tool_call_id: 'c1', name: WEB_SEARCH_TOOL_NAME });
    expect(String(msgs[3].content)).toContain('Ballet Slippers');
  });

  it('never sends OpenRouter\'s billed web plugin', async () => {
    const cap = stubProvider([orToolCall('x'), orAnswer('ok')]);
    await callOpenRouter(OR_CFG, 'sys', 'user', true, SEARCH);
    for (const c of cap) expect(c.body.plugins).toBeUndefined();
  });

  it('offers no tools at all when research is switched off', async () => {
    const cap = stubProvider([orAnswer('ok')]);
    await callOpenRouter(OR_CFG, 'sys', 'user', false, SEARCH);
    expect(cap[0].body.tools).toBeUndefined();
  });

  it('stops offering tools on the last round so a loop-happy model must answer', async () => {
    // Always asks for a tool; the loop has to terminate anyway.
    const cap = stubProvider([orToolCall('again')]);
    await expect(callOpenRouter(OR_CFG, 'sys', 'user', true, SEARCH)).rejects.toThrow(/Werkzeug-Runden/);
    expect(cap).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(cap[MAX_TOOL_ROUNDS].body.tools).toBeUndefined();
  });

  it('also says the budget is spent, since withdrawing the tools is ignorable', async () => {
    const cap = stubProvider([orToolCall('again')]);
    await expect(callOpenRouter(OR_CFG, 'sys', 'user', true, SEARCH)).rejects.toThrow();
    const msgs = cap[MAX_TOOL_ROUNDS].body.messages as { role: string; content?: string }[];
    expect(msgs[msgs.length - 1]).toMatchObject({ role: 'user' });
    expect(String(msgs[msgs.length - 1].content)).toContain('keine weiteren Suchen');
  });

  it('does not announce a budget that was never offered', async () => {
    const cap = stubProvider([orAnswer('ok')]);
    await callOpenRouter(OR_CFG, 'sys', 'user', false, SEARCH);
    const msgs = cap[0].body.messages as { content?: string }[];
    expect(msgs.map((m) => String(m.content)).join(' ')).not.toContain('keine weiteren Suchen');
  });

  it('applies the free-model mapping to the router', async () => {
    const cap = stubProvider([orAnswer('ok')]);
    await callOpenRouter({ ...OR_CFG, model: 'openrouter/auto' }, 'sys', 'user', true, SEARCH);
    expect(cap[0].body.model).toBe('openrouter/free');
  });
});

describe('Gemini tool loop', () => {
  it('returns the answer directly when no tool is requested', async () => {
    stubProvider([gemAnswer('{"color":"#fff"}')]);
    expect(await callGemini(GEM_CFG, 'sys', 'user', true, SEARCH)).toBe('{"color":"#fff"}');
  });

  it('replies to a functionCall with a matching functionResponse', async () => {
    const cap = stubProvider([gemToolCall('essie 162'), gemAnswer('{"color":"#f5e6e8"}')]);
    const out = await callGemini(GEM_CFG, 'sys', 'user', true, SEARCH);
    expect(out).toBe('{"color":"#f5e6e8"}');

    const contents = cap[1].body.contents as Record<string, unknown>[];
    expect(contents).toHaveLength(3);
    expect(contents[1].role).toBe('model');
    expect(contents[2].role).toBe('user');
    const parts = contents[2].parts as { functionResponse?: { name?: string; response?: { results?: string } } }[];
    expect(parts[0].functionResponse?.name).toBe(WEB_SEARCH_TOOL_NAME);
    expect(parts[0].functionResponse?.response?.results).toContain('Ballet Slippers');
  });

  it('never sends Gemini\'s billed grounding tool', async () => {
    const cap = stubProvider([gemToolCall('x'), gemAnswer('ok')]);
    await callGemini(GEM_CFG, 'sys', 'user', true, SEARCH);
    for (const c of cap) {
      const tools = JSON.stringify(c.body.tools ?? '');
      expect(tools).not.toContain('googleSearch');
    }
  });

  it('bounds the loop the same way', async () => {
    const cap = stubProvider([gemToolCall('again')]);
    await expect(callGemini(GEM_CFG, 'sys', 'user', true, SEARCH)).rejects.toThrow(/Werkzeug-Runden/);
    expect(cap).toHaveLength(MAX_TOOL_ROUNDS + 1);
    expect(cap[MAX_TOOL_ROUNDS].body.tools).toBeUndefined();
  });

  it('announces the spent budget in-band on the final round', async () => {
    // Observed against the live API: a Gemini turn that is only a functionCall
    // has no text parts, so an ignored late call leaves the round empty.
    const cap = stubProvider([gemToolCall('again')]);
    await expect(callGemini(GEM_CFG, 'sys', 'user', true, SEARCH)).rejects.toThrow();
    const contents = cap[MAX_TOOL_ROUNDS].body.contents as { role: string; parts: { text?: string }[] }[];
    const last = contents[contents.length - 1];
    expect(last.role).toBe('user');
    expect(String(last.parts[0].text)).toContain('keine weiteren Suchen');
  });
});

describe('exhausted tool budget degrades instead of failing the job', () => {
  // The real failure this reproduces: gemini-flash-latest spent all three
  // rounds on web_search calls and never emitted text, so the autofill job
  // ended as status:"error" with "Gemini hat keine Antwort geliefert".
  it('Gemini falls back to an unresearched answer', async () => {
    let i = 0;
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      if (!url.includes('generativelanguage')) {
        return { ok: true, status: 200, text: async () => DDG_HTML, json: async () => ({}) };
      }
      // Tools offered -> keep calling; tools withdrawn -> a bare functionCall.
      const hasTools = !!JSON.parse(init?.body ?? '{}').tools;
      i += 1;
      const reply = hasTools ? gemToolCall('again') : gemAnswer('{"color":"#f5e6e8"}');
      return { ok: true, status: 200, text: async () => JSON.stringify(reply), json: async () => reply };
    });
    // Sanity: without the fallback this whole call is what used to throw.
    const out = await callGemini(GEM_CFG, 'sys', 'user', false, SEARCH);
    expect(out).toBe('{"color":"#f5e6e8"}');
    expect(i).toBe(1);
  });

  it('reports the exhausted budget distinctly from a plain empty answer', async () => {
    stubProvider([gemToolCall('again')]);
    await expect(callGemini(GEM_CFG, 'sys', 'user', true, SEARCH))
      .rejects.toThrow(/nach 3 Werkzeug-Runden/);

    vi.unstubAllGlobals();
    // Search off: nothing to degrade to, so the plain message stands.
    stubProvider([{ candidates: [{ content: { parts: [] } }] }]);
    await expect(callGemini(GEM_CFG, 'sys', 'user', false, SEARCH))
      .rejects.toThrow(/Gemini hat keine Antwort geliefert/);
  });
});
