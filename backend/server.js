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
    { name: "High Shine Gel", sub: "Top Coat", color: "#ddeeff", shimmer: true, categories: ["coat"], status: "ok" },
    { num: "029", name: "Blue You A Kiss", color: "#3a7bd5", categories: [], status: "ok" },
    { num: "021", name: "Caught on The Red Carpet", color: "#c0202a", categories: [], status: "ok" },
    { num: "030", name: "Fairy Dust", color: "#f9c8e0", shimmer: true, categories: [], status: "ok" },
    { num: "020", name: "Solar Seduction", color: "#f4a020", categories: [], status: "ok" },
    { num: "006", name: "Party Animal", color: "#7b1e2e", categories: [], status: "ok" },
    { num: "010", name: "Party At First Pull", color: "#e05080", count: 2, categories: [], status: "ok" },
    { num: "038", name: "Cosmo Where is Wanda?", color: "#d4257a", categories: [], status: "ok" },
    { num: "026", name: "Midnight Dusk", color: "#1b1340", categories: [], status: "ok" },
    { num: "041", name: "Spill The Tea-I", color: "#9e6b34", categories: [], status: "ok" },
    { num: "040", name: "Ocean Whisper", color: "#2a9db5", categories: [], status: "ok" },
    { num: "036", name: "Silver Supernova", color: "#a8b4c8", shimmer: true, categories: [], status: "ok" },
    { num: "025", name: "Lilac Lullaby", color: "#b98ed6", categories: [], status: "ok" },
    { num: "044", name: "Sparkle Like It's Midnight", color: "#0a0e2e", shimmer: true, categories: [], status: "ok" },
    { num: "031", name: "Electric Turquoise", color: "#00c9c8", categories: [], status: "ok" },
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
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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

function fetchLatestRelease(owner, repo) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: "api.github.com",
        path: `/repos/${owner}/${repo}/releases/latest`,
        headers: { "User-Agent": "nagellacke-app" },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Ungültige API-Antwort von GitHub"));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("GitHub API Timeout"));
    });
  });
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
    const release = await fetchLatestRelease(repo.owner, repo.repo);
    if (!release.tag_name) {
      return res.status(404).json({ error: "Noch keine Releases auf GitHub vorhanden" });
    }
    const latestVersion = release.tag_name.replace(/^v/, "");
    res.json({
      currentVersion: CURRENT_VERSION,
      latestVersion,
      updateAvailable: compareVersions(CURRENT_VERSION, latestVersion) < 0,
      releaseUrl: release.html_url || null,
      releaseNotes: release.body || "",
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

// Fallback: serve index.html for client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Nagellacke v${CURRENT_VERSION} running on http://0.0.0.0:${PORT}`);
  console.log(`Data stored in: ${DATA_FILE}`);
});
