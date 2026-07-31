import { describe, it, expect } from 'vitest';
import {
  parseOpenAiToolCalls,
  parseGeminiToolCalls,
  geminiText,
  runWebSearchTool,
  openAiToolSpec,
  geminiToolSpec,
  WEB_SEARCH_TOOL_NAME,
  MAX_TOOL_ROUNDS,
} from './tooling';
import { DEFAULT_WEB_SEARCH, type FetchLike } from './websearch';

describe('tool specs', () => {
  it('offer web_search under the same name to both providers', () => {
    expect(openAiToolSpec()[0].function.name).toBe(WEB_SEARCH_TOOL_NAME);
    expect(geminiToolSpec()[0].functionDeclarations[0].name).toBe(WEB_SEARCH_TOOL_NAME);
  });

  it('declare query as a required string', () => {
    const params = openAiToolSpec()[0].function.parameters;
    expect(params.required).toEqual(['query']);
    expect(params.properties.query.type).toBe('string');
  });
});

describe('parseOpenAiToolCalls', () => {
  const call = (args: string, name = WEB_SEARCH_TOOL_NAME, id = 'c1') => ({
    tool_calls: [{ id, type: 'function', function: { name, arguments: args } }],
  });

  it('reads the query out of the JSON-string arguments', () => {
    expect(parseOpenAiToolCalls(call('{"query":"essie 162"}')))
      .toEqual([{ id: 'c1', name: WEB_SEARCH_TOOL_NAME, query: 'essie 162' }]);
  });

  it('returns nothing when the model just answered', () => {
    expect(parseOpenAiToolCalls({ content: 'hi' })).toEqual([]);
    expect(parseOpenAiToolCalls(undefined)).toEqual([]);
    expect(parseOpenAiToolCalls({ tool_calls: 'nope' })).toEqual([]);
  });

  it('drops a call whose arguments are not valid JSON instead of throwing', () => {
    expect(parseOpenAiToolCalls(call('{query: essie'))).toEqual([]);
  });

  it('ignores tools we did not offer', () => {
    expect(parseOpenAiToolCalls(call('{"query":"x"}', 'delete_everything'))).toEqual([]);
  });

  it('ignores an empty query', () => {
    expect(parseOpenAiToolCalls(call('{"query":"   "}'))).toEqual([]);
    expect(parseOpenAiToolCalls(call('{}'))).toEqual([]);
  });

  it('handles several calls in one turn', () => {
    const many = {
      tool_calls: [
        { id: 'a', function: { name: WEB_SEARCH_TOOL_NAME, arguments: '{"query":"one"}' } },
        { id: 'b', function: { name: WEB_SEARCH_TOOL_NAME, arguments: '{"query":"two"}' } },
      ],
    };
    expect(parseOpenAiToolCalls(many).map((c) => c.query)).toEqual(['one', 'two']);
  });
});

describe('parseGeminiToolCalls / geminiText', () => {
  it('reads args off a functionCall part', () => {
    const parts = [{ functionCall: { name: WEB_SEARCH_TOOL_NAME, args: { query: 'catrice rainbow' } } }];
    expect(parseGeminiToolCalls(parts)).toEqual([{ name: WEB_SEARCH_TOOL_NAME, query: 'catrice rainbow' }]);
  });

  it('returns nothing for a plain text answer', () => {
    expect(parseGeminiToolCalls([{ text: '{"color":"#fff"}' }])).toEqual([]);
    expect(parseGeminiToolCalls(undefined)).toEqual([]);
  });

  it('ignores an unknown function name', () => {
    expect(parseGeminiToolCalls([{ functionCall: { name: 'other', args: { query: 'x' } } }])).toEqual([]);
  });

  it('joins multi-part text', () => {
    expect(geminiText([{ text: '{"a":' }, { text: '1}' }])).toBe('{"a":1}');
    expect(geminiText(undefined)).toBe('');
  });
});

describe('runWebSearchTool', () => {
  const call = { name: WEB_SEARCH_TOOL_NAME, query: 'essie 162' };

  it('formats results for the model', async () => {
    const html = `<div class="result__body">`
      + `<a class="result__a" href="https://essie.com/162">Ballet Slippers</a>`
      + `<a class="result__snippet" href="/x">sheer pale pink</a></div>`;
    const f: FetchLike = async () => ({ ok: true, status: 200, text: async () => html, json: async () => ({}) });
    const out = await runWebSearchTool(call, { ...DEFAULT_WEB_SEARCH, backend: 'duckduckgo' }, f);
    expect(out).toContain('Ballet Slippers');
    expect(out).toContain('https://essie.com/162');
  });

  it('tells the model plainly when a dead backend returned nothing', async () => {
    const f: FetchLike = async () => { throw new Error('dns'); };
    const out = await runWebSearchTool(call, { ...DEFAULT_WEB_SEARCH, backend: 'duckduckgo' }, f);
    expect(out).toBe('Keine Suchergebnisse gefunden.');
  });
});

describe('MAX_TOOL_ROUNDS', () => {
  it('bounds the loop so a tool-happy model cannot spin forever', () => {
    expect(MAX_TOOL_ROUNDS).toBeGreaterThan(0);
    expect(MAX_TOOL_ROUNDS).toBeLessThanOrEqual(5);
  });
});
