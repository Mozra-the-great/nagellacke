# Changelog

Alle nennenswerten Änderungen werden hier dokumentiert.
Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.0.0/), Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

---

## [Unreleased]

### Hinzugefügt
- **Wochen-/Monatsberichte**: Schöner HTML-Bericht mit Statistiken, neuen Lacken, neuen Stickern und Maniküren. Öffnet in neuem Tab → Als PDF speichern via Strg+P.
- **E-Mail-Versand**: Bericht per SMTP direkt aus den Einstellungen versenden. Konfiguration via `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, optional `SMTP_PORT`, `SMTP_FROM`, `PUBLIC_URL`.
- **Zeitplan**: Wöchentliche (Montag 08:00) oder monatliche (1. des Monats 08:00) automatische E-Mail. Einstellbar unter Einstellungen → Berichte.
- **Neue Server-Endpoints** (alle JWT-geschützt): `GET /api/auth/me`, `PATCH /api/auth/me`, `GET/POST /api/reports/preview`, `POST /api/reports/send`, `GET/POST /api/reports/schedule`

---

## [3.0.4] – 2026-06-17

### Sicherheit
- **Auth-Bypass geschlossen**: `requireApiKey` / `requireJwt` / `requireApiKeyOrJwt` fehlten `return` vor `reply.send()` — Fastify-Lifecycle konnte nach 401 weiterlaufen (K-2)
- **Rate-Limiting repariert**: `request.routerPath` war in Fastify 4 `undefined` → alle Routes teilten ein Bucket (H-1)
- **Foto-Upload: Body-Limit auf 15 MB** angehoben; Fastify-Default (1 MB) hat Handy-Fotos blockiert (H-5)
- **CORS-Warning** beim Start wenn `ALLOWED_ORIGIN` nicht gesetzt; `install.sh` enthält nun Platzhalter mit Hinweis (H-4)

### Behoben
- **React-Hook-Crash**: `useMemo` in NailBottle stand nach Early-Return → "Rendered fewer hooks" beim Foto-Toggle (K-1)
- **Datenverlust**: v2-Maniküreeinträge mit `polishes: string[]` hatten beim Bearbeiten leere Lackauswahl (H-3)
- **Sync-Push**: Fehlgeschlagener Push meldete trotzdem `success: true` (H-2)
- **Orphan-Fotos**: Gelöschte Lacke/Sticker/Maniküren räumen ihre Fotos jetzt serverseitig auf (M-4)
- **hexToHue**: Kurze Hex-Codes (`#fff`), leere Strings und `rgba()`-Werte crashten die Farbsortierung (M-3)
- **SVG-Gradient-IDs**: `Math.random()` erzeugte bei jedem Render neue IDs → Gradients in StrictMode instabil (M-1)
- **git pull --autostash** in `install.sh` verhindert Fehler bei lokalen Änderungen (L-11)
- Korrupte `data.json`/`users.json` werden jetzt geloggt statt still ignoriert (L-12)

### Hinzugefügt
- **Undo-Snackbar**: Löschen von Lacken, Stickern und Tagebucheinträgen ist 3 Sekunden lang rückgängig machbar (K-4)
- **Leere-Zustände**: Kollektion, Sticker, Tagebuch zeigen freundliche Meldung bei 0 Einträgen (H-8)
- **Sync-Fehler-Indikator**: Roter Punkt auf „◈ Mehr"-Button wenn Auto-Sync fehlschlägt (H-9)
- **Such-Clear-Button**: × in Kollektion- und Sticker-Suche (H-10)

### Barrierefreiheit / UX
- Alle drei Modals: `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape-Taste, Focus-Trap (K-5)
- Modal-Schließ-Buttons: `aria-label="Schließen"` (K-6)
- Delete-Buttons auf Touch-Screens sichtbar (`@media hover:none`, Opacity 55 %) (K-3)
- Karten, Tagebucheinträge, Sticker-Items per Tastatur erreichbar (`role="button"`, `tabIndex`, `onKeyDown`) (M-2)
- Nav-Pills auf Mobilgeräten ≥ 44 px Höhe; kein Overflow auf 320-px-Screens (H-6)
- WCAG-AA-Kontrast: `appSubtitle`, `navBtn`, Placeholder, `.count`, `.brand` angehoben (H-7)
- Filter-Selects und Such-Inputs mit `aria-label` (H-10, H-11)
- Stern-Bewertung: `role="group"`, `aria-label`, `aria-pressed` (M-8)
- Nur noch ein `<h1>` pro Seite (App-Titel); Seitentitel auf `<h2>` geändert (M-6)
- Import-Button als echtes `<button>` statt `<label>` (M-11)
- `confirm()` / `alert()` in Settings durch Inline-Dialoge ersetzt (M-5)
- `aria-required` + Hilfstext für Nextcloud-App-Token (M-12)
- `aria-live`-Region für Login-Status in Settings (M-9)
- Focus-visible-Ringe auf Nav-Buttons und Formular-Inputs (L-2, L-3)
- `background-attachment: fixed` entfernt (iOS Safari Repaints) (L-1)
- Alle Schließen-Icons auf `✕` (U+2715) vereinheitlicht (L-10)

---

## [3.0.1] – 2026-06-03

### Geändert
- Interne Version auf 3.0.1 angehoben; Update-Check-Testrelease zur Verifikation der Update-Pipeline

---

## [3.0.0] – 2026-06-03

### Hinzugefügt
- **Native Android-App** (Expo React Native ~51, React Native 0.74, Expo Router, Material Design 3)
- Fünf Tabs: Lacke, Sticker, Tagebuch, Statistik, Mehr
- Play-Store-Build via EAS (Package-ID `de.nagellacke.app`)
- Datenpersistenz: `expo-file-system`; Sync-Config: `expo-secure-store` (verschlüsselt)
- Primärfarbe Pink (`#c2185b`), Light + Dark Mode
- Android-Permissions: Kamera, Storage, Internet

---

## [2.2.9] – 2026-06-02

### Behoben
- JWT-Auth für alle Admin-Endpunkte (`/api/update/check`, `/api/update/apply`, `/api/logs`) einheitlich durchgesetzt
- Update-Check im v3-Server: 10-Sekunden-Timeout verhindert hängende GitHub-API-Anfragen

---

## [2.2.8] – 2026-06-02

### Geändert
- `POST /api/data` akzeptiert jetzt alternativ JWT (Bearer Token) statt nur API-Key — ermöglicht Hybrid-Betrieb für v2-PWA und v3-Clients gleichzeitig

---

## [2.2.7] – 2026-06-02

### Behoben
- Sync-sichere IDs für alle Items: `generateId()` (Timestamp + 5-stelliger Zufallsstring) ersetzt `Date.now()` als alleinigen Identifier
- Backfill beim Laden: Items ohne `id`-Feld erhalten beim Serverstart automatisch eine stabile ID

---

## [2.2.6] – 2026-06-02

### Hinzugefügt
- **SyncPanel** in der v2-Oberfläche: Cloud-Sync direkt in der Web-UI konfigurierbar (Server-URL, Username, Passwort)
- Sync-Endpunkte `/api/auth/register`, `/api/auth/login`, `/api/sync` im v3-Server

### Behoben
- Update-Pipeline deployt jetzt die v3-Web-App (`apps/web/dist`) statt des alten v2-Frontends
- Upgrade-auf-v3-Button wird ausgeblendet, wenn v3 bereits installiert ist

---

## [2.2.5] – 2026-06-02

### Geändert
- Interne Version auf 2.2.5 angehoben; `backend/package.json` und `server.js` synchronisiert

---

## [2.2.4] – 2026-06-02

### Behoben
- v3-Installer: Nginx-Timeout-Problem bei langen Build-Vorgängen behoben; verbessertes Fehler-Feedback
- Service-Worker: Cache-Name-Versioning stellt sicher, dass neue Releases alte Assets ersetzen
- A11Y-Fixes in mehreren Komponenten

---

## [2.2.3] – 2026-06-02

### Behoben
- Service-Worker: Race-Condition beim Cache-Update nach Neustart beseitigt
- Export: Toast-Feedback bei erfolgreichem Export

---

## [2.2.2] – 2026-06-02

### Geändert
- Upgrade-auf-v3-Button direkt ins `UpdatePanel` integriert (kein separates Component mehr nötig)

---

## [2.2.1] – 2026-06-02

### Behoben
- Export: ArrayBuffer-Bug beim base64-Einbetten von Fotos in die JSON-Datei behoben
- V3UpgradePanel wird wieder korrekt gerendert und ist sichtbar

---

## [2.2.0] – 2026-06-02

### Hinzugefügt
- **v3 Sync-Server** als eigenständiges Ziel neben v2 (Fastify + TypeScript, npm-Workspace-Monorepo)
- **Upgrade-Pfad v2 → v3**: automatische Datenmigration (data.json + Fotos + API-Key), kein manueller Eingriff nötig
- Monorepo-Pakete: `@nagellacke/core` (Typen, Logic, Merge-Algorithmus), `@nagellacke/sync` (5 Sync-Adapter)
- Sync-Adapter: Server (JWT), Google Drive, OneDrive, Nextcloud (WebDAV), Dropbox

### Behoben
- Export: alle Fotos werden korrekt base64-eingebettet (ArrayBuffer-Fix)

---

## [2.1.9] – 2026-05-29

### Hinzugefügt
- Statistiken: Sticker-Auswertung (nach Typ, nach Marke)
- Statistiken: Tagebuch-Auswertung (häufigste verwendete Lacke, häufigste verwendete Sticker)
- Aktive View (Nagellack / Sticker / Tagebuch / Stats) wird nach Browser-Refresh wiederhergestellt (`localStorage`)

### Behoben
- Filter-Leiste nur noch in der Nagellack-Ansicht sichtbar, nicht in anderen Tabs
- Bearbeiten von Tagebuch-Einträgen war nicht möglich

---

## [2.1.8] – 2026-05-29

### Geändert
- Tagebuch: **4 Foto-Slots** pro Eintrag (Finger rechts, Finger links, Daumen rechts, Daumen links)
- `photos`-Objekt (`{fingerRight, fingerLeft, thumbRight, thumbLeft}`) ersetzt das alte einzelne `photo`-Feld
- Rückwärtskompatibilität: alte Einträge mit `photo`-Feld werden automatisch migriert

---

## [2.1.7] – 2026-05-29

### Geändert
- **PhotoPicker** (Kamera/Galerie-Dropdown) einheitlich in PolishForm: sowohl Farbpicker-Foto als auch Flaschenfoto nutzen den gleichen Picker

---

## [2.1.6] – 2026-05-29

### Behoben
- Kamera-Input auf Android öffnete sich nicht: Foto-Inputs von `display:none` auf opacity-basiertes Hiding umgestellt (`position:absolute; width:0.1px; opacity:0`)
- `.click()` wird vor `setOpen(false)` aufgerufen — korrekte User-Gesture-Behandlung auf Android erforderlich

---

## [2.1.5] – 2026-05-29

### Hinzugefügt
- Fehler-Feedback (Toast) bei fehlgeschlagenem Foto-Upload

### Geändert
- PhotoPicker (Kamera/Galerie-Dropdown) auch in `StickerPage` und `DiaryPage` einheitlich eingesetzt
- `type="button"` auf alle expliziten Buttons in `StickerFormFields` gesetzt (verhindert unbeabsichtigtes Form-Submit)

### Behoben
- API-Schlüssel-Warnung in Sticker-Formularen fehlte

---

## [2.1.4] – 2026-05-28

### Geändert
- Sticker: Foto wird standardmäßig angezeigt (war vorher ausgeblendet)
- Farb-Editor: „Mehrfarbig"-Option hinzugefügt (Regenbogen-Gradient als visuelles Indikator)
- PolishForm: Foto-Farbpicker auf einen Button reduziert — nativer Android-Chooser öffnet sich

---

## [2.1.3] – 2026-05-28

### Behoben
- Mobile Nav-Overlap: `.header-nav` CSS-Klasse statt Inline-`marginLeft:auto`; Media-Query überschreibt auf Mobilgeräten zu voller Breite und Linksbündigkeit

---

## [2.1.2] – 2026-05-28

### Behoben
- Update-Polling: erkennt Server-Downtime via `downCount`; Fallback-Hard-Reload nach 45 Sekunden (statt lautlosem Hängen)

---

## [2.1.1] – 2026-05-28

### Geändert
- Nav-Label „Nagellack" statt „Kollektion"

### Behoben
- Mobile Nav-Layout (Header-Überlappung)
- Update-Cache-Fix: `localStorage` wird vor dem Update-Apply geleert, damit der SW sofort die neue Version lädt
- Sticker-Auswahl im Tagebuch-Formular funktioniert wieder

---

## [2.1.0] – 2026-05-28

### Hinzugefügt
- **Nail-Sticker-Inventar**: neuer Nav-Tab „Sticker"
- Felder: Name, Marke, Stil (Freitext mit Vorschlägen), Typ (6 Optionen: Full Cover, Akzent, Nail Wrap, 3D, Folie, Slider), Farben (Multi-Color-Editor, bis 10 Farben, Hex + Transparent-Option), Status, Bewertung, Foto, Notizen
- `data.stickers`-Array in `data.json` (automatische Migration älterer Daten)

---

## [2.0.0] – 2026-05-28

### Hinzugefügt
- **Flaschenfoto** pro Lack: Foto hochladen via Kamera oder Galerie; Canvas-Resize auf max. 800×600 px → Base64 → `data/photos/`
- Foto-Toggle auf der Karte: zwischen SVG-Grafik und echtem Foto umschalten (alle 4 Karten-Layouts)
- **Maniküre-Tagebuch**: neue dritte View mit Einträgen (Datum, Lacke aus Kollektion, Notizen, optionales Foto)
- Navigation auf 3 Buttons erweitert (Nagellack / Tagebuch / Statistiken)
- Backend: `POST /api/photos` (Upload) und `DELETE /api/photos/:filename` (Löschen)
- `data.manicures`-Array in `data.json`

---

## [1.9.0] – 2026-05-28

### Hinzugefügt
- **Code-Split**: `App.jsx` aufgeteilt in `themes.js`, `constants.js`, `utils.js` und 5 Komponentendateien
- **Timestamps**: `createdAt`/`updatedAt` pro Lack; neue Sortieroptionen „Neueste zuerst" / „Älteste zuerst"
- **Batch-Erweiterung**: Marke, Finish und Kategorie im Stapel-Modus setzen
- **Import-Merge-Modus**: beim Import wählbar zwischen „Ersetzen" (alles überschreiben) und „Zusammenführen" (bestehende Daten behalten)
- **PWA**: `manifest.json`, Service Worker (Cache-First-Strategie, `/api/` ausgenommen), SVG-Icons (192 + 512 px)

---

## [1.8.0] – 2026-05-27

### Hinzugefügt
- **Tastatur-Shortcuts**: `/` oder `f` für Suche, `n` für Neuer Lack, `Esc` zum Schließen
- **Theme „System"**: folgt automatisch `prefers-color-scheme: dark`
- **Duplikat-Detektor**: warnt beim Anlegen eines neuen Lacks, wenn ein Lack mit ähnlichem Farbton (±15° Hue) und gleichem Finish bereits existiert
- **Update-Check-Cache**: Ergebnis wird 10 Minuten gecacht (verhindert GitHub-Rate-Limit bei häufigem Öffnen der Einstellungen)

### Behoben
- `PolishForm`-Key-Bug: Formular zeigte beim erneuten Öffnen manchmal Werte des vorherigen Lacks

---

## [1.7.3] – 2026-05-27

### Hinzugefügt
- **Accessibility**: `aria-live`, `aria-atomic`, `aria-expanded`, `aria-pressed`, `aria-current`, `aria-label` auf allen interaktiven Elementen; Fokus-Ringe; Landmark-Elemente (`<main>`, `<nav>`, `<header>`); `htmlFor`/`id`-Verbindungen bei Labels

### Behoben
- Kontrast-Fixes in allen 6 Themes (WCAG AA erfüllt)
- Rating-Bug: Sternebewertung wurde beim Öffnen des Bearbeitungsformulars nicht korrekt vorbelegt

---

## [1.7.2] – 2026-05-27

### Hinzugefügt
- **Sternebewertung** (1–5 Sterne) pro Lack; Sortierung nach Bewertung; Top-Bewertet-Liste in den Statistiken
- Farbklick in der Statistik-Farbpalette: springt direkt zum entsprechenden Lack in der Kollektion und selektiert ihn

---

## [1.7.1] – 2026-05-27

### Geändert
- Theme-spezifische **Karten-Layouts**: Flasche (bottle), Blob, Stripe (horizontal, einspaltig), Row (Liste)
- Theme-spezifische **Filter-Layouts**: Pills, Underline, Block-Glow

---

## [1.7.0] – 2026-05-27

### Hinzugefügt
- **Theme-Switcher**: 6 vollständige Designs mit eigenen Fonts, Farb-Tokens, Border-Radii und Shadows
  - Dark Luxury (Standard), Candy Pop, Warm Vintage, Neon Nightclub, Clean White, Forest Dark
- Theme-Auswahl in `localStorage` gespeichert

---

## [1.6.2] – 2026-05-27

### Behoben
- Kamera-Button öffnet auf Mobilgeräten direkt die Rückkamera (`capture="environment"` Attribut)

---

## [1.6.1] – 2026-05-27

### Hinzugefügt
- **Foto-Farbpicker**: Bild mit Kamera aufnehmen oder aus Galerie laden, auf eine Stelle tippen → Farbe wird direkt ins Farbfeld übernommen (Canvas API `getImageData`)

---

## [1.6.0] – 2026-05-27

### Hinzugefügt
- **API-Key-Authentifizierung**: alle Schreiboperationen erfordern `X-Api-Key`-Header
- Automatische Key-Generierung beim ersten Start (`crypto.randomBytes(24)`), Datei-Mode 0o600
- **In-Memory Rate-Limiting** ohne externe Bibliothek: IP-basiert, verschiedene Limits pro Route
- **Magic-Bytes-Validierung** für Foto-Uploads (JPEG/PNG/WebP erkennbar; kein MIME-Type-Spoofing)
- **Atomic Write** für `data.json`: schreibt zuerst in `.tmp`, dann `fs.renameSync` → kein korruptes File bei Absturz

---

## [1.5.0] – 2026-05-27

### Hinzugefügt
- **Eigene Kategorien**: direkt im Bearbeitungsformular anlegen und löschen
- **Notizen**: Freitext-Feld pro Lack (Kaufdatum, Bewertung, Erinnerungen)
- **Stapelaktionen (Batch-Modus)**: mehrere Lacke gleichzeitig auswählen und Status setzen oder löschen
- **Undo**: Löschungen 5 Sekunden lang rückgängig machen
- **Export / Import**: vollständiges Backup als JSON (alle Felder)
- Erweiterte Sortieroptionen

---

## [1.4.0] – 2026-05-27

### Hinzugefügt
- **15 Finish-Typen** mit Icons: Classic, Shimmer, Glitter, Metallic, Chrome, Matte, Satin, Duochrome, Holographic, Jelly, Neon, Magnetic, Gel Look, Top Coat, Base Coat
- **36 Marken-Vorschläge** (Autocomplete im Formular)
- Dynamische Filter nach Finish und Kategorie

---

## [1.3.0] – 2026-05-27

### Hinzugefügt
- **Statistiken-Seite**: Übersicht nach Marken, Finish-Typen, Status, Kategorien und Farbpalette (nach Farbton sortiert)

---

## [1.2.0] – 2026-05-27

### Geändert
- **Multi-Brand-Support**: Marke als eigenes Feld (vorher war alles im Namensfeld)

---

## [1.1.0] – 2026-05-26

### Hinzugefügt
- **System-Log-Viewer**: `journalctl`-Ausgabe live in der App abrufbar (GET `/api/logs`)

---

## [1.0.0] – 2026-05-26

### Hinzugefügt
- Erste Version: Lacke anlegen, bearbeiten, löschen mit Name, Farbe (Hex-Picker) und Status
- Suche nach Name
- **In-App-Update-System**: GitHub-API-Check + `git pull` + `npm run build` + `systemctl restart` per Knopfdruck
- `install.sh`: Einzeilen-Installer für Debian/Ubuntu (Node.js 20, systemd-Service, Port 3000)
- Automatischer Neustart bei Absturz (`Restart=always` in systemd)
