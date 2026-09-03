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
- Auth: JWT (Bearer) for sync endpoints (`/api/sync`, `/api/auth/*`), photo endpoints (`/api/photos`), and report endpoints (`/api/reports/*`). **Admin endpoints** (`/api/update/apply`, `/api/update/check`, `/api/logs`, `/api/admin/api-key/rotate`) accept `X-Api-Key` **or** an admin-role JWT (#173) — `X-Api-Key` still works unchanged, this is additive. `/api/update/apply` additionally requires a fresh password re-confirmation on the JWT path. That guards specifically against a *stolen bearer token* held by someone who doesn't know the account password (e.g. exfiltrated via XSS) — not against someone who does, since that person could just log in again for a fresh JWT. The endpoint itself pulls the current `origin/main` HEAD with no signature/tag pinning and runs `npm install` (arbitrary `postinstall` scripts), so it stays a de-facto RCE/root credential either way (#73).
- Users have a `role: 'admin' | 'user'` (`db.ts`, absent = `'user'`). The first-registered account becomes admin automatically (`migrateFirstUserToAdmin()` on startup, or immediately at registration for a fresh install); `POST /api/admin/bootstrap` exchanges `X-Api-Key` for an admin session once, as a safety net. Full user/server-settings management lives under `/api/admin/*`, gated by `requireAdmin`, surfaced in the web app's Admin tab (`apps/web/src/pages/AdminPage.tsx`, only shown once `GET /api/auth/me` reports `role: 'admin'`). `POST /api/ai/settings` requires admin (not just any logged-in user) since #173.
- Registration: `POST /api/auth/register` is open only when no users exist yet (first-user bootstrap) or registration is allowed — a value saved in `data/server_settings.json` (via the admin panel) wins over `ALLOW_REGISTRATION`, which remains the fallback. That precedence now lives in one `registrationOpen()` helper, shared with the deliberately public `GET /api/auth/registration-status` (`{ allowed, firstUser }`) — the web app has to know whether to offer a register form *before* anyone is logged in, and `/api/admin/settings` is admin-only. The web app's register form (Settings → Sync) only appears when that route answers `allowed: true`; a null/failed answer keeps the box login-only, so an older server behaves exactly as before (#278).
- SMTP env vars (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`) are likewise only the fallback: a value saved under Admin → Server-Einstellungen in `data/server_settings.json` (mode 0600) wins per-field.
- Env vars of note: `PORT`, `ALLOWED_ORIGIN`, `SERVICE_NAME`, `JWT_SECRET`, `JWT_ACCESS_TTL` (default `7d`), `JWT_REFRESH_TTL` (default `30d`), `PHOTO_TOKEN_TTL` (default `3600`), `REPORT_PHOTO_TOKEN_TTL` (default 30 days), `DATA_DIR`, `ALLOW_REGISTRATION`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `APP_URL`
- Data is stored as JSON files under `v3/server/data/` (gitignored); each user's collection lives at `data/users/<user>/data.json`, photos are shared under `v3/server/data/photos/`.
- Photos (`/photos/*`) are **not** public since #269. The static handler sits in its own encapsulated Fastify plugin behind `requirePhotoAccess`, which accepts `X-Api-Key`, an `Authorization: Bearer <access JWT>`, **or** a signed `?t=` token (`src/photoToken.ts`, HMAC keyed on a value derived from `JWT_SECRET` — no extra config). `<img>` tags and mail clients can't send headers, hence the query token. Two flavours: a session token covering every photo (`GET /api/photos/token`, TTL `PHOTO_TOKEN_TTL`, default 1 h) and a per-file token bound to one filename, embedded in report emails (TTL `REPORT_PHOTO_TOKEN_TTL`, default 30 d). Revocation runs through `token_version`, so `POST /api/auth/logout-all` invalidates outstanding photo links too; a token minted via `X-Api-Key` is marked `k: true` and signed under a secret whose HMAC key is the API key in force, so rotating the key invalidates it — nothing derived from the key is put in the token itself (an earlier version embedded a digest, which CodeQL correctly flagged as a fast hash over a secret travelling in a URL). Clients: the web app caches the token in module state only, never localStorage (`apps/web/src/utils/photoToken.ts`, `usePhotoUrl()`); Android mints it inside `sync()`/`uploadPhoto()` because `SyncAdapter.photoUrl()` is not suspending and Coil bypasses the Retrofit auth interceptor, and parks it in a process-wide `PhotoTokenCache` keyed by server URL — it *has* to be shared state, because the adapter that mints (SyncManager's) is never the adapter that reads (the throwaway one `photoResolution()` builds for display). Holding it in an instance field looked correct and silently signed nothing, so every Android thumbnail 401'd (#297). The cache is memory-only like the web app's, and `SettingsViewModel.notifyConfigChanged()` clears it whenever the signed-in identity changes.
- Sync JWTs: the access token is returned in the JSON body as always, but the **refresh token is additionally set as an httpOnly cookie** (`nl_refresh`, `Path=/api/auth`) since #299. The web app keeps the access token in module state only and persists neither JWT — `saveSyncConfig()` strips both before writing to localStorage, and `restoreSession()` trades the cookie for a fresh access token on startup, which is what keeps a reload from reading as a logout. Tokens left in localStorage by an older version are adopted once and then scrubbed. `SameSite` follows the deployment: `Strict` when `ALLOWED_ORIGIN` is unset (install.sh serves the SPA itself, so the cookie is same-site), otherwise `None; Secure` — and because that removes SameSite as a CSRF defence, the cookie path of `POST /api/auth/refresh` then requires an `X-Nagellacke-Refresh: 1` header, which forces a preflight that CORS answers only for `ALLOWED_ORIGIN`. **A cookie-authenticated refresh deliberately returns only `{ token }`, never a new refresh token**: an injected script can already trigger the call and have the browser attach the cookie, so echoing a 30-day credential into a body it could read would give back exactly what #299 removed. Android is unaffected — it has no cookie jar, sends `refreshToken` in the body, and still gets both tokens back on that path.
- Android OAuth client ids (Google Drive / OneDrive / Dropbox) are **not** in the source. They come from `BuildConfig` fields fed by an `OAUTH_CLIENT_ID_*` env var or the same key in `android/local.properties` — the pattern the release signing config already used (#271). Unconfigured means the empty string, never a placeholder, so `OAuthClientIds.isConfigured()` can tell the two apart. Note the OAuth *connect* flow is still unimplemented: `buildAuthIntent()` has no caller and the "Mit Google/Microsoft/Dropbox anmelden" buttons in `SettingsScreen.kt` are disabled ("in Kürze"); the ids are only reached by the adapters' token refresh.
- CI builds Android on every pull request since #302: the `build-android` job in `.github/workflows/ci.yml` runs `./gradlew assembleDebug` (no signing secrets needed — debug uses AGP's built-in config). The `paths` filter covers `.github/workflows/ci.yml` itself, otherwise a PR that only edits the pipeline never runs it. Release builds still live in `android-release.yml` on `android-v*` tags. Note a compile check is not a behaviour check: #297 was a logic bug that would have compiled cleanly.
- Report schedule config is stored in `v3/server/data/schedule.json` (auto-created on first save).
- AI config (provider, API keys, web-search backend) lives in `v3/server/data/ai_config.json` (mode 0600); background jobs in `data/ai_jobs.json`. Web research runs through the server's own `web_search` tool (`src/websearch.ts` + `src/tooling.ts`), offered to the model via tool calling — the providers' billed web search is never used.
- Server settings editable from the admin panel (registration toggle, SMTP) live in `data/server_settings.json` (mode 0600); admin actions are logged to `data/audit.json` (bounded, newest-first).
- The `duckduckgo` backend is rate-limited per source IP: it answers a request it considers automated with **HTTP 202** (a success status) and a CAPTCHA page instead of results. `isDuckDuckGoChallenge()` detects that and logs it, because otherwise it parses to zero results and is indistinguishable from a query that found nothing. Shared/datacenter egress addresses hit this a lot, so a self-hosted SearXNG or a Brave key is the more reliable backend for a server install.
- Gemini's free tier allows only ~20 `generateContent` requests **per day** per model, and one AI job can spend up to `MAX_TOOL_ROUNDS + 1` of them. Model ids matter too: `gemini-2.5-flash` is closed to new API keys (404 "no longer available to new users"), so defaults use the floating `gemini-flash-latest` alias.
