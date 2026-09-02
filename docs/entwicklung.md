# Entwicklung

## Lokal starten

```bash
# Terminal 1 – Server
cd v3 && npm install && npm run build:core && npm run dev:server

# Terminal 2 – Web-App
cd v3 && npm run dev:web

# Android-App (Android Studio / Gradle)
cd android && ./gradlew assembleDebug
```

Frontend läuft auf **http://localhost:5173**, API-Aufrufe werden automatisch an `:3000` weitergeleitet.

## Build & Tests

```bash
cd v3
npm run build:core && npm run build:sync && npm run build:server && npm run build:web
npm run test

cd ../android
./gradlew assembleDebug testDebugUnitTest
```

Die Android-Tests sind reine JVM-Unit-Tests; ein `androidTest`/Instrumentation-Sourceset
gibt es bewusst nicht.

> Der Android-Build läuft in CI **nur** auf `android-v*`-Tags (`.github/workflows/android-release.yml`),
> nicht bei Pull Requests. Änderungen unter `android/` sollten deshalb lokal mit
> `./gradlew assembleDebug` gegengeprüft werden — oder der Workflow wird für den Branch
> manuell über „Run workflow" angestoßen.

## OAuth-Client-IDs für Cloud-Sync (Android)

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
├── android/               ← Native Android-App (Kotlin/Jetpack Compose, Hilt, Room)
├── docs/                  ← Projektseite auf GitHub Pages + Anleitungen (Markdown)
│   ├── index.html          ← Landingpage
│   ├── privacy-policy.html ← Datenschutzerklärung (auch für Play-Store-Listing verlinkt)
│   ├── store-listing.md    ← Play-Store-Metadaten
│   └── releases/           ← Release-Notes pro Version
├── install.sh             ← Installer (Debian/Ubuntu, systemd)
└── v3/                    ← Monorepo (npm workspaces)
    ├── packages/
    │   ├── core/          ← Typen, Business-Logik, Merge-Algorithmus (TypeScript)
    │   └── sync/          ← Sync-Adapter: Server, GDrive, OneDrive, Nextcloud, Dropbox
    ├── server/             ← Fastify-Server
    │   └── src/
    │       ├── index.ts    ← Alle Routen, JWT-Auth, Rate-Limiting, Update-Pipeline
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
| Mobile | Native Android (Kotlin, Jetpack Compose, Hilt, Room) — Play Store |
| Deployment | systemd + EnvironmentFile |
| Monorepo | npm workspaces |
| Projektseite | Statisches HTML unter `docs/`, GitHub Pages via Actions-Workflow |

---

Vollständige Architektur: [ARCHITECTURE.md](../ARCHITECTURE.md) · Änderungshistorie: [CHANGELOG.md](../CHANGELOG.md)
