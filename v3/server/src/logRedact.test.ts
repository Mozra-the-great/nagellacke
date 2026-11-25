import { beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { plainPng } from './testImages';
import {
  REDACTED, redactText, redactUrl, serializeError, serializeRequest, maskEmails, mailErrorText, buildLoggerOptions,
} from './logRedact';

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

describe('log masking in detail (#498)', () => {
  const R = REDACTED;

  it('spells the placeholder out', () => {
    expect(REDACTED).toBe('[REDACTED]');
  });

  describe('which parameter names are credentials', () => {
    it.each(['t', 'k', 'key', 'sig', 'sign', 'auth', 'code', 'otp', 'sid', 'jwt', 'pwd', 'pw'])(
      'masks the exact name %s, in any case', (name) => {
        expect(redactText(`/x?${name}=v`)).toBe(`/x?${name}=${R}`);
        expect(redactText(`/x?${name.toUpperCase()}=v`)).toBe(`/x?${name.toUpperCase()}=${R}`);
      },
    );

    it.each(['token', 'secret', 'passw', 'apikey', 'api-key', 'api_key', 'signature', 'credential', 'bearer', 'session', 'authoriz'])(
      'masks a name that contains %s, wherever it sits and in any case', (word) => {
        expect(redactText(`/x?${word}=v`)).toBe(`/x?${word}=${R}`);
        expect(redactText(`/x?my_${word}_x=v`)).toBe(`/x?my_${word}_x=${R}`);
        expect(redactText(`/x?${word.toUpperCase()}=v`)).toBe(`/x?${word.toUpperCase()}=${R}`);
      },
    );

    it('leaves harmless names alone, including near misses of the credential names', () => {
      for (const name of ['lines', 'period', 'page', 'tt', 'keys', 'ke', 'apiXkey', 'api key', 'pass', 'sess', 'author', 'codes']) {
        const url = `/x?${name}=v`;
        expect(redactText(url)).toBe(url);
      }
    });

    it('reads the name the way a server would: percent-escapes decoded, + as a space, spaces trimmed', () => {
      expect(redactText('/x?%74=v')).toBe(`/x?%74=${R}`); // %74 = t
      expect(redactText('/x?%54oken=v')).toBe(`/x?%54oken=${R}`); // %54 = T
      expect(redactText('/x?+t=v')).toBe(`/x?+t=${R}`); // " t" is "t" after trimming
      expect(redactText('/x?t+=v')).toBe(`/x?t+=${R}`);
      expect(redactText('/x?%20t%20=v')).toBe(`/x?%20t%20=${R}`);
      expect(redactText('/x?k+ey=v')).toBe('/x?k+ey=v'); // the name is "k ey", which is neither "k" nor "key"
    });

    it('judges the raw spelling when the escape is malformed, instead of throwing', () => {
      expect(redactText('/x?token%=v')).toBe(`/x?token%=${R}`);
      expect(redactText('/x?%E0%A4%A=v')).toBe('/x?%E0%A4%A=v');
      expect(redactText('/x?%zzt=v&%zz=v')).toBe('/x?%zzt=v&%zz=v');
    });
  });

  describe('where a pair starts and ends', () => {
    it('finds pairs after ?, & and ;', () => {
      expect(redactText('/x?a=1&t=2')).toBe(`/x?a=1&t=${R}`);
      expect(redactText('/x;t=2')).toBe(`/x;t=${R}`); // a pair after ; only starts a match when no earlier pair swallowed it
      expect(redactText('/x?t=1&t=2&a=3')).toBe(`/x?t=${R}&t=${R}&a=3`);
    });

    it('does not read a pair without a separator in front of it', () => {
      expect(redactText('t=abc')).toBe('t=abc');
      expect(redactText('/x/t=abc')).toBe('/x/t=abc');
    });

    it('stops the value at &, #, whitespace, quotes and angle brackets, and keeps what follows', () => {
      expect(redactText('/x?t=abc#frag')).toBe(`/x?t=${R}#frag`);
      expect(redactText('/x?t=abc&a=1')).toBe(`/x?t=${R}&a=1`);
      expect(redactText('GET /x?t=abc HTTP/1.1')).toBe(`GET /x?t=${R} HTTP/1.1`);
      expect(redactText('GET /x?t=abc\tnext')).toBe(`GET /x?t=${R}\tnext`);
      expect(redactText('"/x?t=abc" failed')).toBe(`"/x?t=${R}" failed`);
      expect(redactText("'/x?t=abc' failed")).toBe(`'/x?t=${R}' failed`);
      expect(redactText('<a href=/x?t=abc>')).toBe(`<a href=/x?t=${R}>`);
    });

    it('masks an empty value too, and a value with an equals sign inside', () => {
      expect(redactText('/x?t=')).toBe(`/x?t=${R}`);
      expect(redactText('/x?t=a=b=c')).toBe(`/x?t=${R}`);
    });

    it('ends the name at =, &, #, whitespace, quotes and angle brackets', () => {
      expect(redactText('/x?a b=1')).toBe('/x?a b=1');
      expect(redactText('/x?a#t=1')).toBe('/x?a#t=1'); // t is in the fragment here, not a parameter
      expect(redactText('/x?"t=1')).toBe('/x?"t=1');
      expect(redactText('/x?<t=1')).toBe('/x?<t=1');
      expect(redactText('/x?a&t=1')).toBe(`/x?a&t=${R}`);
    });

    it('needs at least one character in the name', () => {
      expect(redactText('/x?=abc')).toBe('/x?=abc');
    });

    it('leaves text without any equals sign untouched', () => {
      expect(redactText('/x?token')).toBe('/x?token');
      expect(redactText('')).toBe('');
    });
  });

  describe('maskEmails', () => {
    it.each<[string, string]>([
      ['jane@example.org', 'j***@example.org'],
      ['a@b.de', 'a***@b.de'],
      ['jane.doe@example.org', 'j***@example.org'],
      ['jane+tag@example.org', 'j***@example.org'],
      ["o'brien@example.org", 'o***@example.org'],
      ['j_d-x%y@sub.example.co.uk', 'j***@sub.example.co.uk'],
      ['jane@my-host.example.org', 'j***@my-host.example.org'],
      ['jane@a.b', 'j***@a.b'],
      ['1234@example.org', '1***@example.org'],
      ['JANE@EXAMPLE.ORG', 'J***@EXAMPLE.ORG'],
      ['x{y|z}~@example.org', 'x***@example.org'],
      ['!#$%&*/=?^`@example.org', '!***@example.org'],
    ])('masks %s', (input, expected) => {
      expect(maskEmails(input)).toBe(expected);
      expect(maskEmails(`550 rejected <${input}> by server`)).toBe(`550 rejected <${expected}> by server`);
    });

    it('masks every address in a text', () => {
      expect(maskEmails('from a@x.de to b@y.org, c@z.net')).toBe('from a***@x.de to b***@y.org, c***@z.net');
    });

    it('leaves text that is no address alone', () => {
      for (const text of ['', 'no at sign', '@example.org', 'jane@', 'jane@localhost', 'jane@.org', 'jane@example.', 'jane @example.org']) {
        const out = maskEmails(text);
        expect(out).not.toContain('***');
      }
      expect(maskEmails('')).toBe('');
    });

    it('stops the domain at its last label and does not swallow a trailing dot or hyphen', () => {
      expect(maskEmails('mail jane@example.org.')).toBe('mail j***@example.org.');
      expect(maskEmails('jane@example.org-')).toBe('j***@example.org-');
      expect(maskEmails('jane@-example.org')).not.toContain('***');
    });
  });

  describe('mailErrorText', () => {
    it('shows the SMTP code and response code in brackets, and masks the address in the message', () => {
      const e = Object.assign(new Error('550 5.1.1 <jane@example.org> rejected'), { code: 'EENVELOPE', responseCode: 550 });
      expect(mailErrorText(e)).toBe('[EENVELOPE 550] 550 5.1.1 <j***@example.org> rejected');
    });

    it('shows just the one tag that exists, and none when neither does', () => {
      expect(mailErrorText(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe('[ETIMEDOUT] x');
      expect(mailErrorText(Object.assign(new Error('x'), { responseCode: 421 }))).toBe('[421] x');
      expect(mailErrorText(new Error('x'))).toBe('x');
      expect(mailErrorText(Object.assign(new Error('x'), { code: 5, responseCode: '550' }))).toBe('x');
    });

    it('masks addresses in whatever else was thrown', () => {
      expect(mailErrorText('failed for jane@example.org')).toBe('failed for j***@example.org');
      expect(mailErrorText(null)).toBe('null');
    });
  });

  describe('serializeRequest', () => {
    it('has the fields of the default serializer, with the URL masked', () => {
      expect(serializeRequest({
        method: 'GET', url: '/photos/a.png?t=abc', headers: { 'accept-version': '1.0.0' },
        host: 'app.example', hostname: 'other', ip: '203.0.113.9', socket: { remotePort: 51234 },
      })).toEqual({
        method: 'GET', url: `/photos/a.png?t=${R}`, version: '1.0.0', host: 'app.example',
        remoteAddress: '203.0.113.9', remotePort: 51234,
      });
    });

    it('copes with a request that has no headers, socket or url, and falls back to hostname', () => {
      expect(serializeRequest({ method: 'GET', hostname: 'only-hostname' })).toEqual({
        method: 'GET', url: undefined, version: undefined, host: 'only-hostname', remoteAddress: undefined, remotePort: undefined,
      });
    });
  });

  describe('serializeError', () => {
    it('masks credentials and addresses in message and stack, and names the class', () => {
      class UrlError extends Error {}
      const err = new UrlError('bad /photos/a.png?t=abc for jane@example.org');
      const out = serializeError(err);
      expect(out.type).toBe('UrlError');
      expect(out.message).toBe(`bad /photos/a.png?t=${R} for j***@example.org`);
      expect(out.stack).toContain(`?t=${R}`);
      expect(out.stack).not.toContain('abc');
      expect(out.stack).not.toContain('jane@');
    });

    it('falls back to the error name when there is no constructor, and to an empty stack when there is none', () => {
      const err = Object.assign(new Error('m'), { constructor: undefined, stack: undefined });
      const out = serializeError(err);
      expect(out.type).toBe('Error');
      expect(out.stack).toBe('');
    });

    it('keeps own enumerable properties, masked, but never lets them replace type, message or stack', () => {
      const err = Object.assign(new Error('real'), {
        code: 'FST_ERR', url: '/x?t=abc', who: 'jane@example.org', count: 3, type: 'forged',
      });
      const out = serializeError(err);
      expect(out.code).toBe('FST_ERR');
      expect(out.url).toBe(`/x?t=${R}`);
      expect(out.who).toBe('j***@example.org');
      expect(out.count).toBe(3);
      expect(out.type).toBe('Error');
      expect(out.message).toBe('real');

      Object.defineProperty(err, 'message', { value: '/x?t=abc', enumerable: true });
      expect(serializeError(err).message).toBe(`/x?t=${R}`);
    });

    it('serializes a cause that is an error, and drops one that is not', () => {
      const withCause = serializeError(new Error('outer', { cause: new Error('inner /x?t=abc') }));
      expect(withCause.cause).toMatchObject({ type: 'Error', message: `inner /x?t=${R}` });
      expect('cause' in serializeError(new Error('outer', { cause: 'just text' }))).toBe(false);
      expect('cause' in serializeError(new Error('outer'))).toBe(false);
    });

    it('hands anything that is not an Error back unchanged', () => {
      const notAnError = { message: 'x?t=abc' } as unknown as Error;
      expect(serializeError(notAnError)).toBe(notAnError as unknown);
    });
  });

  describe('buildLoggerOptions', () => {
    it('wires the serializers, the level and the stream', () => {
      const stream = new Writable({ write(_c, _e, cb) { cb(); } });
      const opts = buildLoggerOptions('warn', stream);
      expect(opts.level).toBe('warn');
      expect(opts.stream).toBe(stream);
      expect(opts.serializers.req).toBe(serializeRequest);
      expect(opts.serializers.err).toBe(serializeError);
      expect('stream' in buildLoggerOptions('info')).toBe(false);
    });

    it('masks string arguments of a log call and leaves other arguments alone', () => {
      const calls: unknown[][] = [];
      const method = function (this: unknown, ...args: unknown[]) { calls.push(args); };
      const opts = buildLoggerOptions('info');
      const obj = { url: '/x?t=abc' };
      opts.hooks.logMethod.call({}, [obj, 'Route GET:/photos/x?t=abc not found for jane@example.org', 7, null], method);
      expect(calls).toEqual([[obj, `Route GET:/photos/x?t=${R} not found for j***@example.org`, 7, null]]);
      expect(calls[0][0]).toBe(obj); // objects go through the serializers, not through this hook
    });
  });
});
