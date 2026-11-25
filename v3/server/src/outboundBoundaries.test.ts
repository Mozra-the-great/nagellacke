/**
 * #498: the SSRF guard (#401) at its edges. outbound.test.ts proves the guard works on
 * typical addresses; this file pins where each range starts and stops, every message,
 * the fallbacks and the limits - the places a one-character slip would open or close
 * a door without a typical-case test noticing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as dns from 'node:dns';
import * as net from 'node:net';
import { PassThrough } from 'node:stream';
import {
  OutboundBlockedError, assertPublicOutboundUrl, collectBody, createGuardedFetch, createGuardedLookup,
  isBlockedIp, parseOutboundUrl, type RequestOnce,
} from './outbound';

// The policy, written out a second time on purpose: changing it must mean changing this list too.
const V4_BLOCKED: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const V6_BLOCKED: readonly (readonly [string, number])[] = [
  ['::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
];

const v4ToNum = (ip: string): number => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const numToV4 = (n: number): string => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

function v6ToBig(ip: string): bigint {
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t];
  return groups.reduce((n, g) => (n << 16n) | BigInt(parseInt(g, 16)), 0n);
}
const bigToV6 = (n: bigint): string => Array.from({ length: 8 }, (_, i) => ((n >> BigInt((7 - i) * 16)) & 0xffffn).toString(16)).join(':');

describe('IPv4 ranges, edge by edge', () => {
  const expected = (ip: string): boolean => {
    const n = v4ToNum(ip);
    return V4_BLOCKED.some(([base, bits]) => n >= v4ToNum(base) && n < v4ToNum(base) + 2 ** (32 - bits));
  };

  it.each(V4_BLOCKED.map(([base, bits]) => [base, bits] as const))('%s/%i: blocked from its first to its last address, open on both sides unless a neighbour covers it', (base, bits) => {
    const first = v4ToNum(base);
    const last = first + 2 ** (32 - bits) - 1;
    for (const n of [first, first + 1, Math.floor((first + last) / 2), last - 1, last]) {
      expect(isBlockedIp(numToV4(n))).toBe(true);
    }
    for (const n of [first - 1, last + 1]) {
      if (n < 0 || n > 0xffffffff) continue;
      expect(isBlockedIp(numToV4(n))).toBe(expected(numToV4(n)));
    }
  });

  it.each([
    '1.1.1.1', '8.8.8.8', '9.255.255.255', '11.0.0.0', '100.63.255.255', '100.128.0.0', '126.255.255.255', '128.0.0.0',
    '169.253.255.255', '169.255.0.0', '172.15.255.255', '172.32.0.0', '191.255.255.255', '192.0.1.0', '192.0.3.0',
    '192.88.98.255', '192.88.100.0', '192.167.255.255', '192.169.0.0', '198.17.255.255', '198.20.0.0', '198.51.99.255',
    '198.51.101.0', '203.0.112.255', '203.0.114.0', '223.255.255.255', '93.184.216.34',
  ])('leaves the public address %s open', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it('treats a string that is no IP literal as blocked, whatever it looks like', () => {
    for (const bad of ['', 'localhost', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-4', '01.2.3.4', '1.2.3.4 ', ' 1.2.3.4', 'a.b.c.d', '::g', '1:2:3:4:5:6:7:8:9', ':::']) {
      expect(isBlockedIp(bad)).toBe(true);
    }
  });
});

describe('IPv6 ranges, edge by edge', () => {
  const inRange = (ip: string): boolean => {
    const v = v6ToBig(ip);
    return V6_BLOCKED.some(([base, bits]) => (v >> BigInt(128 - bits)) === (v6ToBig(base) >> BigInt(128 - bits)));
  };

  it.each(V6_BLOCKED.map(([base, bits]) => [base, bits] as const))('%s/%i: blocked from its first to its last address', (base, bits) => {
    const first = v6ToBig(base);
    const last = first + (1n << BigInt(128 - bits)) - 1n;
    for (const n of [first, first + 1n, (first + last) / 2n, last - 1n, last]) {
      expect(isBlockedIp(bigToV6(n))).toBe(true);
    }
    // The neighbours are open unless another blocked range or an embedded IPv4 verdict covers them.
    for (const n of [first - 1n, last + 1n]) {
      if (n < 0n || n >= (1n << 128n)) continue;
      const ip = bigToV6(n);
      const embedded = ip.startsWith('0:0:0:0:0:ffff:') || ip.startsWith('64:ff9b:0:0:0:0:') || ip.startsWith('2002:');
      if (!embedded) expect(isBlockedIp(ip)).toBe(inRange(ip));
    }
  });

  it.each([
    '2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '2001:4860:4860::8888', '2001:1::1', '2001:db9::1',
    '2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', '2000::1', 'fe00::1', 'fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    'fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '::1:0:0', '0:0:0:0:0:1:0:0', '100:0:0:1::', '64:ff9b:2::1',
  ])('leaves the public address %s open', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it('reads a "::" that stands for exactly one group, and an address written out in full', () => {
    expect(isBlockedIp('2606:4700:4700:1:1:1:1::')).toBe(false); // :: is one group
    expect(isBlockedIp('2606:4700:4700:0:0:0:0:1111')).toBe(false); // no :: at all
    expect(isBlockedIp('0:0:0:0:0:0:0:1')).toBe(true); // loopback, written out
    expect(isBlockedIp('0:0:0:0:0:0:0:0')).toBe(true);
    expect(isBlockedIp('fe80:0:0:0:0:0:0:1')).toBe(true);
    expect(isBlockedIp('1::')).toBe(false);
    expect(isBlockedIp('::2606:4700')).toBe(true); // ::/96 ends with 32 bits of anything
  });

  it('ignores a zone id when judging the address', () => {
    expect(isBlockedIp('2606:4700:4700::1111%eth0')).toBe(false);
    expect(isBlockedIp('fe80::1%eth0')).toBe(true);
    expect(isBlockedIp('::1%lo')).toBe(true);
  });

  it('judges an address that embeds an IPv4 one by the embedded address, in all three carriers and both notations', () => {
    const cases: [string, boolean][] = [
      ['::ffff:8.8.8.8', false], ['::ffff:808:808', false], ['::ffff:127.0.0.1', true], ['::ffff:7f00:1', true],
      ['::ffff:100.64.0.1', true], ['::ffff:100.63.255.255', false],
      ['64:ff9b::8.8.8.8', false], ['64:ff9b::808:808', false], ['64:ff9b::127.0.0.1', true], ['64:ff9b::a00:1', true],
      ['2002:808:808::1', false], ['2002:808:808::', false], ['2002:7f00:1::1', true], ['2002:a00:1::', true],
      ['2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true], // 255.255.255.255 inside 6to4
      ['2002:c0a8:101::1', true], ['2002:c0a7:ffff::1', false],
      // the carrier prefix decides: one group off and it is an ordinary address again
      ['::fffe:127.0.0.1', true], // ::/96 does not cover it, but the 0:0:0:0:0:fffe prefix is not mapped either
      ['::1:ffff:7f00:1', false],
    ];
    for (const [ip, blocked] of cases) {
      // ::fffe:... is outside every embedded carrier but also outside ::/96 (its group 5 is nonzero): open
      const want = ip === '::fffe:127.0.0.1' ? false : blocked;
      expect(isBlockedIp(ip), ip).toBe(want);
    }
  });

  it('takes the last 32 bits of a mapped address as the IPv4 one, in the right byte order', () => {
    expect(isBlockedIp('::ffff:0a00:0001')).toBe(true); // 10.0.0.1
    expect(isBlockedIp('::ffff:0001:000a')).toBe(true); // 0.1.0.10: "this network"
    expect(isBlockedIp('::ffff:0100:000a')).toBe(false); // 1.0.0.10
    expect(isBlockedIp('::ffff:000a:0000')).toBe(true); // 0.10.0.0, "this network"
  });
});

describe('URL policy, message by message', () => {
  const refusal = (raw: string): string => {
    try { parseOutboundUrl(raw); } catch (e) { expect(e).toBeInstanceOf(OutboundBlockedError); return (e as Error).message; }
    return '';
  };

  it('names the error class', () => {
    const e = new OutboundBlockedError('x');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('OutboundBlockedError');
    expect(e.message).toBe('x');
  });

  it('says why each URL is refused', () => {
    expect(refusal('not a url')).toBe('Keine gültige URL');
    expect(refusal('')).toBe('Keine gültige URL');
    expect(refusal('http://example.org/')).toBe('Nur https:// ist erlaubt');
    expect(refusal('ftp://example.org/')).toBe('Nur https:// ist erlaubt');
    expect(refusal('https://user@example.org/')).toBe('Zugangsdaten in der URL sind nicht erlaubt');
    expect(refusal('https://:pw@example.org/')).toBe('Zugangsdaten in der URL sind nicht erlaubt');
    expect(refusal('https://./x')).toBe('Die URL enthält keinen Host');
    expect(refusal('https://localhost/')).toBe('Das Ziel zeigt auf einen lokalen oder privaten Host');
    expect(refusal('https://127.0.0.1/')).toBe('Das Ziel zeigt auf eine lokale oder private Adresse');
  });

  it('refuses localhost under any spelling, and only localhost names', () => {
    for (const host of ['localhost', 'LOCALHOST', 'localhost.', 'a.localhost', 'a.b.LocalHost.']) {
      expect(refusal(`https://${host}/`), host).toBe('Das Ziel zeigt auf einen lokalen oder privaten Host');
    }
    for (const host of ['mylocalhost.com', 'localhost.example.com', 'notlocalhost', 'localhostx.org']) {
      expect(refusal(`https://${host}/`), host).toBe('');
    }
  });

  it('judges IP literals, including bracketed IPv6, a trailing dot and odd spellings that parse to a private address', () => {
    expect(refusal('https://[::1]/')).toBe('Das Ziel zeigt auf eine lokale oder private Adresse');
    expect(refusal('https://[fe80::1]:8443/x')).toBe('Das Ziel zeigt auf eine lokale oder private Adresse');
    expect(refusal('https://[::ffff:127.0.0.1]/')).toBe('Das Ziel zeigt auf eine lokale oder private Adresse');
    expect(refusal('https://10.0.0.1./')).toBe('Das Ziel zeigt auf eine lokale oder private Adresse');
    expect(refusal('https://2130706433/')).toBe('Das Ziel zeigt auf eine lokale oder private Adresse'); // 127.0.0.1 as one number
    expect(refusal('https://0x7f.1/')).toBe('Das Ziel zeigt auf eine lokale oder private Adresse');
    expect(refusal('https://[2606:4700:4700::1111]/')).toBe('');
    expect(refusal('https://8.8.8.8:8443/path?q=1')).toBe('');
  });

  it('returns the parsed URL for a good address, with its path, query and port intact', () => {
    const u = parseOutboundUrl('https://searx.example.org:8443/a/b?q=1#x');
    expect(u).toBeInstanceOf(URL);
    expect(u.href).toBe('https://searx.example.org:8443/a/b?q=1#x');
  });
});

describe('save-time check, in detail', () => {
  afterEach(() => vi.restoreAllMocks());

  it('asks the system resolver for every address, in the order the OS would use', async () => {
    const lookup = vi.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    await assertPublicOutboundUrl('https://searx.example.org/');
    expect(lookup).toHaveBeenCalledWith('searx.example.org', { all: true, verbatim: true });
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }] as never);
    await expect(assertPublicOutboundUrl('https://searx.example.org/')).rejects.toThrow('Der Host löst auf eine lokale oder private Adresse auf');
  });

  it('lets a host through whose lookup fails, and one that resolves to nothing', async () => {
    vi.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));
    await expect(assertPublicOutboundUrl('https://gone.example.org/')).resolves.toBeUndefined();
    await expect(assertPublicOutboundUrl('https://gone.example.org/', async () => [])).resolves.toBeUndefined();
  });

  it('does not call the resolver for an IP literal, and still judges it', async () => {
    const resolver = vi.fn(async () => ['10.0.0.1']);
    await expect(assertPublicOutboundUrl('https://8.8.8.8/', resolver)).resolves.toBeUndefined();
    await expect(assertPublicOutboundUrl('https://[2606:4700:4700::1111]/', resolver)).resolves.toBeUndefined();
    await expect(assertPublicOutboundUrl('https://10.0.0.1/', resolver)).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('hands the resolver the bare host: lower-cased, without the trailing dot', async () => {
    const resolver = vi.fn(async (_h: string) => ['93.184.216.34']);
    await assertPublicOutboundUrl('https://SearX.Example.ORG./', resolver);
    expect(resolver).toHaveBeenCalledWith('searx.example.org');
  });
});

describe('connect-time lookup, exact answers', () => {
  type Cb = (e: Error | null, a?: unknown, f?: number) => void;
  const run = (addresses: string[] | Error, options: { all?: boolean }): Promise<unknown[]> => new Promise((resolve) => {
    const fn = createGuardedLookup(async () => { if (addresses instanceof Error) throw addresses; return addresses; });
    (fn as unknown as (h: string, o: object, cb: Cb) => void)('h.example.org', options, (...args) => resolve(args));
  });

  it('passes a resolver error on with an empty address and family 4', async () => {
    const boom = new Error('ENOTFOUND');
    expect(await run(boom, {})).toEqual([boom, '', 4]);
  });

  it('refuses with the blocked-error message, an empty address and family 4', async () => {
    const [err, address, family] = await run(['10.0.0.1'], {});
    expect(err).toBeInstanceOf(OutboundBlockedError);
    expect((err as Error).message).toBe('Der Host löst auf eine lokale oder private Adresse auf');
    expect([address, family]).toEqual(['', 4]);
    expect(await run([], { all: true })).toEqual([expect.any(OutboundBlockedError), '', 4]);
  });

  it('answers an IPv6 address with family 6 and an IPv4 one with family 4, one or all', async () => {
    expect(await run(['2606:4700:4700::1111'], {})).toEqual([null, '2606:4700:4700::1111', 6]);
    expect(await run(['93.184.216.34', '2606:4700:4700::1111'], {})).toEqual([null, '93.184.216.34', 4]);
    expect(await run(['2606:4700:4700::1111', '93.184.216.34'], { all: true })).toEqual([
      null, [{ address: '2606:4700:4700::1111', family: 6 }, { address: '93.184.216.34', family: 4 }],
    ]);
  });
});

describe('response size cap, to the byte', () => {
  it('takes a body of exactly the cap and refuses one byte more', async () => {
    const exact = new PassThrough();
    const p1 = collectBody(exact, 4);
    exact.end('abcd');
    expect((await p1).toString()).toBe('abcd');

    const over = new PassThrough();
    const p2 = collectBody(over, 4);
    over.write('abcde');
    await expect(p2).rejects.toThrow('Die Antwort ist zu groß');
  });

  it('rejects with the stream error', async () => {
    const s = new PassThrough();
    const p = collectBody(s, 100);
    s.destroy(new Error('socket hang up'));
    await expect(p).rejects.toThrow('socket hang up');
  });
});

describe('guarded fetch, limits and bookkeeping', () => {
  afterEach(() => vi.useRealTimers());
  const reply = (status: number, extra: { location?: string; body?: string } = {}) => ({
    status, location: extra.location, body: Buffer.from(extra.body ?? ''),
  });
  const URL0 = 'https://searx.example.org/';

  it.each([[199, false], [200, true], [204, true], [299, true], [300, false], [404, false], [500, false]])(
    'reports status %i as ok=%s', async (status, ok) => {
      const f = createGuardedFetch({}, async () => reply(status));
      const res = await f(URL0);
      expect(res.status).toBe(status);
      expect(res.ok).toBe(ok);
    });

  it('hands the body back as text and as JSON, decoded as UTF-8', async () => {
    const f = createGuardedFetch({}, async () => reply(200, { body: '{"r":"grüße"}' }));
    const res = await f(URL0);
    expect(await res.text()).toBe('{"r":"grüße"}');
    expect(await res.json()).toEqual({ r: 'grüße' });
  });

  it.each([301, 302, 303, 307, 308])('follows a %i with a Location', async (status) => {
    const request = vi.fn<RequestOnce>()
      .mockResolvedValueOnce(reply(status, { location: 'https://other.example.org/next' }))
      .mockResolvedValueOnce(reply(200, { body: 'done' }));
    const res = await createGuardedFetch({}, request)(URL0);
    expect(await res.text()).toBe('done');
    expect(String(request.mock.calls[1][0])).toBe('https://other.example.org/next');
  });

  it.each([200, 204, 300, 304, 305, 306, 309, 400])('does not follow a %i, even with a Location', async (status) => {
    const request = vi.fn<RequestOnce>(async () => reply(status, { location: 'https://other.example.org/next', body: 'here' }));
    const res = await createGuardedFetch({}, request)(URL0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(status);
    expect(await res.text()).toBe('here');
  });

  it('does not follow a redirect that has no Location, and answers it as it is', async () => {
    const request = vi.fn<RequestOnce>(async () => reply(302));
    const res = await createGuardedFetch({}, request)(URL0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(302);
  });

  it('resolves a relative Location against the URL it came from', async () => {
    const request = vi.fn<RequestOnce>()
      .mockResolvedValueOnce(reply(302, { location: '../up?x=1' }))
      .mockResolvedValueOnce(reply(200));
    await createGuardedFetch({}, request)('https://searx.example.org/a/b/c');
    expect(String(request.mock.calls[1][0])).toBe('https://searx.example.org/a/up?x=1');
  });

  it('re-validates every hop: a redirect to http, to localhost or to a private address is refused', async () => {
    for (const location of ['http://other.example.org/', 'https://localhost/', 'https://10.0.0.1/', 'https://[::1]/']) {
      const request = vi.fn<RequestOnce>(async () => reply(302, { location }));
      await expect(createGuardedFetch({}, request)(URL0), location).rejects.toBeInstanceOf(OutboundBlockedError);
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it('refuses an unusable Location', async () => {
    const request = vi.fn<RequestOnce>(async () => reply(302, { location: 'https://[bad' }));
    await expect(createGuardedFetch({}, request)(URL0)).rejects.toThrow('Ungültige Weiterleitung');
  });

  it('follows exactly maxRedirects hops and refuses the next one, with the redirect message', async () => {
    const chain = vi.fn<RequestOnce>(async () => reply(302, { location: '/again' }));
    await expect(createGuardedFetch({ maxRedirects: 2 }, chain)(URL0)).rejects.toThrow('Zu viele Weiterleitungen');
    expect(chain).toHaveBeenCalledTimes(3);

    const ends = vi.fn<RequestOnce>()
      .mockResolvedValueOnce(reply(302, { location: '/1' }))
      .mockResolvedValueOnce(reply(302, { location: '/2' }))
      .mockResolvedValueOnce(reply(200, { body: 'end' }));
    const res = await createGuardedFetch({ maxRedirects: 2 }, ends)(URL0);
    expect(await res.text()).toBe('end');

    const none = vi.fn<RequestOnce>(async () => reply(302, { location: '/1' }));
    await expect(createGuardedFetch({ maxRedirects: 0 }, none)(URL0)).rejects.toThrow('Zu viele Weiterleitungen');
    expect(none).toHaveBeenCalledTimes(1);
  });

  it('refuses a first URL that breaks the policy before any request goes out', async () => {
    const request = vi.fn<RequestOnce>(async () => reply(200));
    await expect(createGuardedFetch({}, request)('http://searx.example.org/')).rejects.toBeInstanceOf(OutboundBlockedError);
    expect(request).not.toHaveBeenCalled();
  });

  it('defaults to 3 redirects, a 2 MiB body cap and the caller headers', async () => {
    const chain = vi.fn<RequestOnce>(async () => reply(302, { location: '/again' }));
    await expect(createGuardedFetch({}, chain)(URL0, { headers: { 'x-test': '1' } })).rejects.toThrow('Zu viele Weiterleitungen');
    expect(chain).toHaveBeenCalledTimes(4);
    const [url, headers, , maxBytes] = chain.mock.calls[0];
    expect(String(url)).toBe(URL0);
    expect(headers).toEqual({ 'x-test': '1' });
    expect(maxBytes).toBe(2 * 1024 * 1024);

    const bare = vi.fn<RequestOnce>(async () => reply(200));
    await createGuardedFetch({ maxBytes: 1234 }, bare)(URL0);
    expect(bare.mock.calls[0][1]).toEqual({});
    expect(bare.mock.calls[0][3]).toBe(1234);
  });

  it('gives a request 12 seconds by default, and exactly the configured time otherwise', async () => {
    vi.useFakeTimers();
    const hang = (): { request: RequestOnce; signal: () => AbortSignal | undefined } => {
      let seen: AbortSignal | undefined;
      return {
        request: (_u, _h, signal) => { seen = signal; return new Promise(() => undefined); },
        signal: () => seen,
      };
    };
    const a = hang();
    void createGuardedFetch({}, a.request)(URL0).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(11_999);
    expect(a.signal()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.signal()?.aborted).toBe(true);

    const b = hang();
    void createGuardedFetch({ timeoutMs: 500 }, b.request)(URL0).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(499);
    expect(b.signal()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.signal()?.aborted).toBe(true);
  });

  it('clears its timer and its listener on the caller signal when the call ends, success or failure', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    await createGuardedFetch({}, async () => reply(200))(URL0, { signal: caller.signal });
    expect(vi.getTimerCount()).toBe(0);
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0]).toBe('abort');
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);

    await expect(createGuardedFetch({}, async () => { throw new Error('boom'); })(URL0, { signal: caller.signal })).rejects.toThrow('boom');
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('passes an abort that happens during the call on to the request', async () => {
    const caller = new AbortController();
    let seen: AbortSignal | undefined;
    const request: RequestOnce = (_u, _h, signal) => { seen = signal; return new Promise((_r, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))); };
    const pending = createGuardedFetch({}, request)(URL0, { signal: caller.signal });
    expect(seen?.aborted).toBe(false);
    caller.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(seen?.aborted).toBe(true);
  });

  it('hands a signal that is already aborted on to the request as aborted, and never listens to it', async () => {
    const caller = new AbortController();
    caller.abort();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    let aborted: boolean | undefined;
    const request: RequestOnce = async (_u, _h, signal) => { aborted = signal.aborted; return reply(200); };
    await createGuardedFetch({}, request)(URL0, { signal: caller.signal });
    expect(aborted).toBe(true);
    expect(add).not.toHaveBeenCalled();
  });
});

describe('net.isIP agrees with the guard about what an IP literal is', () => {
  it('has nothing to judge for a name, and blocks what is no address', () => {
    expect(net.isIP('example.org')).toBe(0);
    expect(isBlockedIp('example.org')).toBe(true);
  });
});
