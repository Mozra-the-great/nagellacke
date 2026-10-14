# Nagellacke v3

The current generation of the app: a React web app, a Fastify server and two shared TypeScript packages, managed as an npm workspace.

> The native Android app in `../android/` is **frozen** (EOL, #372, tag `android-final`) and is not part of this workspace. New features are web + server only.

## Layout

```
v3/
├── packages/
│   ├── core/       @nagellacke/core: data types, filter/sort logic, mergeData(), constants
│   └── sync/       @nagellacke/sync: sync adapters (own server, Nextcloud, Google Drive, OneDrive, Dropbox)
├── apps/
│   └── web/        React 18 + TypeScript + Vite web app
├── server/         Fastify 4 server (JSON-file storage, JWT/API-key auth, AI jobs, reports, self-update)
├── scripts/        v2 -> v3 data migration script (legacy, see header)
├── Dockerfile      Container image for standalone hosts (e.g. the public NailVault instance)
└── package.json    Workspace root (Node >= 20)
```

## Quick start

```bash
cd v3
npm install
npm run build:core && npm run build:sync

# terminal 1: server. The Vite dev proxy forwards /api and /photos to port 3000 (or PORT, if set).
npm run dev:server

# terminal 2: web app on http://localhost:5173
npm run dev:web
```

The server picks `PORT` (default `3000`) from the environment; production installs listen on 3000 and serve the built web app themselves. On first start it prints the API key to the console, and the first account that registers becomes admin.

## Build and test

```bash
npm run build:core && npm run build:sync && npm run build:server && npm run build:web
npm run test        # vitest across all workspaces
```

## More

- Install, update, backup and sync guides: [`../docs/`](../docs/installation.md)
- Development notes and repo structure: [`../docs/entwicklung.md`](../docs/entwicklung.md)
- Architecture and decisions: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- Contributor/agent conventions: [`../CLAUDE.md`](../CLAUDE.md)
