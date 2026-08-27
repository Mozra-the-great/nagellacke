import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import staticFiles from '@fastify/static';
import rateLimitPlugin from '@fastify/rate-limit';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as https from 'node:https';
import { spawnSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { mergeData } from '@nagellacke/core';
import type { AppData } from '@nagellacke/core';
import {
  getData, setData, getUser, getUserCount, getFirstUsername, createUser, updateUserEmail,
  bumpTokenVersion, migrateGlobalDataToFirstUser, migrateFirstUserToAdmin, getScheduleConfig, setScheduleConfig,
  getAiConfig, setAiConfig, addAiJob, getAiJob, PHOTOS_DIR, DATA_DIR,
  setTotpPending, enableTotp, disableTotp, updateTotpCounter, consumeRecoveryCode, setRecoveryCodes,
  recordTotpFailure, clearTotpFailures, totpLockedUntil,
  recordLoginFailure, clearLoginFailures, loginLockedUntil,
  isAdmin, setUserRole, listUsers, deleteUser, countAdmins,
  getServerSettings, setServerSettings, logAdminAction, getAuditLog,
} from './db';
import type { ScheduleConfig, AiConfig, AiJob, UserRole, ServerSettings } from './db';
import { processAiJobQueue, isAiConfigured, testAiConnection } from './ai';
import type { SearchBackend } from './websearch';
import { generateReportHtml, getPeriodBounds } from './report';
import { isEmailConfigured, sendHtmlEmail, sendTestEmail } from './email';
import { generateTotpSecret, buildOtpauthUri, verifyTotpCode, generateRecoveryCodes } from './totp';

const SEARCH_BACKENDS: SearchBackend[] = ['duckduckgo', 'searxng', 'brave', 'off'];

// Shared by GET /api/ai/settings and GET /api/admin/settings (§4.2 embeds the
// same shape under `ai`) — secrets are never sent back, only whether they're set.
function aiSettingsView(config: AiConfig) {
  return {
    provider: config.provider,
    openrouter: { model: config.openrouter.model, freeOnly: config.openrouter.freeOnly, hasApiKey: !!config.openrouter.apiKey },
    gemini: { model: config.gemini.model, hasApiKey: !!config.gemini.apiKey },
    webSearch: {
      backend: config.webSearch.backend,
      searxngUrl: config.webSearch.searxngUrl,
      hasBraveApiKey: !!config.webSearch.braveApiKey,
    },
  };
}

const PORT         = Number(process.env.PORT ?? 3000);

// Fail closed in production: an unset ALLOWED_ORIGIN silently defaulting to
// "*" is fine for local dev, but a misconfigured production deployment
// should refuse to start rather than quietly serve wildcard CORS (#76).
if (!process.env.ALLOWED_ORIGIN && process.env.NODE_ENV === 'production') {
  console.error('[FATAL] ALLOWED_ORIGIN must be set explicitly when NODE_ENV=production.');
  process.exit(1);
}
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';

if (ALLOWED_ORIGIN === '*') {
  console.warn('[WARN] ALLOWED_ORIGIN is not set — CORS is open to all origins');
}
const SERVICE_NAME = process.env.SERVICE_NAME ?? 'nagellacke-v3';
const APP_ROOT     = path.resolve(process.cwd(), '..', '..');  // /opt/nagellacke

// ── Validate SERVICE_NAME (prevent injection) ─────────────────────────────────
if (!/^[a-zA-Z0-9_.-]+$/.test(SERVICE_NAME)) {
  console.error('Ungültiger SERVICE_NAME:', SERVICE_NAME);
  process.exit(1);
}

// ── X-Api-Key auth (v2-kompatibel) ────────────────────────────────────────────
// NOTE: this key is effectively a root credential — it authorizes
// /api/update/apply, which pulls and executes arbitrary repo code. Treat losing
// it like losing a shell on the host, and rotate it (see rotateApiKey below).
const API_KEY_FILE = path.join(DATA_DIR, '.api_key');
// Age after which startup nags about rotating (#108). Not enforced: the key is
// the only way in for admin endpoints, so expiring it automatically would lock
// the operator out of a self-hosted box with no recovery path.
const API_KEY_MAX_AGE_DAYS = 180;

let API_KEY: string;
let API_KEY_IS_NEW = false;

function writeApiKey(key: string): void {
  fs.writeFileSync(API_KEY_FILE, key, { mode: 0o600 });
}

if (fs.existsSync(API_KEY_FILE)) {
  const stored = fs.readFileSync(API_KEY_FILE, 'utf-8').trim();
  // Fail closed, not open: safeEqual() below compares two zero-length
  // buffers as equal, and an empty X-Api-Key header passes the `typeof
  // === 'string'` check - so a zero-byte .api_key (truncated write, disk
  // full, manual `> data/.api_key`) would otherwise silently accept an
  // empty key and hand out the same de-facto root credential as
  // /api/update/apply and now /api/admin/bootstrap to anyone (#216 review
  // item 3). Refuse to start instead.
  if (!stored) {
    console.error(`[FATAL] ${API_KEY_FILE} exists but is empty. Refusing to start with an empty API key (that would authenticate an empty X-Api-Key header). Delete the file to generate a fresh key on next start, or restore a valid one.`);
    process.exit(1);
  }
  API_KEY = stored;
} else {
  API_KEY = crypto.randomBytes(24).toString('hex');
  writeApiKey(API_KEY);
  API_KEY_IS_NEW = true;
}

/** Age of the current key in days, or null if it can't be determined. */
function apiKeyAgeDays(): number | null {
  try {
    const { mtimeMs } = fs.statSync(API_KEY_FILE);
    return Math.floor((Date.now() - mtimeMs) / 86_400_000);
  } catch {
    return null;
  }
}

/** Generates and persists a fresh key, replacing the current one immediately. */
function rotateApiKey(): string {
  API_KEY = crypto.randomBytes(24).toString('hex');
  writeApiKey(API_KEY);
  return API_KEY;
}

// ── JWT secret (persistent) ────────────────────────────────────────────────────
function loadOrCreateSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const f = path.join(DATA_DIR, '.jwt_secret');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf-8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const JWT_SECRET = loadOrCreateSecret();

// users.json already holds scrypt password hashes and, as of this PR, TOTP
// secrets and recovery-code hashes too. writeUsers() (db.ts) now creates it
// with mode 0600, but that only applies at file *creation* - installs
// upgrading in place may have an existing users.json created world/group
// readable under the old default mode. Tighten it once at startup.
if (fs.existsSync(path.join(DATA_DIR, 'users.json'))) {
  fs.chmodSync(path.join(DATA_DIR, 'users.json'), 0o600);
}

// Access tokens were 30d, so a token leaked out of localStorage stayed usable
// for a month (#109). Shortened to 7d, with a long-lived refresh token both
// the web client and the Android app (see ServerAdapter.kt, #220) trade in
// silently on a 401 — cutting the exposure window fourfold either way.
const ACCESS_TOKEN_TTL  = process.env.JWT_ACCESS_TTL  ?? '7d';
const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_TTL ?? '30d';

// ── Image validation ──────────────────────────────────────────────────────────
const MAGIC: [Buffer, string][] = [
  [Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'],
  [Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png'],
  [Buffer.from([0x52, 0x49, 0x46, 0x46]), 'image/webp'],
];
function validImage(buf: Buffer): boolean {
  return MAGIC.some(([m]) => buf.slice(0, m.length).equals(m));
}

// ── Password hashing ──────────────────────────────────────────────────────────
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

// Constant-time string comparison (avoids leaking the API key via response-time
// side channel - crypto.timingSafeEqual itself requires equal-length buffers).
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Sync payload validation ───────────────────────────────────────────────────
// mergeList() (@nagellacke/core) does `for (const item of list) map.set(item.id, item)`
// with no runtime checks — a non-array (e.g. a string) gets iterated char-by-char,
// and non-object items produce a garbage entry keyed by `undefined`. Either one
// gets merged into the user's real collection and persisted to disk (#217).
const APP_DATA_LIST_KEYS = ['polishes', 'customCats', 'manicures', 'stickers'] as const;
function isValidAppDataList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).id === 'string' &&
      typeof (item as Record<string, unknown>).updatedAt === 'number',
  );
}
function isValidAppData(value: unknown): value is AppData {
  // Array.isArray first: an array passes `typeof x === 'object'`, and every list key
  // reads back as undefined on it, so a bare `data: []` would sail through the loop
  // below as a valid-but-empty AppData and overwrite nothing-shaped over the merge.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return APP_DATA_LIST_KEYS.every((key) => {
    const list = (value as Record<string, unknown>)[key];
    return list === undefined || isValidAppDataList(list);
  });
}

// ── GitHub version check helper ───────────────────────────────────────────────
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'nagellacke-v3' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location!).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c: string) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('GitHub API Timeout')); });
  });
}

/**
 * Builds and configures the Fastify instance (plugins, auth helpers, every
 * route) without binding a port or starting any background interval. Split
 * out of main() so tests can exercise routes via app.inject() (see #174) —
 * the report-scheduler and AI-job-queue intervals stay in main(), not here,
 * because moving them into buildApp() would leave dangling timers/open
 * handles behind every test that calls this function.
 */
export async function buildApp(): Promise<FastifyInstance> {
  // Must run before any request is served (#87, #173).
  migrateGlobalDataToFirstUser();
  migrateFirstUserToAdmin();

  // No trustProxy: the default deployment (install.sh) binds directly to 0.0.0.0,
  // so req.ip (used as the rate-limit key below) is the real client IP. If you put
  // this behind a reverse proxy, set trustProxy to that proxy's address specifically
  // — never `true` — or every client collapses onto one rate-limit bucket and an
  // X-Forwarded-For header lets anyone spoof their way around the limits.
  const app = Fastify({ logger: { level: process.env.VITEST ? 'silent' : 'info' } });

  // @fastify/cors defaults `methods` to the literal string 'GET,HEAD,POST' — it
  // does not reflect the routes actually registered. Every preflight therefore
  // advertised those three methods, so a browser refused to send the real
  // DELETE /api/photos/:filename or PATCH /api/auth/me whenever the web app was
  // served from a different origin than the API (GitHub Pages, or a "Eigener
  // Server" URL pointing elsewhere). Invisible in the same-origin install.sh
  // deployment, where CORS is skipped entirely. (#112)
  await app.register(cors, {
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  });
  await app.register(jwt, { secret: JWT_SECRET });
  // global: false — each /api/* route below opts in via its own `config.rateLimit`.
  // A global default would also throttle /photos/ and the SPA static assets,
  // and the gallery renders its full photo list unpaginated/unlazy on load, so a
  // shared bucket would 429 legitimate thumbnail bursts on any sizeable collection.
  // In-memory store resets on restart — acceptable for a personal single-user deployment.
  await app.register(rateLimitPlugin, {
    global: false,
    errorResponseBuilder: (_request, context) => {
      const err = new Error('Zu viele Anfragen') as Error & { statusCode: number };
      err.statusCode = context.statusCode;
      return err;
    },
  });
  await app.register(staticFiles, { root: PHOTOS_DIR, prefix: '/photos/' });

  // Rate-limit errors (and any other thrown error) are reshaped to the app's
  // uniform { error: string } response format instead of Fastify's default
  // { statusCode, error, message } shape.
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      return reply.code(statusCode).send({ error: 'Interner Fehler' });
    }
    reply.code(statusCode).send({ error: error.message || 'Interner Fehler' });
  });

  // Serve web app (built to public/ by install.sh or update/apply)
  const publicDir = path.join(process.cwd(), 'public');
  if (fs.existsSync(publicDir)) {
    await app.register(staticFiles, { root: publicDir, prefix: '/', decorateReply: false });
  }

  // ── Auth helpers ──────────────────────────────────────────────────────────────

  async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
    const key = request.headers['x-api-key'];
    if (typeof key !== 'string' || !safeEqual(key, API_KEY)) {
      return reply.code(401).send({ error: 'Ungültiger API-Schlüssel' });
    }
  }

  // Rejects a verified JWT whose embedded tokenVersion doesn't match the
  // user's current token_version - lets /api/auth/logout-all invalidate
  // every previously issued token for that user immediately, without a
  // separate revocation list (#77).
  function tokenVersionValid(request: FastifyRequest): boolean {
    const { username, tokenVersion } = request.user as { username: string; tokenVersion?: number };
    const user = getUser(username);
    return !!user && (tokenVersion ?? 0) === (user.token_version ?? 0);
  }

  // Pre-existing security hole this feature forced us to notice and fix:
  // requireJwt/requireApiKeyOrJwt used to accept *any* validly signed JWT with
  // a matching tokenVersion, regardless of its `typ` claim - only
  // POST /api/auth/refresh checked `typ`. That meant a refresh token already
  // authenticated every protected route (/api/sync, /api/auth/me, /api/photos,
  // ...), since it carries the same secret and a valid tokenVersion. Now that
  // we're about to mint a third token type (`typ: 'mfa'`, the two-step-login
  // challenge token, see totp.ts), leaving this open would make the MFA gate
  // decorative too - the challenge token would authenticate full API access on
  // its own.
  //
  // Legacy tokens minted before the `typ` claim existed have no `typ` at all;
  // the `?? 'access'` fallback keeps them working as access tokens, so this is
  // backwards compatible. Only the new `refresh` and `mfa` types are now
  // rejected on protected routes.
  function tokenTypeValid(request: FastifyRequest): boolean {
    const { typ } = request.user as { typ?: string };
    return (typ ?? 'access') === 'access';
  }

  async function requireJwt(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    if (!tokenTypeValid(request) || !tokenVersionValid(request)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  }

  async function requireApiKeyOrJwt(request: FastifyRequest, reply: FastifyReply) {
    const key = request.headers['x-api-key'];
    if (key) {
      if (typeof key !== 'string' || !safeEqual(key, API_KEY)) {
        return reply.code(401).send({ error: 'Ungültiger API-Schlüssel' });
      }
      return;
    }
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'API-Key oder Login erforderlich' });
    }
    if (!tokenTypeValid(request) || !tokenVersionValid(request)) {
      return reply.code(401).send({ error: 'API-Key oder Login erforderlich' });
    }
  }

  // Self-contained (does not compose requireJwt) rather than relying on
  // reply.sent after an awaited sibling preHandler — that behavior isn't
  // guaranteed identical across Fastify majors, and this repo's package.json
  // (^5) already disagrees with what CLAUDE.md documents (v4). Mirrors
  // requireJwt's own body exactly, plus the role check (#173).
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    // tokenTypeValid matters more here than anywhere else: an `mfa` challenge
    // is handed out *before* the second factor has been checked, so accepting
    // one on an admin route would let a half-finished 2FA login administer the
    // server. A `refresh` token must not reach these routes either.
    if (!tokenTypeValid(request) || !tokenVersionValid(request)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const { username } = request.user as { username: string };
    if (!isAdmin(username)) {
      return reply.code(403).send({ error: 'Nur für Admins' });
    }
  }

  // Deprecation-period "or" for the four historically X-Api-Key-only admin
  // endpoints (#173 §2.3) — additive only, X-Api-Key keeps working unchanged.
  // Mirrors requireApiKeyOrJwt's key-present branch exactly (same truthiness
  // check, same error message on an invalid key) so that behavior is
  // byte-for-byte identical to today; only the no-credential/JWT branches are
  // new. NOTE (documented, not "fixed" here): the no-credential 401 body text
  // differs from plain requireApiKey ("Unauthorized" vs "Ungültiger
  // API-Schlüssel") because the JWT branch has to run first to tell the two
  // cases apart — the status code (401) and the client's status-only check
  // (SettingsPage.tsx) are unaffected.
  async function requireApiKeyOrAdminJwt(request: FastifyRequest, reply: FastifyReply) {
    const key = request.headers['x-api-key'];
    if (key) {
      if (typeof key !== 'string' || !safeEqual(key, API_KEY)) {
        return reply.code(401).send({ error: 'Ungültiger API-Schlüssel' });
      }
      return;
    }
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'API-Key oder Admin-Login erforderlich' });
    }
    if (!tokenTypeValid(request) || !tokenVersionValid(request)) {
      return reply.code(401).send({ error: 'API-Key oder Admin-Login erforderlich' });
    }
    const { username } = request.user as { username: string };
    if (!isAdmin(username)) {
      return reply.code(403).send({ error: 'Nur für Admins' });
    }
  }

  // POST /api/update/apply keeps its extra bar even under the admin-JWT path
  // (#173 §6): it is a documented RCE surface (git pull + npm install as this
  // process's user). Precisely what the re-confirmation buys, and what it
  // doesn't (PR #216 review item 5 — corrects an earlier, broader claim
  // here): the password check re-verifies the *same* password that was
  // already required to obtain the JWT via login, so it adds nothing against
  // someone who already knows that password — they could just log in again.
  // What it does guard against is a *stolen bearer token* held by someone who
  // does NOT know the password (e.g. exfiltrated via XSS from localStorage,
  // a copy-pasted Authorization header, a leaked log line): that token alone
  // is no longer enough to trigger the RCE path, unlike every other
  // admin-JWT-gated endpoint. X-Api-Key still works exactly as before with
  // no extra step; the update/apply auth mechanism itself is a separate,
  // pending decision — not changed here.
  async function requireApiKeyOrAdminReconfirm(request: FastifyRequest, reply: FastifyReply) {
    const key = request.headers['x-api-key'];
    if (key) {
      if (typeof key !== 'string' || !safeEqual(key, API_KEY)) {
        return reply.code(401).send({ error: 'Ungültiger API-Schlüssel' });
      }
      return;
    }
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'API-Key oder Admin-Login erforderlich' });
    }
    if (!tokenTypeValid(request) || !tokenVersionValid(request)) {
      return reply.code(401).send({ error: 'API-Key oder Admin-Login erforderlich' });
    }
    const { username } = request.user as { username: string };
    if (!isAdmin(username)) {
      return reply.code(403).send({ error: 'Nur für Admins' });
    }
    const { password } = (request.body ?? {}) as { password?: string };
    const user = getUser(username);
    if (!password || !user || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'Passwort-Bestätigung erforderlich' });
    }
  }

  // ── Photo endpoints ────────────────────────────────────────────────────────────

  // POST /api/photos — Foto hochladen (base64 body)
  app.post('/api/photos', {
    bodyLimit: 15 * 1024 * 1024,
    preHandler: requireApiKeyOrJwt,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { data: b64, mimeType } = request.body as { data?: string; mimeType?: string };
    if (!b64 || !mimeType) return reply.code(400).send({ error: 'data und mimeType erforderlich' });
    const buf = Buffer.from(b64, 'base64');
    if (!validImage(buf)) return reply.code(400).send({ error: 'Ungültiges Bildformat' });
    const ext      = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    const filename = `${uuidv4()}.${ext}`;
    const tmp      = path.join(PHOTOS_DIR, `${filename}.tmp`);
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, path.join(PHOTOS_DIR, filename));
    return { filename };
  });

  // DELETE /api/photos/:filename
  app.delete('/api/photos/:filename', {
    preHandler: requireApiKeyOrJwt,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    // Require a single `name.ext` segment — rejects bare "." / ".." and anything
    // that could resolve outside PHOTOS_DIR before we even build the path.
    if (!/^[\w-]+\.\w+$/.test(filename)) return reply.code(400).send({ error: 'Ungültiger Dateiname' });
    const photosRoot = path.resolve(PHOTOS_DIR);
    const p = path.resolve(photosRoot, filename);
    if (!p.startsWith(photosRoot + path.sep)) return reply.code(400).send({ error: 'Ungültiger Dateiname' });
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  });

  // GET /api/version
  app.get('/api/version', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as { version: string };
    return { version: pkg.version };
  });

  // GET /api/update/check — prüft GitHub auf neue Version
  app.get('/api/update/check', {
    preHandler: requireApiKeyOrAdminJwt,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async () => {
    const remoteUrl = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: APP_ROOT, stdio: 'pipe' })
      .stdout?.toString().trim() ?? '';
    const match = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as { version: string };
    const current = pkg.version;
    if (!match) return { current, latestVersion: null, updateAvailable: false };
    const [owner, repo] = match[1].split('/');

    // Harter Gesamt-Timeout: antwortet spätestens nach 8s um Nginx-Timeout zu vermeiden
    const deadline = new Promise<null>(resolve => setTimeout(() => resolve(null), 8_000));

    const fetchLatest = async (): Promise<string | null> => {
      try {
        const rel = JSON.parse(await httpsGet(`https://api.github.com/repos/${owner}/${repo}/releases/latest`)) as { tag_name?: string };
        return rel.tag_name?.replace(/^v/, '') ?? null;
      } catch { /* ignore */ }
      try {
        const tags = JSON.parse(await httpsGet(`https://api.github.com/repos/${owner}/${repo}/tags`)) as { name: string }[];
        const semver = tags.map(t => t.name).filter(t => /^v?\d+\.\d+\.\d+$/.test(t));
        semver.sort((a, b) => {
          const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
          const [ma, mi, pa] = parse(a);
          const [mb, mi2, pb] = parse(b);
          return mb - ma || mi2 - mi || pb - pa;
        });
        return semver[0]?.replace(/^v/, '') ?? null;
      } catch { /* ignore */ }
      return null;
    };

    const latestVersion = await Promise.race([fetchLatest(), deadline]);
    const semverGt = (a: string, b: string): boolean => {
      // Strip pre-release suffixes (e.g. "-rc.1") before parsing - otherwise
      // Number("0-rc") is NaN and every comparison against a running
      // pre-release build silently evaluates to false (#203).
      const p = (v: string) => v.split('-')[0].split('.').map(Number);
      const [aMaj, aMin, aPat] = p(a);
      const [bMaj, bMin, bPat] = p(b);
      return aMaj !== bMaj ? aMaj > bMaj : aMin !== bMin ? aMin > bMin : aPat > bPat;
    };
    const updateAvailable = latestVersion ? semverGt(latestVersion, current) : false;
    return { current, latestVersion, updateAvailable };
  });

  // POST /api/update/apply — git pull + rebuild + restart
  // Antwortet sofort, Build läuft im Hintergrund (verhindert Nginx-Timeout).
  // TRUST BOUNDARY: this pulls whatever HEAD of origin/main currently is - no
  // signature/tag pinning - and npm install runs arbitrary postinstall
  // scripts. requireApiKey is therefore a de facto root/RCE credential, not
  // a normal API key (see #73). Treat API_KEY accordingly; the alternative
  // (pinning to signed release tags) is a deliberate product decision, not
  // made here.
  app.post('/api/update/apply', {
    preHandler: requireApiKeyOrAdminReconfirm,
    config: { rateLimit: { max: 3, timeWindow: '5 minutes' } },
  }, async (request, reply) => {
    reply.send({ ok: true });

    setImmediate(() => {
      try {
        const v3Dir = path.join(APP_ROOT, 'v3');
        const steps = [
          { cmd: 'git', args: ['pull', 'origin', 'main'],    cwd: APP_ROOT,      timeout: 30_000 },
          { cmd: 'npm', args: ['install'],                    cwd: v3Dir,         timeout: 120_000 },
          { cmd: 'npm', args: ['run', 'build:core'],          cwd: v3Dir, timeout: 60_000 },
          { cmd: 'npm', args: ['run', 'build:sync'],          cwd: v3Dir, timeout: 60_000 },
          { cmd: 'npm', args: ['run', 'build:server'],        cwd: v3Dir, timeout: 60_000 },
          { cmd: 'npm', args: ['run', 'build:web'],           cwd: v3Dir, timeout: 120_000 },
        ];

        for (const { cmd, args, cwd, timeout } of steps) {
          const r = spawnSync(cmd, args, { cwd, stdio: 'pipe', timeout });
          if (r.status !== 0) {
            console.error('Update step failed:', r.stderr?.toString());
            return;
          }
        }

        // v3-Web-App nach public/ kopieren
        const v3WebDist = path.join(v3Dir, 'apps', 'web', 'dist');
        const v3Public  = path.join(process.cwd(), 'public');
        if (fs.existsSync(v3WebDist)) {
          if (fs.existsSync(v3Public)) fs.rmSync(v3Public, { recursive: true, force: true });
          fs.cpSync(v3WebDist, v3Public, { recursive: true });
        }

        setTimeout(() => {
          // Restart=always in the systemd unit brings the process back
          // automatically - no need to call `systemctl restart` (which would
          // require root, or a sudo/polkit rule the service shouldn't need
          // just to restart itself, see #71).
          process.exit(0);
        }, 300);
      } catch (e: unknown) {
        console.error('Update failed:', e instanceof Error ? e.message : e);
      }
    });
  });

  // POST /api/admin/api-key/rotate — replace the admin API key
  // Authorized with the *current* key, so an operator who still holds it can
  // invalidate a leaked copy without shell access to the box. Previously the
  // only rotation path was `rm data/.api_key` plus a restart (#108).
  app.post('/api/admin/api-key/rotate', {
    preHandler: requireApiKeyOrAdminJwt,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request) => {
    const apiKey = rotateApiKey();
    console.warn('[SECURITY] Admin API key rotated — every previously issued key is now invalid.');
    // request.user is only set on the admin-JWT path; requireApiKeyOrAdminJwt
    // returns early for a valid X-Api-Key without populating it.
    const actor = (request.user as { username?: string } | undefined)?.username ?? 'api-key';
    logAdminAction(actor, 'api_key.rotated');
    // Returned once, in the response to the authenticated rotation request
    // itself: the caller needs it to keep working, and it is never recoverable
    // from this endpoint again (only from data/.api_key on the host).
    return { apiKey, rotatedAt: Date.now() };
  });

  // GET /api/logs — systemd journal
  app.get('/api/logs', {
    preHandler: requireApiKeyOrAdminJwt,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request) => {
    // parseInt returns NaN for junk like ?lines=abc, and Math.min(NaN, 500) is
    // NaN — which used to reach journalctl as the literal string "NaN".
    const requested = Number.parseInt((request.query as { lines?: string }).lines ?? '100', 10);
    const lines = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 500) : 100;

    const args = ['-u', SERVICE_NAME, '-n', String(lines), '--no-pager', '--output=short-iso'];
    // install.sh grants exactly this invocation via /etc/sudoers.d, instead of
    // putting the service user in the systemd-journal group — which would have
    // granted read access to the whole system journal, not just our own unit
    // (#110). Fall back to a direct call so deployments that provision journal
    // access some other way (or run the server as root) keep working.
    let r = spawnSync('sudo', ['-n', 'journalctl', ...args], { stdio: 'pipe', timeout: 6000 });
    if (r.error || r.status !== 0) {
      r = spawnSync('journalctl', args, { stdio: 'pipe', timeout: 6000 });
    }
    if (r.status === 0) return { logs: r.stdout?.toString() ?? '', lines };
    return { logs: r.stderr?.toString().trim() || 'journalctl nicht verfügbar', lines, error: true };
  });

  // ── Admin panel (#173) ─────────────────────────────────────────────────────────

  // POST /api/admin/bootstrap — exchange the root X-Api-Key for an admin
  // session, once. Even though migrateFirstUserToAdmin()/first-user-at-register
  // already cover the realistic upgrade/fresh-install paths without this, the
  // issue explicitly asks for an explicit "use the key once" affordance. The
  // idempotent guard below is what makes "used once" an enforced server-side
  // fact, not just a UI convention.
  app.post('/api/admin/bootstrap', {
    preHandler: requireApiKey,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    if (countAdmins() > 0) {
      return reply.code(409).send({ error: 'Admin-Konto existiert bereits' });
    }
    const { username, password } = request.body as { username?: string; password?: string };
    if (!username || !password || password.length < 8) {
      return reply.code(400).send({ error: 'username und password (min 8 Zeichen) erforderlich' });
    }
    // If the account already exists, promoting it to admin and handing back
    // a session must not happen without proving knowledge of *that account's*
    // real password - the length check above only validates a fresh
    // password for the create-user branch, it says nothing about `existing`.
    // (PR #216 review item 2 - currently unreachable in practice since it
    // needs countAdmins() === 0 with an existing user, which
    // migrateFirstUserToAdmin() already prevents at every startup, but this
    // must not rely on that invariant alone.)
    const existing = getUser(username);
    if (existing) {
      if (!verifyPassword(password, existing.password_hash)) {
        return reply.code(401).send({ error: 'Passwort ungültig' });
      }
      setUserRole(username, 'admin');
    } else {
      createUser(username, hashPassword(password), 'admin');
    }
    logAdminAction(username, 'bootstrap.admin_created', username);
    const user = getUser(username)!;
    // Promoting the role is the root key holder's prerogative (they own the
    // filesystem anyway), but handing back a *session* must not skip the second
    // factor: an account with TOTP enabled gets the same mfaRequired challenge
    // POST /api/auth/login returns, never real tokens. Without this, whoever
    // holds the API key plus a username could mint an admin session for a
    // 2FA-protected account without ever touching its authenticator (#174).
    if (user.totp_enabled) {
      return { mfaRequired: true, challengeToken: issueMfaChallenge(user.username, user.token_version ?? 0) };
    }
    return issueTokens(user.username, user.token_version ?? 0);
  });

  // GET /api/admin/users
  app.get('/api/admin/users', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async () => {
    return { users: listUsers() };
  });

  // POST /api/admin/users — admin-created accounts always bypass the
  // allowRegistration gate (an admin adding a household member isn't "open
  // registration"); reuses the same password-length rule as self-registration.
  app.post('/api/admin/users', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username: actor } = request.user as { username: string };
    const { username, password, role } = request.body as { username?: string; password?: string; role?: UserRole };
    if (!username || !password || password.length < 8) {
      return reply.code(400).send({ error: 'username und password (min 8 Zeichen) erforderlich' });
    }
    if (role !== undefined && role !== 'admin' && role !== 'user') {
      return reply.code(400).send({ error: 'role muss "admin" oder "user" sein' });
    }
    if (getUser(username)) return reply.code(409).send({ error: 'Benutzer existiert bereits' });
    createUser(username, hashPassword(password), role ?? 'user');
    logAdminAction(actor, 'user.created', username, { role: role ?? 'user' });
    return { ok: true };
  });

  // PATCH /api/admin/users/:username/role
  app.patch('/api/admin/users/:username/role', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username: actor } = request.user as { username: string };
    const { username } = request.params as { username: string };
    const { role } = request.body as { role?: UserRole };
    if (role !== 'admin' && role !== 'user') {
      return reply.code(400).send({ error: 'role muss "admin" oder "user" sein' });
    }
    const target = getUser(username);
    if (!target) return reply.code(404).send({ error: 'Benutzer nicht gefunden' });
    // Last-admin protection, enforced server-side — never trust a
    // client-side disabled button alone (#173 §6).
    if (role === 'user' && isAdmin(username) && countAdmins() <= 1) {
      return reply.code(409).send({ error: 'Der letzte Admin kann nicht entfernt werden' });
    }
    setUserRole(username, role);
    if (role === 'user') {
      // Demotion is security-relevant: force re-login, same semantics as
      // every other bumpTokenVersion() call in this file.
      bumpTokenVersion(username);
    }
    logAdminAction(actor, 'user.role_changed', username, { role });
    return { ok: true };
  });

  // DELETE /api/admin/users/:username
  app.delete('/api/admin/users/:username', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username: actor } = request.user as { username: string };
    const { username } = request.params as { username: string };
    const target = getUser(username);
    if (!target) return reply.code(404).send({ error: 'Benutzer nicht gefunden' });
    if (username === actor) {
      return reply.code(409).send({ error: 'Das eigene Konto kann nicht gelöscht werden' });
    }
    if (isAdmin(username) && countAdmins() <= 1) {
      return reply.code(409).send({ error: 'Der letzte Admin kann nicht gelöscht werden' });
    }
    deleteUser(username);
    // Orphan cleanup: a schedule still pointing at the deleted user would
    // otherwise silently fall back to getFirstUsername() (see the scheduler
    // below) and mail a *different* account's collection to the old toEmail.
    const schedule = getScheduleConfig();
    if (schedule?.username === username) {
      setScheduleConfig({ ...schedule, enabled: false });
    }
    logAdminAction(actor, 'user.deleted', username);
    return { ok: true };
  });

  // GET /api/admin/settings — read-only display values plus, for the hard
  // env-only settings (§1), a trailing `env` block the UI badges as
  // requiresRestart. Secrets are never returned — only booleans/`source` tags.
  app.get('/api/admin/settings', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async () => {
    const settings = getServerSettings();
    const envAllowRegistration = process.env.ALLOW_REGISTRATION === 'true';
    const allowRegistrationSource = settings.allowRegistration !== undefined
      ? 'panel' : (process.env.ALLOW_REGISTRATION !== undefined ? 'env' : 'default');
    const smtp = settings.smtp;
    const smtpPort = smtp?.port || Number.parseInt(process.env.SMTP_PORT ?? '587', 10);
    return {
      allowRegistration: settings.allowRegistration ?? envAllowRegistration,
      allowRegistrationSource,
      smtp: {
        host: smtp?.host || process.env.SMTP_HOST || '',
        port: smtpPort,
        user: smtp?.user || process.env.SMTP_USER || '',
        from: smtp?.from || process.env.SMTP_FROM || '',
        secure: smtp?.secure ?? (smtpPort === 465),
        hasPassword: !!(smtp?.pass || process.env.SMTP_PASS),
        source: smtp ? 'panel' : (process.env.SMTP_HOST ? 'env' : 'default'),
      },
      // appUrl: stored for round-tripping through the panel, but the actual
      // email-link generation below still reads process.env.APP_URL once at
      // module load (APP_BASE_URL) — wiring a live read is deliberately
      // deferred (see #173 plan §9 "PR5", out of scope here). requiresRestart
      // reflects that honestly instead of implying an effect this PR doesn't have.
      appUrl: settings.appUrl || process.env.APP_URL || '',
      appUrlSource: settings.appUrl ? 'panel' : (process.env.APP_URL ? 'env' : 'default'),
      appUrlRequiresRestart: true,
      ai: aiSettingsView(getAiConfig()),
      env: {
        port: PORT,
        allowedOrigin: ALLOWED_ORIGIN,
        serviceName: SERVICE_NAME,
        dataDir: DATA_DIR,
        jwtAccessTtl: ACCESS_TOKEN_TTL,
        jwtRefreshTtl: REFRESH_TOKEN_TTL,
      },
    };
  });

  // POST /api/admin/settings — `smtp.pass` omitted means "keep current value",
  // the same "undefined means unchanged" convention POST /api/ai/settings
  // already uses.
  app.post('/api/admin/settings', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username: actor } = request.user as { username: string };
    const body = request.body as Partial<{
      allowRegistration: boolean;
      smtp: Partial<{ host: string; port: number; user: string; pass: string; from: string; secure: boolean }>;
      appUrl: string;
    }>;
    const current = getServerSettings();
    const next: ServerSettings = { ...current };

    if (body.allowRegistration !== undefined) next.allowRegistration = !!body.allowRegistration;

    if (body.appUrl !== undefined) next.appUrl = body.appUrl.trim().replace(/\/$/, '');

    if (body.smtp) {
      const currentSmtp = current.smtp;
      const port = body.smtp.port !== undefined ? Number(body.smtp.port) : (currentSmtp?.port ?? 587);
      if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        return reply.code(400).send({ error: 'smtp.port muss eine gültige Portnummer sein' });
      }
      next.smtp = {
        host: body.smtp.host !== undefined ? body.smtp.host.trim() : (currentSmtp?.host ?? ''),
        port,
        user: body.smtp.user !== undefined ? body.smtp.user.trim() : (currentSmtp?.user ?? ''),
        // Omitting pass keeps the stored value untouched.
        pass: body.smtp.pass !== undefined ? body.smtp.pass : (currentSmtp?.pass ?? ''),
        from: body.smtp.from !== undefined ? body.smtp.from.trim() : (currentSmtp?.from ?? ''),
        secure: body.smtp.secure !== undefined ? !!body.smtp.secure : currentSmtp?.secure,
      };
    }

    setServerSettings(next);
    // Never log the actual values of secret fields — only that they changed.
    logAdminAction(actor, 'server_settings.updated', undefined, {
      allowRegistration: body.allowRegistration !== undefined,
      appUrl: body.appUrl !== undefined,
      smtp: body.smtp !== undefined ? Object.keys(body.smtp) : undefined,
    });
    return { ok: true };
  });

  // POST /api/admin/settings/smtp/test — accepts an inline config override so
  // an admin can test before saving.
  app.post('/api/admin/settings/smtp/test', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username: actor } = request.user as { username: string };
    const body = request.body as {
      toEmail?: string;
      host?: string; port?: number; user?: string; pass?: string; from?: string; secure?: boolean;
    };
    const toEmail = (body.toEmail ?? '').trim();
    if (!toEmail || !isValidEmail(toEmail)) {
      return reply.code(400).send({ error: 'toEmail fehlt oder ist ungültig' });
    }
    try {
      await sendTestEmail(toEmail, {
        host: body.host, port: body.port, user: body.user, pass: body.pass, from: body.from, secure: body.secure,
      });
    } catch (e: unknown) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'Test-E-Mail konnte nicht gesendet werden' });
    }
    logAdminAction(actor, 'smtp.test_sent', toEmail);
    return { ok: true };
  });

  // POST /api/admin/settings/ai/test — minimal 1-request connectivity check.
  app.post('/api/admin/settings/ai/test', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { provider } = request.body as { provider?: AiConfig['provider'] };
    if (provider !== 'openrouter' && provider !== 'gemini') {
      return reply.code(400).send({ error: 'provider muss "openrouter" oder "gemini" sein' });
    }
    try {
      const result = await testAiConnection(provider);
      return { ok: true, model: result.model };
    } catch (e: unknown) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'KI-Verbindung fehlgeschlagen' });
    }
  });

  // GET /api/admin/audit
  app.get('/api/admin/audit', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async () => {
    return { entries: getAuditLog() };
  });

  // ── v3 Sync-Endpoints (JWT) ────────────────────────────────────────────────

  // ── User profile (JWT) ────────────────────────────────────────────────────────

  // GET /api/auth/me
  app.get('/api/auth/me', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request) => {
    const { username } = request.user as { username: string };
    const user = getUser(username);
    return {
      username,
      email: user?.email ?? null,
      smtpConfigured: isEmailConfigured(),
      totpEnabled: !!user?.totp_enabled,
      recoveryCodesRemaining: user?.recovery_codes?.length ?? 0,
      // An old server simply omits `role`; the client treats a missing role as
      // non-admin and hides the Admin tab — no error, degrades gracefully (#173).
      role: user?.role ?? 'user',
    };
  });

  // PATCH /api/auth/me
  app.patch('/api/auth/me', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const { email } = request.body as { email?: string };
    if (!email || !isValidEmail(email)) {
      return reply.code(400).send({ error: 'Ungültige E-Mail-Adresse' });
    }
    updateUserEmail(username, email.trim().toLowerCase());
    return { ok: true };
  });

  // ── Report endpoints (JWT) ────────────────────────────────────────────────────

  // Use APP_URL env var — never derive the base URL from request headers to
  // prevent host-header poisoning attacks on generated email links.
  const APP_BASE_URL = (process.env.APP_URL ?? '').replace(/\/$/, '');

  function isValidEmail(s: string): boolean {
    if (!s || s.length > 254) return false;
    // Reject CR/LF and other control characters outright — a defense-in-depth
    // guard against SMTP header injection if an address ever ends up written
    // into a raw email header (see #259; nodemailer's own addressparser
    // likely already neutralizes this, but this makes it explicit).
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(s)) return false;
    const at = s.lastIndexOf('@');
    if (at <= 0 || at >= s.length - 1) return false;
    const domain = s.slice(at + 1);
    return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
  }

  // GET /api/reports/preview?period=week&date=2026-06-19
  app.get('/api/reports/preview', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const query = request.query as { period?: string; date?: string };
    const period = (query.period === 'month' ? 'month' : 'week') as 'week' | 'month';
    const date = query.date ? new Date(query.date + 'T00:00:00') : new Date();
    if (isNaN(date.getTime())) return reply.code(400).send({ error: 'Ungültiges Datum' });
    const html = generateReportHtml(getData(username), period, date, APP_BASE_URL);
    return reply.type('text/html').send(html);
  });

  // POST /api/reports/send — send email immediately (rate limited: 10/hour per IP)
  app.post('/api/reports/send', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    if (!isEmailConfigured()) {
      return reply.code(503).send({ error: 'E-Mail nicht konfiguriert (SMTP_HOST, SMTP_USER, SMTP_PASS fehlen)' });
    }
    const { username } = request.user as { username: string };
    const { period: rawPeriod, date: rawDate, toEmail: rawToEmail } = request.body as { period?: string; date?: string; toEmail?: string };
    const toEmail = (rawToEmail ?? '').trim();
    if (!toEmail || !isValidEmail(toEmail)) {
      return reply.code(400).send({ error: 'toEmail fehlt oder ist ungültig' });
    }
    const period = (rawPeriod === 'month' ? 'month' : 'week') as 'week' | 'month';
    const date = rawDate ? new Date(rawDate + 'T00:00:00') : new Date();
    if (isNaN(date.getTime())) return reply.code(400).send({ error: 'Ungültiges Datum' });

    const { label } = getPeriodBounds(period, date);
    const periodLabel = period === 'week' ? 'Wochen' : 'Monats';
    const html = generateReportHtml(getData(username), period, date, APP_BASE_URL);
    try {
      await sendHtmlEmail(toEmail, `💅 Nagellacke ${periodLabel}bericht · ${label}`, html);
    } catch (e: unknown) {
      request.log.error({ err: e }, '[reports] Failed to send email');
      return reply.code(502).send({ error: 'E-Mail konnte nicht gesendet werden. Bitte SMTP-Konfiguration prüfen.' });
    }
    return { ok: true };
  });

  // GET /api/reports/schedule
  app.get('/api/reports/schedule', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async () => {
    return { config: getScheduleConfig(), smtpConfigured: isEmailConfigured() };
  });

  // POST /api/reports/schedule
  app.post('/api/reports/schedule', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const body = request.body as Partial<ScheduleConfig>;
    const toEmail = (body.toEmail ?? '').trim();
    if (body.enabled && (!toEmail || !isValidEmail(toEmail))) {
      return reply.code(400).send({ error: 'toEmail fehlt oder ist ungültig' });
    }
    const current = getScheduleConfig();
    const config: ScheduleConfig = {
      enabled:     !!body.enabled,
      frequency:   body.frequency === 'monthly' ? 'monthly' : 'weekly',
      toEmail:     toEmail || current?.toEmail || '',
      lastSentAt:  current?.lastSentAt,
      // Whoever last saved the schedule owns the collection it reports on —
      // collections are per-user since #87, so the hourly job needs to know.
      username,
    };
    setScheduleConfig(config);
    return { ok: true, config };
  });

  // POST /api/auth/register
  // Open only for the very first user (bootstrap) or when allowRegistration is
  // enabled — a panel value in server_settings.json wins over the env var
  // when set, see the precedence-rule comment on ServerSettings in db.ts.
  app.post('/api/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const allowRegistration = getServerSettings().allowRegistration ?? (process.env.ALLOW_REGISTRATION === 'true');
    const isFirstUser = getUserCount() === 0;
    if (!allowRegistration && !isFirstUser) {
      return reply.code(403).send({ error: 'Registrierung deaktiviert' });
    }
    const { username, password } = request.body as { username?: string; password?: string };
    if (!username || !password || password.length < 8) {
      return reply.code(400).send({ error: 'username und password (min 8 Zeichen) erforderlich' });
    }
    if (getUser(username)) return reply.code(409).send({ error: 'Benutzer existiert bereits' });
    // The very first registered user becomes admin immediately (#173) — rather
    // than relying solely on migrateFirstUserToAdmin() at the next restart,
    // which would leave a window where this session isn't yet admin.
    createUser(username, hashPassword(password), isFirstUser ? 'admin' : undefined);
    const user = getUser(username);
    return issueTokens(username, user?.token_version ?? 0);
  });

  // POST /api/auth/login
  // If the account has TOTP enabled, this does not return real tokens — it
  // returns a short-lived MFA challenge that only POST /api/auth/login/verify
  // accepts (see tokenTypeValid above: a `typ: 'mfa'` token cannot reach any
  // other protected route). Accounts without 2FA get the unchanged response
  // shape, so this is fully backwards compatible for existing clients
  // (including the Android app, which only ever reads `.token`).
  app.post('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const { username, password } = request.body as { username?: string; password?: string };
    const user = username ? getUser(username) : undefined;
    if (!user || !password) return reply.code(401).send({ error: 'Ungültige Anmeldedaten' });

    // Account-scoped brute-force lockout (#259 hardening pass) — independent
    // of the route's per-IP rate limit above, which alone doesn't stop an
    // attacker distributing guesses across many source IPs against one known
    // username. Mirrors the equivalent guard already in place for 2FA's
    // login/verify.
    if (loginLockedUntil(user.username)) {
      return reply.code(401).send({ error: 'Konto vorübergehend gesperrt — zu viele Fehlversuche' });
    }

    if (!verifyPassword(password, user.password_hash)) {
      recordLoginFailure(user.username);
      return reply.code(401).send({ error: 'Ungültige Anmeldedaten' });
    }
    clearLoginFailures(user.username);
    if (user.totp_enabled) {
      return { mfaRequired: true, challengeToken: issueMfaChallenge(user.username, user.token_version ?? 0) };
    }
    return issueTokens(user.username, user.token_version ?? 0);
  });

  /**
   * Mints an access/refresh pair. Both carry the user's current tokenVersion,
   * so POST /api/auth/logout-all revokes refresh tokens too — otherwise a
   * stolen refresh token would outlive the very thing meant to kill it.
   *
   * `token` keeps its old name and shape so existing clients (and the Android
   * app, which ignores the rest) keep working; they simply get a 7-day token
   * instead of a 30-day one and re-login when it lapses.
   */
  function issueTokens(username: string, tokenVersion: number) {
    return {
      token: app.jwt.sign({ username, tokenVersion, typ: 'access' }, { expiresIn: ACCESS_TOKEN_TTL }),
      refreshToken: app.jwt.sign({ username, tokenVersion, typ: 'refresh' }, { expiresIn: REFRESH_TOKEN_TTL }),
    };
  }

  // ── TOTP two-step login (#174) ────────────────────────────────────────────────
  //
  // Two independent brute-force layers on /api/auth/login/verify, because a
  // per-IP rate limit alone doesn't stop a distributed guesser:
  //   1. the route-level `config.rateLimit` below (per source IP);
  //   2. mfaAttempts, keyed on the challenge token's `jti`, independent of IP —
  //      this is what stops an attacker who rotates IPs but is still stuck
  //      brute-forcing the *same* challenge, since minting a fresh one needs
  //      the password again.
  // In-memory, scoped to this app instance: a restart (or, in tests, a fresh
  // buildApp()) invalidates all in-flight challenges and their attempt counts
  // — the same tradeoff already accepted for the rate-limit plugin's
  // in-memory store. This is backstopped by the account-scoped counter in
  // db.ts (recordTotpFailure/totpLockedUntil), which IS persisted to
  // users.json and therefore survives a restart — chosen over just
  // documenting the gap since it was no extra work once item 3's counter
  // existed anyway (hardening items 3+4, #174 security review).
  const MFA_MAX_ATTEMPTS = 5;
  const mfaAttempts = new Map<string, { count: number; mintedAt: number }>();
  // Opportunistic pruning so a long-running process doesn't accumulate dead
  // entries forever. unref() so it never keeps the process (or a test) alive.
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [jti, a] of mfaAttempts) {
      if (a.mintedAt < cutoff) mfaAttempts.delete(jti);
    }
  }, 5 * 60 * 1000).unref();

  function issueMfaChallenge(username: string, tokenVersion: number): string {
    const jti = uuidv4();
    mfaAttempts.set(jti, { count: 0, mintedAt: Date.now() });
    return app.jwt.sign({ username, tokenVersion, typ: 'mfa', jti }, { expiresIn: '5m' });
  }

  // POST /api/auth/login/verify — second step of a 2FA login. Accepts either
  // a 6-digit TOTP code or a recovery code.
  app.post('/api/auth/login/verify', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const { challengeToken, code } = request.body as { challengeToken?: string; code?: string };
    if (!challengeToken || !code) return reply.code(400).send({ error: 'challengeToken und code erforderlich' });

    let payload: { username?: string; tokenVersion?: number; typ?: string; jti?: string };
    try {
      payload = app.jwt.verify(challengeToken);
    } catch {
      return reply.code(401).send({ error: 'Challenge ungültig oder abgelaufen' });
    }
    if (payload.typ !== 'mfa' || !payload.username || !payload.jti) {
      return reply.code(401).send({ error: 'Challenge ungültig oder abgelaufen' });
    }

    const attempt = mfaAttempts.get(payload.jti) ?? { count: 0, mintedAt: Date.now() };
    if (attempt.count >= MFA_MAX_ATTEMPTS) {
      return reply.code(401).send({ error: 'Zu viele Fehlversuche' });
    }
    attempt.count += 1;
    mfaAttempts.set(payload.jti, attempt);

    const user = getUser(payload.username);
    if (!user || !user.totp_enabled || (payload.tokenVersion ?? 0) !== (user.token_version ?? 0)) {
      return reply.code(401).send({ error: 'Challenge ungültig oder abgelaufen' });
    }

    // Account-scoped lockout (hardening item 3, #174 security review):
    // independent of source IP and of the per-jti cap above, both of which
    // reset for an attacker who rotates IP or mints a fresh challenge (which
    // only needs the password again — the case this guards against an
    // attacker who already has).
    const lockedUntil = totpLockedUntil(user.username);
    if (lockedUntil) {
      return reply.code(401).send({ error: 'Konto vorübergehend gesperrt — zu viele Fehlversuche' });
    }

    const trimmedCode = code.trim();
    let ok = false;
    if (/^\d{6}$/.test(trimmedCode) && user.totp_secret) {
      const counter = verifyTotpCode(user.totp_secret, trimmedCode, user.username);
      // Reject a code whose step has already been accepted — stops a
      // shoulder-surfed code from being replayed inside its own validity window.
      if (counter !== null && counter > (user.totp_last_counter ?? -1)) {
        updateTotpCounter(user.username, counter);
        ok = true;
      }
    } else {
      ok = consumeRecoveryCode(user.username, trimmedCode);
    }

    if (!ok) {
      recordTotpFailure(user.username);
      return reply.code(401).send({ error: 'Ungültiger Code' });
    }

    clearTotpFailures(user.username);
    mfaAttempts.delete(payload.jti);
    return issueTokens(user.username, user.token_version ?? 0);
  });

  // POST /api/auth/totp/setup — starts (or restarts) enrollment: generates a
  // fresh, unverified secret and stores it as pending. Never flips
  // totp_enabled — only POST /api/auth/totp/enable does, after a successful
  // code check (verify-before-enable, see #174 plan §5).
  //
  // Blocked while 2FA is already enabled: setTotpPending() also clears
  // totp_enabled, so without this check a session-only call (no password)
  // could silently turn 2FA off — exactly the bypass /disable's
  // password-reentry requirement exists to prevent, just routed through a
  // different endpoint. Disable first, then re-enroll.
  app.post('/api/auth/totp/setup', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    if (getUser(username)?.totp_enabled) {
      return reply.code(400).send({ error: '2FA ist bereits aktiviert — zuerst deaktivieren, um neu einzurichten' });
    }
    const secret = generateTotpSecret();
    setTotpPending(username, secret);
    // otpauthUri/secret must only ever appear in the response body — never as a
    // query param or path segment, or they'd end up in the server's own access
    // log (Fastify logs at { level: 'info' }, which includes the request URL).
    return { secret, otpauthUri: buildOtpauthUri(secret, username), qrLabel: username };
  });

  // POST /api/auth/totp/enable — verifies a code against the pending secret
  // from /setup. Only on success does totp_enabled flip true and recovery
  // codes get generated. On a wrong code, the pending secret is left in place
  // so the user can retry without re-scanning.
  //
  // Requires re-entering the password (security review of #174 — BLOCKER 2):
  // requireJwt alone means a stolen access token, without the password, was
  // enough to turn 2FA on with a secret/recovery codes only the attacker
  // holds — an unrecoverable lockout for the real owner, since this app has
  // no password-reset flow. /disable and /recovery-codes/regenerate already
  // required the password for the equivalent reason; /enable was the odd one
  // out.
  //
  // Also blocked while already enabled (same reasoning as /setup above): it
  // would otherwise regenerate recovery codes and reset the replay-guard
  // counter on session alone.
  //
  // enableTotp() bumps token_version, which invalidates the very access token
  // this request is authenticated with — a fresh pair is minted and returned
  // in the same response so the caller isn't logged out mid-enrollment,
  // mirroring what /disable already does.
  app.post('/api/auth/totp/enable', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const { code, password } = request.body as { code?: string; password?: string };
    const user = getUser(username);
    if (user?.totp_enabled) {
      return reply.code(400).send({ error: '2FA ist bereits aktiviert' });
    }
    if (!user || !password || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'Passwort erforderlich' });
    }
    if (!user.totp_secret) {
      return reply.code(400).send({ error: 'Kein 2FA-Setup gestartet — zuerst /totp/setup aufrufen' });
    }
    if (!code || verifyTotpCode(user.totp_secret, code.trim(), username) === null) {
      return reply.code(401).send({ error: 'Ungültiger Code' });
    }
    const { codes, hashes } = generateRecoveryCodes();
    const newTokenVersion = enableTotp(username, hashes);
    return { ok: true, recoveryCodes: codes, ...issueTokens(username, newTokenVersion) };
  });

  // POST /api/auth/totp/disable — requires re-entering the password (not just
  // having a session), so a stolen unlocked tab can't silently disable 2FA.
  // Bumps token_version (via disableTotp), which would otherwise kill the
  // caller's own access token mid-flow — a fresh token pair is minted and
  // returned in the same response so the UI doesn't silently 401 right after.
  app.post('/api/auth/totp/disable', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const { password } = request.body as { password?: string };
    const user = getUser(username);
    if (!user || !password || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'Passwort erforderlich' });
    }
    if (!user.totp_enabled) {
      return reply.code(400).send({ error: '2FA ist nicht aktiviert' });
    }
    disableTotp(username);
    const updated = getUser(username);
    return { ok: true, ...issueTokens(username, updated?.token_version ?? 0) };
  });

  // POST /api/auth/totp/recovery-codes/regenerate — invalidates all previous
  // recovery codes. Does not touch totp_last_counter (unlike enableTotp),
  // since this isn't a re-enrollment.
  app.post('/api/auth/totp/recovery-codes/regenerate', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const { password } = request.body as { password?: string };
    const user = getUser(username);
    if (!user || !password || !verifyPassword(password, user.password_hash)) {
      return reply.code(401).send({ error: 'Passwort erforderlich' });
    }
    if (!user.totp_enabled) {
      return reply.code(400).send({ error: '2FA ist nicht aktiviert' });
    }
    const { codes, hashes } = generateRecoveryCodes();
    setRecoveryCodes(username, hashes);
    return { recoveryCodes: codes };
  });

  // POST /api/auth/refresh — trade a refresh token for a fresh access token.
  // Deliberately not behind requireJwt: the caller presents a refresh token in
  // the body, not an access token in the header (the access token it is
  // replacing has usually expired by then).
  app.post('/api/auth/refresh', {
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken?: string };
    if (!refreshToken) return reply.code(400).send({ error: 'refreshToken erforderlich' });

    let payload: { username?: string; tokenVersion?: number; typ?: string };
    try {
      payload = app.jwt.verify(refreshToken);
    } catch {
      return reply.code(401).send({ error: 'Refresh-Token ungültig oder abgelaufen' });
    }
    // An access token must not be usable as a refresh token — otherwise a
    // leaked access token could be renewed indefinitely, undoing the short TTL.
    if (payload.typ !== 'refresh' || !payload.username) {
      return reply.code(401).send({ error: 'Refresh-Token ungültig oder abgelaufen' });
    }
    const user = getUser(payload.username);
    if (!user || (payload.tokenVersion ?? 0) !== (user.token_version ?? 0)) {
      return reply.code(401).send({ error: 'Refresh-Token ungültig oder abgelaufen' });
    }
    return issueTokens(payload.username, user.token_version ?? 0);
  });

  // POST /api/auth/logout-all — invalidate every previously issued token for
  // the current user (e.g. after a device is lost/stolen). No way to revoke
  // a single token without per-token tracking, but bumping the version
  // covers the actual threat: an attacker with a stolen long-lived token.
  app.post('/api/auth/logout-all', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request) => {
    const { username } = request.user as { username: string };
    bumpTokenVersion(username);
    return { ok: true };
  });

  // Every sync route below reads/writes only the authenticated user's own
  // collection. Previously they all operated on one global data.json, so any
  // account could read — and /api/sync/push could wipe — another's data (#87).

  // GET /api/sync — aktuellen Stand abrufen (JWT)
  app.get('/api/sync', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request) => {
    const { username } = request.user as { username: string };
    return { data: getData(username) };
  });

  // POST /api/sync — Daten zusammenführen (JWT)
  app.post('/api/sync', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const { data: clientData } = request.body as { data?: unknown };
    if (!clientData) return reply.code(400).send({ error: 'data erforderlich' });
    if (!isValidAppData(clientData)) return reply.code(400).send({ error: 'data ungültig' });
    const merged = mergeData(getData(username), clientData);
    setData(username, merged);
    return { data: merged };
  });

  // POST /api/sync/push — fertig gemergten Stand hochladen (JWT)
  // Merges against the current server state (rather than overwriting it) so a
  // client push based on a slightly stale snapshot can't clobber writes made
  // server-side in the meantime (e.g. by an AI background job).
  app.post('/api/sync/push', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const { data } = request.body as { data?: unknown };
    if (!data) return reply.code(400).send({ error: 'data erforderlich' });
    if (!isValidAppData(data)) return reply.code(400).send({ error: 'data ungültig' });
    // Merge rather than overwrite: AI jobs write to this user's collection in
    // the background, and a client push built from a stale snapshot would
    // otherwise silently drop those writes.
    const merged = mergeData(getData(username), data);
    setData(username, merged);
    return { ok: true };
  });

  // ── KI-Assistenz (AI Auto-Fill / Smart-Cart) ──────────────────────────────────

  // GET /api/ai/settings — secrets are never sent back, only whether they're set
  app.get('/api/ai/settings', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async () => {
    return aiSettingsView(getAiConfig());
  });

  // POST /api/ai/settings
  // requireAdmin, not requireJwt (#173): previously any registered user could
  // change the whole household's AI provider/keys — a latent bug fixed here as
  // a deliberate behavior tightening, called out in CHANGELOG.md.
  app.post('/api/ai/settings', {
    preHandler: requireAdmin,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const body = request.body as Partial<{
      provider: AiConfig['provider'];
      openrouter: Partial<{ apiKey: string; model: string; freeOnly: boolean }>;
      gemini: Partial<{ apiKey: string; model: string }>;
      webSearch: Partial<{ backend: SearchBackend; searxngUrl: string; braveApiKey: string }>;
    }>;
    if (body.provider !== 'openrouter' && body.provider !== 'gemini') {
      return reply.code(400).send({ error: 'provider muss "openrouter" oder "gemini" sein' });
    }
    const current = getAiConfig();
    const config: AiConfig = {
      provider: body.provider,
      openrouter: {
        apiKey: body.openrouter?.apiKey !== undefined ? body.openrouter.apiKey : current.openrouter.apiKey,
        model: body.openrouter?.model || current.openrouter.model,
        freeOnly: body.openrouter?.freeOnly ?? current.openrouter.freeOnly,
      },
      gemini: {
        apiKey: body.gemini?.apiKey !== undefined ? body.gemini.apiKey : current.gemini.apiKey,
        model: body.gemini?.model || current.gemini.model,
      },
      webSearch: {
        backend: SEARCH_BACKENDS.includes(body.webSearch?.backend as SearchBackend)
          ? body.webSearch!.backend as SearchBackend
          : current.webSearch.backend,
        searxngUrl: body.webSearch?.searxngUrl !== undefined ? body.webSearch.searxngUrl.trim() : current.webSearch.searxngUrl,
        braveApiKey: body.webSearch?.braveApiKey !== undefined ? body.webSearch.braveApiKey : current.webSearch.braveApiKey,
      },
    };
    setAiConfig(config);
    const { username: actor } = request.user as { username: string };
    logAdminAction(actor, 'ai_settings.updated', undefined, { provider: config.provider });
    return { ok: true };
  });

  // POST /api/ai/autofill — kick off a background job to research color/finish.
  // Takes the polish's name/brand/num directly (not an id) — the result is
  // handed back via the job for the client to apply itself, so this doesn't
  // depend on the client having already synced the new polish to the server.
  app.post('/api/ai/autofill', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const { name, brand, num } = request.body as { name?: string; brand?: string; num?: string };
    if (!name) return reply.code(400).send({ error: 'name erforderlich' });
    const config = getAiConfig();
    if (!isAiConfigured(config)) {
      return reply.code(400).send({ error: 'KI-Anbieter ist nicht konfiguriert (Einstellungen → KI-Assistenz)' });
    }
    const job: AiJob = {
      id: uuidv4(), type: 'autofill', status: 'pending', username,
      input: { polish: { name, brand: brand ?? '', num: num ?? '' } },
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    addAiJob(job);
    setImmediate(() => { void processAiJobQueue(); });
    return { jobId: job.id };
  });

  // POST /api/ai/smart-cart — kick off a background job to research + add cart items
  app.post('/api/ai/smart-cart', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const { prompt } = request.body as { prompt?: string };
    if (!prompt || !prompt.trim()) return reply.code(400).send({ error: 'prompt erforderlich' });
    const config = getAiConfig();
    if (!isAiConfigured(config)) {
      return reply.code(400).send({ error: 'KI-Anbieter ist nicht konfiguriert (Einstellungen → KI-Assistenz)' });
    }
    const job: AiJob = { id: uuidv4(), type: 'smart-cart', status: 'pending', username, input: { prompt: prompt.trim() }, createdAt: Date.now(), updatedAt: Date.now() };
    addAiJob(job);
    setImmediate(() => { void processAiJobQueue(); });
    return { jobId: job.id };
  });

  // GET /api/ai/jobs/:id — poll job status
  // Generous limit: the client polls this every 2s for up to 2 minutes while a
  // job runs (see pollAiJob), so ~60 requests per job is normal traffic.
  app.get('/api/ai/jobs/:id', {
    preHandler: requireJwt,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { username } = request.user as { username: string };
    const { id } = request.params as { id: string };
    const job = getAiJob(id);
    // Job ids are UUIDs, but a job carries its owner's prompt and researched
    // results, so ownership is checked rather than relying on unguessability.
    // 404 rather than 403 — don't confirm that someone else's job id exists.
    if (!job || job.username !== username) return reply.code(404).send({ error: 'Job nicht gefunden' });
    return { job };
  });

  // ── SPA Fallback ──────────────────────────────────────────────────────────────
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    const index = path.join(process.cwd(), 'public', 'index.html');
    if (fs.existsSync(index)) {
      reply.type('text/html').send(fs.readFileSync(index));
    } else {
      reply.code(404).send({ error: 'Not found' });
    }
  });

  return app;
}

async function main() {
  const app = await buildApp();

  // ── Report scheduler ──────────────────────────────────────────────────────────
  // Checks every hour whether a scheduled report should be sent.
  setInterval(async () => {
    const cfg = getScheduleConfig();
    if (!cfg?.enabled || !cfg.toEmail || !isEmailConfigured()) return;

    const now = new Date();
    const hour = now.getUTCHours();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
    const dayOfMonth = now.getUTCDate();

    const shouldSend = cfg.frequency === 'weekly'
      ? dayOfWeek === 1 && hour === 8  // Every Monday at 08:00 UTC
      : dayOfMonth === 1 && hour === 8; // 1st of each month at 08:00 UTC

    if (!shouldSend) return;

    // Avoid sending twice in the same hour window
    if (cfg.lastSentAt) {
      const hoursSinceLast = (Date.now() - cfg.lastSentAt) / (1000 * 60 * 60);
      if (hoursSinceLast < 2) return;
    }

    const refDate = new Date(now);
    if (cfg.frequency === 'weekly') {
      refDate.setUTCDate(now.getUTCDate() - 7);
    } else {
      refDate.setUTCMonth(now.getUTCMonth() - 1);
    }

    // Configs written before per-user isolation carry no username; the account
    // that bootstrapped the server owns the migrated collection (#87).
    const reportUser = cfg.username ?? getFirstUsername();
    if (!reportUser) {
      console.warn('[reports] Scheduled report skipped: no user to report on.');
      return;
    }

    try {
      const { label } = getPeriodBounds(cfg.frequency === 'monthly' ? 'month' : 'week', refDate);
      const periodLabel = cfg.frequency === 'weekly' ? 'Wochen' : 'Monats';
      const baseUrl = process.env.APP_URL ?? `http://localhost:${PORT}`;
      const html = generateReportHtml(getData(reportUser), cfg.frequency === 'monthly' ? 'month' : 'week', refDate, baseUrl);
      await sendHtmlEmail(cfg.toEmail, `💅 Nagellacke ${periodLabel}bericht · ${label}`, html);
      setScheduleConfig({ ...cfg, lastSentAt: Date.now() });
      console.log(`[reports] Scheduled ${cfg.frequency} report sent to ${cfg.toEmail}`);
    } catch (e: unknown) {
      console.error('[reports] Failed to send scheduled report:', e instanceof Error ? e.message : e);
    }
  }, 60 * 60 * 1000); // every hour

  // ── AI job queue safety net ────────────────────────────────────────────────
  // Jobs are normally picked up immediately (see setImmediate calls above); this
  // interval just catches anything left pending after a restart.
  setInterval(() => { void processAiJobQueue(); }, 30 * 1000);
  void processAiJobQueue();

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    if (API_KEY_IS_NEW) {
      console.log('\n┌─────────────────────────────────────────────────────┐');
      console.log(`│  API-Schlüssel: ${API_KEY.padEnd(38)}│`);
      console.log('│  (Unter Einstellungen ⚙ eintragen)                  │');
      console.log('│  Nur einmalig angezeigt — danach: cat data/.api_key  │');
      console.log('└─────────────────────────────────────────────────────┘\n');
    } else {
      const age = apiKeyAgeDays();
      if (age !== null && age >= API_KEY_MAX_AGE_DAYS) {
        console.warn(
          `[SECURITY] Der Admin-API-Key ist ${age} Tage alt. Rotieren mit ` +
          'POST /api/admin/api-key/rotate (mit dem aktuellen X-Api-Key) oder ' +
          '`rm data/.api_key` + Neustart.',
        );
      }
    }
    if (isEmailConfigured() && !process.env.APP_URL) {
      console.warn('[reports] WARNING: SMTP is configured but APP_URL is not set — photo URLs in emails will be broken. Set APP_URL to the public base URL of this server.');
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

// Skipped under vitest (VITEST is set automatically by the test runner) so
// importing this module for buildApp() in integration tests doesn't also bind
// a port and start the background intervals. NAGELLACKE_NO_AUTOSTART stays
// supported as an explicit opt-out for callers outside the test runner (#173).
if (!process.env.VITEST && process.env.NAGELLACKE_NO_AUTOSTART !== 'true') {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
