import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import staticFiles from '@fastify/static';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as https from 'node:https';
import { spawnSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';
import { mergeData } from '@nagellacke/core';
import type { AppData } from '@nagellacke/core';
import { getData, setData, getUser, createUser, PHOTOS_DIR, DATA_DIR } from './db';

const PORT         = Number(process.env.PORT ?? 3000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
const SERVICE_NAME = process.env.SERVICE_NAME ?? 'nagellacke-v3';
const APP_ROOT     = path.resolve(process.cwd(), '..', '..');  // /opt/nagellacke

// ── Validate SERVICE_NAME (prevent injection) ─────────────────────────────────
if (!/^[a-zA-Z0-9_.-]+$/.test(SERVICE_NAME)) {
  console.error('Ungültiger SERVICE_NAME:', SERVICE_NAME);
  process.exit(1);
}

// ── X-Api-Key auth (v2-kompatibel) ────────────────────────────────────────────
const API_KEY_FILE = path.join(DATA_DIR, '.api_key');
let API_KEY: string;
let API_KEY_IS_NEW = false;

if (fs.existsSync(API_KEY_FILE)) {
  API_KEY = fs.readFileSync(API_KEY_FILE, 'utf-8').trim();
} else {
  API_KEY = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(API_KEY_FILE, API_KEY, { mode: 0o600 });
  API_KEY_IS_NEW = true;
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

// ── Rate limiting (in-memory) ─────────────────────────────────────────────────
const rateLimitMap = new Map<string, number[]>();
function rateLimit(limit: number, windowMs: number) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const key = `${request.routerPath}:${request.ip}`;
    const now = Date.now();
    const hits = (rateLimitMap.get(key) ?? []).filter(t => now - t < windowMs);
    if (hits.length >= limit) {
      return reply.code(429).send({ error: 'Zu viele Anfragen' });
    }
    hits.push(now);
    rateLimitMap.set(key, hits);
  };
}

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

// ── GitHub version check helper ───────────────────────────────────────────────
function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'nagellacke-v3' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location!).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c: string) => { data += c; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const app = Fastify({ logger: { level: 'info' } });

  await app.register(cors, { origin: ALLOWED_ORIGIN });
  await app.register(jwt, { secret: JWT_SECRET });
  await app.register(staticFiles, { root: PHOTOS_DIR, prefix: '/photos/' });

  // Serve v2 frontend (built to ./public by install.sh)
  const publicDir = path.join(process.cwd(), 'public');
  if (fs.existsSync(publicDir)) {
    await app.register(staticFiles, { root: publicDir, prefix: '/', decorateReply: false });
  }

  // ── Auth helpers ──────────────────────────────────────────────────────────────

  function requireApiKey(request: FastifyRequest, reply: FastifyReply): void {
    const key = request.headers['x-api-key'];
    if (!key || key !== API_KEY) {
      reply.code(401).send({ error: 'Ungültiger API-Schlüssel' });
    }
  }

  async function requireJwt(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  }

  // ── v2-kompatible Endpoints (X-Api-Key) ───────────────────────────────────────

  // GET /api/data — liefert die komplette Sammlung
  app.get('/api/data', async () => {
    const d = getData();
    return { polishes: d.polishes, customCats: d.customCats, manicures: d.manicures, stickers: d.stickers };
  });

  // POST /api/data — speichert die komplette Sammlung
  app.post('/api/data', { preHandler: requireApiKey }, async (request, reply) => {
    const body = request.body as Partial<AppData>;
    if (!Array.isArray(body.polishes)) return reply.code(400).send({ error: 'polishes array required' });
    const current = getData();
    const next: AppData = {
      polishes:   body.polishes   ?? current.polishes,
      customCats: body.customCats ?? current.customCats,
      manicures:  body.manicures  ?? current.manicures,
      stickers:   body.stickers   ?? current.stickers,
    };
    setData(next);
    return { ok: true };
  });

  // POST /api/photos — Foto hochladen (v2-Format: base64 body)
  app.post('/api/photos', { preHandler: requireApiKey }, async (request, reply) => {
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
  app.delete('/api/photos/:filename', { preHandler: requireApiKey }, async (request, reply) => {
    const { filename } = request.params as { filename: string };
    if (!/^[\w\-.]+$/.test(filename)) return reply.code(400).send({ error: 'Ungültiger Dateiname' });
    const p = path.join(PHOTOS_DIR, filename);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { ok: true };
  });

  // GET /api/version
  app.get('/api/version', async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as { version: string };
    return { version: pkg.version };
  });

  // GET /api/update/check — prüft GitHub auf neue Version
  app.get('/api/update/check', {
    preHandler: [requireApiKey, rateLimit(10, 60_000)],
  }, async () => {
    const remoteUrl = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: APP_ROOT, stdio: 'pipe' })
      .stdout?.toString().trim() ?? '';
    const match = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
    if (!match) return { error: 'Kein GitHub-Remote gefunden' };
    const [owner, repo] = match[1].split('/');

    let latestVersion: string | null = null;
    try {
      const rel = JSON.parse(await httpsGet(`https://api.github.com/repos/${owner}/${repo}/releases/latest`)) as { tag_name?: string };
      latestVersion = rel.tag_name?.replace(/^v/, '') ?? null;
    } catch { /* fallback to tags */ }

    if (!latestVersion) {
      try {
        const tags = JSON.parse(await httpsGet(`https://api.github.com/repos/${owner}/${repo}/tags`)) as { name: string }[];
        const semver = tags.map(t => t.name).filter(t => /^v?\d+\.\d+\.\d+$/.test(t));
        semver.sort((a, b) => {
          const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
          const [ma, mi, pa] = parse(a);
          const [mb, mi2, pb] = parse(b);
          return mb - ma || mi2 - mi || pb - pa;
        });
        latestVersion = semver[0]?.replace(/^v/, '') ?? null;
      } catch { /* ignore */ }
    }

    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')) as { version: string };
    const current = pkg.version;
    const updateAvailable = latestVersion ? latestVersion !== current : false;
    return { current, latestVersion, updateAvailable };
  });

  // POST /api/update/apply — git pull + rebuild + restart
  // Antwortet sofort, Build läuft im Hintergrund (verhindert Nginx-Timeout).
  app.post('/api/update/apply', {
    preHandler: [requireApiKey, rateLimit(3, 300_000)],
  }, async (request, reply) => {
    reply.send({ ok: true });

    setImmediate(() => {
      try {
        const v3Dir = path.join(APP_ROOT, 'v3');
        const steps = [
          { cmd: 'git', args: ['pull', 'origin', 'main'],    cwd: APP_ROOT,      timeout: 30_000 },
          { cmd: 'npm', args: ['install', '--omit=dev'],      cwd: process.cwd(), timeout: 60_000 },
          { cmd: 'npm', args: ['run', 'build:core'],          cwd: v3Dir,         timeout: 60_000 },
          { cmd: 'npm', args: ['run', 'build:sync'],          cwd: v3Dir,         timeout: 60_000 },
          { cmd: 'npm', args: ['run', 'build:server'],        cwd: v3Dir,         timeout: 60_000 },
          { cmd: 'npm', args: ['run', 'build:web'],           cwd: v3Dir,         timeout: 120_000 },
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
          const r = spawnSync('systemctl', ['restart', SERVICE_NAME], { stdio: 'pipe' });
          if (r.status !== 0) process.exit(0);
        }, 300);
      } catch (e: unknown) {
        console.error('Update failed:', e instanceof Error ? e.message : e);
      }
    });
  });

  // GET /api/logs — systemd journal
  app.get('/api/logs', {
    preHandler: [requireApiKey, rateLimit(30, 60_000)],
  }, async (request) => {
    const lines = Math.min(parseInt((request.query as { lines?: string }).lines ?? '100'), 500);
    const r = spawnSync(
      'journalctl',
      ['-u', SERVICE_NAME, '-n', String(lines), '--no-pager', '--output=short-iso'],
      { stdio: 'pipe', timeout: 6000 },
    );
    if (r.status === 0) return { logs: r.stdout?.toString() ?? '', lines };
    return { logs: r.stderr?.toString().trim() ?? 'journalctl nicht verfügbar', lines, error: true };
  });

  // ── v3 Sync-Endpoints (JWT) ────────────────────────────────────────────────

  // POST /api/auth/register
  app.post('/api/auth/register', async (request, reply) => {
    const { username, password } = request.body as { username?: string; password?: string };
    if (!username || !password || password.length < 8) {
      return reply.code(400).send({ error: 'username und password (min 8 Zeichen) erforderlich' });
    }
    if (getUser(username)) return reply.code(409).send({ error: 'Benutzer existiert bereits' });
    createUser(username, hashPassword(password));
    const token = app.jwt.sign({ username }, { expiresIn: '30d' });
    return { token };
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body as { username?: string; password?: string };
    const user = username ? getUser(username) : undefined;
    if (!user || !password) return reply.code(401).send({ error: 'Ungültige Anmeldedaten' });
    if (!verifyPassword(password, user.password_hash)) return reply.code(401).send({ error: 'Ungültige Anmeldedaten' });
    const token = app.jwt.sign({ username }, { expiresIn: '30d' });
    return { token };
  });

  // GET /api/sync — aktuellen Stand abrufen (JWT)
  app.get('/api/sync', { preHandler: requireJwt }, async () => ({ data: getData() }));

  // POST /api/sync — Daten zusammenführen (JWT)
  app.post('/api/sync', { preHandler: requireJwt }, async (request, reply) => {
    const { data: clientData } = request.body as { data?: AppData };
    if (!clientData) return reply.code(400).send({ error: 'data erforderlich' });
    const merged = mergeData(getData(), clientData);
    setData(merged);
    return { data: merged };
  });

  // POST /api/sync/push — fertig gemergten Stand hochladen (JWT)
  app.post('/api/sync/push', { preHandler: requireJwt }, async (request, reply) => {
    const { data } = request.body as { data?: AppData };
    if (!data) return reply.code(400).send({ error: 'data erforderlich' });
    setData(data);
    return { ok: true };
  });

  // ── SPA Fallback ──────────────────────────────────────────────────────────────
  app.setNotFoundHandler((_request, reply) => {
    const index = path.join(process.cwd(), 'public', 'index.html');
    if (fs.existsSync(index)) {
      reply.type('text/html').send(fs.readFileSync(index));
    } else {
      reply.code(404).send({ error: 'Not found' });
    }
  });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    if (API_KEY_IS_NEW) {
      console.log('\n┌─────────────────────────────────────────────────────┐');
      console.log(`│  API-Schlüssel: ${API_KEY.padEnd(38)}│`);
      console.log('│  (Unter Einstellungen ⚙ eintragen)                  │');
      console.log('│  Nur einmalig angezeigt — danach: cat data/.api_key  │');
      console.log('└─────────────────────────────────────────────────────┘\n');
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
