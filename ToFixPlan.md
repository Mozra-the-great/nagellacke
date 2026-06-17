# Fix Implementation Plan

**Source audit:** `ToFixFehler.md` (2026-06-16) — 41 findings from Security, Code-Logic, and UI/UX-A11y reviews.

All findings were verified against the current code before this plan was written. Two corrections to the audit are noted inline:
- **[H-7]** `StatsPage.module.css` has no low-opacity text colors — removed from contrast list.
- **[H-9]** `syncError` is not invisible: it exists and is shown in `SettingsPage.tsx:176`. The real gap is **app-wide** visibility — fixed by adding a sync-error indicator to `App.tsx` instead.
- **[K-2]** All three auth helpers (`requireApiKey`, `requireJwt`, `requireApiKeyOrJwt`) lack `return` before `reply.send`. All three must be fixed.

**Deletion-protection decision (K-4):** Undo-Snackbar (3 s) using the existing soft-delete (`deletedAt`) — not `confirm()`.

---

## Phase Overview

| Phase | Severity | # Findings | Branch |
|---|---|---|---|
| 1 | 🔴 Critical | 6 (+ M-1 bundled) | `fix/critical-audit` |
| 2 | 🟠 High | 11 | `fix/high-audit` |
| 3 | 🟡 Medium | 11 (M-1 done in Phase 1) | `fix/medium-audit` |
| 4 | 🟢 Low | 12 | `fix/low-audit` |

One branch per phase, merged into `main` via PR after review.

---

## Shared Components (built in Phase 1, reused later)

These cross-cutting pieces need to exist before the dependent fixes can be implemented.

### Undo-Snackbar (for K-4, M-5)

Create `v3/apps/web/src/components/Snackbar.tsx` + `Snackbar.module.css` — a lightweight
toast component that auto-dismisses after 3 s and exposes an optional action button.

Wire a `SnackbarContext` into `App.tsx` so any page can trigger it without prop-drilling.

Add a `restoreItem(id, type)` helper to `useAppData.ts` that sets `deletedAt: undefined`
on a polish / sticker / manicure and persists. The three delete functions call `showSnackbar`
with the item name + `onUndo: () => restoreItem(id, type)`.

### `useFocusTrap` hook (for K-5)

Create `v3/apps/web/src/hooks/useFocusTrap.ts`.

Signature: `useFocusTrap(ref: RefObject<HTMLElement>, active: boolean): void`

Implementation: when `active`, collect all focusable children, focus the first on mount,
trap Tab/Shift+Tab, restore the previously-focused element on cleanup.

Used in all three modals (PolishFormModal, DiaryPage inline modal, StickersPage inline modal).

### `resolvePolishRefs` helper (for H-3)

Extract the legacy-`polishes`-to-`polishRefs` resolution into a shared utility:

```ts
// v3/apps/web/src/utils/polishRefs.ts
export function resolvePolishRefs(
  entry: ManicureEntry,
  allPolishes: Polish[]
): PolishRef[] {
  if (entry.polishRefs?.length) return entry.polishRefs;
  return (entry.polishes ?? []).flatMap(name => {
    const p = allPolishes.find(ap => ap.name === name && !ap.deletedAt);
    return p ? [{ name: p.name, brand: p.brand, color: p.color }] : [];
  });
}
```

Reuse in both `resolveSwatches` (DiaryPage:23) and `openEdit` (DiaryPage:62).

---

## Phase 1 — Critical  (`fix/critical-audit`)

### K-1 + M-1 · NailBottle: `useMemo` after early return + non-deterministic ID

**File:** `v3/apps/web/src/components/NailBottle.tsx`

**Problem:** `useMemo` (line 29) is called only when `photoUrl` is falsy (after the early
return on line 15). Hook count changes between renders → "Rendered fewer hooks than expected".
The `useMemo` also uses `Math.random()` giving unstable SVG gradient IDs.

**Fix:**
1. Move the `useMemo` call to **before** the `if (photoUrl)` block.
2. Replace the body with a deterministic ID:
   ```ts
   const uid = useMemo(
     () => `${color.replace('#', '')}_${finish ?? 'c'}`,
     [color, finish]
   );
   ```
3. The early return block may still reference `uid` for the photo render path if needed,
   otherwise keep the early return after the hook.

**Acceptance:** Opening a collection with photo-polishes causes no React hook crash;
toggling a photo on/off renders without error.

---

### K-2 · `requireApiKey` / `requireJwt` / `requireApiKeyOrJwt`: missing `return`

**File:** `v3/server/src/index.ts:118–141`

**Problem:** All three preHandlers call `reply.code(401).send()` without `return`.
Current Fastify stops the lifecycle implicitly, but relying on that is fragile;
`requireApiKey` is synchronous (`void` return type), making it the highest risk.

**Fix:** Convert all three to `async` functions and add `return`:
```ts
async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const key = request.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    return reply.code(401).send({ error: 'Ungültiger API-Schlüssel' });
  }
}

async function requireJwt(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Ungültiges Token' });
  }
}

async function requireApiKeyOrJwt(request: FastifyRequest, reply: FastifyReply) {
  const key = request.headers['x-api-key'];
  if (key) {
    if (key !== API_KEY) return reply.code(401).send({ error: 'Ungültiger API-Schlüssel' });
    return;
  }
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Ungültiges Token' });
  }
}
```

**Acceptance:** `POST /api/update/apply` without `X-Api-Key` returns 401 and does NOT
trigger git pull / rebuild / restart.

---

### K-3 · Delete buttons invisible on touch devices

**Files:**
- `v3/apps/web/src/components/PolishCard.module.css`
- `v3/apps/web/src/pages/DiaryPage.module.css`
- `v3/apps/web/src/pages/StickersPage.module.css`

**Problem:** `.deleteBtn { opacity: 0 }` revealed only via `:hover` — no hover state on
touch screens → delete buttons permanently invisible on mobile.

**Fix:** Add to each of the three CSS files:
```css
@media (hover: none) {
  .deleteBtn { opacity: 0.55; }
}
```

**Acceptance:** DevTools mobile emulation (or real device) shows delete buttons at 55% opacity.

---

### K-4 · No delete confirmation → immediate irreversible data loss

**Files:**
- `v3/apps/web/src/pages/CollectionPage.tsx:67`
- `v3/apps/web/src/pages/StickersPage.tsx:93`
- `v3/apps/web/src/pages/DiaryPage.tsx:129`
- `v3/apps/web/src/useAppData.ts` (new `restoreItem` + snackbar wiring)
- `v3/apps/web/src/components/Snackbar.tsx` (new — see Shared Components)

**Fix:**
1. Build the Snackbar component and `SnackbarContext` (see Shared Components).
2. In `useAppData.ts`, after each delete, call `showSnackbar({ message: '…gelöscht', undoFn })`.
   Add `restoreItem` (sets `deletedAt: undefined`, persists).
3. Replace the direct `appData.deleteX()` calls in the three pages with the snackbar-
   wrapped version (the delete itself still fires immediately; undo within 3 s reverses it).

**Acceptance:** Tapping delete shows a 3 s toast with "Rückgängig"; tapping Undo restores the
item and it re-appears in the list.

---

### K-5 · Modals: no focus trap, no `role="dialog"`, no Escape key

**Files:**
- `v3/apps/web/src/components/PolishFormModal.tsx:33`
- `v3/apps/web/src/pages/DiaryPage.tsx:137`
- `v3/apps/web/src/pages/StickersPage.tsx:100`
- `v3/apps/web/src/hooks/useFocusTrap.ts` (new — see Shared Components)

**Fix (same pattern in all three modals):**

```tsx
// overlay: catch Escape key
<div
  className={styles.overlay}
  onClick={onClose}
  onKeyDown={(e) => e.key === 'Escape' && onClose()}
  tabIndex={-1}
>
  {/* inner modal */}
  <div
    ref={modalRef}
    className={styles.modal}
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    onClick={(e) => e.stopPropagation()}
  >
    <h2 id="modal-title">…</h2>
    …
  </div>
</div>
```

Apply `useFocusTrap(modalRef, true)` inside each modal component.

Note: DiaryPage and StickersPage use inline modal markup — extract to small sub-components
to keep the hook usage clean.

**Acceptance:** Tab stays within the modal; Escape closes it; screen reader announces
"Dialog — [title]" on open.

---

### K-6 · Modal close buttons missing `aria-label`

**Files:**
- `v3/apps/web/src/components/PolishFormModal.tsx:37`
- `v3/apps/web/src/pages/DiaryPage.tsx:141`
- `v3/apps/web/src/pages/StickersPage.tsx:104`

**Fix:** Add `aria-label="Schließen"` to each close button:
```tsx
<button onClick={onClose} aria-label="Schließen">✕</button>
```

**Acceptance:** Screen reader announces "Schließen, Schaltfläche" on the close button.

---

## Phase 2 — High  (`fix/high-audit`)

### H-1 · Rate limiting broken — `request.routerPath` is `undefined` in Fastify 4

**File:** `v3/server/src/index.ts:54`

**Fix:**
```ts
const key = `${request.routeOptions?.url ?? request.url}:${request.ip}`;
```

**Acceptance:** Rate limit buckets are per-route (verify by observing distinct keys for
`/api/update/apply` vs `/api/logs`).

---

### H-2 · Sync push response unchecked → `success: true` on failure

**File:** `v3/packages/sync/src/adapters/server.ts:38–44`

**Fix:**
```ts
const pushRes = await fetch(`${this.baseUrl}/api/sync/push`, {
  method: 'POST',
  headers: this.headers(),
  body: JSON.stringify({ data: merged }),
});
if (!pushRes.ok) throw new Error(`Push failed: ${pushRes.status}`);
return { success: true, lastSyncAt: Date.now(), merged };
```

**Acceptance:** Simulating a 500 on `/api/sync/push` causes `sync()` to throw (and the
caller to surface an error) rather than returning `{ success: true }`.

---

### H-3 · Data loss when editing v2 manicure entries (legacy `polishes: string[]`)

**File:** `v3/apps/web/src/pages/DiaryPage.tsx:62–71`

**Fix:** Use the shared `resolvePolishRefs` helper (see Shared Components) in `openEdit`:
```ts
function openEdit(m: ManicureEntry) {
  setEditId(m.id);
  setForm({
    date: m.date,
    polishRefs: resolvePolishRefs(m, appData.data.polishes),
    notes: m.notes ?? '',
    photos: { ...(m.photos ?? {}) },
  });
  setShowForm(true);
}
```

Also refactor `resolveSwatches` (line 23) to call the same helper so the resolution
logic lives in one place.

**Acceptance:** A legacy entry with only `polishes: ['Rot', 'Rosa']` and no `polishRefs`
opens in the editor showing both polishes; saving preserves them.

---

### H-4 · CORS defaults to `*` when `ALLOWED_ORIGIN` unset

**File:** `install.sh`

**Fix:** In the systemd unit generation section of `install.sh`, add:
```bash
Environment="ALLOWED_ORIGIN=https://your-domain.example"
```
with a prominent comment instructing the admin to replace the placeholder.

Optionally add a startup warning to `v3/server/src/index.ts` when `ALLOWED_ORIGIN` is `'*'`:
```ts
if (ALLOWED_ORIGIN === '*') {
  console.warn('[WARN] ALLOWED_ORIGIN is not set — CORS is open to all origins');
}
```

**Acceptance:** Fresh `install.sh` run produces a systemd unit with an explicit
`ALLOWED_ORIGIN` line.

---

### H-5 · No file-size limit for photo upload (Fastify default: 1 MB)

**Files:**
- `v3/server/src/index.ts:146` (route registration)
- `v3/apps/web/src/utils/photos.ts` (client error handling)

**Note:** The endpoint accepts base64-encoded JSON, so a 10 MB image becomes ~13.3 MB of
JSON. Set `bodyLimit` to `15 * 1024 * 1024` to safely accommodate 10 MB images after
base64 overhead.

**Fix — server:**
```ts
app.post('/api/photos', {
  bodyLimit: 15 * 1024 * 1024,  // ~10 MB image as base64 JSON
  preHandler: requireApiKeyOrJwt,
}, async (request, reply) => { … });
```

**Fix — client (`utils/photos.ts`):**
```ts
if (res.status === 413) throw new Error('Foto zu groß (max. 10 MB)');
if (res.status === 401) throw new Error('Nicht angemeldet — bitte zuerst in den Einstellungen einloggen');
```

**Acceptance:** Uploading a 5 MB image succeeds; uploading a 12 MB image returns a
readable "Foto zu groß" error in the UI.

---

### H-6 · Nav pill touch targets too small and overflow on 320 px screens

**File:** `v3/apps/web/src/App.module.css:79–91`

**Fix:** Replace the existing `@media (max-width: 600px)` `.navBtn` block:
```css
@media (max-width: 600px) {
  .navBtn {
    padding: 8px 10px;
    min-height: 44px;
    font-size: 10px;
    letter-spacing: 1px;
  }
  .header { padding: 0 12px; }
  .titleArea { padding: 12px 0 6px; }
  .appTitle { font-size: clamp(24px, 6vw, 34px); }
  .appSubtitle { display: none; }
}
```

**Acceptance:** DevTools 320 px viewport shows all 5 nav buttons without horizontal
overflow; each measures ≥ 44 px in height.

---

### H-7 · WCAG AA contrast violations

**Files (StatsPage confirmed clean — not in scope):**
- `v3/apps/web/src/App.module.css:39, 63–64`
- `v3/apps/web/src/pages/CollectionPage.module.css:30, 84`
- `v3/apps/web/src/components/PolishCard.module.css:46`

**Fix per element:**

| Selector | File | Current | Fix |
|---|---|---|---|
| `.appSubtitle` | `App.module.css:39` | `rgba(255,255,255,0.52)` | `rgba(255,255,255,0.70)` |
| `.navBtn` (inactive) | `App.module.css:63–64` | `rgba(255,255,255,0.68)` + `opacity:0.6` | Remove separate `opacity`, use single `rgba(255,255,255,0.70)` |
| placeholder / empty area | `CollectionPage.module.css:30` | `rgba(255,255,255,0.22)` | `rgba(255,255,255,0.50)` |
| `.count` | `CollectionPage.module.css:84` | `rgba(255,255,255,0.38)` | `rgba(255,255,255,0.65)` |
| `.brand` on cards | `PolishCard.module.css:46` | `rgba(255,255,255,0.45)` | `rgba(255,255,255,0.65)` |

**Acceptance:** All modified text elements achieve ≥ 4.5:1 contrast ratio against the
background (verify with browser DevTools or a contrast checker).

---

### H-8 · Empty states missing everywhere

**Files:**
- `v3/apps/web/src/pages/CollectionPage.tsx:61` + `CollectionPage.module.css`
- `v3/apps/web/src/pages/StickersPage.tsx:70` + `StickersPage.module.css`
- `v3/apps/web/src/pages/DiaryPage.tsx:101` + `DiaryPage.module.css`

**Fix (same pattern per page):**
```tsx
{visible.length === 0 && (
  <div className={styles.empty}>
    {hasActiveFilter
      ? 'Keine Einträge gefunden — Filter anpassen.'
      : 'Noch keine Einträge — füge deinen ersten hinzu!'}
  </div>
)}
```
CSS class (add to each module):
```css
.empty {
  grid-column: 1 / -1;   /* or full-width in flex lists */
  text-align: center;
  padding: 60px 20px;
  color: rgba(255, 255, 255, 0.50);
  font-family: var(--font-display);
  font-style: italic;
  font-size: 20px;
}
```

- CollectionPage: `hasActiveFilter = filter.search || filter.finish || filter.status`
- StickersPage: `hasActiveFilter = filter.search`
- DiaryPage: no filter — always show the "add your first" message.

**Acceptance:** Each page shows a friendly message when the list is empty.

---

### H-9 · Sync error only visible on Settings page (not app-wide)

**File:** `v3/apps/web/src/App.tsx`

**Context:** `syncError` exists in `useAppData.ts:38` and is already shown in
`SettingsPage.tsx:176`. A user not visiting Settings won't see auto-sync failures.

**Fix:** Add a small error indicator to the "Mehr" nav button in `App.tsx`:
```tsx
<button
  className={`${styles.navBtn} ${activeTab === 'settings' ? styles.active : ''}`}
  onClick={() => setActiveTab('settings')}
>
  {appData.syncError && (
    <span
      className={styles.syncErrorDot}
      title={`Sync-Fehler: ${appData.syncError}`}
      aria-label="Sync-Fehler"
    />
  )}
  ◈ Mehr
</button>
```
Add `.syncErrorDot` CSS: `6 px` red circle, `position: absolute`, top-right of the button.

**Acceptance:** When a sync fails, a red dot appears on the "Mehr" nav button; hovering/
focusing shows the error as a tooltip.

---

### H-10 · Search inputs missing `aria-label` and clear button

**Files:**
- `v3/apps/web/src/pages/CollectionPage.tsx:28–33`
- `v3/apps/web/src/pages/StickersPage.tsx:59–65`

**Fix:**
```tsx
<div className={styles.searchWrapper}>
  <input
    aria-label="Lacke suchen"   {/* "Sticker suchen" in StickersPage */}
    className={styles.searchInput}
    placeholder="Suchen…"
    value={filter.search}
    onChange={(e) => setFilter(f => ({ ...f, search: e.target.value }))}
  />
  {filter.search && (
    <button
      className={styles.clearSearch}
      aria-label="Suche leeren"
      onClick={() => setFilter(f => ({ ...f, search: '' }))}
    >
      ×
    </button>
  )}
</div>
```

**Acceptance:** Screen reader announces the input purpose; clear button appears when text
is present and removes the search term on click.

---

### H-11 · Filter `<select>` elements missing labels

**File:** `v3/apps/web/src/pages/CollectionPage.tsx:40–56`

**Fix:** Add `aria-label` to each of the four selects:
```tsx
<select aria-label="Sortieren nach" …>
<select aria-label="Oberfläche filtern" …>
<select aria-label="Status filtern" …>
```

**Acceptance:** Each select is announced with its purpose by a screen reader.

---

## Phase 3 — Medium  (`fix/medium-audit`)

### M-1 · NailBottle: non-deterministic gradient IDs
✅ **Resolved in Phase 1 (K-1 fix)** — deterministic `uid` formula already applied.

---

### M-2 · Cards and list rows not keyboard-accessible

**Files:**
- `v3/apps/web/src/components/PolishCard.tsx:15`
- `v3/apps/web/src/pages/DiaryPage.tsx:106`
- `v3/apps/web/src/pages/StickersPage.tsx:72`

**Fix (same pattern):**
```tsx
<div
  className={styles.card}
  onClick={onEdit}
  role="button"
  tabIndex={0}
  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onEdit()}
  aria-label={`${item.name} bearbeiten`}
>
```

**Acceptance:** Tab reaches each card; Enter/Space activates it.

---

### M-3 · `hexToHue` crashes on short hex / invalid color

**File:** `v3/packages/core/src/utils.ts:1–14`

**Fix:**
```ts
export function hexToHue(hex: string): number {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  // … rest unchanged
}
```

Add vitest edge-case tests:
```ts
it('returns 0 for short hex',    () => expect(hexToHue('#fff')).toBe(0));
it('returns 0 for empty string', () => expect(hexToHue('')).toBe(0));
it('returns 0 for rgba value',   () => expect(hexToHue('rgba(255,0,0,1)')).toBe(0));
it('works for valid 6-digit hex',() => expect(hexToHue('#ff0000')).toBe(0)); // red → hue 0
```

**Acceptance:** `npm run test` green; hue-sort in CollectionPage stable with edge-case colors.

---

### M-4 · Orphan photos never deleted

**Files:**
- `v3/apps/web/src/components/PhotoField.tsx`
- `v3/apps/web/src/useAppData.ts` (deletePolish:59, deleteSticker:79, deleteManicure:99)

`deletePhoto` is defined at `v3/apps/web/src/utils/photos.ts:35` but called nowhere.

**Fix — PhotoField:** call `deletePhoto` before clearing:
```tsx
const handleRemove = () => {
  if (value) deletePhoto(value);  // value = current filename
  onChange(undefined);
};
```

**Fix — useAppData delete functions:**
```ts
// deletePolish
if (p.photo) await deletePhoto(p.photo);

// deleteSticker
if (s.photo) await deletePhoto(s.photo);

// deleteManicure
const photos = m.photos ?? {};
await Promise.all(
  Object.values(photos).filter(Boolean).map(f => deletePhoto(f!))
);
```

**Acceptance:** Removing a photo triggers a `DELETE /api/photos/:filename` request;
`data/photos/` no longer accumulates orphaned files.

---

### M-5 · Native `confirm()` / `alert()` in SettingsPage

**File:** `v3/apps/web/src/pages/SettingsPage.tsx:87, 144, 148`

**Fix:** Replace native dialogs with inline status UI:
- `confirm()` before server update → styled inline confirmation with [Ja] / [Abbrechen] buttons,
  or reuse the Snackbar component built in Phase 1.
- `alert()` success/error messages → inline status banner (`styles.errorBanner` /
  new `styles.successBanner`).

**Acceptance:** No `confirm()` or `alert()` calls remain in SettingsPage; all feedback
is inline.

---

### M-6 · Multiple `<h1>` per page — broken heading hierarchy

**Files:**
- `v3/apps/web/src/pages/DiaryPage.tsx:95`
- `v3/apps/web/src/pages/StickersPage.tsx:55`
- `v3/apps/web/src/pages/StatsPage.tsx:36`
- `v3/apps/web/src/pages/SettingsPage.tsx:161`

**Fix:** Change each page-level `<h1>` to `<h2>`, and any wrapping `<header>` to `<div>`
where semantically appropriate. `App.tsx:32` retains the single document `<h1>`.

CollectionPage has no `<h1>` of its own → no change needed there.

**Acceptance:** Exactly one `<h1>` exists in the DOM on any page.

---

### M-7 · Photo slot grid overflows on 320 px screens

**File:** `v3/apps/web/src/pages/DiaryPage.module.css:70`

**Fix:**
```css
.photoSlots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 16px;
}
```

**Acceptance:** DevTools 320 px — photo slots wrap gracefully, no horizontal overflow.

---

### M-8 · Star rating buttons missing `aria-label` and `role="group"`

**File:** `v3/apps/web/src/components/PolishFormModal.tsx:86–95`

**Fix:**
```tsx
<div role="group" aria-label="Bewertung">
  {[1, 2, 3, 4, 5].map((n) => (
    <button
      key={n}
      type="button"
      aria-label={`${n} Stern${n > 1 ? 'e' : ''}`}
      aria-pressed={n <= (form.rating ?? 0)}
      onClick={() => setForm(f => ({ ...f, rating: n }))}
    >
      ★
    </button>
  ))}
</div>
```

**Acceptance:** Screen reader announces each button as "1 Stern, nicht gedrückt" etc.

---

### M-9 · Status updates not announced via `aria-live`

**Files:** `v3/apps/web/src/components/PhotoField.tsx`, `v3/apps/web/src/pages/SettingsPage.tsx`

**Fix:**
```tsx
{/* polite for progress */}
<div role="status" aria-live="polite" className={styles.srOnly}>
  {uploading ? 'Foto wird hochgeladen…' : ''}
</div>

{/* assertive for errors */}
{error && <div role="alert">{error}</div>}
```

Add `.srOnly` utility class if not already present:
```css
.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
```

**Acceptance:** Screen reader announces upload progress and errors without visual
layout changes.

---

### M-10 · BarChart label column too narrow on mobile

**File:** `v3/apps/web/src/pages/StatsPage.module.css:24`

**Fix:**
```css
.barRow {
  grid-template-columns: minmax(70px, 120px) 1fr 28px;
}
```

**Acceptance:** Bar chart labels don't overflow or wrap unexpectedly on 375 px viewport.

---

### M-11 · Import button is a `<label>` — not keyboard-focusable as a button

**File:** `v3/apps/web/src/pages/SettingsPage.tsx:314–316`

**Fix:**
```tsx
const fileInputRef = useRef<HTMLInputElement>(null);

<button
  type="button"
  className={styles.importBtn}
  onClick={() => fileInputRef.current?.click()}
>
  Import JSON
</button>
<input
  ref={fileInputRef}
  type="file"
  accept=".json"
  onChange={importData}
  style={{ display: 'none' }}
/>
```

**Acceptance:** Tab reaches the import button; Enter/Space triggers the file picker.

---

### M-12 · Settings: required fields not marked, no helper text

**File:** `v3/apps/web/src/pages/SettingsPage.tsx:197–253`

**Fix:**
- Add `aria-required="true"` to required inputs (server URL, username, password).
- Add `<p className={styles.helpText}>…</p>` below the App-Token input explaining
  where to find the Nextcloud App-Token (Settings → Security → App passwords).

**Acceptance:** Screen reader announces required fields; help text is visible below
the token input.

---

## Phase 4 — Low  (`fix/low-audit`)

All low-priority fixes are small, mostly one-liners.

| ID | File | Fix |
|---|---|---|
| L-1 | `v3/apps/web/src/index.css:29` | Remove `background-attachment: fixed` (iOS Safari repaints) |
| L-2 | `v3/apps/web/src/App.module.css` | Add `:focus-visible { outline: 2px solid rgba(255,200,230,0.9); }` to `.navBtn` |
| L-3 | `PolishFormModal.module.css`, `DiaryPage.module.css` | Replace `outline: none` with `:focus-visible { box-shadow: 0 0 0 2px var(--md-primary); }` on inputs |
| L-4 | `DiaryPage.tsx:97`, `StickersPage.tsx:56` | `aria-label="Neuen Eintrag hinzufügen"` on "+" buttons |
| L-5 | `DiaryPage.tsx:120` | `title={m.polishRefs?.[i]?.name ?? color}` on color swatches |
| L-6 | `App.module.css:29` | Add `color: transparent` before `-webkit-text-fill-color` as fallback |
| L-7 | `PolishCard.tsx:26` | `title={polish.name}` on the `.name` div |
| L-8 | `DiaryPage.tsx:127` | `aria-label="Eintrag löschen"` on the diary delete button |
| L-9 | `v3/server/src/index.ts` | Add comment: rate-limit map resets on server restart — acceptable for personal use |
| L-10 | Various | Standardize on `✕` (U+2715) across all close/remove buttons project-wide |
| L-11 | `install.sh:51` | `git -C "$INSTALL_DIR" pull --autostash --quiet origin main` |
| L-12 | `v3/server/src/db.ts:21` | `console.error('data.json corrupt — returning empty:', e)` in catch; same for `readUsers()` |

---

## Verification

Run after each phase before opening a PR.

### Automated

```sh
# from v3/
npm run build:core     # must pass
npm run build:web      # must pass
npm run build:server   # must pass
npm run test           # vitest — especially M-3 hexToHue edge cases
```

### Manual (critical paths)

| Scenario | What to check |
|---|---|
| Collection tab with at least one photo-polish | No React hook crash (K-1) |
| Toggle a polish photo on/off | No "Rendered fewer hooks" error in console |
| `POST /api/update/apply` without `X-Api-Key` | Returns 401, no git pull / restart triggered (K-2) |
| Mobile DevTools emulation (or real device) | Delete buttons visible at 55% opacity (K-3) |
| Tap delete on polish / sticker / diary entry | Undo snackbar appears; Undo restores the item (K-4) |
| Open any modal, press Tab | Focus stays inside modal (K-5) |
| Open any modal, press Escape | Modal closes (K-5) |
| Upload a photo > 5 MB | Succeeds; uploading > 12 MB shows "Foto zu groß" error (H-5) |
| Edit legacy diary entry (has `polishes`, no `polishRefs`) | Polish selection populated; save preserves it (H-3) |
| Collection / Stickers / Diary with 0 entries | Friendly empty-state message shown (H-8) |
| Trigger sync failure (wrong server URL in Settings) | Red dot on "Mehr" nav button (H-9) |
| 320 px viewport | No nav overflow; photo grid wraps gracefully (H-6, M-7) |

### Pre-merge per phase

- Run `code-reviewer` subagent on the branch diff before each PR.
- After Phase 1 and Phase 2: additionally run `security-reviewer` subagent (auth changes,
  CORS, upload limits).

---

## Docs

After completing all four phases, update:
- `CHANGELOG.md` — one entry per phase listing the finding IDs fixed
- `README.md` — if any user-visible behavior changed (empty states, delete UX, upload limits)
- `ARCHITECTURE.md` — if new shared components or hooks were added (`Snackbar`,
  `useFocusTrap`, `resolvePolishRefs`)
