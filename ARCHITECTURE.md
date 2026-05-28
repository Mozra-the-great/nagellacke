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
│       ├── data.json       ← Persistenz (Lacke + Kategorien + Maniküren)
│       ├── photos/         ← Flaschenfoto- und Tagebuch-Fotos (jpg)
│       └── .api_key        ← API-Schlüssel (mode 0o600)
├── frontend/
│   ├── public/             ← statische Assets (von Vite 1:1 in dist kopiert)
│   │   ├── manifest.json   ← PWA-Manifest
│   │   ├── sw.js           ← Service Worker (Cache-First, /api/ ausgenommen)
│   │   ├── icon-192.svg    ← PWA-Icon
│   │   └── icon-512.svg    ← PWA-Icon (groß)
│   ├── src/
│   │   ├── themes.js       ← THEMES-Objekt (alle 7 Designs)
│   │   ├── constants.js    ← FINISH_OPTIONS, STATUS_OPTIONS, SORT_OPTIONS, EMPTY_FORM, …
│   │   ├── utils.js        ← hexToHue() und weitere shared Helpers
│   │   ├── App.jsx         ← State, Handler, Main-Render (~600 Zeilen)
│   │   ├── main.jsx        ← React-Einstiegspunkt + SW-Registrierung
│   │   └── components/
│   │       ├── NailBottle.jsx
│   │       ├── PolishForm.jsx
│   │       ├── StatsPage.jsx
│   │       ├── LogPanel.jsx
│   │       └── UpdatePanel.jsx
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

### Modulare Dateistruktur (seit v1.9.0)

`App.jsx` wurde in separate Module aufgeteilt: `themes.js` (Theme-Daten), `constants.js` (Optionslisten, EMPTY_FORM), `utils.js` (shared Helpers) und fünf Komponentendateien unter `components/`. `App.jsx` enthält nur noch State, Handler und den Haupt-Render (~600 Zeilen statt ~1700). Intern genutzte Hilfskomponenten wie `Bar` in StatsPage bleiben in der jeweiligen Datei.

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
  "notes":      "Gekauft 2024-03",     // Freitext (optional)
  "rating":     4,                     // Sterne 1–5 (optional)
  "createdAt":  1716900000000,         // Unix-ms, beim Anlegen gesetzt
  "updatedAt":  1716900000000,         // Unix-ms, bei jeder Änderung aktualisiert
  "photo":      "filename.jpg"         // Dateiname in data/photos/ (optional, seit v2.0.0)
}
```

### Manicure-Objekt (seit v2.0.0)

```json
{
  "id":         "1716900000000-abc",
  "date":       "2025-05-28",
  "polishRefs": [{ "name": "Blue You A Kiss", "brand": "Catrice", "color": "#3a7bd5" }],
  "notes":      "für den Urlaub",
  "photo":      "manicure-filename.jpg",
  "createdAt":  1716900000000
}
```

### Sticker-Objekt (seit v2.1.0)

```json
{
  "name":      "Cherry Blossoms",
  "brand":     "Born Pretty",
  "style":     "Blumen",
  "type":      "accent",
  "colors":    ["#ffb3c6", "transparent", "#ffffff"],
  "status":    "ok",
  "notes":     "Sehr filigran",
  "photo":     "sticker-filename.jpg",
  "rating":    4,
  "createdAt": 1716900000000,
  "updatedAt": 1716900000000
}
```

`colors` ist ein Array aus Hex-Strings plus dem Sonderwert `"transparent"`, der als CSS-Wert direkt verwendbar ist und als Schachbrettmuster dargestellt wird. Maximal 10 Farben pro Sticker.

`type` ist eines von: `"full"` (Full Cover), `"accent"`, `"wrap"` (Nail Wrap), `"3d"`, `"foil"` (Folie), `"slider"`.

### data.json-Struktur

```json
{
  "polishes":  [ ...Polish-Objekte ],
  "customCats": [ { "id": "sommer_1234567890", "label": "Sommer" } ],
  "manicures": [ ...Manicure-Objekte ],
  "stickers":  [ ...Sticker-Objekte ]
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
| v1.7.1 | Strukturelle Theme-Unterschiede: 4 Karten-Layouts (Flasche, Blob, Stripe, Row) und 3 Filter-Layouts (Pills, Underline, Block-Glow) je nach Theme |
| v1.7.2 | Sternebewertung (1–5) pro Lack; Farbklick in Statistik zeigt zugehörigen Lack mit Sprung in Kollektion |
| v1.7.3 | Lesbarkeit: Kontrast-Fixes in allen 6 Themes (WCAG AA); Accessibility: aria-label, aria-pressed, aria-live, Fokus-Ringe, Landmark-Elemente, htmlFor/id-Verbindungen; Rating-Bug in Bearbeitungsformular behoben |
| v1.8.0 | Tastatur-Shortcuts (/ Suche, Esc schließen, n Neuer Lack); Theme „System" (folgt OS prefers-color-scheme); Dupe-Detektor beim Anlegen (Hue + Finish); Update-Check-Cache 10 min (kein GitHub-Rate-Limit); PolishForm key-Bug behoben |
| v1.9.0 | Code-Split (App.jsx → themes.js, constants.js, utils.js, 5 Komponenten); Timestamps (createdAt/updatedAt + Sortierung „Neueste/Älteste"); Batch-Erweiterung (Marke, Finish, Kategorie); Import Merge-Modus (Zusammenführen vs. Ersetzen); PWA (manifest.json, Service Worker Cache-First, SVG-Icons) — **Hinweis:** `CACHE`-Name in `sw.js` bei jedem Release auf neue Version aktualisieren (z.B. `nagellacke-v1.9.1`), damit alte Assets durch neue ersetzt werden |
| v2.0.0 | Flaschenfoto pro Lack (Canvas-Resize → Base64 → `data/photos/`, kein neues npm-Paket); Foto-Toggle auf Karte (SVG ↔ Foto, alle 4 Kartentypen); Maniküre-Tagebuch (neue 3. View, Einträge mit Datum, Lacke aus Kollektion, Notizen, optionales Foto); Navigation auf 3 Buttons erweitert; `data.manicures`-Array in data.json; Backend-Endpoints POST/DELETE `/api/photos` |
| v2.1.0 | Nail-Sticker-Inventar: eigener Nav-Tab „Sticker"; Felder Name, Marke, Stil (Freitext), Typ (6 Typen als Chips), Farben (Multi-Color-Editor mit Hex + Transparent-Option), Status, Bewertung, Foto, Notizen; `data.stickers`-Array in data.json; automatische Migration älterer data.json ohne `stickers`-Feld |
| v2.1.1 | Update-Cache-Fix (localStorage wird vor dem Update-Apply geleert); Nav „Nagellack" statt „Kollektion"; Sticker-Auswahl im Tagebuch; Mobile Nav-Overlap-Fix (flexbox Header) |
| v2.1.2 | Robustes Update-Polling (erkennt Server-Downtime via `downCount`; Fallback-Reload nach 45 s); Version-Bump-Pflicht in allen Patch-Commits klargestellt |
| v2.1.3 | Mobile Nav-Fix: `.header-nav` CSS-Klasse statt Inline-`marginLeft:auto`, Media-Query überschreibt auf Mobilgeräten zu voller Breite und Linksbündigkeit |
| v2.1.4 | Sticker: Foto wird standardmäßig angezeigt; „Mehrfarbig"-Option im Farb-Editor (Regenbogen-Gradient); PolishForm Foto-Farbpicker auf einen Button reduziert (nativer Android-Chooser statt 📷/🖼 getrennt) |
| v2.1.5 | Mobile Bug-Fixes: PhotoPicker-Komponente (ein Button → Dropdown „📷 Kamera" / „🖼 Galerie") in StickerPage + DiaryPage; Fehler-Feedback bei fehlgeschlagenem Foto-Upload; `type="button"` auf alle Buttons in StickerFormFields; API-Schlüssel-Warnung in Sticker-Formularen |
