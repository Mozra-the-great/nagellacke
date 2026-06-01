# Nagellacke v3

Cross-platform nail polish collection — Android App, Web App, and sync server.

> **v2** (the original self-hosted PWA) lives in the root `/backend` + `/frontend` folders and is completely unchanged. v3 is isolated in this `/v3/` directory.

## Structure

```
v3/
├── packages/
│   ├── core/        TypeScript types, business logic, merge algorithm
│   └── sync/        Pluggable sync engine (server / GDrive / OneDrive / Nextcloud / Dropbox)
├── server/          Fastify + SQLite sync server (self-hosted)
├── apps/
│   ├── web/         React + Vite web app (Material Design 3)
│   └── android/     Expo React Native app (Material You, Play Store ready)
└── package.json     npm workspaces root
```

## Quick Start

```bash
cd v3
npm install
```

### Run the server (local dev)

```bash
npm run dev:server
# → http://localhost:3001

# Register an account:
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"me","password":"mysecretpassword"}'
# → {"token":"eyJ..."}
```

### Run the web app

```bash
npm run dev:web
# → http://localhost:5173
```

Open Settings → enter your server URL + the token from registration → Save → Sync.

### Run the Android app (Expo Go)

```bash
cd apps/android
npx expo start
```

Scan the QR code with **Expo Go** on your Android phone.

## Sync Providers

In Settings you can choose one of:

| Provider | How it works |
|----------|--------------|
| **Eigener Server** | REST API to your self-hosted server. Recommended. |
| **Nextcloud** | WebDAV — stores `nagellacke-data.json` in your Nextcloud. |
| **Google Drive** | Stores `nagellacke-data.json` in your Drive. Requires OAuth. |
| **OneDrive** | Stores `nagellacke-data.json` via Microsoft Graph. Requires OAuth. |
| **Dropbox** | Stores `nagellacke-data.json` via Dropbox API. Requires OAuth. |

**Conflict resolution:** last `updatedAt` timestamp wins per item. Deleted items use soft-delete (`deletedAt`) so deletions propagate across devices.

## Self-host the server (Linux)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/v3/server/install.sh)
```

This installs Node 20, builds the server, and creates a systemd service on port **3001**.

## Play Store Build

```bash
# Install Expo EAS CLI
npm install -g eas-cli
eas login

cd apps/android

# Development APK (for testing)
eas build --platform android --profile development

# Production AAB (for Play Store)
eas build --platform android --profile production

# Submit to Play Store (needs google-service-account.json)
eas submit --platform android
```

Replace `apps/android/assets/*.png` with real artwork before publishing.

## Run tests

```bash
cd packages/core
npm test
```

## Versioning

- v2 releases: tagged `v2.x.x` — drives the v2 in-app update checker
- v3 releases: tagged `v3.x.x` — completely separate
