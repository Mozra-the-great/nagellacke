/**
 * #498: the real transport of the SSRF guard (#401), `requestOnce` in outbound.ts, driven
 * with a fake `node:https` so no socket is opened. outbound.test.ts replaces the whole
 * transport with its own fake and only reaches the real one through a loopback listener
 * that proves a refusal; what the real one hands to https.request, and how it turns the
 * response into the guard's answer, is pinned here.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboundBlockedError, createGuardedFetch } from './outbound';

const https = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:https', () => ({ request: https.request, default: { request: https.request } }));

interface FakeReq extends EventEmitter { end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }
type ResponseSpec = { statusCode?: number; headers?: Record<string, string | string[] | undefined>; body?: string | Buffer };

/** Makes https.request answer once with the given response, or never. */
function answerWith(spec: ResponseSpec | 'never'): FakeReq {
  const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() }) as FakeReq;
  https.request.mockImplementationOnce((_url: URL, _opts: unknown, cb: (res: PassThrough) => void) => {
    if (spec !== 'never') {
      queueMicrotask(() => {
        const res = Object.assign(new PassThrough(), { statusCode: spec.statusCode, headers: spec.headers ?? {} });
        cb(res);
        res.end(spec.body ?? '');
      });
    }
    return req;
  });
  return req;
}

const URL0 = 'https://searx.example.org/search?q=1';

beforeEach(() => https.request.mockReset());

describe('the real transport', () => {
  it('sends one GET to the URL with the caller headers, the abort signal, no shared agent, and ends the request', async () => {
    const req = answerWith({ statusCode: 200, body: 'ok' });
    const res = await createGuardedFetch({})(URL0, { headers: { accept: 'application/json' } });
    expect(await res.text()).toBe('ok');

    expect(https.request).toHaveBeenCalledTimes(1);
    const [url, opts] = https.request.mock.calls[0] as [URL, Record<string, unknown>];
    expect(String(url)).toBe(URL0);
    expect(opts.method).toBe('GET');
    expect(opts.headers).toEqual({ accept: 'application/json' });
    expect(opts.agent).toBe(false);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(req.end).toHaveBeenCalledTimes(1);
  });

  it('connects through the guarded lookup: a name that resolves to a private address never gets a socket', async () => {
    answerWith({ statusCode: 200 });
    await createGuardedFetch({})(URL0);
    const opts = https.request.mock.calls[0][1] as { lookup: (h: string, o: object, cb: (e: Error | null, a?: unknown, f?: number) => void) => void };
    expect(typeof opts.lookup).toBe('function');
    // "localhost" resolves to a loopback address on every machine, with or without a network.
    const [err, address, family] = await new Promise<unknown[]>((resolve) => opts.lookup('localhost', {}, (...args) => resolve(args)));
    expect(err).toBeInstanceOf(OutboundBlockedError);
    expect([address, family]).toEqual(['', 4]);
  });

  it('turns the response into status, Location and body', async () => {
    answerWith({ statusCode: 302, headers: { location: 'https://other.example.org/x' } });
    answerWith({ statusCode: 200, headers: {}, body: 'final' });
    const res = await createGuardedFetch({})(URL0);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('final');
    expect(String((https.request.mock.calls[1] as [URL])[0])).toBe('https://other.example.org/x');
  });

  it('ignores a Location that is not a single string, and reads a missing status as 0', async () => {
    answerWith({ statusCode: 302, headers: { location: ['https://a.example.org/', 'https://b.example.org/'] }, body: 'stay' });
    const res = await createGuardedFetch({})(URL0);
    expect(https.request).toHaveBeenCalledTimes(1); // no redirect was followed
    expect(res.status).toBe(302);
    expect(await res.text()).toBe('stay');

    answerWith({ headers: {} });
    const none = await createGuardedFetch({})(URL0);
    expect(none.status).toBe(0);
    expect(none.ok).toBe(false);
  });

  it('refuses a body over the cap, destroys the request and says why', async () => {
    const req = answerWith({ statusCode: 200, body: 'x'.repeat(11) });
    await expect(createGuardedFetch({ maxBytes: 10 })(URL0)).rejects.toThrow('Die Antwort ist zu groß');
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });

  it('accepts a body of exactly the cap', async () => {
    answerWith({ statusCode: 200, body: 'x'.repeat(10) });
    const res = await createGuardedFetch({ maxBytes: 10 })(URL0);
    expect((await res.text()).length).toBe(10);
  });

  it('rejects with the request error', async () => {
    const req = answerWith('never');
    const pending = createGuardedFetch({})(URL0);
    await new Promise((r) => setTimeout(r, 0));
    req.emit('error', new Error('ECONNRESET'));
    await expect(pending).rejects.toThrow('ECONNRESET');
  });
});
