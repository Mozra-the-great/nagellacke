# Entwicklung

## Lokal starten

```bash
# Terminal 1 – Server (der Vite-Proxy erwartet Port 3001; der Server-Default ist 3000)
cd v3 && npm install && npm run build:core && npm run build:sync && PORT=3001 npm run dev:server

# Terminal 2 – Web-App
cd v3 && npm run dev:web
```

Frontend läuft auf **http://localhost:5173**, `/api` und `/photos` werden vom Vite-Dev-Server an `localhost:3001` weitergeleitet (`v3/apps/web/vite.config.ts`). Ein Produktions-Build wird dagegen vom Server selbst unter seinem Port (Default 3000) ausgeliefert.

## Build & Tests

```bash
cd v3
npm run build:core && npm run build:sync && npm run build:server && npm run build:web
npm run test
```

> **Android ist eingefroren (EOL, #372).** Es gibt keine Android-Builds oder -Tests mehr in der täglichen Arbeit.
> Falls doch, lokal: `cd android && ./gradlew testDebugUnitTest assembleDebug` (reine JVM-Unit-Tests, ein
> `androidTest`-Sourceset gibt es bewusst nicht). Der Job `build-android` in `.github/workflows/ci.yml` läuft nur, wenn die
> Repo-Variable `ANDROID_ENABLED` auf `true` steht; der Release-Workflow `.github/workflows/android-release.yml` ist nur noch
> manuell auslösbar. Änderungen unter `android/` sind nicht vorgesehen. Wiederaufnahme: [Android wieder aufnehmen](android-wieder-aufnehmen.md).

## OAuth-Client-IDs für Cloud-Sync (Android, eingefroren)

Google Drive, OneDrive und Dropbox brauchen jeweils eine **eigene** OAuth-Client-ID. Es gibt
keine mitgelieferten: wer die App selbst hostet, registriert seine eigenen Clients. Bis #271
standen an dieser Stelle Platzhalter (`YOUR_GOOGLE_CLIENT_ID…`) direkt im Quelltext, die
ungeprüft in echte OAuth-Anfragen gingen.

Die IDs kommen jetzt zur Build-Zeit rein — Umgebungsvariable schlägt `android/local.properties`
(gitignored), sonst leer:

| Schlüssel | Registrierung |
|---|---|
| `OAUTH_CLIENT_ID_GOOGLE` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth-Client, Typ „Android" |
| `OAUTH_CLIENT_ID_MICROSOFT` | [Microsoft Entra](https://entra.microsoft.com) → App registrations |
| `OAUTH_CLIENT_ID_DROPBOX` | [Dropbox App Console](https://www.dropbox.com/developers/apps) |

Als Redirect-URI ist überall `nagellacke://oauth` einzutragen.

Fehlt eine ID, ist sie im Build der **leere String** — nicht ein Platzhalter. Das ist Absicht:
leer heißt eindeutig „nicht eingerichtet" (`OAuthClientIds.isConfigured()`), während ein
Platzhalter von einer echten, bloß falschen ID nicht zu unterscheiden ist.

Vorlage samt Kommentaren: `android/local.properties.example`.

## Repo-Struktur

```
nagellacke/
├── android/               ← Native Android-App (Kotlin/Jetpack Compose, Hilt, Room) — eingefroren (EOL, Tag android-final)
├── docs/                  ← Projektseite auf GitHub Pages + Anleitungen (Markdown)
│   ├── index.html          ← Landingpage
│   ├── privacy-policy.html ← Datenschutzerklärung (auch für Play-Store-Listing verlinkt)
│   ├── FEATURES.md         ← Feature-Inventar / manuelle QA-Checkliste
│   ├── store-listing.md    ← Play-Store-Entwurf (Android, nie eingereicht)
│   ├── releases/           ← Release-Notes pro Tag (Eingabe für release.yml)
│   └── archive/            ← überholte Planungsdokumente
├── fixtures/merge/        ← gemeinsame mergeData()-Testfälle (core-Tests lesen sie)
├── scripts/ci/            ← Label-Automatik (labels.py) und ihre Tests
├── .github/               ← Workflows (ci, pages, release, claude*, labels, android-release) und labels.json
├── install.sh             ← Installer (Debian/Ubuntu, systemd)
└── v3/                    ← Monorepo (npm workspaces)
    ├── Dockerfile          ← Container-Image (öffentliche Instanz)
    ├── scripts/            ← migrate-v2-to-v3.js (Legacy-Datenmigration)
    ├── packages/
    │   ├── core/          ← Typen, Business-Logik, Merge-Algorithmus (TypeScript)
    │   └── sync/          ← Sync-Adapter: Server, GDrive, OneDrive, Nextcloud, Dropbox
    ├── server/             ← Fastify-Server
    │   └── src/
    │       ├── index.ts    ← Alle Routen, JWT-Auth, Rate-Limiting, Security-Header
    │       ├── update.ts   ← Selbst-Update-Pipeline und Statusdatei
    │       ├── db.ts       ← Datei-Persistenz (data.json, users.json, Fotos)
    │       ├── ai.ts       ← KI-Provider-Anbindung (Auto-Fill, Smart-Cart)
    │       ├── report.ts   ← Wochen-/Monatsberichte (HTML)
    │       ├── email.ts    ← Berichtsversand per SMTP
    │       └── websearch.ts ← eigener web_search-Tool-Server (DuckDuckGo/SearXNG/Brave)
    ├── apps/
    │   └── web/            ← Web-App (React 18 + TypeScript + Vite)
    └── package.json        ← Monorepo-Root (npm workspaces, Node ≥20)
```

## Technik

| Schicht | Technologie |
|--------|-------------|
| Frontend | React 18 + Vite + TypeScript |
| Backend | Fastify 4 (TypeScript strict) |
| Speicher | JSON-Datei |
| Auth | API-Key (Admin) + JWT 7d/30d (Sync), optional TOTP-2FA |
| Passwort-Hash | scrypt + Salt + timingSafeEqual |
| Sync | Server / GDrive / OneDrive / Nextcloud / Dropbox |
| Mobile | Native Android (Kotlin, Jetpack Compose, Hilt, Room) — eingefroren seit 2026-10, kein Play-Store-Eintrag; die Web-App ist der Weg aufs Handy |
| Deployment | systemd + EnvironmentFile (`install.sh`) oder Container (`v3/Dockerfile`) |
| Monorepo | npm workspaces |
| Projektseite | Statisches HTML unter `docs/`, GitHub Pages via Actions-Workflow |

---

Vollständige Architektur: [ARCHITECTURE.md](../ARCHITECTURE.md) · Änderungshistorie: [CHANGELOG.md](../CHANGELOG.md)
