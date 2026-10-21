import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { parseTrustProxy } from './trustProxy';

/**
 * #397: behind Traefik (nailvault.de) the socket peer is the proxy, so without
 * trustProxy `request.ip` is the proxy for every client and all users share one
 * rate-limit bucket per route. TRUST_PROXY names the proxies to believe; it must
 * never degrade into "believe everybody", or X-Forwarded-For becomes a way
 * around the limits.
 */
describe('parseTrustProxy', () => {
  it.each([undefined, '', '   ', 'false', 'FALSE'])('treats %j as "no proxy"', (raw) => {
    expect(parseTrustProxy(raw)).toBe(false);
  });

  it('accepts single addresses, CIDR ranges and lists, IPv4 and IPv6', () => {
    expect(parseTrustProxy('172.18.0.2')).toEqual(['172.18.0.2']);
    expect(parseTrustProxy('172.18.0.0/16')).toEqual(['172.18.0.0/16']);
    expect(parseTrustProxy(' 172.18.0.2 , fd00::/8 ,::1')).toEqual(['172.18.0.2', 'fd00::/8', '::1']);
    expect(parseTrustProxy('2001:db8::/32')).toEqual(['2001:db8::/32']);
  });

  it.each([
    'true', 'TRUE', '1', '2', 'loopback', 'uniquelocal', 'proxy.example.com',
    '0.0.0.0/0', '::/0', '10.0.0.0/0', '10.0.0.0/33', '::1/129', '10.0.0.0/-1', '10.0.0.0/', '10.0.0.0/8/8',
    '999.1.1.1', '10.0.0.1,', ',10.0.0.1', '10.0.0.1,,10.0.0.2', '10.0.0.1, true',
  ])('rejects %j instead of trusting everybody', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY/);
  });
});

describe('buildApp with TRUST_PROXY', () => {
  const PROXY = '172.18.0.2';
  // registration-status is public and rate-limited to 30 per minute per source.
  const LIMIT = 30;

  let buildApp: typeof import('./index').buildApp;
  let app: FastifyInstance | undefined;
  const previous = process.env.TRUST_PROXY;

  beforeAll(async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-trustproxy-test-'));
    process.env.JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
    ({ buildApp } = await import('./index'));
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (previous === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previous;
  });

  async function start(trustProxy: string | undefined): Promise<FastifyInstance> {
    if (trustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = trustProxy;
    app = await buildApp();
    // Probe route (added before the first inject, so before ready()): reports what
    // Fastify resolved as the client address.
    app.get('/__client-ip', async (request) => ({ ip: request.ip }));
    return app;
  }

  async function status(remoteAddress: string, forwardedFor?: string): Promise<number> {
    const res = await app!.inject({
      method: 'GET',
      url: '/api/auth/registration-status',
      remoteAddress,
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    });
    return res.statusCode;
  }

  async function clientIp(remoteAddress: string, forwardedFor?: string): Promise<string> {
    const res = await app!.inject({
      method: 'GET',
      url: '/__client-ip',
      remoteAddress,
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    });
    return (res.json() as { ip: string }).ip;
  }

  it('default (unset): the peer is the client, X-Forwarded-For is ignored', async () => {
    await start(undefined);
    expect(await clientIp(PROXY, '203.0.113.7')).toBe(PROXY);
    expect(await clientIp('198.51.100.9', '203.0.113.7')).toBe('198.51.100.9');
  });

  it('default (unset): clients behind a proxy share one bucket, the header does not separate them', async () => {
    await start(undefined);
    for (let i = 0; i < LIMIT; i++) {
      expect(await status(PROXY, `203.0.113.${i + 1}`)).toBe(200);
    }
    // The 31st request comes from a brand-new client address, and is still refused.
    expect(await status(PROXY, '203.0.113.200')).toBe(429);
  });

  it('trusted proxy: request.ip is the client address from X-Forwarded-For', async () => {
    await start('172.18.0.0/16');
    expect(await clientIp(PROXY, '203.0.113.7')).toBe('203.0.113.7');
    expect(await clientIp(PROXY)).toBe(PROXY); // no header: fall back to the peer
  });

  it('trusted proxy: every client gets its own rate-limit bucket', async () => {
    await start(PROXY);
    for (let i = 0; i < LIMIT; i++) {
      expect(await status(PROXY, '203.0.113.7')).toBe(200);
    }
    expect(await status(PROXY, '203.0.113.7')).toBe(429); // that client is throttled ...
    expect(await status(PROXY, '203.0.113.8')).toBe(200); // ... the next one is not
    expect(await status(PROXY, '2001:db8::1')).toBe(200); // ... nor an IPv6 client
  });

  it('trusted proxy: a forged chain cannot pick the client address', async () => {
    await start(PROXY);
    // A client that sends its own X-Forwarded-For through the proxy: proxy-addr
    // takes the first untrusted hop from the right, i.e. the address the proxy saw.
    expect(await clientIp(PROXY, '10.9.9.9, 203.0.113.7')).toBe('203.0.113.7');
    for (let i = 0; i < LIMIT; i++) {
      expect(await status(PROXY, `10.9.9.${i + 1}, 203.0.113.7`)).toBe(200);
    }
    expect(await status(PROXY, '10.9.9.200, 203.0.113.7')).toBe(429);
  });

  it('untrusted peer: X-Forwarded-For is ignored, so it cannot be used to dodge the limit', async () => {
    await start(PROXY);
    const attacker = '198.51.100.9';
    expect(await clientIp(attacker, '203.0.113.7')).toBe(attacker);
    for (let i = 0; i < LIMIT; i++) {
      expect(await status(attacker, `203.0.113.${i + 1}`)).toBe(200);
    }
    expect(await status(attacker, '203.0.113.250')).toBe(429);
  });

  it('refuses to start with a value that would trust everybody', async () => {
    process.env.TRUST_PROXY = 'true';
    await expect(buildApp()).rejects.toThrow(/TRUST_PROXY/);
    process.env.TRUST_PROXY = '0.0.0.0/0';
    await expect(buildApp()).rejects.toThrow(/TRUST_PROXY/);
  });
});
