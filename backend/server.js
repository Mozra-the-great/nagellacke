const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "data.json");

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

// Load or initialize data
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

// Fallback: serve index.html for client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Nagellacke running on http://0.0.0.0:${PORT}`);
  console.log(`Data stored in: ${DATA_FILE}`);
});
