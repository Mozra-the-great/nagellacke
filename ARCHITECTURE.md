# Architektur & Technische Entscheidungen

Dieses Dokument erklärt den Aufbau der Nagellack-Kollektion-App, den verwendeten Software-Stack und die Gründe hinter den getroffenen Entscheidungen. Es deckt beide Generationen ab: **v2** (Express, aktuell im Einsatz) und **v3** (Fastify + Monorepo + Android-App, nach Upgrade aktiv).

---

## Überblick

### v2

```
Browser
  └── React SPA (statische Dateien, vom Express-Server ausgeliefert)
        └── /api/* → Express-Routen → data.json (Dateisystem)
```

### v3

```
Browser / Android-App
  └── React SPA / Expo React Native
        ├── /api/*       → Fastify-Routen → data.json (Dateisystem)
        ├── /api/auth/*  → JWT-Authentifizierung → users.json
        └── /api/sync/*  → Merge-Algorithmus (@nagellacke/core) → data.json
```

---

## Verzeichnisstruktur

```
nagellacke/
├── backend/
│   ├── server.js           ← Express-Server, alle API-Routen, Auth, Rate-Limiting, v3-Upgrade-Logik
│   ├── package.json        ← v3.0.1, nur Express als Dependency
│   └── data/               ← wird beim ersten Start automatisch angelegt
│       ├── data.json       ← Persistenz (Lacke + Kategorien + Maniküren + Sticker)
│       ├── photos/         ← Flaschenfoto- und Tagebuch-Fotos (UUID-benannt)
│       └── .api_key        ← API-Schlüssel (mode 0o600)
├── frontend/
│   ├── public/             ← statische Assets (von Vite 1:1 in dist kopiert)
│   │   ├── manifest.json   ← PWA-Manifest
│   │   ├── sw.js           ← Service Worker (Cache-First, /api/ ausgenommen)
│   │   ├── icon-192.svg    ← PWA-Icon
│   │   └── icon-512.svg    ← PWA-Icon (groß)
│   ├── src/
│   │   ├── themes.js       ← THEMES-Objekt (6 vollständige Designs)
│   │   ├── constants.js    ← FINISH_OPTIONS, STATUS_OPTIONS, SORT_OPTIONS, BRAND_SUGGESTIONS, EMPTY_FORM, …
│   │   ├── utils.js        ← hexToHue() und weitere shared Helpers
│   │   ├── App.jsx         ← State, Handler, Main-Render (~1370 Zeilen, 4 Views)
│   │   ├── main.jsx        ← React-Einstiegspunkt + SW-Registrierung
│   │   └── components/
│   │       ├── NailBottle.jsx        ← SVG-Darstellung einer Nagellack-Flasche
│   │       ├── PolishForm.jsx        ← Formular zum Anlegen/Bearbeiten von Lacken
│   │       ├── StatsPage.jsx         ← Statistiken-Dashboard
│   │       ├── DiaryPage.jsx         ← Maniküre-Tagebuch
│   │       ├── StickerPage.jsx       ← Nail-Sticker-Inventar
│   │       ├── SyncPanel.jsx         ← Cloud-Sync-Konfiguration (v3-Feature in v2-UI)
│   │       ├── UpdatePanel.jsx       ← In-App-Update-System + Upgrade-auf-v3-Button
│   │       └── LogPanel.jsx          ← systemd Journal Viewer
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── install.sh              ← v2 Installer und Update-Skript
├── CHANGELOG.md            ← Vollständige Versionshistorie
└── v3/                     ← v3 Monorepo (npm workspaces)
    ├── package.json        ← Monorepo-Root, Node ≥20, Scripts für alle Workspaces
    ├── packages/
    │   ├── core/           ← @nagellacke/core — Typen, Logic, Merge-Algo, Konstanten
    │   │   └── src/
    │   │       ├── types.ts      ← Polish, Sticker, Manicure, Category, AppData
    │   │       ├── logic.ts      ← filterPolishes, sortPolishes, mergeData, mergeList
    │   │       ├── constants.ts  ← FINISH_OPTIONS, STATUS_OPTIONS, BRAND_SUGGESTIONS, …
    │   │       └── utils.ts      ← hexToHue, generateId, now
    │   └── sync/           ← @nagellacke/sync — Sync-Adapter-Abstraktionsschicht
    │       └── src/
    │           ├── adapter.ts          ← SyncAdapter Interface + SyncConfig Typ
    │           ├── factory.ts          ← createAdapter(config) Factory-Funktion
    │           └── adapters/
    │               ├── server.ts       ← Eigener Fastify-Server (JWT)
    │               ├── googledrive.ts  ← Google Drive v3 API
    │               ├── onedrive.ts     ← Microsoft Graph v1.0
    │               ├── nextcloud.ts    ← WebDAV (remote.php/dav)
    │               └── dropbox.ts      ← Dropbox API v2
    ├── server/             ← Fastify-Server (nach Upgrade aktiver Dienst)
    │   └── src/
    │       ├── index.ts    ← Alle Routen, JWT-Auth, Rate-Limiting, Update-Pipeline
    │       └── db.ts       ← getData/setData, getUser/createUser, Dateipersistenz
    └── apps/
        ├── web/            ← v3 Web-App (React 18 + TypeScript + Vite)
        │   └── src/
        │       ├── App.tsx              ← Tab-Navigation (collection|stickers|diary|stats|settings)
        │       ├── useAppData.ts        ← Hook für Daten + CRUD + sync()
        │       └── pages/              ← CollectionPage, StickersPage, DiaryPage, StatsPage, SettingsPage
        └── web/            ← v3 Web-App (React 18 + TypeScript + Vite) [nur Webapp]
android/                    ← Native Android-App (Kotlin / Jetpack Compose)
    └── app/src/main/java/de/nagellacke/
        ├── data/
        │   ├── local/      ← Room Entities, DAOs, AppDatabase
        │   ├── repo/       ← NagellackeRepository, PhotoRepository, SyncConfigStore, DisplayPrefsStore
        │   └── sync/       ← SyncAdapter Interface + ServerAdapter, NextcloudAdapter, …
        ├── domain/
        │   ├── model/      ← Polish, Sticker, Manicure, Category, AppData (kotlinx.serialization)
        │   └── Constants.kt ← FINISH_OPTIONS, SHIMMER_FINISHES, BRAND_SUGGESTIONS, …
        └── ui/
            ├── collection/ ← CollectionScreen, PolishCard, PolishFormSheet, CollectionViewModel
            ├── stickers/   ← StickersScreen, StickerFormSheet, StickersViewModel
            ├── diary/      ← DiaryScreen, DiaryFormSheet, DiaryViewModel
            ├── stats/      ← StatsScreen
            ├── settings/   ← SettingsScreen, SettingsViewModel
            └── common/     ← LoadingScreen, EmptyScreen, ErrorScreen, NailBottle
```

---

## Frontend (v2)

### React 18

**Warum React?**
React wurde gewählt, weil es der de-facto-Standard für reaktive UIs ist und der Einstieg ohne komplexes Setup möglich ist. Die App hat viele interabhängige Zustände (Filterauswahl, Suchbegriff, Sortierung, Batch-Selektion, Undo-Stack, offene Formulare), die mit React-Hooks (`useState`, `useMemo`, `useCallback`, `useEffect`) sauber ausgedrückt werden können.

### Vite

Vite bietet wesentlich schnellere Builds durch nativen ESM-Support und Rollup als Bundler. Create React App ist deprecated. Vite baut das Frontend in `backend/public/` — genau dort, wo Express seine statischen Dateien erwartet.

### Modulare Dateistruktur (seit v1.9.0)

`App.jsx` wurde in separate Module aufgeteilt: `themes.js` (Theme-Daten), `constants.js` (Optionslisten, EMPTY_FORM), `utils.js` (shared Helpers) und sieben Komponentendateien unter `components/`. `App.jsx` enthält nur noch State, Handler und den Haupt-Render (~1370 Zeilen für 4 Views).

### 4 Views

Die App hat vier Hauptansichten und schaltet zwischen ihnen per `useState`:
- `"collection"` — Nagellack-Kollektion (Standard)
- `"diary"` — Maniküre-Tagebuch
- `"stickers"` — Nail-Sticker-Inventar
- `"stats"` — Statistiken-Dashboard

Kein vollständiger Router — für vier Views ohne URL-Navigation wäre er Overhead.

### Kein State-Management-Framework

Kein Redux, Zustand, Jotai oder ähnliches. Der Zustand besteht aus ca. 25 `useState`-Hooks. Alles lebt in `App` und wird als Props nach unten gereicht. Für diese Größenordnung ist das die einfachste und wartbarste Lösung.

### Styling ohne CSS-Framework

Keine Tailwind, kein Bootstrap, kein CSS-in-JS-Framework. Alle Styles sind inline-Objekte oder eine kleine `<style>`-Komponente. Das vermeidet Build-Komplexität.

### Theme-System (seit v1.7.0)

Sechs vollständige Theme-Definitionen in `themes.js`, jedes mit 30+ Farb- und Style-Tokens:

| Theme-ID | Stil | Karten-Layout | Filter-Layout |
|----------|------|---------------|---------------|
| `darkLuxury` | Dunkel, Luxus | Flasche (bounce) | Pills |
| `candyPop` | Hell, verspielt | Blob (weiche Formen) | Pills |
| `vintageWarm` | Hell, Retro | Stripe (horizontal, einspaltig) | Underline |
| `neonNightclub` | Dunkel, Neon | Flasche | Block-Glow |
| `cleanWhite` | Hell, Minimalist | Row (Liste, einspaltig) | Pills |
| `forestGreen` | Dunkel, Nature | Blob | Pills |

Theme-Auswahl wird in `localStorage` (Key: `nagellacke_theme`) gespeichert. Option `"system"` folgt `prefers-color-scheme`.

---

## Backend (v2)

### Node.js + Express

Express ist das bekannteste und einfachste Node.js-Framework. Es hat minimale Abstraktion und kommt mit `npm install express` ohne weiteres Setup aus. Für eine App mit ~8 Routen gibt es keinen Grund für ein schwergewichtigeres Framework in v2.

### API-Routen (v2)

| Endpoint | Methode | Auth | Funktion |
|----------|---------|------|---------|
| `/api/data` | GET | — | Kollektion lesen |
| `/api/data` | POST | API-Key | Kollektion speichern |
| `/api/photos` | POST | API-Key | Foto hochladen (Base64, UUID-Dateiname) |
| `/api/photos/:filename` | DELETE | API-Key | Foto löschen |
| `/api/version` | GET | — | Aktuelle Version |
| `/api/update/check` | GET | API-Key | GitHub-Update-Check (Rate: 10/min) |
| `/api/update/apply` | POST | API-Key | Update durchführen (Rate: 3/5min) |
| `/api/logs` | GET | API-Key | systemd Journal (Rate: 30/min) |
| `/api/v3/status` | GET | API-Key | v3-Installations-Status |
| `/api/v3/install` | POST | API-Key | v2→v3-Migration (Rate: 2/5min) |
| `/api/v3/logs` | GET | API-Key | v3 systemd Journal |

### Keine externe Datenbank

Die App ist für **eine Person** auf einem **privaten Server** ausgelegt. Eine JSON-Datei erfüllt alle Anforderungen:
- Keine Installation eines Datenbankservers
- Backup = `cp data.json backup.json`
- Im Fehlerfall direkt lesbar und editierbar
- Atomic Write: erst in `.tmp` schreiben, dann `fs.renameSync` → kein korruptes File bei Absturz

### Datenmigration beim Laden

`loadData()` enthält eine automatische Migration: ältere Datensätze ohne neue Felder werden beim Laden auf sinnvolle Defaults gesetzt und sofort zurückgeschrieben. Das ermöglicht Datenschema-Erweiterungen ohne manuelles Migrationsskript.

### API-Key-Authentifizierung

Ein statischer API-Schlüssel im HTTP-Header (`X-Api-Key`) ist für das Heimnetz ausreichend. Der Schlüssel wird beim ersten Start generiert (`crypto.randomBytes(24).toString("hex")`), in `data/.api_key` persistiert (0o600) und einmalig in der Konsole ausgegeben.

### Rate-Limiting ohne externe Bibliothek

Kein `express-rate-limit`, kein Redis. Ein `Map`-basierter In-Memory-Limiter reicht für den Anwendungsfall.

---

## v3 — Fastify-Server

### Warum Fastify statt Express?

v3 wurde von Grund auf in TypeScript geschrieben. Fastify bietet native TypeScript-Unterstützung, Plugin-basierte Architektur (`@fastify/jwt`, `@fastify/cors`, `@fastify/static`) und ist deutlich performanter als Express — relevant wenn die gleiche Instanz auch den Sync für die Android-App betreibt.

### API-Routen (v3)

| Endpoint | Methode | Auth | Funktion |
|----------|---------|------|---------|
| `/api/data` | GET | API-Key | Kollektion lesen (v2-kompatibel) |
| `/api/data` | POST | API-Key oder JWT | Kollektion speichern |
| `/api/photos` | POST | API-Key oder JWT | Foto hochladen |
| `/api/photos/:filename` | DELETE | API-Key oder JWT | Foto löschen |
| `/api/version` | GET | — | Server-Version |
| `/api/update/check` | GET | JWT | GitHub-Update-Check (Rate: 10/min) |
| `/api/update/apply` | POST | JWT | Update durchführen (Rate: 3/5min) |
| `/api/logs` | GET | JWT | systemd Journal (Rate: 30/min) |
| `/api/auth/register` | POST | — | Neuer User → JWT (min. 8 Zeichen Passwort) |
| `/api/auth/login` | POST | — | Login → JWT (30 Tage gültig) |
| `/api/sync` | GET | JWT | Aktuellen Datenstand abrufen |
| `/api/sync` | POST | JWT | Client-Daten merge (mergeData aus @nagellacke/core) |
| `/api/sync/push` | POST | JWT | Gemergten Stand hochladen |

### Dual-Auth (API-Key + JWT)

`POST /api/data` akzeptiert sowohl `X-Api-Key` (v2-Clients, PWA) als auch `Authorization: Bearer <token>` (v3 Android/Web mit Account). Das ermöglicht einen nahtlosen Übergang ohne Breaking Change.

### Passwort-Hashing

`crypto.scryptSync` mit 32-Byte-Salt + 64-Byte-Hash. Vergleich mit `crypto.timingSafeEqual` gegen Timing-Angriffe. Format in `users.json`: `{salt}:{hash}` (Hex-kodiert).

### Image-Validierung

Magic-Bytes-Check vor dem Speichern: JPEG (`0xFFD8FF`), PNG (`0x89504E47`), WebP (`RIFF...WEBP`). MIME-Type-Spoofing ist damit nicht möglich.

### Update-Pipeline (v3)

1. Antwortet sofort mit `{ok: true}` (verhindert Nginx-Timeout)
2. `setImmediate()` startet Build im Hintergrund:
   - `git pull origin main` (30 s Timeout)
   - `npm install --omit=dev` (60 s)
   - `npm run build:core` (60 s)
   - `npm run build:server` (60 s)
   - `npm run build:web` (120 s)
   - Kopiert `v3/apps/web/dist` → `server/public/`
3. Nach 300 ms: `process.exit(0)` — `Restart=always` in der Unit startet den Prozess automatisch neu (kein `systemctl restart` mehr, s. #71)

---

## v3 — Monorepo

### npm workspaces

Das v3-Verzeichnis ist ein npm-Workspace-Monorepo mit fünf Packages:

| Package | Name | Zweck |
|---------|------|-------|
| `packages/core` | `@nagellacke/core` | Typen, Business-Logik, Merge-Algorithmus |
| `packages/sync` | `@nagellacke/sync` | Sync-Adapter-Abstraktionsschicht |
| `server` | `nagellacke-server` | Fastify HTTP-Server |
| `apps/web` | `nagellacke-web` | React Web-App |
| `apps/android` | — | Expo React Native App |

**Warum Monorepo?**
`@nagellacke/core` (Typen + Merge-Logik) und `@nagellacke/sync` (Adapter) werden von Server, Web-App und Android-App gemeinsam genutzt. Ein Monorepo vermeidet Code-Duplikation und stellt sicher, dass alle Teile denselben Typen-Stand haben.

---

## v3 — @nagellacke/core

### Typen

```typescript
Polish    { id, name, brand, num, color, finish, status, count?, categories?,
            notes?, rating?, photo?, createdAt, updatedAt, deletedAt? }

Sticker   { id, name, brand?, style?, type, colors?, status, rating?,
            notes?, photo?, createdAt, updatedAt, deletedAt? }

Manicure  { id, date, polishes: string[], notes?, photos?: string[],
            createdAt, updatedAt, deletedAt? }

Category  { id, label, deletedAt?, updatedAt }

AppData   { polishes[], customCats[], manicures[], stickers[] }
```

**Unterschied zu v2:** Alle Items haben ein `id`-Feld (stabile ID, unabhängig von Array-Position) und ein optionales `deletedAt`-Feld für Soft-Deletes (notwendig für den Merge-Algorithmus).

### Merge-Algorithmus (Last-Write-Wins)

```
mergeList<T extends { id, updatedAt }>(local, remote): T[]
  → Map-basierter Merge: höherer updatedAt gewinnt
  → Soft-Deletes (deletedAt) bleiben erhalten

mergeData(local, remote): AppData
  → merged alle 4 Listen per mergeList
```

Dieser Algorithmus wird serverseitig bei `POST /api/sync` und clientseitig nach `GET /api/sync` ausgeführt. Beide Seiten laufen dieselbe Logik aus `@nagellacke/core`.

---

## v3 — @nagellacke/sync (Sync-Adapter)

### Abstraktion

Einheitliches Interface für alle Cloud-Provider:

```typescript
interface SyncAdapter {
  readonly type: SyncProviderType
  sync(local: AppData): Promise<SyncResult>         // pull → merge → push
  uploadPhoto(data, mimeType): Promise<PhotoUploadResult>
  deletePhoto(filename): Promise<void>
  photoUrl(filename): string
}
```

`createAdapter(config: SyncConfig)` wählt den passenden Adapter anhand von `config.provider`.

### Implementierte Adapter

| Provider | Protokoll | Datenspeicher | Auth |
|----------|-----------|--------------|------|
| `server` | REST (Fastify) | `data.json` auf Server | JWT Bearer |
| `googledrive` | Google Drive API v3 | `nagellacke-data.json` im Drive-Root | OAuth2 Access Token |
| `onedrive` | Microsoft Graph v1.0 | `/nagellacke/nagellacke-data.json` | OAuth2 Access Token |
| `nextcloud` | WebDAV (`remote.php/dav`) | `/nagellacke/nagellacke-data.json` | HTTP Basic |
| `dropbox` | Dropbox API v2 | `/nagellacke/nagellacke-data.json` | OAuth2 Access Token |

---

## v3 — Android-App

### Native Kotlin / Jetpack Compose

Die Android-App ist nativ in Kotlin geschrieben (kein React Native). Stack:

| Schicht | Technologie |
|---------|-------------|
| UI | Jetpack Compose + Material 3 |
| DI | Hilt (KSP-Codegen) |
| Persistenz | Room 2.x (SQLite), EncryptedSharedPreferences |
| Netzwerk | Retrofit 2 + OkHttp (JSON via kotlinx.serialization) |
| Fotos | Coil 2 (AsyncImage) |
| OAuth | AppAuth-Android |
| Sync-Protokolle | Eigener Server (JWT), Nextcloud (WebDAV), Google Drive, OneDrive, Dropbox (OAuth2) |

**Package-ID:** `de.nagellacke.app`  
**Verzeichnis:** `android/` (Root-Ebene des Repos, **nicht** im v3-Monorepo)

### Navigation (Bottom Navigation, 5 Tabs)

1. **Nagellacke** — LazyVerticalGrid mit Suchbar, Status-Filter, FAB, PolishCard
2. **Sticker** — LazyColumn mit ListItem
3. **Tagebuch** — LazyColumn mit ListItem
4. **Statistik** — StatsScreen
5. **Einstellungen** — Sync-Konfiguration, Darstellung, Statistik

### Datenpersistenz

- **App-Daten:** Room-Datenbank (5 Tabellen: polishes, stickers, manicures, categories + je Sticker-/Manikür-IDs)
- **Sync-Konfiguration:** `EncryptedSharedPreferences` (`sync_config`) via `SyncConfigStore`
- **Darstellungs-Einstellungen:** Plain `SharedPreferences` (`display_prefs`) via `DisplayPrefsStore`
- **Fotos lokal:** `filesDir/photos/` (JPEG, max 1024×1024, 80 % Qualität)

### Darstellungs-Features (Lack-Karten)

Die `PolishCard` unterstützt drei visuelle Modi mit Priorität photo > bottle > swatch:

| Modus | Anzeige | Aktivierung |
|-------|---------|-------------|
| **Foto** | Coil `AsyncImage` (ContentScale.Crop) | Standardmäßig wenn Foto + Server-URL vorhanden |
| **Flasche** | `NailBottle` Composable (Canvas-Port des Web-SVG) | Einstellungs-Toggle |
| **Farb-Swatch** | Farbige Rechteck-Box | Einstellungs-Toggle |

`NailBottle` (`ui/common/NailBottle.kt`):
- Canvas mit `drawRoundRect` + `Brush.linearGradient` (Korpus, Deckel, Hals, Highlights)
- Shimmer-Variante für Shimmer/Glitter/Metallic/Chrome/Holographic/Duochrome (Finish-Klasse aus `SHIMMER_FINISHES` in `domain/Constants.kt`)
- Status-Effekte: `empty`/`gone` → 38 % Gesamt-Alpha via `graphicsLayer`; `wish` → 62 % + ☆; `empty` → zusätzliches dunkles Overlay auf unterem Körper
- Marken-Label + „nail lacquer" via `nativeCanvas.drawText`
- Aspect Ratio 64:130 erzwungen via `Modifier.aspectRatio`

Foto-Anzeige (Sticker + Maniküren):
- Automatisch als Thumbnail im `ListItem.leadingContent` wenn Server-URL konfiguriert und `item.photo != null`
- Kein Toggle-Button; Fallback auf Farbkreise

Foto-URL-Konstruktion (nur Server-Provider):
```kotlin
"${serverUrl.trimEnd('/')}/photos/${filename}"
// /photos/ ist öffentliche statische Route in index.ts, kein Auth nötig
```

### Design

Material Design 3 (`androidx.compose.material3`). Primärfarbe `#c2185b` (Pink). Light + Dark Mode via `MaterialTheme`.

---

## Deployment

### systemd

Der Dienst läuft als systemd-Unit. Das gibt:
- Autostart beim Server-Boot
- Automatischer Neustart bei Absturz (`Restart=always`)
- Logs über `journalctl`

**v2:** Unit-Datei in `install.sh` generiert, inline `Environment=PORT=3000`  
**v3:** Unit-Datei mit `EnvironmentFile` (`.env` mit `JWT_SECRET` und weiteren Variablen)

### Vite Build-Output

v2: Vite baut in `backend/public/` — Express liefert mit `express.static()` aus.  
v3: Vite baut in `apps/web/dist/` — die Update-Pipeline kopiert es nach `server/public/`.

---

## Datenmodell

### Polish-Objekt

```json
{
  "id":         "1716900000000-a3f8c",   // Stabile ID (seit v2.2.7), fehlt in v2-Daten
  "name":       "Blue You A Kiss",
  "brand":      "Catrice",
  "num":        "029",
  "color":      "#3a7bd5",
  "finish":     "Classic",
  "status":     "ok",                    // "ok" | "wish" | "empty" | "gone"
  "count":      2,
  "categories": ["sommer_1234567890"],
  "notes":      "Gekauft 2024-03",
  "rating":     4,                       // 1–5 (optional)
  "createdAt":  1716900000000,
  "updatedAt":  1716900000000,
  "deletedAt":  null,                    // Soft-Delete für Sync-Merge (v3)
  "photo":      "a3f8c2d1.jpg"           // UUID-Dateiname in data/photos/
}
```

### Manicure-Objekt

```json
{
  "id":         "1716900000000-abc",
  "date":       "2025-05-28",
  "polishRefs": [{ "name": "Blue You A Kiss", "brand": "Catrice", "color": "#3a7bd5" }],
  "stickerRefs": [],
  "notes":      "für den Urlaub",
  "photos": {
    "fingerRight": "manicure-uuid1.jpg",
    "fingerLeft":  "manicure-uuid2.jpg",
    "thumbRight":  null,
    "thumbLeft":   null
  },
  "createdAt":  1716900000000
}
```

### Sticker-Objekt

```json
{
  "id":      "1716900000000-xyz",
  "name":    "Cherry Blossoms",
  "brand":   "Born Pretty",
  "style":   "Blumen",
  "type":    "accent",                 // "full"|"accent"|"wrap"|"3d"|"foil"|"slider"
  "colors":  ["#ffb3c6", "transparent", "#ffffff"],
  "status":  "ok",
  "notes":   "Sehr filigran",
  "photo":   "sticker-uuid.jpg",
  "rating":  4,
  "createdAt": 1716900000000,
  "updatedAt": 1716900000000
}
```

### data.json-Struktur

```json
{
  "polishes":   [ ...Polish-Objekte ],
  "customCats": [ { "id": "sommer_1234567890", "label": "Sommer", "updatedAt": 1716900000000 } ],
  "manicures":  [ ...Manicure-Objekte ],
  "stickers":   [ ...Sticker-Objekte ]
}
```

---

## Sicherheitsmodell

Die App ist für den Einsatz im **privaten Heimnetz** konzipiert, nicht für das öffentliche Internet.

| Bedrohung | v2-Maßnahme | v3-Maßnahme |
|-----------|-------------|-------------|
| Unberechtigte Schreibzugriffe | API-Key auf allen Mutationen | API-Key + JWT |
| Passwort-Angriffe | — | scrypt + Salt + timingSafeEqual |
| Replay / Brute-Force | In-Memory Rate-Limiting | In-Memory Rate-Limiting |
| Riesige Payloads | `express.json({ limit: "4mb" })` | Fastify body limit |
| Bösartige Foto-Uploads | Magic-Bytes-Check | Magic-Bytes-Check |
| MIME-Type-Spoofing | Magic-Bytes-Check | Magic-Bytes-Check |
| Bösartige Importdaten | Validierung vor Übernahme | Validierung + Typprüfung |
| Information Leakage | Interne Fehler nur geloggt | Interne Fehler nur geloggt |
| Datenverlust bei Absturz | Atomic Write (`.tmp` + `renameSync`) | Atomic Write |
| Shell-Injection (UPDATE) | SERVICE_NAME Regex-Validierung | SERVICE_NAME Regex-Validierung |

Bekannte offene Punkte (für Heimnetz-Betrieb akzeptiert):
- HTTP, kein HTTPS — im Heimnetz ohne externen Zugang akzeptabel; für externen Zugang: Nginx-Reverse-Proxy mit Let's Encrypt

Behoben:
- Der Dienst lief bisher standardmäßig als root; `install.sh` legt jetzt einen dedizierten Systembenutzer an (`User=nagellacke`/`Group=nagellacke` in der Unit), dem `/opt/nagellacke` gehört (#71)

---

## Versionierung

Semantisches Versioning (`MAJOR.MINOR.PATCH`). Versionen werden als Git-Tags gesetzt. Vollständige Änderungshistorie: [CHANGELOG.md](CHANGELOG.md)

| Version | Inhalt |
|---------|--------|
| v1.0.0 | Erste Version — Grundfunktionen, In-App-Update, systemd |
| v1.1.0 | System-Log-Viewer (journalctl) |
| v1.2.0 | Multi-Brand-Support |
| v1.3.0 | Statistiken-Seite |
| v1.4.0 | 15 Finish-Typen, 36 Marken-Vorschläge, dynamische Filter |
| v1.5.0 | Kategorien, Notizen, Batch-Modus, Undo, Export/Import, Sortierung |
| v1.6.0 | API-Key-Auth, Security Hardening, Magic-Bytes-Validierung, Atomic Write |
| v1.6.1 | Foto-Farbpicker (Canvas API) |
| v1.6.2 | Kamera-Button direkt auf Mobilgeräten |
| v1.7.0 | Theme-Switcher: 6 Designs |
| v1.7.1 | Theme-spezifische Karten- und Filter-Layouts (4 + 3 Varianten) |
| v1.7.2 | Sternebewertung (1–5), Farbklick in Statistik |
| v1.7.3 | Accessibility (WCAG AA), aria-*, Fokus-Ringe |
| v1.8.0 | Tastatur-Shortcuts, System-Theme, Duplikat-Detektor, Update-Cache |
| v1.9.0 | Code-Split, Timestamps, Batch-Edit, Import-Merge, PWA |
| v2.0.0 | Flaschenfoto, Maniküre-Tagebuch, 3. Nav-Tab |
| v2.1.0 | Nail-Sticker-Inventar |
| v2.1.1–2.1.9 | Mobile-Fixes, Foto-Slots, PhotoPicker-Einheitlichkeit, Stats-Erweiterung |
| v2.2.0 | v3 Sync-Server, v2→v3-Upgrade-Pfad |
| v2.2.1–2.2.9 | Upgrade-Pipeline-Fixes, SyncPanel, JWT-Auth, sync-sichere IDs |
| v3.0.0 | Native Android-App (Expo React Native, Play Store, 5 Tabs) |
| v3.0.1 | Update-Check Testrelease |
