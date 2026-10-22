/**
 * SSRF guard for server-side requests to a URL somebody configured (#401).
 *
 * The only such URL today is the admin-set `webSearch.searxngUrl`; everything
 * else the server calls (OpenRouter, Gemini, Brave, DuckDuckGo, the GitHub
 * release check) is a fixed https host in the source. A configurable target
 * lets whoever sets it make the server talk to addresses only the server can
 * reach: the Docker network, the cloud metadata service (169.254.169.254), LAN
 * and Tailnet hosts.
 *
 * Three layers, in this order of authority:
 *  1. `guardedFetch` — the one that counts. https only, no credentials in the
 *     URL, and the address the socket connects to is validated inside the
 *     connect-time `lookup` hook, so a hostname that resolves differently on a
 *     second query (DNS rebinding) cannot slip a private address past a
 *     check-then-connect gap. Redirects are followed by hand and every hop goes
 *     through the same checks. Timeout and a hard response size cap.
 *  2. `parseOutboundUrl` — the synchronous part (scheme, credentials, literal
 *     IPs, `localhost`), also used as an early reject in `searchWeb`.
 *  3. `assertPublicOutboundUrl` — save-time validation for the settings route,
 *     so a bad address is refused when it is entered rather than failing
 *     silently on every search. A convenience, not a guarantee (DNS can change
 *     after saving); layer 1 is what protects.
 *
 * No port allowlist: the ban on private ranges is what matters, and a public
 * SearXNG on a custom port is a normal setup.
 */
import * as dns from 'node:dns';
import * as https from 'node:https';
import * as net from 'node:net';
import type { LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import type { FetchLike } from './websearch';

/** Thrown for every refusal, so callers can tell "blocked" from a network error. */
export class OutboundBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboundBlockedError';
  }
}

// ── IP classification ────────────────────────────────────────────────────────

/** [network, prefix length] */
type V4Range = readonly [string, number];

const BLOCKED_V4: readonly V4Range[] = [
  ['0.0.0.0', 8],        // "this network", includes 0.0.0.0 (reaches localhost on Linux)
  ['10.0.0.0', 8],       // RFC 1918
  ['100.64.0.0', 10],    // CGNAT / Tailscale
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local, cloud metadata
  ['172.16.0.0', 12],    // RFC 1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.88.99.0', 24],   // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16],   // RFC 1918
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved, includes 255.255.255.255
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function isBlockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return true; // unparsable: refuse rather than guess
  return BLOCKED_V4.some(([net_, bits]) => {
    const base = v4ToInt(net_) as number;
    const size = 2 ** (32 - bits);
    return n >= base && n < base + size;
  });
}

/** Parses an IPv6 literal (incl. `::` and a trailing dotted quad) to 128 bits. */
function v6ToBigInt(ip: string): bigint | null {
  if (!net.isIPv6(ip)) return null;
  let text = ip;
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);

  // A trailing dotted quad (::ffff:1.2.3.4) stands for the last two groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = v4ToInt(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

function inV6(value: bigint, network: string, bits: number): boolean {
  const base = v6ToBigInt(network) as bigint;
  const shift = BigInt(128 - bits);
  return (value >> shift) === (base >> shift);
}

function bigToV4(low32: bigint): string {
  const n = Number(low32 & 0xffffffffn);
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function isBlockedV6(ip: string): boolean {
  const v = v6ToBigInt(ip);
  if (v === null) return true;

  // Ranges that embed an IPv4 address: judged by the embedded address, so
  // ::ffff:127.0.0.1 is as blocked as 127.0.0.1 and ::ffff:8.8.8.8 is as
  // allowed as 8.8.8.8.
  if (inV6(v, '::ffff:0:0', 96)) return isBlockedV4(bigToV4(v));          // IPv4-mapped
  if (inV6(v, '64:ff9b::', 96)) return isBlockedV4(bigToV4(v));           // NAT64
  if (inV6(v, '2002::', 16)) return isBlockedV4(bigToV4(v >> 80n));       // 6to4

  return (
    inV6(v, '::', 96)             // unspecified, loopback, deprecated IPv4-compatible
    || inV6(v, '64:ff9b:1::', 48) // local-use NAT64
    || inV6(v, '100::', 64)       // discard-only
    || inV6(v, '2001::', 32)      // Teredo
    || inV6(v, '2001:db8::', 32)  // documentation
    || inV6(v, 'fc00::', 7)       // unique local
    || inV6(v, 'fe80::', 10)      // link-local
    || inV6(v, 'fec0::', 10)      // site-local (deprecated)
    || inV6(v, 'ff00::', 8)       // multicast
  );
}

/**
 * True when `ip` must not be reached by a server-side request: private,
 * loopback, link-local, CGNAT, unique-local, multicast, unspecified, reserved
 * and documentation ranges, IPv4 and IPv6, including IPv4 embedded in IPv6.
 * Anything that is not a valid IP literal counts as blocked.
 */
export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family === 6) return isBlockedV6(ip);
  return true;
}

// ── URL validation ───────────────────────────────────────────────────────────

function bareHost(url: URL): string {
  const h = url.hostname.toLowerCase().replace(/\.$/, '');
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

/**
 * Synchronous part of the policy. Returns the parsed URL or throws an
 * `OutboundBlockedError` whose message is safe to show to the admin.
 */
export function parseOutboundUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundBlockedError('Keine gültige URL');
  }
  if (url.protocol !== 'https:') {
    throw new OutboundBlockedError('Nur https:// ist erlaubt');
  }
  if (url.username || url.password) {
    throw new OutboundBlockedError('Zugangsdaten in der URL sind nicht erlaubt');
  }
  const host = bareHost(url);
  if (!host) throw new OutboundBlockedError('Die URL enthält keinen Host');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new OutboundBlockedError('Das Ziel zeigt auf einen lokalen oder privaten Host');
  }
  if (net.isIP(host) && isBlockedIp(host)) {
    throw new OutboundBlockedError('Das Ziel zeigt auf eine lokale oder private Adresse');
  }
  return url;
}

type Resolver = (hostname: string) => Promise<readonly string[]>;

const systemResolver: Resolver = async (hostname) => {
  const found = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return found.map((a) => a.address);
};

/**
 * Save-time check: `parseOutboundUrl` plus a DNS look at the host. A host that
 * does not resolve at all is let through (a flaky resolver or a not-yet-created
 * record should not stop the admin from saving; the fetch-time guard decides
 * anyway). A host that resolves to even one blocked address is refused.
 */
export async function assertPublicOutboundUrl(
  raw: string,
  resolver: Resolver = systemResolver,
): Promise<void> {
  const url = parseOutboundUrl(raw);
  const host = bareHost(url);
  if (net.isIP(host)) return; // literal, already judged
  let addresses: readonly string[];
  try {
    addresses = await resolver(host);
  } catch {
    return;
  }
  if (addresses.some(isBlockedIp)) {
    throw new OutboundBlockedError('Der Host löst auf eine lokale oder private Adresse auf');
  }
}

// ── Guarded request ──────────────────────────────────────────────────────────

/**
 * Connect-time address check. Node asks this hook for the address to connect
 * to, so the address that was validated is the address that is used. Every
 * returned address is checked, not just the first: a record set that mixes a
 * public and a private address is refused outright.
 */
export function createGuardedLookup(resolver: Resolver = systemResolver): LookupFunction {
  return (hostname, options, callback) => {
    void (async () => {
      let addresses: readonly string[];
      try {
        addresses = await resolver(hostname);
      } catch (e) {
        callback(e as NodeJS.ErrnoException, '', 4);
        return;
      }
      if (addresses.length === 0 || addresses.some(isBlockedIp)) {
        callback(new OutboundBlockedError(
          'Der Host löst auf eine lokale oder private Adresse auf',
        ) as unknown as NodeJS.ErrnoException, '', 4);
        return;
      }
      const family = (a: string): 4 | 6 => (net.isIP(a) === 6 ? 6 : 4);
      if (options.all) {
        callback(null, addresses.map((address) => ({ address, family: family(address) })));
      } else {
        callback(null, addresses[0], family(addresses[0]));
      }
    })();
  };
}

const guardedLookup = createGuardedLookup();

export interface GuardedFetchOptions {
  /** Whole-call timeout including redirects. */
  timeoutMs?: number;
  /** Hard cap on the response body. */
  maxBytes?: number;
  /** Redirect hops followed (each one is re-validated). */
  maxRedirects?: number;
}

interface HopResponse {
  status: number;
  location?: string;
  body: Buffer;
}

/** One request, no redirect handling. Replaceable in tests. */
export type RequestOnce = (
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  maxBytes: number,
) => Promise<HopResponse>;

/**
 * Reads a response body up to `maxBytes`. Over the cap the stream is destroyed
 * and the promise rejects, so a hostile or broken endpoint cannot make the
 * server buffer an unbounded body. Exported for testing.
 */
export function collectBody(stream: Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        stream.destroy();
        reject(new OutboundBlockedError('Die Antwort ist zu groß'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

const requestOnce: RequestOnce = (url, headers, signal, maxBytes) => new Promise((resolve, reject) => {
  const req = https.request(url, {
    method: 'GET',
    headers,
    lookup: guardedLookup,
    signal,
    // No shared agent: nothing about a guarded connection may be reused by, or
    // reuse, a pool keyed on host alone.
    agent: false,
  }, (res) => {
    collectBody(res, maxBytes).then((body) => resolve({
      status: res.statusCode ?? 0,
      location: typeof res.headers.location === 'string' ? res.headers.location : undefined,
      body,
    }), (e: unknown) => {
      req.destroy();
      reject(e);
    });
  });
  req.on('error', reject);
  req.end();
});

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/**
 * Builds a `FetchLike` that enforces the policy above. `request` is a seam for
 * tests; production code uses the default.
 */
export function createGuardedFetch(
  opts: GuardedFetchOptions = {},
  request: RequestOnce = requestOnce,
): FetchLike {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  return async (rawUrl, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onCallerAbort = () => controller.abort();
    if (init?.signal) {
      if (init.signal.aborted) controller.abort();
      else init.signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    try {
      let url = parseOutboundUrl(rawUrl);
      for (let hop = 0; ; hop++) {
        const res = await request(url, init?.headers ?? {}, controller.signal, maxBytes);
        if (REDIRECT_STATUS.has(res.status) && res.location) {
          if (hop >= maxRedirects) throw new OutboundBlockedError('Zu viele Weiterleitungen');
          // Every station is judged like the first one: scheme, literal IP,
          // and (in `request`) the connect-time address check.
          let next: string;
          try {
            next = new URL(res.location, url).toString();
          } catch {
            throw new OutboundBlockedError('Ungültige Weiterleitung');
          }
          url = parseOutboundUrl(next);
          continue;
        }
        const text = res.body.toString('utf8');
        return {
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          text: async () => text,
          json: async () => JSON.parse(text) as unknown,
        };
      }
    } finally {
      clearTimeout(timer);
      init?.signal?.removeEventListener('abort', onCallerAbort);
    }
  };
}

/** The production instance: 12 s, 2 MiB, 3 redirects. */
export const guardedFetch: FetchLike = createGuardedFetch();
