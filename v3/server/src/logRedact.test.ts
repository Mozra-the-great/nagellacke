import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { plainPng } from './testImages';
import { REDACTED, redactText, redactUrl, serializeError, serializeRequest } from './logRedact';

/**
 * #450: photo access tokens travel in `?t=` and Fastify logs the request URL, so
 * every token in the journal could be replayed until it expired.
 */
describe('redactUrl / redactText', () => {
  it('masks the photo token and keeps the path', () => {
    expect(redactUrl('/photos/abc.png?t=eyJ.sig')).toBe(`/photos/abc.png?t=${REDACTED}`);
  });

  it.each([
    ['/x?token=abc', `/x?token=${REDACTED}`],
    ['/x?access_token=abc', `/x?access_token=${REDACTED}`],
    ['/x?refreshToken=abc', `/x?refreshToken=${REDACTED}`],
    ['/x?api_key=abc', `/x?api_key=${REDACTED}`],
    ['/x?apikey=abc', `/x?apikey=${REDACTED}`],
    ['/x?key=abc', `/x?key=${REDACTED}`],
    ['/x?sig=abc', `/x?sig=${REDACTED}`],
    ['/x?signature=abc', `/x?signature=${REDACTED}`],
    ['/x?password=abc', `/x?password=${REDACTED}`],
    ['/x?client_secret=abc', `/x?client_secret=${REDACTED}`],
    ['/x?jwt=abc', `/x?jwt=${REDACTED}`],
    ['/x?T=abc', `/x?T=${REDACTED}`],
    ['/x?%74=abc', `/x?%74=${REDACTED}`],
  ])('masks token-like parameter %s', (input, expected) => {
    expect(redactUrl(input)).toBe(expected);
  });

  it('masks only the sensitive parameters and keeps order and the rest readable', () => {
    expect(redactUrl('/api/logs?lines=50&t=SECRET&period=week&token=SECRET2&x=1'))
      .toBe(`/api/logs?lines=50&t=${REDACTED}&period=week&token=${REDACTED}&x=1`);
  });

  it('masks the token whether it is first or later, and an empty value is harmless', () => {
    expect(redactUrl('/p?a=1&t=SECRET')).toBe(`/p?a=1&t=${REDACTED}`);
    expect(redactUrl('/p?t=')).toBe(`/p?t=${REDACTED}`);
  });

  it('does not touch a URL without a query, a lookalike name or a fragment-only token', () => {
    expect(redactUrl('/photos/abc.png')).toBe('/photos/abc.png');
    expect(redactUrl('/api/logs?lines=100')).toBe('/api/logs?lines=100');
    expect(redactUrl('/api/x?style=1&tag=2&format=3')).toBe('/api/x?style=1&tag=2&format=3');
    // Page URLs keep their tokens in the fragment, which never reaches the server.
    expect(redactUrl('/')).toBe('/');
  });

  it('masks a URL inside a log sentence and stops at the end of the URL', () => {
    expect(redactText('Route GET:/photos/a.png?t=SECRET.sig not found'))
      .toBe(`Route GET:/photos/a.png?t=${REDACTED} not found`);
    expect(redactText(`bad url "/photos/a.png?t=SECRET" given`)).toBe(`bad url "/photos/a.png?t=${REDACTED}" given`);
  });

  it('survives malformed percent-encoding in a parameter name', () => {
    expect(redactUrl('/x?%E0%A4%A=abc&t=SECRET')).toBe(`/x?%E0%A4%A=abc&t=${REDACTED}`);
  });
});

describe('serializers', () => {
  it('serializeRequest keeps the default fields but masks the URL', () => {
    const out = serializeRequest({
      method: 'GET', url: '/photos/a.png?t=SECRET', headers: { 'accept-version': '1.0.0' },
      host: 'example.org', ip: '10.0.0.1', socket: { remotePort: 4711 },
    });
    expect(out).toEqual({
      method: 'GET', url: `/photos/a.png?t=${REDACTED}`, version: '1.0.0',
      host: 'example.org', remoteAddress: '10.0.0.1', remotePort: 4711,
    });
  });

  it('serializeError masks URLs in message, stack and properties, and in a cause', () => {
    const err = Object.assign(new Error('bad /photos/a.png?t=SECRET', { cause: new Error('inner ?token=SECRET') }), {
      code: 'FST_ERR_BAD_URL', detail: '/photos/b.png?t=SECRET',
    });
    const out = serializeError(err);
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(out.message).toContain(`t=${REDACTED}`);
    expect(out.code).toBe('FST_ERR_BAD_URL');
    expect(out.type).toBe('Error');
  });

  it('serializeError passes non-errors through', () => {
    expect(serializeError('plain' as unknown as Error)).toBe('plain');
  });
});

describe('request log of a real server (#450)', () => {
  const JWT_SECRET = 'test-jwt-secret-do-not-use-in-prod';
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) { lines.push(chunk.toString('utf-8')); cb(); },
  });
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nagellacke-logredact-test-'));
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.ALLOW_REGISTRATION = 'true';
    const { buildApp } = await import('./index');
    app = await buildApp({ logStream: sink });
  });

  it('never writes a photo token, valid or not, to the log', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: 'log-redact-user', password: 'correct-horse-battery' },
    });
    expect(reg.statusCode).toBe(200);
    const bearer = (reg.json() as { token: string }).token;

    const png = plainPng();
    const up = await app.inject({
      method: 'POST', url: '/api/photos', headers: { authorization: `Bearer ${bearer}` },
      payload: { data: png.toString('base64'), mimeType: 'image/png' },
    });
    expect(up.statusCode).toBe(200);
    const filename = (up.json() as { filename: string }).filename;

    const tok = await app.inject({ method: 'GET', url: '/api/photos/token', headers: { authorization: `Bearer ${bearer}` } });
    const token = (tok.json() as { token: string }).token;
    expect(token.length).toBeGreaterThan(20);

    const secondToken = 'forged-looking-token-0123456789';
    lines.length = 0;

    const ok = await app.inject({ method: 'GET', url: `/photos/${filename}?t=${encodeURIComponent(token)}` });
    expect(ok.statusCode).toBe(200);
    const denied = await app.inject({ method: 'GET', url: `/photos/${filename}?t=${secondToken}` });
    expect(denied.statusCode).toBe(401);
    // 404 and a URL Fastify rejects itself both write the URL into log text/errors.
    await app.inject({ method: 'GET', url: `/api/does-not-exist?token=${secondToken}` });
    await app.inject({ method: 'GET', url: `/photos/%E0%A4%A?t=${secondToken}` });

    const log = lines.join('');
    // The log is not empty (otherwise the assertions below prove nothing) ...
    expect(log).toContain('incoming request');
    expect(log).toContain(`/photos/${filename}?t=${REDACTED}`);
    // ... and neither the real nor the forged token appears anywhere in it.
    expect(log).not.toContain(token);
    expect(log).not.toContain(encodeURIComponent(token));
    expect(log).not.toContain(secondToken);
  });
});
