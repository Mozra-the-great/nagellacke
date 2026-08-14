# Nagellacke — Feature Inventory / Manual QA Checklist

Exhaustive checklist of every user-facing feature on the Web app (`v3/apps/web/`) and the
Android app (`android/`), derived by walking every page/screen, component, modal/sheet and
settings control in the source. Use this as the master manual-QA test plan.

Every item has a stable ID (`WEB-<AREA>-<NN>` / `AND-<AREA>-<NN>`). IDs must not be renumbered
once assigned — if a feature is removed, mark the checkbox `[x]` with `(REMOVED)` rather than
deleting the row, so IDs referenced in old bug reports stay valid.

Legend: ☐ = not yet tested this pass. Check items off during a QA run; reset before the next
full pass.

---

## Web — Navigation & shell (`App.tsx`)

- [ ] `WEB-NAV-01` App loads to the "Nagellack" (Collection) tab by default.
- [ ] `WEB-NAV-02` Header subtitle shows correct "N vorhanden · N Flasche(n) gesamt" counts (owned polishes only, respects `count` multiplier).
- [ ] `WEB-NAV-03` Nav bar switches between the 6 base tabs: Nagellack, Sticker, Tagebuch, Einkaufswagen, Statistiken, Mehr — each renders its page without losing app state.
- [ ] `WEB-NAV-04` Active tab is visually highlighted.
- [ ] `WEB-NAV-05` A red/error dot appears on the "Mehr" (Settings) tab when `syncError` is set; hover/title shows the error text.
- [ ] `WEB-NAV-06` A global snackbar (bottom) appears after delete actions across all pages, with "Rückgängig" (undo) and a dismiss (✕) button; auto-dismisses after 3s and commits the pending action (e.g. server-side photo cleanup) at that point.
- [ ] `WEB-NAV-07` Triggering a second delete while a snackbar is showing replaces the first snackbar and commits (not discards) the first item's pending cleanup.
- [ ] `WEB-NAV-08` A 7th tab, "◈ Admin", appears at the end of the nav bar only once `GET /api/auth/me` resolves `role: 'admin'` for the logged-in account (#173/#216); absent for `role: 'user'`, and absent (not merely disabled) while the role probe is unresolved — offline, logged out, or an older server that doesn't send `role` yet. Re-probed after login/logout/bootstrap without a full page reload.

## Web — Collection page (`CollectionPage.tsx`)

- [ ] `WEB-COL-01` "+" button opens the empty "Neuer Lack" form.
- [ ] `WEB-COL-02` Search box filters the grid live by name/brand as you type; a "✕" clear button appears when search has text and clears it.
- [ ] `WEB-COL-03` "Sortieren nach" dropdown re-orders the grid per each `SORT_OPTIONS` value (newest, etc.).
- [ ] `WEB-COL-04` "Status filtern" dropdown filters by status (owned/used up/wishlist/etc.), including "Alle Status".
- [ ] `WEB-COL-05` "Oberfläche filtern" (finish) dropdown filters by finish type, including "Alle Finishes"; a polish with several finish tags (#192/#197/#214) matches when the selected value is any one of them, not just the first.
- [ ] `WEB-COL-06` "Kategorie filtern" dropdown appears only when custom categories exist, and filters by category.
- [ ] `WEB-COL-07` Result count text ("N Lack/Lacke") updates with active filters.
- [ ] `WEB-COL-08` Empty state shows "Keine Lacke gefunden — Filter anpassen." when filters exclude everything, vs. "Noch keine Lacke…" when the collection is truly empty.
- [ ] `WEB-COL-09` Each polish card shows bottle/photo view (per global default), name, brand, star rating, wishlist badge (🛒) when status = wish, and count badge (`N×`) when count > 1.
- [ ] `WEB-COL-10` Photo toggle button (📷/◎) on a card with a photo swaps between photo and bottle view without navigating away; state persists only for that card/session.
- [ ] `WEB-COL-11` Clicking a card opens its detail view (photo/bottle, name, brand, rating stars, number, finish row listing every finish tag with its icon comma-separated (#192/#197/#214), status, count if >1, notes).
- [ ] `WEB-COL-12` Card "✕" delete button deletes the polish (soft-delete), shows snackbar with Undo.
- [ ] `WEB-COL-13` Undo on a deleted polish restores it and its visibility in the grid.
- [ ] `WEB-COL-14` Detail modal "Bearbeiten" opens the edit form pre-filled with existing values.
- [ ] `WEB-COL-15` Detail modal "Schließen" / ✕ / click-outside / Escape all close the modal.
- [ ] `WEB-COL-16` Detail modal traps focus (Tab does not leave the dialog) while open.
- [ ] `WEB-COL-17` New/edit form: Name is required — Save is disabled and an inline error shows on blur when empty.
- [ ] `WEB-COL-18` New/edit form: Brand, Nummer are free-text optional fields.
- [ ] `WEB-COL-19` New/edit form: color picker (native `<input type=color>`) updates the hex text live.
- [ ] `WEB-COL-20` New/edit form: "📷 Farbe aus Foto" opens the Color-from-Photo tool (see WEB-CFP-*) and applies the picked hex back into the color field.
- [ ] `WEB-COL-21` New/edit form: duplicate-color warning appears when a saturated color is within 15° hue and same finish as an existing (non-deleted) polish; lists the matching name(s); only shown when adding, not editing.
- [ ] `WEB-COL-22` New/edit form: Finish is a toggle-chip multi-select (#192/#197/#214, replaced the old single-select dropdown) listing all `FINISH_OPTIONS` with icons; a polish can carry several finishes at once (e.g. Top Coat + Glitter); the last remaining selected chip cannot be toggled off — a polish always keeps at least one finish; chips are disabled while AI Auto-Fill is checked.
- [ ] `WEB-COL-23` New/edit form: Status dropdown lists all `STATUS_OPTIONS`.
- [ ] `WEB-COL-24` New/edit form: Anzahl (count) numeric field, minimum 1.
- [ ] `WEB-COL-25` New/edit form: 1–5 star rating selector; clicking the already-selected star clears the rating to 0.
- [ ] `WEB-COL-26` New/edit form: Category chips toggle on/off (multi-select); section hidden when no categories exist.
- [ ] `WEB-COL-27` New/edit form: Foto field — add/change/remove a photo (see WEB-PHOTO-*).
- [ ] `WEB-COL-28` New/edit form: Notizen free-text textarea.
- [ ] `WEB-COL-29` New/edit form: "Abbrechen" discards changes and closes without saving.
- [ ] `WEB-COL-30` New/edit form: "Speichern" persists a new polish or updates an existing one and closes the form.
- [ ] `WEB-COL-31` AI Auto-Fill checkbox ("✨ KI recherchiert Farbe & Finish automatisch") appears only for new polishes when AI is enabled and server-sync is configured; when checked, color/finish inputs are disabled with a "(wird von der KI ermittelt)" hint.
- [ ] `WEB-COL-32` Saving with Auto-Fill checked creates the polish immediately, then kicks off a background AI job; on success the polish's color/finish are updated and a "✨ KI hat Farbe & Finish … ermittelt" snackbar appears; on failure a "KI-Recherche fehlgeschlagen: …" snackbar appears instead.

## Web — Color-from-Photo tool (`ColorFromPhoto.tsx`, used from Collection + Sticker/Diary forms indirectly via Collection form)

- [ ] `WEB-CFP-01` "Foto auswählen oder Kamera öffnen" opens the file/camera picker.
- [ ] `WEB-CFP-02` Selected image renders on a canvas (downscaled to max 1200px).
- [ ] `WEB-CFP-03` Tapping/clicking on the image samples that pixel's color and shows a swatch + hex value.
- [ ] `WEB-CFP-04` Dragging across the image (pointer held down) live-updates the sampled color.
- [ ] `WEB-CFP-05` "Übernehmen" applies the picked color back to the caller and closes the tool.
- [ ] `WEB-CFP-06` ✕ / Escape / click-outside closes the tool without applying a color.

## Web — Photo field (`PhotoField.tsx`, used in Collection / Sticker / Diary forms)

- [ ] `WEB-PHOTO-01` "📷 Foto hinzufügen" opens a file picker and uploads the chosen image, showing a thumbnail preview on success.
- [ ] `WEB-PHOTO-02` Button is disabled (with an explanatory hint) when there's no upload auth (no server-sync/API key configured).
- [ ] `WEB-PHOTO-03` While uploading, the button shows "⟳ Lädt…" and is disabled.
- [ ] `WEB-PHOTO-04` A failed upload shows an inline error message.
- [ ] `WEB-PHOTO-05` "× Entfernen" clears the selected photo (does not delete it from the server immediately — only on save/delete flows).
- [ ] `WEB-PHOTO-06` "📷 Ändern" replaces an existing photo with a newly picked one.
- [ ] `WEB-PHOTO-07` The uploaded filename's extension matches the actual image format (`.png`/`.webp`/`.jpg` picked server-side from the upload's MIME type, #225) rather than always defaulting to `.jpg` regardless of what was picked — check a PNG (e.g. a screenshot) round-trips without a visible artifact/format mismatch after upload.

## Web — Finish migration notice (`FinishMigrationNotice.tsx`, #192/#197/#214)

- [ ] `WEB-FIN-01` On first load after the multi-finish upgrade (a pre-migration localStorage backup exists and hasn't been dismissed yet), a modal appears explaining that `finish` is now multi-select and that a backup was made automatically; focus is trapped inside it.
- [ ] `WEB-FIN-02` "Verstanden" dismisses the notice permanently (persists a "seen" flag) without changing any data.
- [ ] `WEB-FIN-03` "Rückgängig machen" reveals a second confirmation step warning that rollback restores the device to its pre-migration snapshot and syncs that to the server, discarding device-local changes made since (while keeping newer changes already synced from other devices); "Ja, zurücksetzen" performs the rollback (shows "Wird zurückgesetzt…" while in flight) and then dismisses the notice; "Abbrechen" returns to the first step without changes.
- [ ] `WEB-FIN-04` Clicking the overlay or pressing Escape has the same effect as "Verstanden" (dismisses without rollback).

## Web — Error handling (`ErrorBoundary.tsx`, #218)

- [ ] `WEB-ERR-01` An outermost boundary in `main.tsx` catches a crash thrown while `App` itself derives state from corrupted data (e.g. a synced/imported `polishes` field that isn't an array at all), showing the same fallback as the per-tab boundary.
- [ ] `WEB-ERR-02` A per-tab boundary around `<main>`, keyed by the active tab, catches a render crash confined to one page/record (e.g. one malformed entry) without taking down the nav bar; switching to a different tab remounts a clean boundary instead of staying stuck on the failed render.
- [ ] `WEB-ERR-03` The fallback shows "Etwas ist schiefgelaufen" plus the thrown error's message when available; "Neu laden" reloads the page.
- [ ] `WEB-ERR-04` "Lokale Daten zurücksetzen" reveals a confirmation warning that this clears the locally cached collection on this device (recoverable via server sync, permanent otherwise) before "Ja, lokale Daten löschen" clears `localStorage` and reloads; "Abbrechen" returns to the normal fallback.
- [ ] `WEB-ERR-05` The caught error and component stack are still logged to the console (`console.error`), not swallowed silently.

## Web — Einkaufswagen / Cart page (`CartPage.tsx`)

- [ ] `WEB-CART-01` "+" opens the "Hinzufügen" chooser with two options: "Aus meiner Sammlung" and "Komplett neuer Lack".
- [ ] `WEB-CART-02` "Aus meiner Sammlung" opens a searchable picker of existing non-wishlist polishes; typing filters by name/brand (max 50 shown); selecting one adds a wishlist copy and shows a confirmation snackbar.
- [ ] `WEB-CART-03` "Komplett neuer Lack" opens the polish form pre-set to status "Wish".
- [ ] `WEB-CART-04` Cart grid shows only polishes with status = wish (non-deleted).
- [ ] `WEB-CART-05` Empty state: "Noch nichts im Einkaufswagen — füge einen Lack hinzu!"
- [ ] `WEB-CART-06` Card delete (✕) removes the wishlist entry with an undo snackbar (same as Collection).
- [ ] `WEB-CART-07` Clicking a card opens its detail view (photo/bottle, name, brand, number, finish row listing every finish tag with icon (#192/#197/#214), notes — no status/count rows, unlike Collection detail).
- [ ] `WEB-CART-08` Detail "Bearbeiten" opens the edit form.
- [ ] `WEB-CART-09` Detail "Gekauft ✓" marks the item status = ok (moves it into the main Collection) and shows a confirmation snackbar.
- [ ] `WEB-CART-10` Smart-Cart section is hidden entirely when AI is disabled in Settings.
- [ ] `WEB-CART-11` Smart-Cart section shows a "benötigen Server-Sync…" hint instead of the prompt box when server-sync isn't configured.
- [ ] `WEB-CART-12` Smart-Cart prompt textarea + "✨ Vorschläge finden" button is disabled until text is entered.
- [ ] `WEB-CART-13` Running Smart-Cart shows a spinner + "KI recherchiert…" state and disables the textarea.
- [ ] `WEB-CART-14` Smart-Cart success adds matching real products to the wishlist and shows "✨ N Lack(e) zum Einkaufswagen hinzugefügt" (or a "keine passenden…" message if 0 found); prompt clears.
- [ ] `WEB-CART-15` Smart-Cart failure shows an inline error banner and keeps the prompt text.
- [ ] `WEB-CART-16` "KI-Recherche anzeigen (N)" toggle expands/collapses a trace panel listing each research round's search queries.

## Web — Tagebuch / Diary page (`DiaryPage.tsx`)

- [ ] `WEB-DIARY-01` "+" opens a blank new-entry form defaulted to today's date.
- [ ] `WEB-DIARY-02` Entry count text updates ("N Eintrag/Einträge").
- [ ] `WEB-DIARY-03` Empty state: "Noch keine Einträge — starte dein Maniküre-Tagebuch!"
- [ ] `WEB-DIARY-04` Timeline entries are sorted newest-first by date.
- [ ] `WEB-DIARY-05` Each entry row shows a thumbnail (first available photo), formatted German date, up to 6 polish-color swatches, sticker chips (name + color dot), and notes preview.
- [ ] `WEB-DIARY-06` Entry row delete (✕) soft-deletes with undo snackbar; click doesn't also open the detail view.
- [ ] `WEB-DIARY-07` Clicking an entry (or Enter/Space when focused) opens its detail view.
- [ ] `WEB-DIARY-08` Detail view shows all attached photos with their slot labels (Foto / Finger rechts / Finger links / Daumen rechts / Daumen links), polish chips, sticker chips, and notes.
- [ ] `WEB-DIARY-09` Detail "Bearbeiten" opens the edit form pre-filled.
- [ ] `WEB-DIARY-10` Form: date picker (native `<input type=date>`).
- [ ] `WEB-DIARY-11` Form: 4 independent photo slots (Finger rechts/links, Daumen rechts/links), each with its own add/change/remove via PhotoField.
- [ ] `WEB-DIARY-12` Form: "Verwendete Lacke" chip picker — multi-select toggle over all owned (non-wishlist, non-deleted) polishes, shown with color dot + name.
- [ ] `WEB-DIARY-13` Form: "Verwendete Sticker" chip picker — multi-select over active stickers; section hidden when there are none.
- [ ] `WEB-DIARY-14` Form: Notizen textarea.
- [ ] `WEB-DIARY-15` Form "Abbrechen" discards; "Speichern" persists a new or updated entry.
- [ ] `WEB-DIARY-16` Editing an entry created before polish `id` tracking existed (legacy name/brand refs) still resolves the correct polishes into the picker without collapsing distinct same-named polishes onto one id.

## Web — Sticker page (`StickersPage.tsx`)

- [ ] `WEB-STK-01` "+" opens a blank new-sticker form.
- [ ] `WEB-STK-02` Search box filters the list live; "✕" clears it.
- [ ] `WEB-STK-03` Count text ("N Sticker") updates with the filter.
- [ ] `WEB-STK-04` Empty state distinguishes "no stickers at all" vs. "no results for this search".
- [ ] `WEB-STK-05` List row shows photo thumbnail (or up to 3 color dots if no photo), name, brand, type chip, star rating.
- [ ] `WEB-STK-06` Row delete (✕) soft-deletes with undo snackbar.
- [ ] `WEB-STK-07` Clicking a row opens the detail view (photo or color swatches, brand, type, style, rating, notes).
- [ ] `WEB-STK-08` Detail "Bearbeiten" opens the edit form.
- [ ] `WEB-STK-09` Form: Name required (Save disabled when blank).
- [ ] `WEB-STK-10` Form: Marke free text.
- [ ] `WEB-STK-11` Form: Typ dropdown (`STICKER_TYPE_OPTIONS`, with icons).
- [ ] `WEB-STK-12` Form: Status dropdown (`STATUS_OPTIONS`).
- [ ] `WEB-STK-13` Form: Foto field (add/change/remove via PhotoField).
- [ ] `WEB-STK-14` Form: Notizen textarea.
- [ ] `WEB-STK-15` Form "Abbrechen"/"Speichern" behave as in Collection.

## Web — Statistik page (`StatsPage.tsx`, read-only)

- [ ] `WEB-STATS-01` KPI row shows correct counts: owned polishes, active stickers, active manicure entries.
- [ ] `WEB-STATS-02` "Farbpalette" renders one dot per owned polish, sorted by hue; hovering shows a name/brand tooltip.
- [ ] `WEB-STATS-03` "Nach Finish" bar chart shows only finishes with ≥1 owned polish, with correct proportional bar widths and counts; a polish with several finish tags (#192/#197/#214) is counted once per tag, so bar widths (each computed against total owned count) can legitimately sum past 100% — not a bug.
- [ ] `WEB-STATS-04` "Nach Status" bar chart covers all (non-deleted) polishes, not just owned ones.
- [ ] `WEB-STATS-05` "Top-Marken" shows up to 10 brands by owned-polish count, descending, "Unbekannt" for blank brand.
- [ ] `WEB-STATS-06` "Bestbewertet" section (only shown if any rated polish exists) lists up to 5 top-rated owned polishes with swatch, name, brand, stars.
- [ ] `WEB-STATS-07` All charts show "Keine Daten" gracefully instead of breaking when a category is empty.

## Web — Settings page (`SettingsPage.tsx`) — Statistik section

- [ ] `WEB-SET-01` Shows live counts of polishes/stickers/manicures (non-deleted).

## Web — Settings — Sync

- [ ] `WEB-SET-02` Sync error banner shows the current `syncError` message when present.
- [ ] `WEB-SET-03` "Letzter Sync" timestamp shown when a previous sync succeeded.
- [ ] `WEB-SET-04` "Sync-Anbieter" dropdown offers: Kein Sync, Eigener Server, Nextcloud, Google Drive, OneDrive, Dropbox.
- [ ] `WEB-SET-05` "Eigener Server" provider: Server-URL field + Benutzername/Passwort login form; "Anmelden" logs in against `/api/auth/login`, stores the JWT, and triggers an immediate sync.
- [ ] `WEB-SET-06` Login shows a loading state and surfaces server error messages (e.g. wrong password) inline.
- [ ] `WEB-SET-07` After login, the login form is replaced by "✓ Eingeloggt" + "Abmelden"; Abmelden clears the token and sync config.
- [ ] `WEB-SET-08` Attempting to Save the "Eigener Server" config without being logged in shows an explanatory error instead of saving.
- [ ] `WEB-SET-09` "Nextcloud" provider: URL/Benutzername/App-Passwort fields, with a help text warning against using the real account password; Save requires all three fields filled.
- [ ] `WEB-SET-10` Selecting Google Drive/OneDrive/Dropbox on web shows an "OAuth2-Login wird in der Android-App unterstützt" hint and Save is blocked with an explanatory error (these providers are Android-only from the web UI).
- [ ] `WEB-SET-11` "Speichern" shows a transient "✓ Gespeichert" confirmation.
- [ ] `WEB-SET-12` "↑↓ Jetzt syncen" button (visible once a provider is configured) triggers a manual sync and shows a "Sync…" busy state.

## Web — Settings — Categories

- [ ] `WEB-SET-13` Existing categories list with a ✕ delete button each; "Noch keine Kategorien" empty state.
- [ ] `WEB-SET-14` New-category input + "+" button adds a category; pressing Enter in the input also adds it; input clears after adding.
- [ ] `WEB-SET-15` Deleting a category removes it from this list and from the Collection filter/category-chip pickers.

## Web — Settings — Darstellung (display)

- [ ] `WEB-SET-16` "Standard-Lackansicht" segmented control (📷 Foto / ◎ Flasche) sets the app-wide default photo-vs-bottle view for new card renders; existing per-card toggles are unaffected.
- [ ] `WEB-SET-17` "KI-Funktionen" segmented control (An/Aus) is the master AI switch; when off, Auto-Fill checkbox, Smart-Cart section, and the whole "KI-Assistenz" settings section disappear everywhere (not just disabled/greyed).

## Web — Settings — Daten (import/export)

- [ ] `WEB-SET-18` "Export ZIP" downloads a `.zip` containing `data.json` plus a `photos/` folder with every referenced photo; button shows "Exportiere…" while running.
- [ ] `WEB-SET-19` Export completing with some photos unreachable shows a warning banner with the skipped count, but still downloads the zip.
- [ ] `WEB-SET-20` "Import" opens a file picker accepting `.json` and `.zip`.
- [ ] `WEB-SET-21` Importing a valid `.zip` merges its `data.json` + re-uploads its photos (remapping filenames), then shows a success message with counts (polishes/stickers/manicures/photos).
- [ ] `WEB-SET-22` Importing a `.zip` while some photo uploads fail (e.g. no upload auth) still merges the data and shows a warning message with the failed-photo count.
- [ ] `WEB-SET-23` Importing a `.zip` missing `data.json` shows "Ungültige ZIP-Datei: data.json fehlt".
- [ ] `WEB-SET-24` Importing a legacy plain `.json` file (no photos) merges it directly and shows a success message.
- [ ] `WEB-SET-25` Importing an invalid/corrupt file shows an error message instead of crashing.
- [ ] `WEB-SET-26` Import message banner has a ✕ to dismiss it.
- [ ] `WEB-SET-27` Import merges rather than overwrites — pre-existing local data survives an import (newest-wins merge, verified via `mergeData`).

## Web — Settings — Berichte (reports)

- [ ] `WEB-SET-28` "Wochenübersicht"/"Monatsübersicht" segmented toggle switches report period.
- [ ] `WEB-SET-29` Date picker selects which week/month the report covers.
- [ ] `WEB-SET-30` "📄 Bericht erstellen" opens a new tab with the generated HTML report for the selected period/date.
- [ ] `WEB-SET-31` Report email/schedule sub-section only renders when server-sync is the active provider; otherwise a "nur mit dem Eigenen-Server-Sync verfügbar" hint shows instead.
- [ ] `WEB-SET-32` E-mail field pre-fills from the logged-in account's e-mail (`/api/auth/me`) when available.
- [ ] `WEB-SET-33` A warning banner shows when SMTP isn't configured server-side, and disables "Jetzt per E-Mail senden".
- [ ] `WEB-SET-34` "✉ Jetzt per E-Mail senden" sends the report for the selected period/date to the given address; shows "Sende…" then "✓ Bericht gesendet!" or an inline error.
- [ ] `WEB-SET-35` "Automatisch senden" An/Aus toggle reveals Häufigkeit (Wöchentlich/Monatlich) + Senden-an fields when on.
- [ ] `WEB-SET-36` "Zeitplan speichern" persists the schedule to the server; disabled while SMTP isn't configured; shows "Speichere…" then "✓ Gespeichert" or an error.
- [ ] `WEB-SET-37` Existing schedule config loads on page open (enabled/frequency/toEmail restored from `/api/reports/schedule`).

## Web — Settings — KI-Assistenz (AI settings) — legacy/unknown-role path only

Since #173/#216, this section only still lives in `SettingsPage.tsx` while `role === null`
(offline, logged out, or an older server that predates the `role` concept) — see `WEB-SET-38`.
Once a role is known it moves wholesale to the Admin page (`WEB-ADM-09`..`11`, admin) or
disappears entirely (`role === 'user'`, whose `POST /api/ai/settings` now 403s server-side).

- [ ] `WEB-SET-38` The "KI-Assistenz" section here is visible only when the master AI toggle (WEB-SET-17) is on **and** `role === null`; it disappears the moment a role is resolved (see WEB-NAV-08), whether that resolves to admin or user.
- [ ] `WEB-SET-39` Shows a "benötigt den Eigenen-Server-Sync" hint instead of the form when server-sync isn't configured.
- [ ] `WEB-SET-40` "Anbieter" toggle switches between OpenRouter and Gemini, each revealing its own fields.
- [ ] `WEB-SET-41` OpenRouter: API-key field (password-masked, shows "(bereits gesetzt)" hint when one exists server-side without re-displaying it), Modell text field, "Nur kostenlose Modelle" An/Aus toggle with explanatory text about skipping web search for `:free` models.
- [ ] `WEB-SET-42` Gemini: API-key field (same masking behavior) + Modell text field.
- [ ] `WEB-SET-43` "Web-Recherche" backend selector: DuckDuckGo / SearXNG / Brave / Aus.
- [ ] `WEB-SET-44` SearXNG backend reveals an "SearXNG-Adresse" URL field.
- [ ] `WEB-SET-45` Brave backend reveals a masked API-key field (with "already set" hint behavior).
- [ ] `WEB-SET-46` "Speichern" persists AI settings to the server; shows "Speichere…" → "✓ Gespeichert" or an inline error; key fields clear after a successful save (so a stored key is never re-shown in plaintext) while the "already set" hint switches on.
- [ ] `WEB-SET-47` Existing AI settings (provider, models, free-only flag, search backend, has-key flags) load on page open via `/api/ai/settings`(or equivalent) and populate the form.

## Web — Settings — Sicherheit (TOTP 2FA, #174/#215)

- [ ] `WEB-SET-52` Section only offers the setup flow when server-sync is active; otherwise shows "2FA ist nur mit dem Eigenen-Server-Sync verfügbar" instead.
- [ ] `WEB-SET-53` When 2FA is off, a warning banner recommends updating the Android app to the latest version *before* enabling 2FA, since older Android builds cannot complete a two-step login (#227 — Android has no 2FA login UI at all; see `AND-SET-*` platform-parity note).
- [ ] `WEB-SET-54` "2FA aktivieren" calls `POST /api/auth/totp/setup`, then shows a QR code (rendered client-side via the `qrcode` package from the returned `otpauthUri`) plus the raw secret and otpauth URI as manual-entry fallbacks.
- [ ] `WEB-SET-55` Entering the 6-digit code from the authenticator app and a password, then "Bestätigen und aktivieren", calls `POST /api/auth/totp/enable`; a wrong code or password shows an inline error and does not enable 2FA.
- [ ] `WEB-SET-56` A successful enable reveals a one-time "Wiederherstellungscodes" panel (10 codes in a 2-column monospace grid) with "Kopieren" (clipboard) and "Verstanden" (dismiss) — the codes are never shown again after dismissal.
- [ ] `WEB-SET-57` Enabling 2FA transparently refreshes the session's access/refresh tokens in place (the server bumps `token_version`, invalidating pre-enrollment sessions) — the user is never forced to log back in as a side effect of enabling 2FA.
- [ ] `WEB-SET-58` "Abbrechen" during setup discards the in-progress QR/secret state without enabling anything.
- [ ] `WEB-SET-59` Once enabled, the section shows "✓ 2FA aktiv" plus the remaining recovery-code count; a warning banner appears once ≤2 codes remain, prompting regeneration.
- [ ] `WEB-SET-60` "Neu erzeugen…" reveals a password-confirmation row; confirming calls the recovery-codes regenerate endpoint, invalidates all previous codes, and re-shows the one-time reveal panel (WEB-SET-56) with the new set.
- [ ] `WEB-SET-61` "2FA deaktivieren" requires a password and, on success, turns 2FA off, clears the recovery-code count, and (like enable) refreshes tokens transparently without forcing a re-login.
- [ ] `WEB-SET-62` Two-step login: after a correct username/password on an account with 2FA enabled, `POST /api/auth/login` returns a challenge instead of tokens; the login form is replaced by a code-entry step ("Code aus der Authenticator-App").
- [ ] `WEB-SET-63` "Stattdessen Wiederherstellungscode verwenden" swaps the code field to accept a recovery code instead (different placeholder/format hint); toggling back restores the authenticator-code field and clears whatever was typed.
- [ ] `WEB-SET-64` "Bestätigen" posts to `/api/auth/login/verify` with the challenge token + code; success completes the login exactly like a non-2FA login (stores tokens, triggers a sync, refreshes the role/Admin-tab probe); an invalid/expired code or already-used recovery code shows an inline error and stays on the challenge step.
- [ ] `WEB-SET-65` "Abbrechen" on the challenge step returns to the plain username/password form, discarding the challenge token.

## Web — Settings — Admin (legacy API-key path, hidden once `role === 'admin'`)

Once #173/#216 resolve a known admin role, this whole section's job (update check/apply, API
key) is superseded by the Admin page (`WEB-ADM-12`..`14`). It stays visible for `role === 'user'`
(the bootstrap flow below needs it) and `role === null` (offline/legacy server), unchanged from
its pre-#173 behavior.

- [ ] `WEB-SET-48` API-Schlüssel field (password-masked) is stored in `localStorage` and used as `X-Api-Key` for admin calls; the whole "Admin" section disappears once `role === 'admin'` is resolved (WEB-NAV-08) — its job is done from then on.
- [ ] `WEB-SET-49` "Update prüfen" (disabled until a key is entered) calls `/api/update/check`; shows current version and, if newer exists, "→ vX verfügbar"; shows "API-Schlüssel ungültig" on a 401.
- [ ] `WEB-SET-50` "Update installieren" only appears when an update is available; clicking it reveals a confirm row ("Server neu starten? (~2 Min. nicht erreichbar)") with "Ja, installieren"/"Abbrechen".
- [ ] `WEB-SET-51` Confirming triggers `/api/update/apply` and shows "Update gestartet — Server startet in ~2 Min. neu."; a connection error during apply shows an inline error instead.
- [ ] `WEB-SET-66` With an API key entered and no admin account bootstrapped yet, a "Mit dem API-Schlüssel einmalig ein Admin-Konto einrichten" box appears above the key field with username + password (min. 8 chars) fields and "In Admin-Konto umwandeln" (#173 §3.3).
- [ ] `WEB-SET-67` If an admin account already exists, the bootstrap box instead shows "Es existiert bereits ein Admin-Konto — bitte mit diesem Konto oben anmelden." and hides the username/password fields (detected from a 409 response, matched on message text).
- [ ] `WEB-SET-68` A successful bootstrap logs the new admin in immediately (stores the returned tokens via the normal sync-config path, clears the API key from `localStorage`, re-probes the role) and shows "✓ Admin-Konto eingerichtet — angemeldet."; the whole Admin section then disappears on the next role probe since `role` is now `'admin'`.

## Web — Admin page (`AdminPage.tsx`, `role === 'admin'` only, #173/#216)

- [ ] `WEB-ADM-01` "Benutzer" lists every account (username, "(Admin)" tag, e-mail if set).
- [ ] `WEB-ADM-02` "Zu Admin machen" / "Admin entfernen" toggles a user's role via `PATCH /api/admin/users/:username/role`; "Admin entfernen" is disabled (with an explanatory title) when that user is the last remaining admin.
- [ ] `WEB-ADM-03` Deleting a user (✕) requires a second "Wirklich löschen" confirmation click ("Abbrechen" cancels); the ✕ itself is disabled for the last remaining admin.
- [ ] `WEB-ADM-04` "Neuen Benutzer anlegen": username, password (min. 8 chars, Save disabled below that), and a Benutzer/Admin role segmented control; "Benutzer anlegen" shows "Anlegen…" → "✓ Angelegt" or an inline error, then refreshes the list and resets the form.
- [ ] `WEB-ADM-05` "Server-Einstellungen → Registrierung erlauben" An/Aus toggle, annotated with its source (`aus Admin-Panel` / `aus Umgebungsvariable` / `nicht gesetzt`).
- [ ] `WEB-ADM-06` SMTP fields (Host, Port, Benutzer, Passwort — masked with "(bereits gesetzt)" hint, Absender, TLS An/Aus toggle), each section annotated with its config source; "Speichern" persists them (password left blank = unchanged) and shows saving/saved/error states.
- [ ] `WEB-ADM-07` "Test-E-Mail an" + "Testmail senden" (disabled until an address is entered) calls the SMTP test endpoint with the current form values and shows "✓ Test-E-Mail gesendet" or an inline error.
- [ ] `WEB-ADM-08` App-URL is shown read-only with its source and current value, and a note that it's only settable via the `APP_URL` environment variable (requires a server restart).
- [ ] `WEB-ADM-09` "KI-Assistenz → Anbieter" toggle (OpenRouter/Gemini) — same field set as the legacy per-user KI-Assistenz section (WEB-SET-40..45): masked API keys with "already set" hints, model fields, free-only toggle, web-search backend selector with SearXNG/Brave sub-fields.
- [ ] `WEB-ADM-10` "Speichern" persists the server-wide AI config; key fields clear after a successful save.
- [ ] `WEB-ADM-11` "Verbindung testen" calls the AI test endpoint for the selected provider and shows "✓ Verbindung erfolgreich (<model>)" or an inline error.
- [ ] `WEB-ADM-12` "API-Schlüssel & Update → Update prüfen" shows the current version and, if newer, "→ vX verfügbar" — authorized via the admin's own session (JWT), no API key needed any more.
- [ ] `WEB-ADM-13` "Update installieren" (shown once an update is available) reveals a password-confirmation row ("Server neu starten? (~2 Min. nicht erreichbar) — Passwort zur Bestätigung"); confirm is disabled below 8 characters; success shows "Update gestartet — Server startet in ~2 Min. neu."
- [ ] `WEB-ADM-14` "API-Schlüssel rotieren" generates a new root API key (invalidating the old one immediately) and displays it once in a warning banner ("nur jetzt sichtbar") — never shown again after leaving/reloading the page.
- [ ] `WEB-ADM-15` "Audit-Log" lists recorded admin actions (timestamp, actor, action, optional target), newest entries as returned by the server; shows "Noch keine Einträge" when empty.

---

## Android — Bottom navigation (`MainActivity.kt`)

- [ ] `AND-NAV-01` App launches with a splash screen, then lands on the "Lacke" (Collection) tab.
- [ ] `AND-NAV-02` Bottom nav has 6 destinations, each with a distinct icon; since #240/#241 the printed labels are shortened to fit 6-across ("Lacke · Wünsche · Sticker · Buch · Statistik · Mehr"), each truncating to an ellipsis rather than wrapping mid-word under a larger system font scale; the full names ("Wunschliste", "Tagebuch", …) remain as the icon's accessibility label and as each screen's own top-bar title, so nothing is actually lost, only shortened in the bar itself.
- [ ] `AND-NAV-03` Switching tabs preserves each tab's scroll/back-stack state (`saveState`/`restoreState`).
- [ ] `AND-NAV-04` Re-tapping the current tab does not push a duplicate destination (`launchSingleTop`).
- [ ] `AND-NAV-05` A periodic background sync is scheduled on app start (`SyncManager.schedulePeriodicSync`) — verify sync still runs/updates data after the app has been backgrounded a while (WorkManager); a 401 during that sync (or any authenticated call) transparently refreshes the access token once and retries before surfacing an error (#220).
- [ ] `AND-NAV-06` Local photo files no longer referenced by any polish/sticker/manicure are deleted automatically as part of that periodic sync, but only once they're older than a 24h grace period — a photo picked seconds ago and not yet referenced anywhere doesn't get swept mid-edit (#226).

## Android — Collection screen (`CollectionScreen.kt` / `CollectionViewModel.kt`)

- [ ] `AND-COL-01` FAB (+) opens the "Neuer Lack" bottom sheet.
- [ ] `AND-COL-02` Search bar filters the grid live by name/brand.
- [ ] `AND-COL-03` Horizontal-scrolling status filter chips toggle a status filter on/off (tapping the active chip clears it back to "all").
- [ ] `AND-COL-04` Result count text ("N Lacke") updates with filters.
- [ ] `AND-COL-05` Empty state ("Noch keine Lacke. Tippe + …") vs. loading spinner vs. populated 2-column grid — correct state shown in each case.
- [ ] `AND-COL-06` Card shows photo (if available and toggled on) / nail-bottle SVG / plain color swatch depending on the "Darstellung" setting and per-card toggle.
- [ ] `AND-COL-07` Count badge (`N×`) shows top-left when count > 1.
- [ ] `AND-COL-08` Photo/bottle toggle button (📷/◎, top-right, ≥48dp touch target) switches the card's own view without affecting other cards.
- [ ] `AND-COL-09` "Unsupported provider" badge (🚫) shows instead of a photo when the photo can't be resolved for the current sync provider (e.g. Google Drive).
- [ ] `AND-COL-10` Card name/brand/finish label render correctly, name truncates at 1 line; a polish with several finish tags (#192/#197/#214) shows all of them comma-joined on the finish label.
- [ ] `AND-COL-11` Tapping a card opens the edit sheet pre-filled with its data.
- [ ] `AND-COL-12` Edit sheet "Löschen" (only shown when editing, not for new) deletes the polish and closes the sheet.
- [ ] `AND-COL-13` Form: Name required — Save disabled until non-blank.
- [ ] `AND-COL-14` Form: Marke, Nummer free text.
- [ ] `AND-COL-15` Form: Photo picker (see AND-PHOTO-*).
- [ ] `AND-COL-16` Form: AI Auto-Fill checkbox appears only for new polishes when AI is enabled + server-sync configured; disables color/finish inputs when checked.
- [ ] `AND-COL-17` Form: color hex field with live color-preview swatch and inline validation (invalid hex shows an error state).
- [ ] `AND-COL-18` Form: "📷 Farbe aus Foto" opens the color-from-photo dialog (hidden while Auto-Fill is checked).
- [ ] `AND-COL-19` Form: Finish is a multi-select chip row (#192/#197/#214, mirrors `PolishFormModal.tsx` on web) — several finishes can be selected at once; the last remaining selected chip cannot be toggled off; disabled while Auto-Fill is checked.
- [ ] `AND-COL-20` Form: Status filter-chip row.
- [ ] `AND-COL-21` Form: 1–5 star rating, tap-to-toggle-off-when-equal behavior; each star sits in its own 48dp touch target (#224).
- [ ] `AND-COL-22` Form: category chips (multi-select), section hidden when no categories exist.
- [ ] `AND-COL-23` Form: Notizen multi-line field.
- [ ] `AND-COL-24` Form "Abbrechen"/"Speichern" behave as expected; Save persists and triggers Auto-Fill job if checked.
- [ ] `AND-COL-25` (Gap check — see Platform parity) confirm whether Finish/Category/Sort filters are reachable anywhere in the Collection UI, since the ViewModel (`setFinish`/`setCategory`/`setSort`) exposes them but no chip/dropdown currently calls them from `CollectionScreen`.

## Android — Color-from-photo dialog (`ColorFromPhotoDialog.kt`)

- [ ] `AND-CFP-01` "Foto auswählen" launches the system photo picker.
- [ ] `AND-CFP-02` Selected photo displays at its native aspect ratio (letterbox-free).
- [ ] `AND-CFP-03` Tapping the image samples that pixel's color and shows swatch + hex.
- [ ] `AND-CFP-04` Dragging across the image live-updates the sampled color.
- [ ] `AND-CFP-05` "Übernehmen" applies the color to the calling form field and closes the dialog.
- [ ] `AND-CFP-06` Close (✕) icon dismisses without applying.

## Android — Photo picker field (`PhotoPickerField` in `CommonUi.kt`, used in Collection/Wishlist/Diary/Stickers forms)

- [ ] `AND-PHOTO-01` "Foto auswählen" launches the Android Photo Picker (no runtime permission prompt).
- [ ] `AND-PHOTO-02` Picking an image imports (downsamples/compresses) it locally and previews it immediately, before any upload/sync happens.
- [ ] `AND-PHOTO-03` A photo synced from another device but not yet downloaded locally still previews correctly via the remote-resolution path.
- [ ] `AND-PHOTO-04` The small ✕ badge (top-right of the thumbnail) removes the selected photo; the visible circle stays 4dp off the corner but its actual tap target is the full 48dp (#224), extending inward over the photo.

## Android — Wishlist screen (`WishlistScreen.kt` / `WishlistViewModel.kt`)

- [ ] `AND-WISH-01` FAB (+) opens a new-polish sheet pre-set to status Wish.
- [ ] `AND-WISH-02` Smart-Cart card is shown only when AI is available (enabled + server-sync); prompt field + "✨ Vorschläge finden" button (disabled until non-blank).
- [ ] `AND-WISH-03` Running Smart-Cart disables the field and shows "KI recherchiert…" on the button.
- [ ] `AND-WISH-04` Smart-Cart success message ("✨ N zur Wunschliste hinzugefügt" or "keine passenden… gefunden") shown, and the collection refreshes via a forced sync.
- [ ] `AND-WISH-05` Smart-Cart error shows an inline error message in the card.
- [ ] `AND-WISH-06` Prompt clears automatically once a Smart-Cart run completes successfully.
- [ ] `AND-WISH-07` Count text ("N auf der Wunschliste") updates.
- [ ] `AND-WISH-08` Empty state ("Noch nichts auf der Wunschliste…") / loading / grid states render correctly.
- [ ] `AND-WISH-09` Grid only shows polishes with status = Wish (via `wishlistPolishes`).
- [ ] `AND-WISH-10` Tapping a card opens a read-only detail sheet (photo/bottle, name, brand, number, finish row listing every finish tag with its icon (#192/#197/#214), notes).
- [ ] `AND-WISH-11` Detail sheet "Bearbeiten" opens the edit form.
- [ ] `AND-WISH-12` Detail sheet "Gekauft ✓" moves the item to status Ok (into the main collection) and closes the sheet.
- [ ] `AND-WISH-13` Detail sheet "Schließen" dismisses without changes.

## Android — Diary screen (`DiaryScreen.kt` / `DiaryViewModel.kt`)

- [ ] `AND-DIARY-01` FAB (+) opens a blank entry sheet defaulted to today.
- [ ] `AND-DIARY-02` Entry count text updates.
- [ ] `AND-DIARY-03` Empty/loading/list states render correctly.
- [ ] `AND-DIARY-04` Each list row shows: formatted date (headline), notes or a fallback of polish+sticker names (supporting text), and a leading visual — photo thumbnail, "unsupported provider" badge, or up to 4 polish-color dots.
- [ ] `AND-DIARY-05` Tapping a row opens the edit sheet with existing data.
- [ ] `AND-DIARY-06` Form: date field opens a `DatePickerDialog`; OK commits the selected date, Cancel/dismiss leaves it unchanged.
- [ ] `AND-DIARY-07` Form: 4 independent photo slots (Finger rechts/links, Daumen rechts/links) in a flow-row, each with its own picker.
- [ ] `AND-DIARY-08` Form: "Lacke" chip multi-select over all polishes.
- [ ] `AND-DIARY-09` Form: "Sticker" chip multi-select, hidden when no stickers exist.
- [ ] `AND-DIARY-10` Form: Notizen multi-line field.
- [ ] `AND-DIARY-11` Form "Löschen" (edit mode only) deletes the entry; "Abbrechen"/"Speichern" behave as expected.
- [ ] `AND-DIARY-12` Editing a legacy entry (stickers stored as id/name strings, no `stickerRefs`) still resolves the correct sticker chips as selected.
- [ ] `AND-DIARY-13` Entries reference polishes by `PolishRef` id (#219), not by name/brand string — two distinct owned polishes that happen to share a name each resolve to their own correct chip in the "Lacke" picker instead of collapsing onto one.

## Android — Stickers screen (`StickersScreen.kt` / `StickersViewModel.kt`)

- [ ] `AND-STK-01` FAB (+) opens a blank new-sticker sheet.
- [ ] `AND-STK-02` Search bar filters the list live.
- [ ] `AND-STK-03` Count text ("N Sticker") updates.
- [ ] `AND-STK-04` Empty/loading/list states render correctly.
- [ ] `AND-STK-05` Row shows photo thumbnail / unsupported-provider badge / up to 3 color dots as leading content, name + "brand · type" as supporting text, star rating as trailing content when rated.
- [ ] `AND-STK-06` Tapping a row opens the edit sheet.
- [ ] `AND-STK-07` Form: Name required (Save disabled when blank).
- [ ] `AND-STK-08` Form: Marke, Stil free text.
- [ ] `AND-STK-09` Form: Photo picker.
- [ ] `AND-STK-10` Form: Typ chip row (`STICKER_TYPE_OPTIONS`).
- [ ] `AND-STK-11` Form: Status chip row.
- [ ] `AND-STK-12` Form: 1–5 star rating.
- [ ] `AND-STK-13` Form: Notizen field.
- [ ] `AND-STK-14` Form "Löschen"/"Abbrechen"/"Speichern" behave as expected.

## Android — Stats screen (`StatsScreen.kt`, read-only)

- [ ] `AND-STATS-01` KPI cards show correct counts: Lacke, Sticker, Maniküren.
- [ ] `AND-STATS-02` "Farbpalette" shows one dot per active polish, sorted by hue.
- [ ] `AND-STATS-03` "Nach Finish" bars show only finishes present, correct proportional widths/counts; a polish with several finish tags (#192/#197/#214) is counted once per tag, so the bars can legitimately sum past 100% of the polish count — not a bug (matches `WEB-STATS-03`).
- [ ] `AND-STATS-04` "Nach Status" bars cover all active polishes.
- [ ] `AND-STATS-05` "Top-Marken" shows up to 8 brands by count, descending, "Unbekannt" fallback.
- [ ] `AND-STATS-06` "Bestbewertet" (shown only if any rated polish exists) lists up to 5 top-rated polishes with swatch/name/brand/stars.
- [ ] `AND-STATS-07` Sections needing data (Finish/Status/Brand/Top-rated) are hidden entirely when there are zero active polishes, rather than shown empty.

## Android — Settings screen (`SettingsScreen.kt` / `SettingsViewModel.kt`) — Sammlung & Darstellung

- [ ] `AND-SET-01` Stat cards show live counts: Lacke, Sticker, Maniküren.
- [ ] `AND-SET-02` "Lack-Ansicht" chips (◎ Flasche / ⬤ Farb-Swatch) set the app-wide default for polishes without a photo.
- [ ] `AND-SET-03` "KI-Funktionen" chips (✨ An / Aus) are the master AI switch; turning it off hides Auto-Fill, Smart-Cart, and the whole KI-Assistenz section app-wide.

## Android — Settings — Synchronisation

- [ ] `AND-SET-04` Sync-error card shows when `syncError` is set.
- [ ] `AND-SET-05` HTTP (non-HTTPS) warning card shows when the configured server URL isn't HTTPS — the app permits cleartext traffic globally (`network_security_config.xml`, since a self-hosted server URL is often a bare LAN IP with no TLS in front) but flags it (#221).
- [ ] `AND-SET-06` "Letzter Sync" timestamp shown after a successful sync.
- [ ] `AND-SET-07` Provider chip row: Eigener Server / Nextcloud / Google Drive / OneDrive / Dropbox.
- [ ] `AND-SET-08` "Eigener Server": URL + JWT-token fields; "Login"/"Registrieren" buttons open the login/register dialog; "Speichern" persists URL+token directly (for pasting an existing token without going through the dialog).
- [ ] `AND-SET-09` Login/Register dialog: username+password fields, inline error on failure, disabled confirm until both fields are non-blank, loading state while in flight; success populates the token field and saves the server config automatically. Has no two-step/2FA code-entry state at all — logging into an account with TOTP 2FA enabled (#174/#215) simply fails here, since `/api/auth/login`'s `{ mfaRequired, challengeToken }` response isn't handled (known limitation, #227; see web's `WEB-SET-53`/`62`..`65` for the flow Android is missing).
- [ ] `AND-SET-10` "Nextcloud": URL/Benutzername/Passwort fields; "Speichern" persists the config.
- [ ] `AND-SET-11` Google Drive / OneDrive / Dropbox: informational text + a disabled "Mit … anmelden (in Kürze)" button — confirm these remain visibly disabled/non-functional (OAuth client IDs are placeholders in `OAuthHelper.kt`), i.e. this is intentionally not-yet-implemented, not a bug.
- [ ] `AND-SET-12` "Jetzt syncen" button (shown once a provider is configured) triggers a manual sync, shows a spinner + "Synchronisiere…" while running, disabled during sync.
- [ ] `AND-SET-13` "Verbindung trennen" clears the sync config (back to local-only).
- [ ] `AND-SET-34` Saving an "Eigener Server" URL that starts with `http://` (case/whitespace-insensitive) shows an "Unverschlüsselte Verbindung" confirmation dialog explaining that the password and collection would transfer in the clear, restricted to a trusted home network; "Trotzdem speichern" proceeds, "Abbrechen" cancels without saving (#221).

## Android — Settings — Berichte (reports)

- [ ] `AND-SET-14` Period chips: Wochenübersicht / Monatsübersicht.
- [ ] `AND-SET-15` Date field opens a `DatePickerDialog` for choosing the report's reference date.
- [ ] `AND-SET-16` "📄 Bericht erstellen" generates the report HTML and opens it full-screen in an in-app WebView preview (JS disabled) with a close (✕) button.
- [ ] `AND-SET-17` E-mail send sub-section only shown when provider = Eigener Server.
- [ ] `AND-SET-18` SMTP-not-configured warning card shown/hidden correctly, and gates the send button.
- [ ] `AND-SET-19` "✉ Jetzt per E-Mail senden" sends the report; shows "Sende…" → "✓ Bericht gesendet!" or "Senden fehlgeschlagen".
- [ ] `AND-SET-20` Schedule An/Aus chips reveal Häufigkeit (Wöchentlich/Monatlich) + Senden-an fields when on.
- [ ] `AND-SET-21` "Zeitplan speichern" persists the schedule; gated on SMTP being configured; shows saving/saved/error states.
- [ ] `AND-SET-22` Existing schedule loads and pre-fills the fields on screen open.

## Android — Settings — KI-Assistenz

- [ ] `AND-SET-23` Section hidden entirely when the master AI toggle is off, or when the account's role resolves to `user` (#243/#244 — `POST /api/ai/settings` is admin-only since #173, so a plain user would only hit a dead-end 403 on save); a `null` role (offline, or a server predating the role concept) keeps the section visible rather than hiding it, mirroring the web app's `role === null` fallback.
- [ ] `AND-SET-24` Shows a hint instead of the form when provider ≠ Eigener Server.
- [ ] `AND-SET-25` Anbieter chips: OpenRouter / Gemini, each revealing its own fields (API key masked, "(bereits gesetzt)" label when already configured; model text field; OpenRouter also has a "Nur kostenlose Modelle" toggle).
- [ ] `AND-SET-26` Web-Recherche backend chip row: DuckDuckGo / SearXNG / Brave / Aus.
- [ ] `AND-SET-27` SearXNG selection reveals the SearXNG-Adresse field; Brave selection reveals the masked Brave API-key field.
- [ ] `AND-SET-28` "Speichern" persists AI settings, clears the plaintext key fields on success (switching to "already set" labels), shows saving/saved/error states.

## Android — Settings — Daten (import/export)

- [ ] `AND-SET-29` Import/export status message card (success/error) with a ✕ close button.
- [ ] `AND-SET-30` "Export ZIP" opens the system "create document" picker, then writes `data.json` + `photos/` into the chosen `.zip`; shows "Exportiere…" while running; success message includes counts, or a photos-skipped warning.
- [ ] `AND-SET-31` "Import" opens the system document picker (zip/octet-stream), merges the picked archive's data with the current collection (newest-wins), re-imports photos where possible; success message includes counts, or a photos-failed warning when some photo imports fail (e.g. sync not configured).
- [ ] `AND-SET-32` Importing an invalid/corrupt zip shows a failure message instead of crashing.
- [ ] `AND-SET-33` Helper text clarifies that import merges rather than overwrites/deletes anything.

---

## Platform parity

Features present on one platform but not (yet) reachable on the other — useful both as QA scope
boundaries and as a backlog of intentional/unintentional gaps:

- **Web-only:**
  - Category management UI (add/delete custom categories) — `WEB-SET-13`..`15`. Android's
    repository layer supports `addCategory`/`deleteCategory` (`NagellackeRepository.kt`), but no
    Android screen currently exposes it — categories can only be created on web (and will then
    sync to Android, where they're usable as filter/chip options but not manageable).
  - Collection page's Finish / Kategorie / Sortieren-nach dropdowns (`WEB-COL-03/05/06`) — Android's
    `CollectionViewModel` has equivalent `setFinish`/`setCategory`/`setSort` methods, but
    `CollectionScreen.kt` only wires up search + status chips, so finish/category/sort filtering
    is not reachable in the Android UI today (see `AND-COL-25`).
  - Admin panel (`AdminPage.tsx` — user management, server settings, server-wide AI config,
    update check/apply, API-key rotation, audit log) — `WEB-ADM-01`..`15`, plus the legacy
    per-account API-key/update section it superseded, `WEB-SET-48`..`51`/`66`..`68`. No Android
    equivalent at all; this is a server-operator feature tied to the self-hosted deploy, not
    meant for the phone app — an admin has to use the web app for user/server management even
    when everything else is done on Android.
  - Two-Factor-Authentication (TOTP, #174/#215) — `WEB-SET-52`..`65`. Android has **no** 2FA
    login UI whatsoever (#227): setup/enable/disable/recovery-codes and the two-step login
    challenge all only exist on web. An account with 2FA enabled from the web app cannot log in
    on Android at all until this gap is closed (`AND-SET-09`) — treat this as a known limitation
    to confirm during QA, not investigate as a new bug.
  - Registration is reachable from the web app only indirectly (no "Registrieren" button — a user
    must be bootstrapped or `ALLOW_REGISTRATION=true`); the web Settings login form has no sign-up
    option at all, whereas Android does (see below), even though both hit the same
    `/api/auth/register` endpoint gated by the same server-side rule.

- **Android-only:**
  - "Registrieren" button in the server-login dialog (`AND-SET-09`) — web's `SettingsPage` only
    offers "Anmelden" (login), no sign-up UI.
  - OAuth2 sign-in buttons for Google Drive/OneDrive/Dropbox are present as UI (`AND-SET-11`) but
    intentionally disabled/non-functional (placeholder client IDs) — worth a QA note that this is
    expected, not a defect, unless client IDs have since been filled in.
  - Report preview renders via an in-app WebView dialog (`AND-SET-16`) instead of opening a new
    browser tab (web's `WEB-SET-30`) — same generated HTML, different presentation shell.
  - HTTP/non-HTTPS server-URL warning banner and its save-time confirmation dialog (`AND-SET-05`,
    `AND-SET-34`) has no web equivalent — the web app has no client-side cleartext gate at all.

- **Present on both, worth cross-checking for behavioral drift:** Smart-Cart trace/step display
  differs — web shows an expandable "KI-Recherche anzeigen" panel with per-round query lists
  (`WEB-CART-16`); Android's Wishlist screen shows only the final status/result, no per-round
  trace UI. Not a bug per se, but a UX asymmetry worth confirming is intentional.

- **Server-backed, not exposed in either app's UI (out of scope for this checklist but worth
  knowing about):** `/api/logs` (admin log viewer) is API-key gated and has no UI on web or
  Android — only reachable via direct API call (e.g. curl). Password-reset / forgot-password flow
  does not appear to exist anywhere (web or Android) — only login/register. `POST /api/sync` and
  `POST /api/sync/push` reject a structurally invalid `data` payload with `400` (#217, checked via
  `isValidAppData`) rather than merging garbage — there's no dedicated UI for this since it
  surfaces through the same generic sync-error banner both apps already show (`WEB-SET-02`,
  `AND-SET-04`) whenever a sync round-trip fails for any reason.
