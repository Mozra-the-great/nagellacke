# Architektur & Technische Entscheidungen

Dieses Dokument erklärt den Aufbau der Nagellack-Kollektion-App, den verwendeten Software-Stack und die Gründe hinter den getroffenen Entscheidungen.

---

## Überblick

Die App ist eine **Single-Page-Application (SPA)** mit einem Node.js-Backend. Sie läuft als systemd-Dienst auf einem Linux-Server (typischerweise ein LXC-Container in Proxmox) und ist über den Browser erreichbar. Es gibt keine externe Datenbank, keine Cloud-Dienste und keine externen Abhängigkeiten zur Laufzeit.

```
Browser
  └── React SPA (statische Dateien, vom Express-Server ausgeliefert)
        └── /api/* → Express-Routen → data.json (Dateisystem)
```

---

## Verzeichnisstruktur

```
nagellacke/
├── backend/
│   ├── server.js           ← Express-Server, alle API-Routen, Auth, Rate-Limiting
│   ├── package.json
│   └── data/               ← wird beim ersten Start automatisch angelegt
│       ├── data.json       ← Persistenz (Lacke + Kategorien)
│       └── .api_key        ← API-Schlüssel (mode 0o600)
├── frontend/
│   ├── src/
│   │   ├── App.jsx         ← gesamte Frontend-Logik (~1200 Zeilen, eine Datei)
│   │   └── main.jsx        ← React-Einstiegspunkt
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── install.sh              ← Installations- und Update-Skript
└── README.md
```

---

## Frontend

### React 18

**Warum React?**
React wurde gewählt, weil es der de-facto-Standard für reaktive UIs ist und der Einstieg ohne komplexes Setup möglich ist. Die App hat viele interabhängige Zustände (Filterauswahl, Suchbegriff, Sortierung, Batch-Selektion, Undo-Stack, offene Formulare), die mit React-Hooks (`useState`, `useMemo`, `useCallback`, `useEffect`) sauber ausgedrückt werden können.

Alternativen wie Vue oder Svelte wären ebenfalls möglich gewesen — der Hauptgrund für React war schlicht Bekanntheit und Ökosystem.

### Vite

**Warum Vite statt Create React App?**
Vite bietet wesentlich schnellere Builds durch nativen ESM-Support und Rollup als Bundler. Create React App ist deprecated. Vite baut das Frontend in `backend/public/` — genau dort, wo Express seine statischen Dateien erwartet. Der Entwicklungs-Proxy (`/api → localhost:3000`) ist mit wenigen Zeilen konfiguriert.

### Eine einzige `App.jsx`

**Warum nicht mehrere Komponenten-Dateien?**
Die App ist klein genug (~1200 Zeilen), dass eine einzelne Datei überschaubar bleibt. Mehrere Dateien hätten mehr Import-Overhead und keine echten Vorteile gebracht. Intern gibt es klare Komponenten (`NailBottle`, `PolishForm`, `StatsPage`, `LogPanel`, `UpdatePanel`), aber keine eigenen Dateien.

### Kein Router

Die App hat zwei Ansichten (Kollektion / Statistiken) und schaltet zwischen ihnen per `useState("collection" | "stats")`. Ein vollständiger Router (React Router, TanStack Router) wäre Overhead ohne Nutzen bei zwei Views und keiner URL-Navigation.

### Kein State-Management-Framework

Kein Redux, Zustand, Jotai oder ähnliches. Der Zustand der App besteht aus ca. 15 `useState`-Hooks. Alles lebt in der `App`-Komponente und wird als Props nach unten gereicht. Für diese Größenordnung ist das die einfachste und wartbarste Lösung.

### Styling ohne CSS-Framework

Kein Tailwind, kein Bootstrap, kein CSS-in-JS-Framework. Alle Styles sind inline-Objekte oder eine kleine `<style>`-Komponente mit CSS-Klassen für oft verwendete Pattern (`.bottle-card`, `.filter-btn`, `.form-input`). Das vermeidet Build-Komplexität und hält alles in einer Datei.

Das Design folgt einem dunklen, minimalistischen Luxus-Ästhetik mit Google Fonts (Cormorant Garamond + Jost) und feinen Glass-Morphism-Elementen.

### Google Fonts

Werden live von `fonts.googleapis.com` geladen. In einem Offline-Szenario müssten sie lokal liegen — für ein Heimnetz-Tool akzeptiert.

---

## Backend

### Node.js + Express

**Warum nicht Fastify, Hapi oder ein anderes Framework?**
Express ist das bekannteste und einfachste Node.js-Framework. Es hat minimale Abstraktion und kommt mit `npm install express` ohne weitere Setup-Schritte aus. Für eine App mit ~6 Routen gibt es keinen Grund für ein schwergewichtigeres Framework.

### Keine externe Datenbank

**Warum JSON statt SQLite, PostgreSQL oder MongoDB?**

Die App ist für **eine Person** auf einem **privaten Server** ausgelegt. Es gibt keine gleichzeitigen Schreibzugriffe, keine Abfragen, die einen Query-Planner brauchen, und keine Millionen von Einträgen. Eine JSON-Datei erfüllt alle Anforderungen:

- Keine Installation eines Datenbankservers
- Backup = `cp data.json backup.json`
- Im Fehlerfall direkt lesbar und editierbar
- Atomic Write: erst in `.tmp` schreiben, dann `fs.renameSync` → kein korruptes File bei Absturz

Wenn die App je multi-user oder öffentlich zugänglich werden sollte, wäre SQLite der sinnvolle nächste Schritt.

### Datenmigration beim Laden

`loadData()` enthält eine automatische Migration: ältere Datensätze ohne `brand`- oder `finish`-Felder werden beim Laden auf sinnvolle Defaults gesetzt und sofort zurückgeschrieben. Das ermöglicht Datenschema-Erweiterungen ohne manuelles Migrationsskript.

### API-Key-Authentifizierung

**Warum kein JWT, keine Sessions, kein OAuth?**

Die App ist nur im Heimnetz erreichbar. Ein einfacher statischer API-Schlüssel im HTTP-Header (`X-Api-Key`) ist ausreichend sicher und verursacht null Overhead. Der Schlüssel wird beim ersten Start generiert (`crypto.randomBytes(24).toString("hex")`), in `data/.api_key` persistiert (Dateiberechtigung 0o600) und in der Konsole ausgegeben. Im Frontend wird er in `localStorage` gespeichert.

Geschützte Endpunkte:
- `POST /api/data` — Kollektion speichern
- `GET /api/update/check` — GitHub-Update-Check
- `POST /api/update/apply` — Update durchführen
- `GET /api/logs` — Systemlogs abrufen

Öffentlich (kein Key nötig):
- `GET /api/data` — Kollektion lesen (read-only, kein Risiko)
- `GET /api/version` — aktuelle Version (wird für Update-Polling gebraucht)

### Rate-Limiting ohne externe Bibliothek

Kein `express-rate-limit`, kein Redis. Ein einfaches `Map`-basiertes In-Memory-Limiter reicht für den Anwendungsfall. Limit: 10 Req/min für Update-Check, 3 Req/5min für Update-Apply, 30 Req/min für Logs.

### `execSync` für Git und Build

Das Update-Kommando läuft synchron: `git pull` → `npm install` → `npm run build` → `systemctl restart`. Synchron statt asynchron, weil der Server ohnehin direkt danach neugestartet wird. Fehler aus `stderr` werden intern geloggt, aber nicht an den Client weitergegeben (verhindert Information Leakage).

---

## Deployment

### systemd

Der Dienst läuft als systemd-Unit (`/etc/systemd/system/nagellacke.service`). Das gibt:
- Autostart beim Server-Boot
- Automatischer Neustart bei Absturz (`Restart=always`)
- Logs über `journalctl`
- Steuerung über `systemctl start/stop/restart`

### In-App-Update-System

Das Update-Kommando (`POST /api/update/apply`) führt direkt `git pull`, `npm install`, `npm run build` und `systemctl restart` aus. Nach dem Neustart pollt das Frontend alle 2 Sekunden `/api/version` und lädt die Seite neu, sobald die neue Version antwortet. Fallback: harter Reload nach 60 Sekunden.

### Vite Build-Output direkt in `backend/public/`

Vite baut die SPA als statische Dateien in `backend/public/`. Express liefert diesen Ordner mit `express.static()` aus. Kein separater Nginx nötig.

---

## Datenmodell

### Polish-Objekt

```json
{
  "name":       "Blue You A Kiss",      // Pflichtfeld
  "brand":      "Catrice",              // Marke
  "num":        "029",                  // Artikelnummer (optional)
  "color":      "#3a7bd5",             // Hex-Farbe
  "finish":     "Classic",             // eines von 15 Finish-Typen
  "status":     "ok",                  // "ok" | "wish" | "empty" | "gone"
  "count":      2,                     // Anzahl Flaschen (optional, ≥2)
  "categories": ["sommer_1234567890"], // IDs aus customCats
  "notes":      "Gekauft 2024-03"      // Freitext (optional)
}
```

### data.json-Struktur

```json
{
  "polishes": [ ...Polish-Objekte ],
  "customCats": [
    { "id": "sommer_1234567890", "label": "Sommer" }
  ]
}
```

Kategorie-IDs werden beim Erstellen generiert: `label.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now()`. Das macht sie eindeutig ohne UUID-Bibliothek.

---

## Sicherheitsmodell

Die App ist für den Einsatz im **privaten Heimnetz** konzipiert, nicht für das öffentliche Internet.

| Bedrohung | Maßnahme |
|-----------|---------|
| Unberechtigte Schreibzugriffe | API-Key-Pflicht auf allen Mutationen |
| Replay / Brute-Force | In-Memory-Rate-Limiting |
| Riesige Payloads (DoS) | `express.json({ limit: "2mb" })` |
| Bösartige Importdaten | Validierung jedes Polish-Objekts vor Übernahme |
| Information Leakage | Interne Fehler werden nur geloggt, nicht an Client geschickt |
| Datenverlust bei Absturz | Atomic Write (`.tmp` + `renameSync`) |

Bekannte offene Punkte (für Heimnetz-Betrieb akzeptiert):
- Der Dienst läuft standardmäßig als root — für Produktionsbetrieb sollte ein eigener `nagellacke`-User angelegt und in der systemd-Unit eingetragen werden (`User=nagellacke`, `NoNewPrivileges=yes`, `ProtectSystem=strict`)
- HTTP, kein HTTPS — im Heimnetz ohne externen Zugang akzeptabel; für externen Zugang: Nginx-Reverse-Proxy mit Let's Encrypt vorschalten

---

## Versionierung

Semantisches Versioning (`MAJOR.MINOR.PATCH`). Versionen werden als Git-Tags gesetzt. Der Update-Check im Backend liest Tags via GitHub API.

| Version | Inhalt |
|---------|--------|
| v1.0.0 | Erste Version — Grundfunktionen |
| v1.1.0 | System-Log-Viewer |
| v1.2.0 | Multi-Brand-Support |
| v1.3.0 | Statistiken-Seite |
| v1.4.0 | Finish-Typen, Marken-Vorschläge, dynamische Filter |
| v1.5.0 | Kategorien im Formular, Notizen, Batch-Modus, Undo, Export/Import, Sortierung |
| v1.6.0 | API-Key-Authentifizierung, Security Hardening, Bug-Fixes |
| v1.6.1 | Foto-Farbpicker: Kamera/Galerie → Farbe per Tipp aus Bild übernehmen (Canvas API) |
| v1.6.2 | Kamera-Button öffnet direkt die Kamera auf Mobilgeräten (`capture="environment"`) |
| v1.7.0 | Theme-Switcher: 6 vollständige Designs (Dark Luxury, Candy Pop, Warm Vintage, Neon Nightclub, Clean White, Forest Dark) mit eigenen Fonts, Border-Radii, Shadows und Farb-Tokens |
