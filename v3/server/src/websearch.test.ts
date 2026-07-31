import { describe, it, expect, vi } from 'vitest';
import {
  parseDuckDuckGoHtml,
  isDuckDuckGoChallenge,
  parseSearxngJson,
  parseBraveJson,
  unwrapDuckDuckGoUrl,
  isWebSearchConfigured,
  formatResults,
  searchWeb,
  DEFAULT_WEB_SEARCH,
  type FetchLike,
  type WebSearchConfig,
} from './websearch';

// A trimmed but structurally faithful sample of DuckDuckGo's HTML endpoint.
const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <div class="result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.essie.com%2Fnail-polish%2F162&amp;rut=abc">Essie 162 &amp;ndash; Ballet Slippers</a>
    </h2>
    <a class="result__snippet" href="/x">A sheer pale pink with a <b>classic</b> finish.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result">
  <div class="result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb">Second   result</a>
    </h2>
    <a class="result__snippet" href="/y">Snippet two</a>
  </div>
</div>`;

/**
 * Verbatim excerpt of what html.duckduckgo.com actually returns when it decides
 * a request is automated: HTTP 202 — a *success* status — with this page in
 * place of results.
 */
const DDG_CHALLENGE = `
<!DOCTYPE html>
<html lang="en">
<head><title>DuckDuckGo</title></head>
<body>
  <form id="challenge-form" action="//duckduckgo.com/anomaly.js?sv=html&cc=botnet&st=1785479667" method="POST">
    <div class="anomaly-modal__mask">
      <div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div>
      <div class="anomaly-modal__description">Please complete the following challenge to confirm this search was made by a human.</div>
      <div class="anomaly-modal__instructions">Select all squares containing a duck:</div>
    </div>
  </form>
</body>
</html>`;

function fakeFetch(body: string | object, ok = true, status = 200): FetchLike {
  return async () => ({
    ok,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  });
}

describe('unwrapDuckDuckGoUrl', () => {
  it('unwraps the redirect and decodes the destination', () => {
    expect(unwrapDuckDuckGoUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.essie.com%2Fx&rut=z'))
      .toBe('https://www.essie.com/x');
  });

  it('leaves a direct link alone, fixing only a protocol-relative prefix', () => {
    expect(unwrapDuckDuckGoUrl('//example.com/a')).toBe('https://example.com/a');
    expect(unwrapDuckDuckGoUrl('https://example.com/a')).toBe('https://example.com/a');
  });
});

describe('parseDuckDuckGoHtml', () => {
  const results = parseDuckDuckGoHtml(DDG_HTML);

  it('extracts every result', () => {
    expect(results).toHaveLength(2);
  });

  it('decodes entities and collapses whitespace in titles', () => {
    expect(results[0].title).toBe('Essie 162 &ndash; Ballet Slippers');
    expect(results[1].title).toBe('Second result');
  });

  it('strips highlight markup from snippets', () => {
    expect(results[0].snippet).toBe('A sheer pale pink with a classic finish.');
  });

  it('does not let encoded markup survive as markup', () => {
    // Decoding runs after tag-stripping, so "&lt;b&gt;" becomes a real tag
    // mid-pipeline; it must not reach the model's context as one.
    const html = `<div class="result__body">`
      + `<a class="result__a" href="https://e.com">t</a>`
      + `<a class="result__snippet" href="/x">a &lt;script&gt;alert(1)&lt;/script&gt; b</a></div>`;
    const [r] = parseDuckDuckGoHtml(html);
    expect(r.snippet).not.toContain('<');
    expect(r.snippet).not.toContain('>');
    expect(r.snippet).toBe('a alert(1) b');
  });

  it('resolves the real destination url', () => {
    expect(results[0].url).toBe('https://www.essie.com/nail-polish/162');
  });

  it('returns nothing for an empty or unexpected page', () => {
    expect(parseDuckDuckGoHtml('')).toEqual([]);
    expect(parseDuckDuckGoHtml('<html><body>no results</body></html>')).toEqual([]);
  });

  it('drops entries whose href is not http(s)', () => {
    const html = `<div class="result__body"><a class="result__a" href="javascript:alert(1)">x</a></div>`;
    expect(parseDuckDuckGoHtml(html)).toEqual([]);
  });
});

describe('isDuckDuckGoChallenge', () => {
  it('recognises the real bot-check page', () => {
    expect(isDuckDuckGoChallenge(DDG_CHALLENGE)).toBe(true);
  });

  it('does not fire on an ordinary result page or an empty one', () => {
    expect(isDuckDuckGoChallenge(DDG_HTML)).toBe(false);
    expect(isDuckDuckGoChallenge('')).toBe(false);
  });

  it('the challenge would otherwise pass as a result-less search', () => {
    // This is why the check exists at all: the page parses cleanly to zero
    // results, so nothing downstream could tell it apart from "no hits".
    expect(parseDuckDuckGoHtml(DDG_CHALLENGE)).toEqual([]);
  });
});

describe('parseSearxngJson / parseBraveJson', () => {
  it('maps SearXNG fields', () => {
    const r = parseSearxngJson({ results: [{ title: 'T', url: 'https://e.com', content: 'C' }] });
    expect(r).toEqual([{ title: 'T', url: 'https://e.com', snippet: 'C' }]);
  });

  it('maps Brave fields', () => {
    const r = parseBraveJson({ web: { results: [{ title: 'T', url: 'https://e.com', description: 'D' }] } });
    expect(r).toEqual([{ title: 'T', url: 'https://e.com', snippet: 'D' }]);
  });

  it('survives a malformed payload', () => {
    expect(parseSearxngJson(null)).toEqual([]);
    expect(parseSearxngJson({ results: 'nope' })).toEqual([]);
    expect(parseBraveJson({})).toEqual([]);
    expect(parseBraveJson({ web: { results: [null, 3] } })).toEqual([]);
  });

  it('drops non-http urls', () => {
    expect(parseSearxngJson({ results: [{ title: 'x', url: 'file:///etc/passwd' }] })).toEqual([]);
  });
});

describe('isWebSearchConfigured', () => {
  it('needs no setup for duckduckgo, a url for searxng, a key for brave', () => {
    expect(isWebSearchConfigured({ ...DEFAULT_WEB_SEARCH, backend: 'duckduckgo' })).toBe(true);
    expect(isWebSearchConfigured({ ...DEFAULT_WEB_SEARCH, backend: 'searxng' })).toBe(false);
    expect(isWebSearchConfigured({ ...DEFAULT_WEB_SEARCH, backend: 'searxng', searxngUrl: 'https://s.example' })).toBe(true);
    expect(isWebSearchConfigured({ ...DEFAULT_WEB_SEARCH, backend: 'brave' })).toBe(false);
    expect(isWebSearchConfigured({ ...DEFAULT_WEB_SEARCH, backend: 'brave', braveApiKey: 'k' })).toBe(true);
    expect(isWebSearchConfigured({ ...DEFAULT_WEB_SEARCH, backend: 'off' })).toBe(false);
  });
});

describe('searchWeb', () => {
  const ddg: WebSearchConfig = { ...DEFAULT_WEB_SEARCH, backend: 'duckduckgo' };

  it('returns parsed results for a successful search', async () => {
    const r = await searchWeb('essie 162', ddg, fakeFetch(DDG_HTML));
    expect(r).toHaveLength(2);
  });

  it('returns nothing for a bot check served with a 2xx status', async () => {
    // 202, not an error status — `res.ok` is true, so only the body gives it
    // away.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await searchWeb('essie 162', ddg, fakeFetch(DDG_CHALLENGE, true, 202))).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Bot-Pruefung'));
    warn.mockRestore();
  });

  it('degrades to empty rather than throwing when the backend errors', async () => {
    expect(await searchWeb('x', ddg, fakeFetch('', false, 503))).toEqual([]);
    const boom: FetchLike = async () => { throw new Error('network down'); };
    expect(await searchWeb('x', ddg, boom)).toEqual([]);
  });

  it('does not call out at all when unconfigured or given a blank query', async () => {
    const spy = vi.fn(fakeFetch(DDG_HTML));
    expect(await searchWeb('   ', ddg, spy as unknown as FetchLike)).toEqual([]);
    expect(await searchWeb('x', { ...DEFAULT_WEB_SEARCH, backend: 'off' }, spy as unknown as FetchLike)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('sends the query to the configured backend', async () => {
    const seen: string[] = [];
    const spy: FetchLike = async (url) => {
      seen.push(url);
      return { ok: true, status: 200, text: async () => DDG_HTML, json: async () => ({ results: [] }) };
    };
    await searchWeb('essie 162', ddg, spy);
    await searchWeb('essie 162', { ...DEFAULT_WEB_SEARCH, backend: 'searxng', searxngUrl: 'https://s.example/' }, spy);
    expect(seen[0]).toContain('duckduckgo.com/html/?q=essie%20162');
    // trailing slash on the configured base must not double up
    expect(seen[1]).toBe('https://s.example/search?q=essie%20162&format=json');
  });
});

describe('formatResults', () => {
  it('numbers results and keeps urls visible', () => {
    const out = formatResults([{ title: 'T', url: 'https://e.com', snippet: 'S' }]);
    expect(out).toBe('[1] T\nhttps://e.com\nS');
  });

  it('says so explicitly when there is nothing', () => {
    expect(formatResults([])).toBe('Keine Suchergebnisse gefunden.');
  });
});
