const express  = require("express");
const fs       = require("fs");
const path     = require("path");
const https    = require("https");
const crypto   = require("crypto");
const { spawnSync } = require("child_process");

const app      = express();
const PORT     = process.env.PORT || 3000;
const DATA_FILE     = path.join(__dirname, "data", "data.json");
const API_KEY_FILE  = path.join(__dirname, "data", ".api_key");
const PHOTOS_DIR    = path.join(__dirname, "data", "photos");
const APP_ROOT      = path.join(__dirname, "..");
const SERVICE_NAME  = process.env.SERVICE_NAME || "nagellacke";

// SEC-2: Validate SERVICE_NAME to prevent command injection
if (!/^[a-zA-Z0-9_.-]+$/.test(SERVICE_NAME)) {
  console.error("Ungültiger SERVICE_NAME:", SERVICE_NAME);
  process.exit(1);
}

const pkg             = require("./package.json");
const CURRENT_VERSION = pkg.version;

const DEFAULT_DATA = {
  manicures: [],
  stickers: [],
  customCats: [],
  polishes: [
    { name: "High Shine Gel", brand: "Catrice", color: "#ddeeff", finish: "Top Coat",  categories: [], status: "ok" },
    { num: "029", name: "Blue You A Kiss",             brand: "Catrice", color: "#3a7bd5", finish: "Classic", categories: [], status: "ok" },
    { num: "021", name: "Caught on The Red Carpet",    brand: "Catrice", color: "#c0202a", finish: "Classic", categories: [], status: "ok" },
    { num: "030", name: "Fairy Dust",                  brand: "Catrice", color: "#f9c8e0", finish: "Shimmer", categories: [], status: "ok" },
    { num: "020", name: "Solar Seduction",             brand: "Catrice", color: "#f4a020", finish: "Classic", categories: [], status: "ok" },
    { num: "006", name: "Party Animal",                brand: "Catrice", color: "#7b1e2e", finish: "Classic", categories: [], status: "ok" },
    { num: "010", name: "Party At First Pull",         brand: "Catrice", color: "#e05080", finish: "Classic", count: 2, categories: [], status: "ok" },
    { num: "038", name: "Cosmo Where is Wanda?",       brand: "Catrice", color: "#d4257a", finish: "Classic", categories: [], status: "ok" },
    { num: "026", name: "Midnight Dusk",               brand: "Catrice", color: "#1b1340", finish: "Classic", categories: [], status: "ok" },
    { num: "041", name: "Spill The Tea-I",             brand: "Catrice", color: "#9e6b34", finish: "Classic", categories: [], status: "ok" },
    { num: "040", name: "Ocean Whisper",               brand: "Catrice", color: "#2a9db5", finish: "Classic", categories: [], status: "ok" },
    { num: "036", name: "Silver Supernova",            brand: "Catrice", color: "#a8b4c8", finish: "Shimmer", categories: [], status: "ok" },
    { num: "025", name: "Lilac Lullaby",               brand: "Catrice", color: "#b98ed6", finish: "Classic", categories: [], status: "ok" },
    { num: "044", name: "Sparkle Like It's Midnight",  brand: "Catrice", color: "#0a0e2e", finish: "Glitter", categories: [], status: "ok" },
    { num: "031", name: "Electric Turquoise",          brand: "Catrice", color: "#00c9c8", finish: "Classic", categories: [], status: "ok" },
  ],
};

// Ensure data directories exist before anything else touches them
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

// ── API Key ─────────────────────────────────────────────────────────────────

// SEC-1: Returns {key, isNew} — print full key only when freshly generated
function loadApiKey() {
  if (process.env.API_KEY) return { key: process.env.API_KEY, isNew: false };
  try {
    if (fs.existsSync(API_KEY_FILE)) {
      return { key: fs.readFileSync(API_KEY_FILE, "utf8").trim(), isNew: false };
    }
  } catch (e) { console.warn("Could not read API key file:", e.message); }
  const key = crypto.randomBytes(24).toString("hex");
  try { fs.writeFileSync(API_KEY_FILE, key, { mode: 0o600, encoding: "utf8" }); }
  catch (e) { console.warn("Could not persist API key:", e.message); }
  return { key, isNew: true };
}

const { key: API_KEY, isNew: API_KEY_IS_NEW } = loadApiKey();

function requireApiKey(req, res, next) {
  if (req.headers["x-api-key"] === API_KEY) return next();
  res.status(401).json({ error: "Unauthorized — API-Schlüssel fehlt oder falsch" });
}

// ── Rate limiting (in-memory) ────────────────────────────────────────────────

const _rlMap = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip  = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    const e   = _rlMap.get(ip) || { n: 0, reset: now + windowMs };
    if (now > e.reset) { e.n = 0; e.reset = now + windowMs; }
    e.n++;
    _rlMap.set(ip, e);
    if (e.n > max) return res.status(429).json({ error: "Zu viele Anfragen — bitte warten" });
    next();
  };
}

// ── CORS ─────────────────────────────────────────────────────────────────────

// SEC-7/8: Explicit CORS — cross-origin requests blocked unless ALLOWED_ORIGIN matches
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const allowed = process.env.ALLOWED_ORIGIN;
    if (!allowed || origin === allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// ── Global error handler ─────────────────────────────────────────────────────

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

// ── Data helpers ─────────────────────────────────────────────────────────────

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      let migrated = false;
      data.polishes = (data.polishes || []).map(p => {
        let updated = { ...p };
        if (!updated.brand) { updated.brand = "Catrice"; migrated = true; }
        if (!updated.finish) {
          if ((updated.categories || []).includes("coat")) {
            updated.finish = "Top Coat";
            updated.categories = updated.categories.filter(c => c !== "coat");
          } else if (updated.shimmer) {
            updated.finish = "Shimmer";
          } else {
            updated.finish = "Classic";
          }
          migrated = true;
        }
        if (!updated.createdAt) { updated.createdAt = Date.now(); updated.updatedAt = Date.now(); migrated = true; }
        return updated;
      });
      if (!data.manicures) { data.manicures = []; migrated = true; }
      if (!data.stickers)  { data.stickers  = []; migrated = true; }
      if (migrated) saveData(data);
      return data;
    }
  } catch (e) {
    console.error("Error reading data file, using defaults:", e.message);
  }
  return DEFAULT_DATA;
}

// SEC-4: Serialized write queue to prevent concurrent-write lost-update races
let _saveQueue = Promise.resolve();

function saveData(data) {
  _saveQueue = _saveQueue.then(() => {
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  }).catch(e => {
    console.error("Fehler beim Speichern der Daten:", e.message);
  });
}

// Input validation for polishes
const VALID_STATUSES  = new Set(["ok", "wish", "empty", "gone"]);
const COLOR_RE        = /^#[0-9a-f]{6}$/i;

function validatePolish(p) {
  if (!p || typeof p !== "object") return false;
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 200) return false;
  if (p.color !== undefined && !COLOR_RE.test(p.color)) return false;
  if (p.status !== undefined && !VALID_STATUSES.has(p.status)) return false;
  if (p.count !== undefined && (typeof p.count !== "number" || p.count < 1 || p.count > 999)) return false;
  return true;
}

// SEC-6: Validate image data by checking magic bytes
function isValidImageData(base64Data, ext) {
  try {
    const buf = Buffer.from(base64Data.slice(0, 20), "base64");
    if (ext === "jpg" || ext === "jpeg") return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    if (ext === "png")  return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    if (ext === "webp") return buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP";
    return true;
  } catch { return false; }
}

// ── GitHub helpers ───────────────────────────────────────────────────────────

// SEC-2: Use spawnSync with argument arrays to prevent command injection
function getGithubRepo() {
  try {
    const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: APP_ROOT, stdio: "pipe" });
    const url = r.stdout?.toString().trim();
    if (!url) return null;
    const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (match) return { owner: match[1], repo: match[2] };
  } catch (e) {
    console.debug("Could not detect GitHub remote:", e.message);
  }
  return null;
}

function githubGet(apiPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { hostname: "api.github.com", path: apiPath, headers: { "User-Agent": "nagellacke-app" } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error("Ungültige API-Antwort von GitHub")); }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("GitHub API Timeout")); });
  });
}

async function fetchLatestVersion(owner, repo) {
  try {
    const release = await githubGet(`/repos/${owner}/${repo}/releases/latest`);
    if (release.tag_name) return { version: release.tag_name, url: release.html_url || null };
  } catch (e) {
    console.debug("Releases API failed, trying tags:", e.message);
  }

  const tags = await githubGet(`/repos/${owner}/${repo}/tags`);
  if (!Array.isArray(tags) || tags.length === 0) throw new Error("Keine Tags oder Releases auf GitHub gefunden");

  const semver = tags
    .map(t => t.name)
    .filter(n => /^v?\d+\.\d+\.\d+$/.test(n))
    .sort((a, b) => {
      const parse = v => v.replace(/^v/, "").split(".").map(Number);
      const [a1, b1, c1] = parse(a), [a2, b2, c2] = parse(b);
      return (a2 - a1) || (b2 - b1) || (c2 - c1);
    });

  if (semver.length === 0) throw new Error("Keine gültigen Versions-Tags gefunden");
  return { version: semver[0], url: `https://github.com/${owner}/${repo}/releases/tag/${semver[0]}` };
}

function compareVersions(v1, v2) {
  const parse = (v) => v.replace(/^v/, "").split(".").map((n) => parseInt(n) || 0);
  const [a1, b1, c1] = parse(v1);
  const [a2, b2, c2] = parse(v2);
  if (a1 !== a2) return a1 < a2 ? -1 : 1;
  if (b1 !== b2) return b1 < b2 ? -1 : 1;
  if (c1 !== c2) return c1 < c2 ? -1 : 1;
  return 0;
}

// ── Express middleware ────────────────────────────────────────────────────────

app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/photos", express.static(PHOTOS_DIR));

// ── API routes ────────────────────────────────────────────────────────────────

// GET /api/data — read collection (public, read-only)
app.get("/api/data", (req, res) => {
  res.json(loadData());
});

// POST /api/data — save collection (requires API key)
app.post("/api/data", requireApiKey, (req, res) => {
  const { polishes, customCats, manicures, stickers } = req.body;
  if (!Array.isArray(polishes) || !Array.isArray(customCats)) {
    return res.status(400).json({ error: "Ungültiges Datenformat" });
  }
  if (polishes.length > 10000) {
    return res.status(400).json({ error: "Zu viele Einträge" });
  }
  if (!polishes.every(validatePolish)) {
    return res.status(400).json({ error: "Ungültige Lack-Daten (Name, Farbe oder Status fehlerhaft)" });
  }
  saveData({ polishes, customCats, manicures: Array.isArray(manicures) ? manicures : [], stickers: Array.isArray(stickers) ? stickers : [] });
  res.json({ ok: true });
});

// POST /api/photos — save a photo (base64 JSON, requires API key)
app.post("/api/photos", requireApiKey, (req, res) => {
  const { data, ext = "jpg" } = req.body;
  if (!data || typeof data !== "string" || data.length > 4_000_000)
    return res.status(400).json({ error: "Ungültige Bilddaten" });
  const safe = /^(jpg|jpeg|png|webp)$/.test(ext) ? ext : "jpg";
  // SEC-6: Validate magic bytes before writing
  if (!isValidImageData(data, safe))
    return res.status(400).json({ error: "Ungültiges Bildformat" });
  // SEC-5: Cryptographically random filename to prevent enumeration
  const filename = `${crypto.randomUUID()}.${safe}`;
  try {
    fs.writeFileSync(path.join(PHOTOS_DIR, filename), Buffer.from(data, "base64"));
    res.json({ filename });
  } catch (e) {
    res.status(500).json({ error: "Foto konnte nicht gespeichert werden" });
  }
});

// DELETE /api/photos/:filename — remove a photo (requires API key)
app.delete("/api/photos/:filename", requireApiKey, (req, res) => {
  const name = path.basename(req.params.filename);
  const full = path.join(PHOTOS_DIR, name);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  res.json({ ok: true });
});

// GET /api/version — current version (public, needed by frontend before key is set)
app.get("/api/version", (req, res) => {
  res.json({ version: CURRENT_VERSION });
});

// GET /api/update/check — check GitHub for updates (requires key, rate-limited)
app.get("/api/update/check", requireApiKey, rateLimit(10, 60_000), async (req, res) => {
  const repo = getGithubRepo();
  if (!repo) return res.status(500).json({ error: "Kein GitHub-Remote konfiguriert" });
  try {
    const latest        = await fetchLatestVersion(repo.owner, repo.repo);
    const latestVersion = latest.version.replace(/^v/, "");
    res.json({
      currentVersion: CURRENT_VERSION,
      latestVersion,
      updateAvailable: compareVersions(CURRENT_VERSION, latestVersion) < 0,
      releaseUrl: latest.url,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/update/apply — git pull + build + restart (requires key, rate-limited)
// Antwortet sofort, führt Build im Hintergrund aus (verhindert Nginx-Proxy-Timeout).
app.post("/api/update/apply", requireApiKey, rateLimit(3, 300_000), (req, res) => {
  res.json({ ok: true });
  setImmediate(() => {
    try {
      const frontendDir = path.join(APP_ROOT, "frontend");
      const steps = [
        { cmd: "git", args: ["pull", "origin", "main"],   cwd: APP_ROOT,    timeout: 30_000 },
        { cmd: "npm", args: ["install", "--omit=dev"],     cwd: __dirname,   timeout: 60_000 },
        { cmd: "npm", args: ["install"],                   cwd: frontendDir, timeout: 60_000 },
        { cmd: "npm", args: ["run", "build"],              cwd: frontendDir, timeout: 120_000 },
      ];
      for (const { cmd, args, cwd, timeout } of steps) {
        const r = spawnSync(cmd, args, { cwd, stdio: "pipe", timeout });
        if (r.status !== 0) {
          console.error("Update step failed:", r.stderr?.toString());
          return;
        }
      }
      setTimeout(() => {
        const r = spawnSync("systemctl", ["restart", SERVICE_NAME], { stdio: "pipe" });
        if (r.status !== 0) {
          console.debug("systemctl restart failed, falling back to process.exit");
          process.exit(0);
        }
      }, 300);
    } catch (e) {
      console.error("Update failed:", e.message);
    }
  });
});

// GET /api/logs — systemd journal (requires key, rate-limited)
// SEC-2: Use spawnSync with argument array to prevent injection via SERVICE_NAME
app.get("/api/logs", requireApiKey, rateLimit(30, 60_000), (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  const r = spawnSync(
    "journalctl",
    ["-u", SERVICE_NAME, "-n", String(lines), "--no-pager", "--output=short-iso"],
    { stdio: "pipe", timeout: 6000 }
  );
  if (r.status === 0) {
    res.json({ logs: r.stdout?.toString() || "", lines });
  } else {
    const msg = r.stderr?.toString().trim() || "journalctl nicht verfügbar";
    res.json({ logs: msg, lines, error: true });
  }
});

// ── v3 Sync-Server Management ─────────────────────────────────────────────────

const V3_ROOT       = path.join(APP_ROOT, "v3");
const V3_SERVICE    = "nagellacke-v3";
const V3_SERVER_DIR = path.join(V3_ROOT, "server");

let v3InstallState = "idle"; // "idle" | "building" | "done" | "error"
let v3InstallError = "";

// GET /api/v3/status — Installation und Laufstatus des v3-Servers
app.get("/api/v3/status", requireApiKey, (req, res) => {
  const built   = fs.existsSync(path.join(V3_SERVER_DIR, "dist", "index.js"));
  const svcFile = `/etc/systemd/system/${V3_SERVICE}.service`;
  const svcInstalled = fs.existsSync(svcFile);

  let running = false;
  if (svcInstalled) {
    const r = spawnSync("systemctl", ["is-active", V3_SERVICE], { stdio: "pipe" });
    running = r.stdout?.toString().trim() === "active";
  }

  let version = null;
  try {
    const pkgPath = path.join(V3_SERVER_DIR, "package.json");
    if (fs.existsSync(pkgPath)) version = JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
  } catch {}

  res.json({ built, svcInstalled, running, version, installState: v3InstallState, installError: v3InstallError });
});

// POST /api/v3/install — v2→v3 Upgrade: baut v3, migriert Daten, übernimmt Port 3000
// Antwortet sofort mit { ok: true }, führt den Build im Hintergrund aus (verhindert Nginx-Proxy-Timeout).
app.post("/api/v3/install", requireApiKey, rateLimit(2, 300_000), (req, res) => {
  if (!fs.existsSync(V3_ROOT)) {
    return res.status(404).json({ error: "v3/-Ordner nicht gefunden. Bitte erst git pull ausführen." });
  }
  if (v3InstallState === "building") {
    return res.json({ ok: true, status: "building" });
  }

  v3InstallState = "building";
  v3InstallError = "";
  res.json({ ok: true });

  setImmediate(() => {
    try {
      // 1. v3 bauen (core, sync, server, web-app)
      const buildSteps = [
        { cmd: "npm", args: ["install"],             cwd: V3_ROOT, timeout: 120_000 },
        { cmd: "npm", args: ["run", "build:core"],   cwd: V3_ROOT, timeout:  60_000 },
        { cmd: "npm", args: ["run", "build:server"], cwd: V3_ROOT, timeout:  60_000 },
        { cmd: "npm", args: ["run", "build:web"],    cwd: V3_ROOT, timeout: 120_000 },
      ];
      for (const { cmd, args, cwd, timeout } of buildSteps) {
        const r = spawnSync(cmd, args, { cwd, stdio: "pipe", timeout });
        if (r.status !== 0) {
          v3InstallError = (r.stderr?.toString() || `${cmd} ${args.join(" ")} fehlgeschlagen`).split("\n")[0];
          v3InstallState = "error";
          return;
        }
      }

      // 2. v3-Web-App nach v3/server/public/ kopieren
      const v3WebDist = path.join(V3_ROOT, "apps", "web", "dist");
      const v3Public  = path.join(V3_SERVER_DIR, "public");
      if (fs.existsSync(v3WebDist)) {
        if (fs.existsSync(v3Public)) fs.rmSync(v3Public, { recursive: true, force: true });
        fs.cpSync(v3WebDist, v3Public, { recursive: true });
      }

      // 3. Datenmigration: v2-Daten nach v3 übernehmen
      const v2DataDir  = path.join(__dirname, "data");
      const v3DataDir  = path.join(V3_SERVER_DIR, "data");
      fs.mkdirSync(path.join(v3DataDir, "photos"), { recursive: true });

      const v2DataFile = path.join(v2DataDir, "data.json");
      const v3DataFile = path.join(v3DataDir, "data.json");
      if (fs.existsSync(v2DataFile) && !fs.existsSync(v3DataFile)) {
        fs.copyFileSync(v2DataFile, v3DataFile);
      }

      const v2PhotosDir = path.join(v2DataDir, "photos");
      const v3PhotosDir = path.join(v3DataDir, "photos");
      if (fs.existsSync(v2PhotosDir)) {
        for (const f of fs.readdirSync(v2PhotosDir)) {
          const dest = path.join(v3PhotosDir, f);
          if (!fs.existsSync(dest)) fs.copyFileSync(path.join(v2PhotosDir, f), dest);
        }
      }

      const v2KeyFile = path.join(v2DataDir, ".api_key");
      const v3KeyFile = path.join(v3DataDir, ".api_key");
      if (fs.existsSync(v2KeyFile) && !fs.existsSync(v3KeyFile)) {
        fs.copyFileSync(v2KeyFile, v3KeyFile);
      }

      // 4. .env anlegen
      const envFile = path.join(V3_SERVER_DIR, ".env");
      if (!fs.existsSync(envFile)) {
        const secret = crypto.randomBytes(32).toString("hex");
        fs.writeFileSync(envFile,
          `PORT=${PORT}\nSERVICE_NAME=${V3_SERVICE}\nJWT_SECRET=${secret}\nDATA_DIR=${v3DataDir}\n`,
          { mode: 0o600 }
        );
      }

      // 5. systemd-Service anlegen
      const svc = [
        "[Unit]",
        "Description=Nagellacke v3",
        "After=network.target",
        "",
        "[Service]",
        "Type=simple",
        `WorkingDirectory=${V3_SERVER_DIR}`,
        `EnvironmentFile=${envFile}`,
        "ExecStart=/usr/bin/node dist/server/src/index.js",
        "Restart=always",
        "RestartSec=5",
        "",
        "[Install]",
        "WantedBy=multi-user.target",
      ].join("\n");
      fs.writeFileSync(`/etc/systemd/system/${V3_SERVICE}.service`, svc);
      spawnSync("systemctl", ["daemon-reload"],       { stdio: "pipe" });
      spawnSync("systemctl", ["enable",  V3_SERVICE], { stdio: "pipe" });

      v3InstallState = "done";

      // 6. v2 stoppen, v3 starten
      setTimeout(() => {
        spawnSync("systemctl", ["start",   V3_SERVICE],  { stdio: "pipe" });
        spawnSync("systemctl", ["stop",    SERVICE_NAME], { stdio: "pipe" });
        spawnSync("systemctl", ["disable", SERVICE_NAME], { stdio: "pipe" });
      }, 500);
    } catch (e) {
      v3InstallError = e.message || "Installation fehlgeschlagen";
      v3InstallState = "error";
    }
  });
});

// GET /api/v3/logs — systemd-Journal des v3-Servers
app.get("/api/v3/logs", requireApiKey, rateLimit(30, 60_000), (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 50, 200);
  const r = spawnSync(
    "journalctl",
    ["-u", V3_SERVICE, "-n", String(lines), "--no-pager", "--output=short-iso"],
    { stdio: "pipe", timeout: 6000 }
  );
  if (r.status === 0) {
    res.json({ logs: r.stdout?.toString() || "", lines });
  } else {
    const msg = r.stderr?.toString().trim() || "journalctl nicht verfügbar";
    res.json({ logs: msg, lines, error: true });
  }
});

// Fallback — client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// SEC-9: Global Express error handler — prevents stack traces leaking to clients
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Interner Serverfehler" });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\nNagellacke v${CURRENT_VERSION} running on http://0.0.0.0:${PORT}`);
  console.log(`Data: ${DATA_FILE}\n`);
  if (API_KEY_IS_NEW) {
    // SEC-1: Print full key only on first generation
    console.log("┌─────────────────────────────────────────────────────┐");
    console.log(`│  API-Schlüssel: ${API_KEY.padEnd(38)}│`);
    console.log("│  (Unter Einstellungen ⚙ eintragen)                  │");
    console.log("│  Nur einmalig angezeigt — danach: cat data/.api_key  │");
    console.log("└─────────────────────────────────────────────────────┘\n");
  } else {
    console.log("API-Schlüssel geladen. Anzeigen: cat backend/data/.api_key\n");
  }
});
