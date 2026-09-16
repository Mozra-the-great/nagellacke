import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerAdapter } from './server';

/**
 * Fastify's JSON body parser 400s a request whose Content-Type is
 * application/json but whose body is empty. `deletePhoto()` sends a bodyless
 * DELETE, so it must not send that header - it used to, via the same
 * `headers()` every other (bodied) request went through, which is exactly why
 * DELETE /api/photos/:filename 400'd and every deleted record's photo was
 * silently left on disk.
 */
describe('ServerAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  function adapter(): ServerAdapter {
    return new ServerAdapter({ provider: 'server', serverUrl: 'https://example.test', serverToken: 'tok' });
  }

  it('omits Content-Type on the bodyless DELETE request', async () => {
    await adapter().deletePhoto('photo-123.jpg');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/api/photos/photo-123.jpg');
    expect(init.method).toBe('DELETE');
    const headers = new Headers(init.headers);
    expect(headers.has('Content-Type')).toBe(false);
    expect(headers.get('Authorization')).toBe('Bearer tok');
  });

  it('still sends Content-Type on requests with a body', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ filename: 'f.jpg' }), { status: 200 }));

    await adapter().uploadPhoto('base64data', 'image/png');

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});
