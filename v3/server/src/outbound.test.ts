/**
 * #401: SSRF guard for the admin-configurable SearXNG address.
 *
 * No test here reaches the network. DNS is replaced by a fake resolver, the
 * transport by a fake `request`, and the one real-socket test connects to a
 * loopback listener precisely to prove that the guard refuses before connecting.
 */
import { describe, it, expect, vi } from 'vitest';
import * as net from 'node:net';
import { PassThrough } from 'node:stream';
import {
  OutboundBlockedError,
  assertPublicOutboundUrl,
  collectBody,
  createGuardedFetch,
  createGuardedLookup,
  guardedFetch,
  isBlockedIp,
  parseOutboundUrl,
  type RequestOnce,
} from './outbound';

const BLOCKED_IPS = [
  // loopback / unspecified / "this network"
  '127.0.0.1', '127.255.255.254', '0.0.0.0', '0.1.2.3',
  // RFC 1918
  '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
  // link-local incl. the cloud metadata address
  '169.254.169.254', '169.254.0.1',
  // CGNAT / Tailscale
  '100.64.0.1', '100.127.255.255',
  // multicast, reserved, broadcast
  '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
  // documentation, benchmarking, protocol assignments
  '192.0.0.8', '192.0.2.1', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9',
  // IPv6: loopback, unspecified, ULA, link-local, multicast
  '::1', '::', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'ff02::1', 'ff0e::1',
  // IPv6: documentation, Teredo, discard
  '2001:db8::1', '2001::1', '100::1',
  // IPv4-mapped / IPv4-compatible IPv6 carrying a private v4 (both notations)
  '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.1.2.3', '::ffff:a01:203',
  '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '::ffff:192.168.1.1', '::ffff:100.64.0.1',
  '0:0:0:0:0:ffff:7f00:1', '::127.0.0.1',
  // NAT64 and 6to4 carrying a private v4
  '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '64:ff9b::10.0.0.1', '2002:7f00:1::1', '2002:a9fe:a9fe::1',
  // local-use NAT64
  '64:ff9b:1::1',
];

const ALLOWED_IPS = [
  '1.1.1.1', '8.8.8.8', '93.184.216.34', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1',
  '169.253.255.255', '169.255.0.1', '192.167.255.255', '192.169.0.1', '198.17.255.255', '198.20.0.1',
  '223.255.255.255',
  '2606:4700:4700::1111', '2a00:1450:4001:81b::200e', '2001:4860:4860::8888',
  // mapped / NAT64 / 6to4 carrying a *public* v4 stay allowed
  '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1',
];

describe('isBlockedIp', () => {
  it.each(BLOCKED_IPS)('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each(ALLOWED_IPS)('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it('treats anything that is not an IP literal as blocked', () => {
    for (const junk of ['', 'example.com', '999.1.1.1', '1.2.3', '1.2.3.4.5', 'zz::1', ':::']) {
      expect(isBlockedIp(junk)).toBe(true);
    }
  });
});

describe('parseOutboundUrl', () => {
  it('accepts a public https url', () => {
    expect(parseOutboundUrl('https://searx.example.org').hostname).toBe('searx.example.org');
    expect(parseOutboundUrl('https://searx.example.org:8443/base').port).toBe('8443');
    expect(parseOutboundUrl('https://93.184.216.34/').hostname).toBe('93.184.216.34');
    expect(parseOutboundUrl('https://[2606:4700:4700::1111]/').hostname).toBe('[2606:4700:4700::1111]');
  });

  it.each([
    ['plain http', 'http://searx.example.org'],
    ['ftp', 'ftp://searx.example.org'],
    ['file', 'file:///etc/passwd'],
    ['javascript', 'javascript:alert(1)'],
    ['no scheme', 'searx.example.org'],
    ['garbage', 'not a url'],
    ['empty', ''],
    ['credentials', 'https://user:pw@searx.example.org'],
    ['username only', 'https://token@searx.example.org'],
    ['localhost', 'https://localhost/'],
    ['localhost with trailing dot', 'https://localhost./'],
    ['subdomain of localhost', 'https://foo.localhost/'],
    ['loopback v4', 'https://127.0.0.1/'],
    ['loopback v4 on a port', 'https://127.0.0.1:8080/'],
    ['metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['RFC 1918', 'https://10.0.0.5/'],
    ['RFC 1918 (192.168)', 'https://192.168.0.1/'],
    ['CGNAT / Tailnet', 'https://100.100.100.100/'],
    ['0.0.0.0', 'https://0.0.0.0/'],
    ['decimal-integer host', 'https://2130706433/'],
    ['hex host', 'https://0x7f000001/'],
    ['short dotted host', 'https://127.1/'],
    ['octal host', 'https://0177.0.0.1/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['IPv6 unique-local', 'https://[fd00::1]/'],
    ['IPv6 link-local', 'https://[fe80::1]/'],
    ['IPv4-mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/'],
    ['IPv4-mapped IPv6 metadata', 'https://[::ffff:a9fe:a9fe]/'],
  ])('rejects %s', (_name, url) => {
    expect(() => parseOutboundUrl(url)).toThrow(OutboundBlockedError);
  });
});

describe('assertPublicOutboundUrl (save-time check)', () => {
  it('accepts a host that resolves to public addresses only', async () => {
    const resolver = vi.fn(async () => ['93.184.216.34', '2606:2800:220:1::1']);
    await expect(assertPublicOutboundUrl('https://searx.example.org', resolver)).resolves.toBeUndefined();
    expect(resolver).toHaveBeenCalledWith('searx.example.org');
  });

  it('rejects a host that resolves to a private address, even next to a public one', async () => {
    await expect(assertPublicOutboundUrl('https://internal.example.org', async () => ['10.0.0.8']))
      .rejects.toThrow(OutboundBlockedError);
    await expect(assertPublicOutboundUrl('https://mixed.example.org', async () => ['93.184.216.34', '169.254.169.254']))
      .rejects.toThrow(OutboundBlockedError);
    await expect(assertPublicOutboundUrl('https://v6.example.org', async () => ['::ffff:10.0.0.8']))
      .rejects.toThrow(OutboundBlockedError);
  });

  it('does not resolve literal IPs and still judges them', async () => {
    const resolver = vi.fn(async () => ['93.184.216.34']);
    await expect(assertPublicOutboundUrl('https://93.184.216.34/', resolver)).resolves.toBeUndefined();
    await expect(assertPublicOutboundUrl('https://10.0.0.1/', resolver)).rejects.toThrow(OutboundBlockedError);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('lets an unresolvable host through (fetch time decides) but not a bad scheme', async () => {
    const dead = async (): Promise<string[]> => { throw new Error('ENOTFOUND'); };
    await expect(assertPublicOutboundUrl('https://not-yet.example.org', dead)).resolves.toBeUndefined();
    await expect(assertPublicOutboundUrl('http://not-yet.example.org', dead)).rejects.toThrow(/https/);
  });
});

describe('createGuardedLookup (connect-time address check, DNS rebinding)', () => {
  type Result = { err: Error | null; address: unknown; family: number | undefined };
  function lookup(addresses: string[], all: boolean): Promise<Result> {
    const fn = createGuardedLookup(async () => addresses);
    return new Promise((resolve) => {
      (fn as unknown as (h: string, o: { all: boolean }, cb: (e: Error | null, a: unknown, f?: number) => void) => void)(
        'searx.example.org', { all },
        (err, address, family) => resolve({ err, address, family }),
      );
    });
  }

  it('hands back the validated public address', async () => {
    const single = await lookup(['93.184.216.34'], false);
    expect(single.err).toBeNull();
    expect(single.address).toBe('93.184.216.34');
    expect(single.family).toBe(4);

    const many = await lookup(['93.184.216.34', '2606:2800:220:1::1'], true);
    expect(many.err).toBeNull();
    expect(many.address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
  });

  it('refuses a private answer', async () => {
    for (const all of [false, true]) {
      const r = await lookup(['127.0.0.1'], all);
      expect(r.err).toBeInstanceOf(OutboundBlockedError);
    }
  });

  it('refuses an answer that mixes a public and a private address (rebinding trick)', async () => {
    const r = await lookup(['93.184.216.34', '10.0.0.5'], true);
    expect(r.err).toBeInstanceOf(OutboundBlockedError);
  });

  it('judges every query anew, so a name that flips to a private address is caught', async () => {
    const answers = [['93.184.216.34'], ['169.254.169.254']];
    let n = 0;
    const fn = createGuardedLookup(async () => answers[n++]);
    const run = () => new Promise<Error | null>((resolve) => {
      (fn as unknown as (h: string, o: { all: boolean }, cb: (e: Error | null) => void) => void)(
        'flip.example.org', { all: true }, (err) => resolve(err),
      );
    });
    expect(await run()).toBeNull();
    expect(await run()).toBeInstanceOf(OutboundBlockedError);
  });

  it('refuses an empty answer and passes resolver errors through', async () => {
    expect((await lookup([], true)).err).toBeInstanceOf(OutboundBlockedError);
    const boom = createGuardedLookup(async () => { throw new Error('ENOTFOUND'); });
    const err = await new Promise<Error | null>((resolve) => {
      (boom as unknown as (h: string, o: object, cb: (e: Error | null) => void) => void)('x.example.org', {}, (e) => resolve(e));
    });
    expect(err?.message).toBe('ENOTFOUND');
  });
});

describe('createGuardedFetch', () => {
  const ok = (body: string, extra: Partial<{ status: number; location: string }> = {}) => ({
    status: extra.status ?? 200,
    location: extra.location,
    body: Buffer.from(body),
  });

  it('allows a valid public https url and returns the body', async () => {
    const seen: string[] = [];
    const request: RequestOnce = async (url, headers) => {
      seen.push(`${url.toString()} ${headers.Accept}`);
      return ok('{"results":[]}');
    };
    const res = await createGuardedFetch({}, request)('https://searx.example.org/search?q=essie&format=json', {
      headers: { Accept: 'application/json' },
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
    expect(seen).toEqual(['https://searx.example.org/search?q=essie&format=json application/json']);
  });

  it('reports a non-2xx answer as not ok instead of throwing', async () => {
    const res = await createGuardedFetch({}, async () => ok('nope', { status: 503 }))('https://searx.example.org/');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });

  it.each([
    ['http', 'http://searx.example.org/search'],
    ['loopback', 'https://127.0.0.1/search'],
    ['metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['private', 'https://10.0.0.1/search'],
    ['IPv6 loopback', 'https://[::1]/search'],
    ['mapped IPv6', 'https://[::ffff:7f00:1]/search'],
  ])('refuses a %s target without sending a request', async (_n, url) => {
    const request = vi.fn<RequestOnce>(async () => ok('x'));
    await expect(createGuardedFetch({}, request)(url)).rejects.toThrow(OutboundBlockedError);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['RFC 1918 address', 'https://192.168.1.1/admin'],
    ['loopback', 'https://127.0.0.1:8080/'],
    ['localhost', 'https://localhost/'],
    ['IPv6 loopback', 'https://[::1]/'],
    ['downgrade to http', 'http://searx.example.org/'],
    ['protocol-relative localhost', '//localhost/x'],
  ])('refuses a redirect to a %s and never follows it', async (_n, location) => {
    const calls: string[] = [];
    const request: RequestOnce = async (url) => {
      calls.push(url.toString());
      return calls.length === 1 ? ok('', { status: 302, location }) : ok('secret');
    };
    await expect(createGuardedFetch({}, request)('https://searx.example.org/search'))
      .rejects.toThrow(OutboundBlockedError);
    expect(calls).toEqual(['https://searx.example.org/search']);
  });

  it('follows a redirect to another public https url, re-validating each hop', async () => {
    const calls: string[] = [];
    const request: RequestOnce = async (url) => {
      calls.push(url.toString());
      if (calls.length === 1) return ok('', { status: 301, location: '/en/search' });
      if (calls.length === 2) return ok('', { status: 307, location: 'https://searx2.example.net/search' });
      return ok('"done"');
    };
    const res = await createGuardedFetch({}, request)('https://searx.example.org/search');
    expect(await res.json()).toBe('done');
    expect(calls).toEqual([
      'https://searx.example.org/search',
      'https://searx.example.org/en/search',
      'https://searx2.example.net/search',
    ]);
  });

  it('stops after the redirect limit', async () => {
    const request = vi.fn<RequestOnce>(async () => ok('', { status: 302, location: '/again' }));
    await expect(createGuardedFetch({ maxRedirects: 2 }, request)('https://searx.example.org/'))
      .rejects.toThrow(/Weiterleitungen/);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('times out a request that never answers', async () => {
    const request: RequestOnce = (_u, _h, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    await expect(createGuardedFetch({ timeoutMs: 20 }, request)('https://searx.example.org/')).rejects.toThrow('aborted');
  });

  it('honours the caller abort signal', async () => {
    const controller = new AbortController();
    const request: RequestOnce = (_u, _h, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const pending = createGuardedFetch({}, request)('https://searx.example.org/', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
  });
});

describe('collectBody (size cap)', () => {
  it('returns a body within the cap', async () => {
    const s = new PassThrough();
    const p = collectBody(s, 10);
    s.write('hello');
    s.end('!');
    expect((await p).toString()).toBe('hello!');
  });

  it('rejects and destroys the stream when the body exceeds the cap', async () => {
    const s = new PassThrough();
    const p = collectBody(s, 8);
    s.write('12345');
    s.write('67890');
    await expect(p).rejects.toThrow(/zu groß/);
    expect(s.destroyed).toBe(true);
  });
});

describe('guardedFetch against a real loopback listener', () => {
  // Proves the production instance refuses before connecting. The listener sits
  // on 127.0.0.1 only to count connection attempts; none must arrive.
  it.each([
    ['127.0.0.1', 'https://127.0.0.1'],
    ['localhost', 'https://localhost'],
    ['[::1]', 'https://[::1]'],
  ])('never connects to %s', async (_n, base) => {
    let connections = 0;
    const server = net.createServer((sock) => { connections += 1; sock.destroy(); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      await expect(guardedFetch(`${base}:${port}/search`)).rejects.toThrow(OutboundBlockedError);
      expect(connections).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
