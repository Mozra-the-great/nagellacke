# Architektur & Technische Entscheidungen

Dieses Dokument erklärt den Aufbau der Nagellack-Kollektion-App, den verwendeten Software-Stack und die Gründe hinter den getroffenen Entscheidungen.

> **Hinweis zur Historie:** Es gab eine frühere Generation ("v2": Express + einfaches React/Vite-Frontend unter `backend/`/`frontend/`, kein Sync, keine App). Sie wurde vollständig entfernt (siehe Änderungshistorie um v3.0.x); der aktuelle Code kennt nur noch den unten beschriebenen Stand. Wo Entscheidungen historisch v2 vs. v3 gegeneinander abgewogen haben, ist das nur noch für's Verständnis von Altdaten (z. B. `.api_key`-Kompatibilität) relevant.

---

## Überblick

```
Browser / Android-App
  └── React-SPA (Web) / natives Kotlin+Compose (Android)
        ├── /api/photos, /api/version, /api/update/*, /api/logs, /api/admin/*
        │     → Fastify-Routen → data.json / Dateisystem (Foto-Uploads)
        ├── /api/auth/*  → JWT-Authentifizierung → users.json
        ├── /api/sync*   → Merge-Algorithmus (@nagellacke/core) → data.json (pro Benutzer)
        ├── /api/ai/*    → KI-Provider (OpenAI-kompatibel / Gemini) + eigener web_search-Tool-Server
        └── /api/reports/* → HTML-Bericht-Generator + optionaler SMTP-Versand
```

---

## Verzeichnisstruktur

```
nagellacke/
├── android/                 ← Native Android-App (Kotlin/Jetpack Compose), Root-Ebene, NICHT im npm-Workspace
│   └── app/src/main/java/de/nagellacke/
│       ├── data/
│       │   ├── local/       ← Room Entities, DAOs, AppDatabase
│       │   ├── repo/        ← NagellackeRepository, PhotoRepository, SyncConfigStore, DisplayPrefsStore
│       │   └── sync/        ← SyncAdapter Interface + ServerAdapter, NextcloudAdapter, …
│       ├── domain/
│       │   ├── model/       ← Polish, Sticker, Manicure, Category, AppData (kotlinx.serialization)
│       │   └── Constants.kt ← FINISH_OPTIONS, SHIMMER_FINISHES, BRAND_SUGGESTIONS, …
│       └── ui/
│           ├── collection/  ← CollectionScreen, PolishCard, PolishFormSheet, CollectionViewModel
│           ├── stickers/    ← StickersScreen, StickerFormSheet, StickersViewModel
│           ├── diary/       ← DiaryScreen, DiaryFormSheet, DiaryViewModel
│           ├── stats/       ← StatsScreen
│           ├── settings/    ← SettingsScreen, SettingsViewModel
│           └── common/      ← LoadingScreen, EmptyScreen, ErrorScreen, NailBottle
├── docs/                    ← Projektseite auf GitHub Pages (statisch, kein Build nötig)
│   ├── index.html           ← Landingpage
│   ├── privacy-policy.html  ← Datenschutzerklärung
│   ├── store-listing.md     ← Play-Store-Metadaten
│   └── releases/            ← Release-Notes pro Version
├── install.sh                ← Installer/Updater (Debian/Ubuntu, systemd)
├── CHANGELOG.md              ← Vollständige Versionshistorie
└── v3/                       ← Monorepo (npm workspaces, Node ≥20)
    ├── package.json          ← Monorepo-Root, Scripts für alle Workspaces
    ├── packages/
    │   ├── core/             ← @nagellacke/core — Typen, Logic, Merge-Algo, Konstanten
    │   │   └── src/
    │   │       ├── types.ts      ← Polish, Sticker, Manicure, Category, AppData
    │   │       ├── logic.ts      ← filterPolishes, sortPolishes, mergeData, mergeList
    │   │       ├── constants.ts  ← FINISH_OPTIONS, STATUS_OPTIONS, BRAND_SUGGESTIONS, …
    │   │       └── utils.ts      ← hexToHue, generateId, now
    │   └── sync/             ← @nagellacke/sync — Sync-Adapter-Abstraktionsschicht
    │       └── src/
    │           ├── adapter.ts          ← SyncAdapter Interface + SyncConfig Typ
    │           ├── factory.ts          ← createAdapter(config) Factory-Funktion
    │           └── adapters/
    │               ├── server.ts       ← Eigener Fastify-Server (JWT)
    │               ├── googledrive.ts  ← Google Drive v3 API
    │               ├── onedrive.ts     ← Microsoft Graph v1.0
    │               ├── nextcloud.ts    ← WebDAV (remote.php/dav)
    │               └── dropbox.ts      ← Dropbox API v2
    ├── server/                ← Fastify-Server
    │   └── src/
    │       ├── index.ts       ← Alle Routen, JWT-Auth, Rate-Limiting, Update-Pipeline
    │       ├── db.ts          ← Datei-Persistenz (data.json pro User, users.json, Fotos)
    │       ├── ai.ts          ← KI-Provider-Anbindung (Auto-Fill, Smart-Cart, Tool-Loop)
    │       ├── tooling.ts     ← Tool-Definitionen/-Aufruf für den KI-Provider (web_search)
    │       ├── websearch.ts   ← Eigener web_search-Tool-Server (DuckDuckGo/SearXNG/Brave)
    │       ├── report.ts      ← Wochen-/Monatsberichte (HTML-Generator)
    │       └── email.ts       ← Berichtsversand per SMTP
    └── apps/
        └── web/                ← Web-App (React 18 + TypeScript + Vite)
            └── src/
                ├── App.tsx              ← Tab-Navigation (collection|stickers|diary|cart|stats|settings)
                ├── useAppData.ts        ← Hook für Daten + CRUD + sync()
                └── pages/               ← CollectionPage, StickersPage, DiaryPage, CartPage, StatsPage, SettingsPage
```

---

## Web-App (React + TypeScript + Vite)

### Warum React?

React ist der de-facto-Standard für reaktive UIs mit vielen interabhängigen Zuständen (Filterauswahl, Suchbegriff, Sortierung, Batch-Selektion, Undo-Stack, offene Formulare) — mit Hooks (`useState`, `useMemo`, `useCallback`, `useEffect`) sauber ausdrückbar.

### Vite

Nativer ESM-Support und Rollup als Bundler machen Vite deutlich schneller als ältere Toolchains. Die Update-Pipeline baut das Web-App-Bundle in `apps/web/dist/` und kopiert es nach `server/public/`, wo Fastify es statisch ausliefert.

### Seitenbasierte Struktur

`App.tsx` hält die Tab-Navigation und globalen State, die eigentlichen Ansichten liegen als eigene Komponenten unter `pages/` (`CollectionPage`, `StickersPage`, `DiaryPage`, `CartPage`/Wunschliste, `StatsPage`, `SettingsPage`). Datenzugriff und Mutationen laufen über den zentralen `useAppData`-Hook. Kein Router — für eine feste Tab-Leiste ohne URL-Navigation wäre er Overhead.

### Kein State-Management-Framework

Kein Redux, Zustand, Jotai o. ä. Für die Größenordnung der App ist Prop-Drilling ausgehend von `App`/`useAppData` die einfachste und wartbarste Lösung.

---

## Server — Fastify

### Warum Fastify?

Native TypeScript-Unterstützung, Plugin-basierte Architektur (`@fastify/jwt`, `@fastify/cors`, `@fastify/static`) und gute Performance — relevant, weil dieselbe Instanz sowohl die Web-App ausliefert als auch Sync für Web/Android sowie KI-Hintergrundjobs bedient.

### API-Routen

| Endpoint | Methode | Auth | Funktion |
|----------|---------|------|---------|
| `/api/version` | GET | — | Server-Version |
| `/api/auth/register` | POST | — | Neuer User → JWT (nur wenn noch kein User existiert oder `ALLOW_REGISTRATION=true`) |
| `/api/auth/login` | POST | — | Login → Access-Token (7d) + Refresh-Token (30d) |
| `/api/auth/refresh` | POST | Refresh-Token | Neues Access-Token ausstellen |
| `/api/auth/me` | GET | JWT | Aktuellen User abrufen |
| `/api/auth/logout-all` | POST | JWT | Alle Tokens invalidieren (Token-Version hochzählen) |
| `/api/sync` | GET/POST | JWT | Datenstand abrufen / Client-Daten mergen (`mergeData` aus `@nagellacke/core`) |
| `/api/sync/push` | POST | JWT | Gemergten Stand hochladen |
| `/api/photos` | POST | API-Key oder JWT | Foto hochladen (Base64, Magic-Bytes-Check, UUID-Dateiname) |
| `/api/photos/:filename` | DELETE | API-Key oder JWT | Foto löschen |
| `/api/ai/settings` | GET/POST | JWT | KI-Provider/Modell/Schlüssel/Websuche-Backend konfigurieren |
| `/api/ai/autofill` | POST | JWT | Farbe & Finish für einen Lack per KI ermitteln (Hintergrundjob) |
| `/api/ai/smart-cart` | POST | JWT | Wunschlisten-Vorschläge per KI |
| `/api/ai/jobs/:id` | GET | JWT | Status/Ergebnis eines KI-Hintergrundjobs |
| `/api/reports/preview` | GET | JWT | Bericht als HTML generieren |
| `/api/reports/send` | POST | JWT | Bericht per E-Mail versenden |
| `/api/reports/schedule` | GET/POST | JWT | Automatischen Berichts-Zeitplan lesen/setzen |
| `/api/update/check` | GET | API-Key | GitHub-Update-Check (Rate: 10/min) |
| `/api/update/apply` | POST | API-Key | Update durchführen (Rate: 3/5min) |
| `/api/admin/api-key/rotate` | POST | API-Key | API-Schlüssel rotieren |
| `/api/logs` | GET | API-Key | systemd Journal (Rate: 30/min) |

**Admin-Endpunkte** (`/api/update/*`, `/api/admin/*`, `/api/logs`) akzeptieren bewusst nur `X-Api-Key`, kein JWT — der Schlüssel ist ein De-facto-Root-Credential (er löst `git pull` + `npm install` + Rebuild auf dem Host aus), siehe [README](README.md#erster-start--api-schlüssel-einrichten) und #73. JWT ist auf Daten-/Sync-Endpunkte beschränkt.

### Keine externe Datenbank

Die App ist für **eine Handvoll Personen** auf einem **privaten Server** ausgelegt. Eine JSON-Datei pro Benutzer erfüllt alle Anforderungen:
- Keine Installation eines Datenbankservers
- Backup = `cp data.json backup.json`
- Im Fehlerfall direkt lesbar und editierbar
- Atomic Write: erst in `.tmp` schreiben, dann `fs.renameSync` → kein korruptes File bei Absturz

### API-Key-Authentifizierung

Ein statischer API-Schlüssel im HTTP-Header (`X-Api-Key`) ist für Admin-Operationen im Heimnetz ausreichend. Der Schlüssel wird beim ersten Start generiert (`crypto.randomBytes(24).toString("hex")`), in `data/.api_key` persistiert (0o600) und einmalig in der Konsole ausgegeben. Rotierbar über `/api/admin/api-key/rotate` oder durch Löschen der Datei + Neustart.

### Passwort-Hashing

`crypto.scryptSync` mit 32-Byte-Salt + 64-Byte-Hash. Vergleich mit `crypto.timingSafeEqual` gegen Timing-Angriffe. Format in `users.json`: `{salt}:{hash}` (Hex-kodiert).

### Image-Validierung

Magic-Bytes-Check vor dem Speichern: JPEG (`0xFFD8FF`), PNG (`0x89504E47`), WebP (`RIFF...WEBP`). MIME-Type-Spoofing ist damit nicht möglich.

### Rate-Limiting ohne externe Bibliothek

Kein Redis. Ein In-Memory-Limiter (`config: { rateLimit: {...} }` pro Route) reicht für den Anwendungsfall.

### Update-Pipeline

1. Antwortet sofort mit `{ok: true}` (verhindert Reverse-Proxy-Timeout)
2. `setImmediate()` startet Build im Hintergrund:
   - `git pull origin main` (30 s Timeout)
   - `npm install --omit=dev` (60 s)
   - `npm run build:core` (60 s)
   - `npm run build:server` (60 s)
   - `npm run build:web` (120 s)
   - Kopiert `v3/apps/web/dist` → `server/public/`
3. Nach 300 ms: `process.exit(0)` — `Restart=always` in der systemd-Unit startet den Prozess automatisch neu

---

## KI-Funktionen und Websuche

### Eigener web_search-Tool-Server statt Anbieter-Websuche

Statt der kostenpflichtigen Websuche der KI-Anbieter (die z. B. auch bei kostenlosen Modellen extra berechnet wird oder im Free-Tier fehlt) stellt der Server selbst die Suchanfrage und bietet sie dem Modell als Werkzeug `web_search` an — für beide unterstützten Wire-Formate (OpenAI-kompatibel und Gemini `functionDeclarations`). Backend wählbar: DuckDuckGo (ohne Einrichtung, aber rate-limited bei Rechenzentrums-IPs — erkennt und loggt die HTTP-202-CAPTCHA-Antwort separat, `websearch.ts`), eigene SearXNG-Instanz oder Brave.

### Hintergrundjobs

Auto-Fill (Lack-Formular) und Smart-Cart (Wunschliste) laufen als asynchrone Jobs (`data/ai_jobs.json`), damit ein mehrere Sekunden dauernder Tool-Loop den Request nicht blockiert. Ergebnisse werden über `/api/ai/jobs/:id` abgefragt und auf den frisch aus der DB gelesenen Datensatz angewendet (nicht auf eine veraltete Kopie), damit parallele Bearbeitung nicht durch Last-Write-Wins verloren geht.

### KI-Konfiguration

Provider, Modell, API-Schlüssel und Websuche-Backend liegen in `data/ai_config.json` (mode 0600). Modellwahl ist bewusst konservativ dokumentiert (z. B. Gemini-Free-Tier-Limits, veraltete Modell-IDs) — siehe [CLAUDE.md](CLAUDE.md) für aktuelle Stolpersteine.

---

## Monorepo (`v3/`)

### npm workspaces

`v3/` ist ein npm-Workspace-Monorepo. Die native Android-App liegt bewusst **außerhalb** davon (`android/` auf Root-Ebene) — sie teilt keine npm-Dependencies, sondern portiert die relevante Logik (Merge-Algorithmus, Report-Generator, Konstanten) nach Kotlin.

| Package | Name | Zweck |
|---------|------|-------|
| `packages/core` | `@nagellacke/core` | Typen, Business-Logik, Merge-Algorithmus |
| `packages/sync` | `@nagellacke/sync` | Sync-Adapter-Abstraktionsschicht |
| `server` | `nagellacke-server` | Fastify HTTP-Server |
| `apps/web` | `nagellacke-web` | React Web-App |

**Warum Monorepo?**
`@nagellacke/core` (Typen + Merge-Logik) und `@nagellacke/sync` (Adapter) werden von Server und Web-App gemeinsam genutzt. Ein Monorepo vermeidet Code-Duplikation und stellt sicher, dass beide denselben Typen-Stand haben.

---

## @nagellacke/core

### Typen

```typescript
Polish    { id, name, brand, num, color, finish, status, count?, categories?,
            notes?, rating?, photo?, createdAt, updatedAt, deletedAt? }

Sticker   { id, name, brand?, style?, type, colors?, status, rating?,
            notes?, photo?, createdAt, updatedAt, deletedAt? }

Manicure  { id, date, polishRefs, stickerRefs, notes?, photos?,
            createdAt, updatedAt, deletedAt? }

Category  { id, label, deletedAt?, updatedAt }

AppData   { polishes[], customCats[], manicures[], stickers[] }
```

Jedes Item hat eine stabile `id` (unabhängig von Array-Position oder Name+Marke-Kombination — siehe #178) und ein optionales `deletedAt`-Feld für Soft-Deletes, das der Merge-Algorithmus braucht.

### Merge-Algorithmus (Last-Write-Wins)

```
mergeList<T extends { id, updatedAt }>(local, remote): T[]
  → Map-basierter Merge: höherer updatedAt gewinnt
  → Soft-Deletes (deletedAt) bleiben erhalten

mergeData(local, remote): AppData
  → merged alle 4 Listen per mergeList
```

Dieser Algorithmus läuft serverseitig bei `POST /api/sync` und clientseitig nach `GET /api/sync` — beide Seiten nutzen dieselbe Logik aus `@nagellacke/core`; die Android-App hat einen äquivalenten Kotlin-Port.

---

## @nagellacke/sync (Sync-Adapter)

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

## Android-App

### Native Kotlin / Jetpack Compose

Die Android-App ist nativ in Kotlin geschrieben (kein React Native, kein Expo). Stack:

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

### Navigation (Bottom Navigation, 6 Tabs)

1. **Nagellacke** — LazyVerticalGrid mit Suchbar, Status-Filter, FAB, PolishCard
2. **Sticker** — LazyColumn mit ListItem
3. **Tagebuch** — LazyColumn mit ListItem
4. **Wunschliste** — Grid der Lacke mit `status == Wish`, „Gekauft ✓" setzt Status zurück
5. **Statistik** — StatsScreen
6. **Einstellungen** — Sync-Konfiguration, Darstellung, KI-Einstellungen, Berichte, Statistik

### Datenpersistenz

- **App-Daten:** Room-Datenbank (Tabellen für polishes, stickers, manicures, categories)
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

### Berichte (`ReportGenerator.kt`)

Kotlin-Port von `report.ts`s `generateReport()` (gleiches HTML/CSS, gleiche Kennzahlen), läuft komplett lokal — „Bericht erstellen" öffnet ihn in einem WebView ohne Serveranfrage. Bei aktivem Server-Sync zusätzlich: Bericht per E-Mail senden und automatischer Zeitplan über die `/api/reports/*`-Endpunkte.

### Design

Material Design 3 (`androidx.compose.material3`). Primärfarbe `#c2185b` (Pink). Light + Dark Mode via `MaterialTheme`.

---

## Deployment

### systemd

Der Dienst läuft als systemd-Unit (`nagellacke-v3`) mit `EnvironmentFile` (`.env` mit `JWT_SECRET` und weiteren Variablen). Das gibt:
- Autostart beim Server-Boot
- Automatischer Neustart bei Absturz (`Restart=always`)
- Logs über `journalctl`
- Dedizierter Systembenutzer (`User=nagellacke`/`Group=nagellacke`), dem `/opt/nagellacke` gehört — der Dienst läuft nicht als root (#71)

### Vite Build-Output

Vite baut in `apps/web/dist/` — die Update-Pipeline kopiert es nach `server/public/`, wo Fastify es statisch ausliefert.

### GitHub Pages

Die Projektseite (`docs/`) ist statisch und unabhängig vom Server-Deployment. Der Workflow [`pages.yml`](.github/workflows/pages.yml) deployt sie bei jedem Push auf `main`, der etwas unter `docs/` ändert (außer reine Release-Notes unter `docs/releases/`), sowie manuell per `workflow_dispatch`. Läuft über die offiziellen `actions/configure-pages` + `actions/deploy-pages` Actions, kein eigener Build-Schritt nötig.

---

## Datenmodell

### Polish-Objekt

```json
{
  "id":         "1716900000000-a3f8c",   // Stabile ID, unabhängig von Name/Marke
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
  "deletedAt":  null,                    // Soft-Delete für Sync-Merge
  "photo":      "a3f8c2d1.jpg"           // UUID-Dateiname in data/photos/
}
```

### Manicure-Objekt

```json
{
  "id":          "1716900000000-abc",
  "date":        "2025-05-28",
  "polishRefs":  [{ "name": "Blue You A Kiss", "brand": "Catrice", "color": "#3a7bd5" }],
  "polishIds":   ["1716900000000-a3f8c"],
  "stickerRefs": [],
  "notes":       "für den Urlaub",
  "photos": {
    "fingerRight": "manicure-uuid1.jpg",
    "fingerLeft":  "manicure-uuid2.jpg",
    "thumbRight":  null,
    "thumbLeft":   null
  },
  "createdAt":  1716900000000
}
```

`polishRefs`/`stickerRefs` werden beim Speichern aus der aktuellen Auswahl über `polishIds` neu gebaut (nicht umgekehrt) — die Auswahl selbst läuft über IDs, nicht über Name+Marke+Farbe, damit gleichnamige Lacke unterscheidbar bleiben (#176).

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

### data.json-Struktur (pro Benutzer)

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

| Bedrohung | Maßnahme |
|-----------|----------|
| Unberechtigte Schreibzugriffe | API-Key (Admin) + JWT (Daten/Sync) |
| Passwort-Angriffe | scrypt + Salt + timingSafeEqual |
| Replay / Brute-Force | In-Memory Rate-Limiting pro Route |
| Riesige Payloads | Fastify body limit (Fotos: 15 MB) |
| Bösartige Foto-Uploads | Magic-Bytes-Check vor dem Speichern |
| MIME-Type-Spoofing | Magic-Bytes-Check (nicht der `Content-Type`-Header) |
| Bösartige Importdaten | Validierung + Typprüfung vor Übernahme |
| Information Leakage | Interne Fehler nur geloggt, nicht an den Client |
| Datenverlust bei Absturz | Atomic Write (`.tmp` + `renameSync`) |
| Shell-Injection (Update-Pipeline) | `SERVICE_NAME` Regex-Validierung |
| Offene Registrierung | `/api/auth/register` nur beim ersten User oder mit `ALLOW_REGISTRATION=true` |

Bekannte offene Punkte (für Heimnetz-Betrieb akzeptiert):
- HTTP, kein HTTPS — im Heimnetz ohne externen Zugang akzeptabel; für externen Zugang: Reverse-Proxy (Nginx) mit Let's Encrypt
- `X-Api-Key` ist ein De-facto-Root-Credential (`/api/update/apply` zieht ungeprüft `origin/main` und führt `npm install`/`postinstall` aus) — bewusst akzeptiert für den Heimnetz-Anwendungsfall, siehe #73

---

## Versionierung

Semantisches Versioning (`MAJOR.MINOR.PATCH`). Versionen werden als Git-Tags gesetzt. Vollständige Änderungshistorie: [CHANGELOG.md](CHANGELOG.md)
