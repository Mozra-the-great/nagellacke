const express = require("express");
const fs      = require("fs");
const path    = require("path");
const https   = require("https");
const crypto  = require("crypto");
const { execSync } = require("child_process");

const app      = express();
const PORT     = process.env.PORT || 3000;
const DATA_FILE     = path.join(__dirname, "data", "data.json");
const API_KEY_FILE  = path.join(__dirname, "data", ".api_key");
const PHOTOS_DIR    = path.join(__dirname, "data", "photos");
const APP_ROOT      = path.join(__dirname, "..");
const SERVICE_NAME  = process.env.SERVICE_NAME || "nagellacke";

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

function loadApiKey() {
  if (process.env.API_KEY) return process.env.API_KEY;
  try {
    if (fs.existsSync(API_KEY_FILE)) return fs.readFileSync(API_KEY_FILE, "utf8").trim();
  } catch (e) { console.warn("Could not read API key file:", e.message); }
  const key = crypto.randomBytes(24).toString("hex");
  try { fs.writeFileSync(API_KEY_FILE, key, { mode: 0o600, encoding: "utf8" }); }
  catch (e) { console.warn("Could not persist API key:", e.message); }
  return key;
}

const API_KEY = loadApiKey();

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

function saveData(data) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, DATA_FILE);
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

// ── GitHub helpers ───────────────────────────────────────────────────────────

function getGithubRepo() {
  try {
    const url   = execSync("git remote get-url origin", { cwd: APP_ROOT, stdio: "pipe" }).toString().trim();
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
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${safe}`;
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
app.post("/api/update/apply", requireApiKey, rateLimit(3, 300_000), (req, res) => {
  const frontendDir = path.join(APP_ROOT, "frontend");
  try {
    execSync("git pull origin main",        { cwd: APP_ROOT,    stdio: "pipe", timeout: 30_000 });
    execSync("npm install --omit=dev",      { cwd: __dirname,   stdio: "pipe", timeout: 60_000 });
    execSync("npm install",                 { cwd: frontendDir, stdio: "pipe", timeout: 60_000 });
    execSync("npm run build",               { cwd: frontendDir, stdio: "pipe", timeout: 120_000 });
    res.json({ ok: true });
    setTimeout(() => {
      try {
        execSync(`systemctl restart ${SERVICE_NAME}`, { stdio: "pipe" });
      } catch (e) {
        console.debug("systemctl restart failed, falling back to process.exit:", e.message);
        process.exit(0);
      }
    }, 300);
  } catch (e) {
    console.error("Update failed:", e.stderr?.toString() || e.message);
    const msg = (e.stderr ? e.stderr.toString() : e.message).split("\n")[0];
    res.status(500).json({ error: msg || "Update fehlgeschlagen" });
  }
});

// GET /api/logs — systemd journal (requires key, rate-limited)
app.get("/api/logs", requireApiKey, rateLimit(30, 60_000), (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  try {
    const output = execSync(
      `journalctl -u ${SERVICE_NAME} -n ${lines} --no-pager --output=short-iso`,
      { stdio: "pipe", timeout: 6000 }
    ).toString();
    res.json({ logs: output, lines });
  } catch (e) {
    const msg = e.stderr ? e.stderr.toString().trim() : e.message;
    res.json({ logs: msg || "journalctl nicht verfügbar", lines, error: true });
  }
});

// Fallback — client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\nNagellacke v${CURRENT_VERSION} running on http://0.0.0.0:${PORT}`);
  console.log(`Data: ${DATA_FILE}\n`);
  console.log("┌─────────────────────────────────────────────────────┐");
  console.log(`│  API-Schlüssel: ${API_KEY.padEnd(38)}│`);
  console.log("│  (In der App unter Einstellungen ⚙ eingeben)        │");
  console.log("└─────────────────────────────────────────────────────┘\n");
});
