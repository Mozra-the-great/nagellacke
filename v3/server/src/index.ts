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
  bumpTokenVersion, migrateGlobalDataToFirstUser, getScheduleConfig, setScheduleConfig,
  getAiConfig, setAiConfig, addAiJob, getAiJob, PHOTOS_DIR, DATA_DIR,
  setTotpPending, enableTotp, disableTotp, updateTotpCounter, consumeRecoveryCode, setRecoveryCodes,
  recordTotpFailure, clearTotpFailures, totpLockedUntil,
} from './db';
import type { ScheduleConfig, AiConfig, AiJob } from './db';
import { processAiJobQueue, isAiConfigured } from './ai';
import type { SearchBackend } from './websearch';
import { generateReportHtml, getPeriodBounds } from './report';
import { isEmailConfigured, sendHtmlEmail } from './email';
import { generateTotpSecret, buildOtpauthUri, verifyTotpCode, generateRecoveryCodes } from './totp';

const SEARCH_BACKENDS: SearchBackend[] = ['duckduckgo', 'searxng', 'brave', 'off'];

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
  API_KEY = fs.readFileSync(API_KEY_FILE, 'utf-8').trim();
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
  // Must run before any request is served (#87).
  migrateGlobalDataToFirstUser();

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
    preHandler: requireApiKey,
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
    preHandler: requireApiKey,
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
    preHandler: requireApiKey,
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async () => {
    const apiKey = rotateApiKey();
    console.warn('[SECURITY] Admin API key rotated — every previously issued key is now invalid.');
    // Returned once, in the response to the authenticated rotation request
    // itself: the caller needs it to keep working, and it is never recoverable
    // from this endpoint again (only from data/.api_key on the host).
    return { apiKey, rotatedAt: Date.now() };
  });

  // GET /api/logs — systemd journal
  app.get('/api/logs', {
    preHandler: requireApiKey,
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
  // Open only for the very first user (bootstrap) or when ALLOW_REGISTRATION=true.
  app.post('/api/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const allowRegistration = process.env.ALLOW_REGISTRATION === 'true';
    const isFirstUser = getUserCount() === 0;
    if (!allowRegistration && !isFirstUser) {
      return reply.code(403).send({ error: 'Registrierung deaktiviert' });
    }
    const { username, password } = request.body as { username?: string; password?: string };
    if (!username || !password || password.length < 8) {
      return reply.code(400).send({ error: 'username und password (min 8 Zeichen) erforderlich' });
    }
    if (getUser(username)) return reply.code(409).send({ error: 'Benutzer existiert bereits' });
    createUser(username, hashPassword(password));
    return issueTokens(username, 0);
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
    if (!verifyPassword(password, user.password_hash)) return reply.code(401).send({ error: 'Ungültige Anmeldedaten' });
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
    const { data: clientData } = request.body as { data?: AppData };
    if (!clientData) return reply.code(400).send({ error: 'data erforderlich' });
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
    const { data } = request.body as { data?: AppData };
    if (!data) return reply.code(400).send({ error: 'data erforderlich' });
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
    const config = getAiConfig();
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
  });

  // POST /api/ai/settings
  app.post('/api/ai/settings', {
    preHandler: requireJwt,
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
// importing this module for buildApp() in integration tests doesn't also
// bind a port and start the background intervals.
if (!process.env.VITEST) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
