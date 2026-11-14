import type { Writable } from 'node:stream';

/**
 * Keeps credentials that travel in a URL out of the server log (#450).
 *
 * `/photos/<file>?t=<token>` carries a signed access token in the query string
 * (an <img> tag and a mail client cannot send an Authorization header, see
 * photoToken.ts). Fastify logs the request URL on every request ("incoming
 * request" and the 404 line), so anyone who could read the log - journald, a
 * log shipper, a support bundle, `GET /api/logs` - could replay a token that is
 * still valid. The token is masked at every place the URL reaches the logger:
 *  - the `req` serializer (the "incoming request" line),
 *  - free text in log messages (Fastify's "Route GET:/photos/x?t=... not found"),
 *  - the message and stack of a logged error (e.g. FST_ERR_BAD_URL repeats the URL).
 *
 * The masking is name based: the value of a query parameter is replaced when
 * its name is one of the known credential names or looks like one. Everything
 * else (`lines`, `period`, ...) stays readable, which keeps the log useful.
 */

export const REDACTED = '[REDACTED]';

/** Parameter names that are credentials on their own. */
const EXACT_NAMES = new Set(['t', 'k', 'key', 'sig', 'sign', 'auth', 'code', 'otp', 'sid', 'jwt', 'pwd', 'pw']);
/** A name containing one of these is treated as a credential too. */
const NAME_PATTERN = /token|secret|passw|apikey|api[-_]key|signature|credential|bearer|session|authoriz/i;

function isSensitiveName(rawName: string): boolean {
  let name = rawName;
  try {
    name = decodeURIComponent(rawName.replace(/\+/g, ' '));
  } catch {
    // Malformed escape: judge the raw spelling.
  }
  name = name.trim();
  return EXACT_NAMES.has(name.toLowerCase()) || NAME_PATTERN.test(name);
}

/**
 * `?name=value` / `&name=value` pairs anywhere in a string. The name stops at
 * `=`, `&`, `#` or whitespace/quotes; the value at `&`, `#`, whitespace or a
 * quote, so a pair inside a log sentence ends where the sentence's URL ends.
 */
const QUERY_PAIR = /([?&;])([^=&#\s"'<>]+)=([^&#\s"'<>]*)/g;

/** Masks the value of every credential-like query parameter in `text` (a URL or a log message). */
export function redactText(text: string): string {
  if (!text.includes('=')) return text;
  return text.replace(QUERY_PAIR, (match, sep: string, name: string) =>
    isSensitiveName(name) ? `${sep}${name}=${REDACTED}` : match);
}

/** Alias that reads better where the input is known to be a request URL. */
export const redactUrl = redactText;

function redactValue(value: unknown): unknown {
  return typeof value === 'string' ? redactText(value) : value;
}

interface RequestLike {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  host?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

/** Same fields as Fastify's default `req` serializer, with the URL masked. */
export function serializeRequest(req: RequestLike): Record<string, unknown> {
  const version = req.headers?.['accept-version'];
  return {
    method: req.method,
    url: typeof req.url === 'string' ? redactUrl(req.url) : req.url,
    version,
    host: req.host ?? req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

/**
 * Error serializer with the same shape as pino's (`type`, `message`, `stack`,
 * plus own enumerable properties such as `code`), but with query credentials
 * masked in every string. Fastify itself puts URLs into error text: FST_ERR_BAD_URL,
 * FST_ERR_REP_ALREADY_SENT.
 */
export function serializeError(err: Error): SerializedError {
  // pino hands over whatever was logged under `err`; only real errors are reshaped.
  if (!(err instanceof Error)) return err as unknown as SerializedError;
  const out: SerializedError = {
    type: err.constructor?.name ?? err.name,
    message: redactText(err.message),
    stack: redactText(err.stack ?? ''),
  };
  for (const key of Object.keys(err)) {
    if (key in out) continue;
    out[key] = redactValue((err as unknown as Record<string, unknown>)[key]);
  }
  if (err.cause instanceof Error) out.cause = serializeError(err.cause);
  return out;
}

interface SerializedError {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
}

type LogFn = (this: unknown, ...args: unknown[]) => void;

interface LoggerConfig {
  level: string;
  stream?: Writable;
  serializers: { req: typeof serializeRequest; err: typeof serializeError };
  hooks: { logMethod: (this: unknown, args: unknown[], method: LogFn) => void };
}

/**
 * Logger configuration for Fastify. `stream` exists for tests, which capture the
 * log lines to prove no credential reaches them.
 */
export function buildLoggerOptions(level: string, stream?: Writable): LoggerConfig {
  return {
    level,
    ...(stream ? { stream } : {}),
    serializers: {
      req: serializeRequest,
      err: serializeError,
    },
    hooks: {
      // Free-text messages ("Route GET:/photos/x?t=... not found") bypass the
      // serializers, so mask string arguments as well. Objects are left alone:
      // they pass through the serializers above.
      logMethod(args, method) {
        method.apply(this, args.map(redactValue));
      },
    },
  };
}
