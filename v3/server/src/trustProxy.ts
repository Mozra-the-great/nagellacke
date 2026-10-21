import { isIP } from 'node:net';

/**
 * Which reverse proxies Fastify may believe about the client address (#397).
 *
 * Behind a proxy the socket peer of every request is the proxy, so `request.ip`
 * is the proxy's address. That one address is the key of every per-IP rate
 * limit (`@fastify/rate-limit`) and the `remoteAddress` in the request log:
 * all users share one bucket per route and the log has no client address.
 * Fastify's `trustProxy` fixes both by reading the client from
 * `X-Forwarded-For` - but only when the peer is a proxy we named. `true` would
 * believe the header from anyone who can reach the port, and a client could
 * then pick any address it likes (or a fresh one per request) and walk around
 * every limit.
 *
 * `TRUST_PROXY` is therefore a comma-separated list of IP addresses and/or
 * CIDR ranges, nothing else. Unset or empty means "no proxy" (`false`), which
 * is right for the install.sh deployment that binds 0.0.0.0 directly. Values
 * that would trust everybody (`true`, `0.0.0.0/0`, `::/0`, any `/0`) and hop
 * counts are rejected at startup: a typo must not silently turn the limits off.
 */
export function parseTrustProxy(raw: string | undefined): string[] | false {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false') return false;

  const entries = value.split(',').map((e) => e.trim());
  for (const entry of entries) {
    if (!isValidProxyEntry(entry)) {
      throw new Error(
        `Invalid TRUST_PROXY entry "${entry}": expected a comma-separated list of IP addresses or CIDR ranges ` +
          `(e.g. "172.18.0.2" or "172.18.0.0/16"), not a boolean, a hop count or a /0 range. ` +
          `Unset it when the server is not behind a reverse proxy.`,
      );
    }
  }
  return entries;
}

function isValidProxyEntry(entry: string): boolean {
  const slash = entry.indexOf('/');
  const address = slash === -1 ? entry : entry.slice(0, slash);
  const family = isIP(address);
  if (family === 0) return false;
  if (slash === -1) return true;

  const prefix = entry.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const bits = Number(prefix);
  // /0 matches every address, which is `trustProxy: true` by another name.
  return bits >= 1 && bits <= (family === 4 ? 32 : 128);
}
