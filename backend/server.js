const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "data.json");
const APP_ROOT = path.join(__dirname, "..");

const pkg = require("./package.json");
const CURRENT_VERSION = pkg.version;

// Default data if no file exists yet
const DEFAULT_DATA = {
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
  customCats: [],
};

// Ensure data directory exists
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      // Migrate: add missing fields from older data formats
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
        return updated;
      });
      if (migrated) saveData(data);
      return data;
    }
  } catch (e) {
    console.error("Error reading data file, using defaults:", e.message);
  }
  return DEFAULT_DATA;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

// Parse GitHub owner/repo from remote URL
function getGithubRepo() {
  try {
    const url = execSync("git remote get-url origin", { cwd: APP_ROOT, stdio: "pipe" }).toString().trim();
    const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (match) return { owner: match[1], repo: match[2] };
  } catch (e) {}
  return null;
}

function githubGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      { hostname: "api.github.com", path, headers: { "User-Agent": "nagellacke-app" } },
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
  // Try releases API first, fall back to tags
  try {
    const release = await githubGet(`/repos/${owner}/${repo}/releases/latest`);
    if (release.tag_name) return { version: release.tag_name, url: release.html_url || null };
  } catch (e) { /* fall through to tags */ }

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

// -1 = v1 older than v2 (update available), 0 = equal, 1 = v1 newer
function compareVersions(v1, v2) {
  const parse = (v) => v.replace(/^v/, "").split(".").map((n) => parseInt(n) || 0);
  const [a1, b1, c1] = parse(v1);
  const [a2, b2, c2] = parse(v2);
  if (a1 !== a2) return a1 < a2 ? -1 : 1;
  if (b1 !== b2) return b1 < b2 ? -1 : 1;
  if (c1 !== c2) return c1 < c2 ? -1 : 1;
  return 0;
}

app.use(express.json());

// Serve built frontend
app.use(express.static(path.join(__dirname, "public")));

// API: get all data
app.get("/api/data", (req, res) => {
  res.json(loadData());
});

// API: save all data
app.post("/api/data", (req, res) => {
  const { polishes, customCats } = req.body;
  if (!Array.isArray(polishes) || !Array.isArray(customCats)) {
    return res.status(400).json({ error: "Invalid data format" });
  }
  saveData({ polishes, customCats });
  res.json({ ok: true });
});

// API: current version
app.get("/api/version", (req, res) => {
  res.json({ version: CURRENT_VERSION });
});

// API: check for update on GitHub
app.get("/api/update/check", async (req, res) => {
  const repo = getGithubRepo();
  if (!repo) {
    return res.status(500).json({ error: "Kein GitHub-Remote konfiguriert" });
  }
  try {
    const latest = await fetchLatestVersion(repo.owner, repo.repo);
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

// API: apply update (git pull + rebuild + restart)
app.post("/api/update/apply", (req, res) => {
  const frontendDir = path.join(APP_ROOT, "frontend");
  try {
    execSync("git pull origin main", { cwd: APP_ROOT, stdio: "pipe", timeout: 30000 });
    execSync("npm install --omit=dev", { cwd: __dirname, stdio: "pipe", timeout: 60000 });
    execSync("npm install", { cwd: frontendDir, stdio: "pipe", timeout: 60000 });
    execSync("npm run build", { cwd: frontendDir, stdio: "pipe", timeout: 120000 });

    res.json({ ok: true });

    // Restart: try systemd first, fall back to process exit (systemd Restart=always picks it up)
    setTimeout(() => {
      try {
        execSync("systemctl restart nagellacke", { stdio: "pipe" });
      } catch (e) {
        process.exit(0);
      }
    }, 300);
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).split("\n")[0];
    res.status(500).json({ error: msg || "Update fehlgeschlagen" });
  }
});

// API: fetch systemd journal logs
app.get("/api/logs", (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  try {
    const output = execSync(
      `journalctl -u nagellacke -n ${lines} --no-pager --output=short-iso`,
      { stdio: "pipe", timeout: 6000 }
    ).toString();
    res.json({ logs: output, lines });
  } catch (e) {
    const msg = e.stderr ? e.stderr.toString().trim() : e.message;
    res.json({ logs: msg || "journalctl nicht verfügbar", lines, error: true });
  }
});

// Fallback: serve index.html for client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Nagellacke v${CURRENT_VERSION} running on http://0.0.0.0:${PORT}`);
  console.log(`Data stored in: ${DATA_FILE}`);
});
