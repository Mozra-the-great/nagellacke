# nagellacke

## Type
Personal nail-polish collection app — self-hosted on a Linux server via systemd, with a web frontend and an Android app.

## Stack

- Server: Fastify 4, TypeScript, JWT (`@fastify/jwt`), API-key auth — npm workspace under `v3/`
- Web app: React 18, TypeScript, Vite — `v3/apps/web/`
- Android: native Kotlin, Jetpack Compose, Hilt, KSP, Room — `android/` (root)
- Shared packages: `@nagellacke/core` (data types + merge logic, tsup + vitest), `@nagellacke/sync` — `v3/packages/`

## Structure

```
android/          # native Kotlin/Jetpack Compose Android app
v3/
  packages/
    core/         # shared AppData types + mergeData()
    sync/         # shared sync helpers
  apps/
    web/          # React/TS/Vite web app
  server/
    src/index.ts  # Fastify server (entry point)
    src/db.ts     # file-based JSON store + user management
install.sh        # Linux server installer → /opt/nagellacke, systemd
```

## Commands

**v3 monorepo (`v3/`):**
```sh
npm run dev:server      # Fastify server (tsx watch)
npm run dev:web         # Vite web dev server
npm run build:core      # build @nagellacke/core
npm run build:sync      # build @nagellacke/sync
npm run build:server    # tsc → dist/
npm run build:web       # tsc + vite build
npm run test            # vitest (core package)
```

**Server (`v3/server/`):**
```sh
npm run dev    # tsx watch src/index.ts
npm run build  # tsc
npm start      # node dist/index.js
```

## Notes

- Server deployment: `sudo bash install.sh` → installs to `/opt/nagellacke`, creates systemd service `nagellacke-v3`
- Auth: JWT (Bearer) for sync endpoints (`/api/sync`, `/api/auth/*`), photo endpoints (`/api/photos`), and report endpoints (`/api/reports/*`). **Admin endpoints** (`/api/update/apply`, `/api/update/check`, `/api/logs`) accept only `X-Api-Key`.
- Registration: `POST /api/auth/register` is open only when no users exist yet (first-user bootstrap) or `ALLOW_REGISTRATION=true` is set in the environment.
- Env vars of note: `PORT`, `ALLOWED_ORIGIN`, `SERVICE_NAME`, `JWT_SECRET`, `DATA_DIR`, `ALLOW_REGISTRATION`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `APP_URL`
- Data is stored as JSON files under `v3/server/data/` (gitignored); photos under `v3/server/data/photos/`.
- Report schedule config is stored in `v3/server/data/schedule.json` (auto-created on first save).
