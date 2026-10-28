# Architektur & Technische Entscheidungen

Dieses Dokument erklärt den Aufbau der Nagellack-Kollektion-App, den verwendeten Software-Stack und die Gründe hinter den getroffenen Entscheidungen.

> **Hinweis zur Historie:** Es gab eine frühere Generation ("v2": Express + einfaches React/Vite-Frontend unter `backend/`/`frontend/`, kein Sync, keine App). Sie wurde vollständig entfernt (siehe Änderungshistorie um v3.0.x); der aktuelle Code kennt nur noch den unten beschriebenen Stand. Wo Entscheidungen historisch v2 vs. v3 gegeneinander abgewogen haben, ist das nur noch für's Verständnis von Altdaten (z. B. `.api_key`-Kompatibilität) relevant.

> **Stand:** Web-App und Server (`v3/`) sind das Produkt. Die native Android-App (`android/`) ist **eingefroren** (EOL, #372, Tag `android-final`); der Abschnitt „Android-App“ weiter unten beschreibt den letzten gepflegten Stand und ist nur noch für eine Wiederaufnahme relevant ([Anleitung](docs/android-wieder-aufnehmen.md)).

---

## Überblick

```
Browser (oder die eingefrorene Android-App)
  └── React-SPA (Web) / natives Kotlin+Compose (Android, eingefroren)
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
├── android/                 ← Native Android-App (Kotlin/Jetpack Compose) — EINGEFROREN (EOL #372), nicht im npm-Workspace
│   └── app/src/main/java/de/nagellacke/   (data/ · domain/ · ui/; Details im Abschnitt „Android-App“)
├── docs/                    ← Projektseite auf GitHub Pages (statisch, kein Build nötig) + Anleitungen
│   ├── index.html, privacy-policy.html, assets/  ← die Website
│   ├── *.md                 ← Anleitungen (Installation, Sync, Backup, Entwicklung), FEATURES.md (QA-Checkliste)
│   ├── android-wieder-aufnehmen.md, store-listing.md  ← Android-Wiederaufnahme
│   ├── releases/            ← Release-Notes pro Tag (Eingabe von release.yml)
│   └── archive/             ← überholte Planungsdokumente
├── fixtures/merge/           ← gemeinsame mergeData()-Testfälle (heute nur noch von TypeScript geprüft)
├── scripts/ci/               ← Label-Automatik (labels.py) + Tests
├── .github/                  ← Workflows (CI, Pages, Release, Review, Labels, Android-Release manuell), labels.json
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
    │       ├── index.ts       ← Alle Routen, JWT-Auth, Rate-Limiting, Security-Header
    │       ├── db.ts          ← Datei-Persistenz (data.json pro User, users.json, Fotos)
    │       ├── update.ts      ← Selbst-Update-Pipeline + Statusdatei (#335)
    │       ├── totp.ts, passkeys.ts, pow.ts, accountMail.ts  ← 2FA, WebAuthn, Registrierungs-PoW, Reset-/Bestätigungs-Mails
    │       ├── photoToken.ts  ← signierte Foto-Tokens (#269)
    │       ├── branding.ts    ← Branding/Instanz-Konfiguration (#324)
    │       ├── ai.ts          ← KI-Provider-Anbindung (Auto-Fill, Smart-Cart, Tool-Loop)
    │       ├── tooling.ts     ← Tool-Definitionen/-Aufruf für den KI-Provider (web_search)
    │       ├── websearch.ts   ← Eigener web_search-Tool-Server (DuckDuckGo/SearXNG/Brave)
    │       ├── report.ts      ← Wochen-/Monatsberichte (HTML-Generator)
    │       └── email.ts       ← Berichtsversand per SMTP
    ├── Dockerfile            ← Container-Image für eigenständige Hosts (öffentliche Instanz)
    ├── scripts/              ← migrate-v2-to-v3.js (Legacy-Migration)
    └── apps/
        └── web/                ← Web-App (React 19 + TypeScript + Vite)
            └── src/
                ├── App.tsx              ← Tab-Navigation (collection|stickers|diary|cart|stats|settings, +admin für Admins), Hash-Routen
                ├── useAppData.ts        ← Hook für Daten + CRUD + sync()
                ├── components/, hooks/, utils/
                └── pages/               ← CollectionPage, StickersPage, DiaryPage, CartPage, StatsPage, SettingsPage, AdminPage, AccountLinkPage, LegalPage
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

Gruppiert; die Routen stehen vollständig in `v3/server/src/index.ts`, Auth-Details und Eigenheiten pro Bereich in [CLAUDE.md](CLAUDE.md).

| Bereich | Endpunkte | Auth |
|---|---|---|
| Öffentlich | `GET /api/version`, `GET /api/instance-config`, `GET /api/legal`, `GET /api/branding/logo`, `GET /api/auth/registration-status`, `GET /api/auth/pow-challenge` | — |
| Konto | `POST /api/auth/register`, `/login`, `/login/verify` (2FA), `/refresh`, `/logout`, `/logout-all`; `GET`/`PATCH /api/auth/me`; Passwort vergessen/zurücksetzen und E-Mail bestätigen unter `/api/auth/password/*` und `/api/auth/email/*` | teils öffentlich (Login/Registrierung), sonst JWT |
| 2FA / Passkeys | `/api/auth/totp/*` (setup, enable, disable, recovery-codes), `/api/auth/passkeys/*` | JWT bzw. öffentlich für den Passkey-Login |
| Selbstbedienung | `GET /api/me/export`, `POST /api/me/delete` | JWT (+ Passwort) |
| Sync | `GET`/`POST /api/sync`, `POST /api/sync/push` (`mergeData` aus `@nagellacke/core`) | JWT |
| Fotos | `POST /api/photos`, `DELETE /api/photos/:filename`, `GET /api/photos/token`; Auslieferung `GET /photos/*` | JWT oder API-Key; Auslieferung zusätzlich mit signiertem `?t=`-Token (seit #269 nicht mehr öffentlich) |
| KI | `/api/ai/settings`, `POST /api/ai/autofill`, `POST /api/ai/smart-cart`, `GET /api/ai/jobs/:id` | JWT (Einstellungen ändern: Admin) |
| Berichte | `/api/reports/preview`, `/send`, `/schedule` (Zeitplan pro Benutzer) | JWT |
| Admin | `/api/admin/*` (Benutzer, Rollen, Einstellungen, Branding, Legal, Audit, API-Key rotieren, Bootstrap), `/api/update/check`, `/api/update/status`, `/api/update/apply`, `/api/logs` | `X-Api-Key` **oder** Admin-JWT (#173); `update/apply` per JWT zusätzlich mit frischer Passwort-Bestätigung |

Der API-Schlüssel bleibt ein De-facto-Root-Credential (er löst `git fetch` + `npm install` + Rebuild auf dem Host aus), siehe [Erster Start](docs/erste-schritte.md) und #73. Das Admin-Konto (erster registrierter Benutzer) ersetzt ihn im Alltag.

### Keine externe Datenbank

Die App ist für **eine Handvoll Personen** auf einem **privaten Server** ausgelegt. Eine JSON-Datei pro Benutzer erfüllt alle Anforderungen:
- Keine Installation eines Datenbankservers
- Backup = `cp data.json backup.json`
- Im Fehlerfall direkt lesbar und editierbar
- Atomic Write: erst in `.tmp` schreiben, dann `fs.renameSync` → kein korruptes File bei Absturz

### API-Key-Authentifizierung

Ein statischer API-Schlüssel im HTTP-Header (`X-Api-Key`) ist für Admin-Operationen im Heimnetz ausreichend; seit #173 akzeptieren dieselben Endpunkte alternativ ein Admin-JWT. Der Schlüssel wird beim ersten Start generiert (`crypto.randomBytes(24).toString("hex")`), in `data/.api_key` persistiert (0o600) und einmalig in der Konsole ausgegeben. Rotierbar über `/api/admin/api-key/rotate` oder durch Löschen der Datei + Neustart.

### Passwort-Hashing

`crypto.scryptSync` mit 32-Byte-Salt + 64-Byte-Hash. Vergleich mit `crypto.timingSafeEqual` gegen Timing-Angriffe. Format in `users.json`: `{salt}:{hash}` (Hex-kodiert).

### Image-Validierung

Magic-Bytes-Check vor dem Speichern: JPEG (`0xFFD8FF`), PNG (`0x89504E47`), WebP (`RIFF...WEBP`). MIME-Type-Spoofing ist damit nicht möglich.

### Rate-Limiting ohne externe Bibliothek

Kein Redis. Ein In-Memory-Limiter (`config: { rateLimit: {...} }` pro Route) reicht für den Anwendungsfall.

### Update-Pipeline

Implementiert in `v3/server/src/update.ts` (#335, #338). Nur auf systemd-Installationen mit Git-Checkout; Container-Deployments melden `selfUpdate: unsupported`.

1. `POST /api/update/apply` antwortet sofort mit `{ok: true}` (kein Reverse-Proxy-Timeout)
2. Im Hintergrund laufen asynchron (der Event-Loop bleibt frei) nacheinander:
   - `git fetch origin main` + `git reset --hard FETCH_HEAD` (kein `git pull`, weil `npm install` das Lockfile verändern kann)
   - `npm install --include=dev` (ohne `NODE_ENV` im Kindprozess, sonst entfernt npm die Build-Toolchain)
   - `npm run build:core`, `build:sync`, `build:server`, `build:web`
   - Web-Build über ein Staging-Verzeichnis nach `server/public/` austauschen
3. Jeder Schritt wird in `data/update_state.json` protokolliert; `GET /api/update/status` liefert den Stand, auch über den Neustart hinweg
4. Danach `process.exit(0)` — `Restart=always` in der systemd-Unit startet den Prozess neu

---

## KI-Funktionen und Websuche

### Eigener web_search-Tool-Server statt Anbieter-Websuche

Statt der kostenpflichtigen Websuche der KI-Anbieter (die z. B. auch bei kostenlosen Modellen extra berechnet wird oder im Free-Tier fehlt) stellt der Server selbst die Suchanfrage und bietet sie dem Modell als Werkzeug `web_search` an — für beide unterstützten Wire-Formate (OpenAI-kompatibel und Gemini `functionDeclarations`). Backend wählbar: DuckDuckGo (ohne Einrichtung, aber rate-limited bei Rechenzentrums-IPs — erkennt und loggt die HTTP-202-CAPTCHA-Antwort separat, `websearch.ts`), eigene SearXNG-Instanz oder Brave.

### Ausgehende Anfragen und SSRF-Schutz

Der Server ruft nur feste https-Hosts auf (OpenRouter, Gemini, Brave, DuckDuckGo, GitHub), mit einer Ausnahme: die vom Admin gesetzte SearXNG-Adresse. Diese läuft über `outbound.ts` (#401): nur `https://`, keine Zugangsdaten in der URL, und die Zieladresse wird im `lookup`-Hook des Sockets geprüft — die geprüfte Adresse ist also die, mit der verbunden wird (kein Zeitfenster für DNS-Rebinding). Abgelehnt werden Loopback, RFC 1918, Link-Local (inkl. Cloud-Metadaten), CGNAT/Tailnet, Unique-Local, Multicast und reservierte Bereiche, IPv4 wie IPv6 (auch IPv4-mapped, NAT64, 6to4). Weiterleitungen folgt der Server selbst (max. 3), jede Station wird neu geprüft; dazu Timeout und Größenlimit. `POST /api/ai/settings` lehnt solche Adressen schon beim Speichern ab, maßgeblich ist aber die Prüfung beim Abruf. Der Gemini-Schlüssel geht im Header `x-goog-api-key`, nie in der URL. Wer künftig weitere nutzerkonfigurierbare Ziele einführt (z. B. #400), nutzt dieselbe Funktion.

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

> **Eingefroren (EOL, #372, Tag `android-final`).** Dieser Abschnitt beschreibt den letzten gepflegten Stand; neue Features entstehen nur für Web und Server.

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
// /photos/ ist seit #269 nicht mehr öffentlich: Bearer-JWT, API-Key oder signiertes ?t=-Token (die App hängt es in sync()/uploadPhoto() an)
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

### Container (öffentliche Instanz)

`v3/Dockerfile` (mehrstufig, `node:20-alpine`) ist der Weg für eigenständige Cloud-Hosts; die öffentliche Instanz `nailvault.de` läuft so. Das Image enthält kein git, das Update in der App ist dort abgeschaltet. Welche App-Version läuft, wird im Infrastruktur-Repo `homelab-infra` festgelegt (Pin auf Tag oder Commit); die Daten liegen in einem Volume.

### Release-Ablauf

Änderungen laufen über Feature-Branch und PR nach `main` (Pflicht-Checks: `build`, `build-android` — übersprungen —, CodeQL, Analyze, `claude-review`). Ein Release entsteht mit dem Workflow `release.yml` (manuell ausgelöst, Eingaben: Tag, Pre-Release, Notizdatei `docs/releases/<tag>.md`) nach Pflege von `CHANGELOG.md`. Installationen holen ein Release über die Update-Funktion der App bzw. `install.sh`; das Container-Deployment wird über seinen Pin umgestellt.

### GitHub Pages

Die Projektseite (`docs/`) ist statisch und unabhängig vom Server-Deployment. Der Workflow [`pages.yml`](.github/workflows/pages.yml) deployt sie bei jedem Push auf `main`, der etwas unter `docs/` ändert (außer reine Release-Notes, die Markdown-Anleitungen unter `docs/*.md` und `docs/archive/`), sowie manuell per `workflow_dispatch`. Läuft über die offiziellen `actions/configure-pages` + `actions/deploy-pages` Actions, kein eigener Build-Schritt nötig.

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

Die App ist primär für den Einsatz im **privaten Heimnetz** konzipiert. Für die öffentliche Instanz (`nailvault.de`) gibt es zusätzlich serverweite Schalter (Foto-Upload, KI, Registrierung mit Proof-of-Work), E-Mail-Bestätigung, Passwort-Reset und Passkeys — siehe [CLAUDE.md](CLAUDE.md).

| Bedrohung | Maßnahme |
|-----------|----------|
| Unberechtigte Schreibzugriffe | JWT (Daten/Sync), API-Key oder Admin-JWT (Admin), optional TOTP-2FA/Passkeys |
| Fremde Fotos abrufen | `/photos/*` nur mit Bearer-JWT, API-Key oder signiertem Token (#269); Löschen nur für den Besitzer |
| Clickjacking / MIME-Sniffing | `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff` auf jeder Antwort (#355) |
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
- HTTP, kein HTTPS — im Heimnetz ohne externen Zugang akzeptabel; für externen Zugang: Reverse-Proxy (Nginx) mit Let's Encrypt. Dann `TRUST_PROXY` auf die Adresse des Proxys setzen (nur IP/CIDR, nie `true`), sonst teilen sich alle Clients ein Rate-Limit pro Route (#397)
- `X-Api-Key` ist ein De-facto-Root-Credential (`/api/update/apply` zieht ungeprüft `origin/main` und führt `npm install`/`postinstall` aus) — bewusst akzeptiert für den Heimnetz-Anwendungsfall, siehe #73

---

## Versionierung

Semantisches Versioning (`MAJOR.MINOR.PATCH`). Versionen werden als Git-Tags gesetzt. Vollständige Änderungshistorie: [CHANGELOG.md](CHANGELOG.md)
