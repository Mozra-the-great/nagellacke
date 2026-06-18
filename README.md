# Nail Lacquer Kollektion

Persönliche Nagellack-Verwaltung als Self-hosted Web-App — läuft auf einem eigenen Server im Heimnetz, keine externe Cloud nötig. Mit optionalem Sync-Server und nativer Android-App.

![Version](https://img.shields.io/badge/version-3.0.4-pink) ![Stack](https://img.shields.io/badge/stack-React%20%2B%20Fastify%20%2B%20Kotlin-blueviolet) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Versionen

| Version | Status | Beschreibung |
|---------|--------|-------------|
| **v2** | 🔄 Legacy | Self-hosted Web-App, kein Sync, kein Active Development |
| **v3** (aktuell) | ✅ Stabil | Fastify-Server, Cloud-Sync, native Android-App |

---

## Features

### Kollektion
- **Lacke verwalten** — Name, Marke, Nummer, Farbe, Finish, Status, Anzahl, Notizen, Sternebewertung
- **15 Finish-Typen** — Classic, Shimmer, Glitter, Metallic, Chrome, Matte, Satin, Duochrome, Holographic, Jelly, Neon, Magnetic, Gel Look, Top Coat, Base Coat
- **4 Status-Werte** — Vorhanden, Wunschliste, Leer, Nicht mehr da
- **Eigene Kategorien** — direkt im Bearbeitungsformular anlegen und löschen
- **Flaschenfoto** — pro Lack ein Foto hochladen; zwischen SVG-Grafik und echtem Foto umschalten
- **Foto-Farbpicker** — Foto öffnen, auf Farbe tippen → Lackfarbe wird direkt übernommen
- **Duplikat-Warnung** — beim Anlegen prüft die App auf ähnlichen Farbton (±15°) + gleiches Finish

### Suche & UI
- **Suche & Filter** — nach Name, Marke, Nummer, Finish, Kategorie, Status, Notizen
- **Sortierung** — nach Eingabereihenfolge, Name, Marke, Farbton oder Bewertung
- **Undo** — Löschungen 3 Sekunden rückgängig machen

### Weitere Bereiche
- **Statistiken** — Übersicht nach Marken, Finish, Status, Kategorien, Farbpalette; Zähler für Sticker und Maniküren
- **Maniküre-Tagebuch** — Einträge mit Datum, Lacken, Stickern, Notizen und 4 Foto-Slots (Finger/Daumen rechts/links)
- **Nail-Sticker-Inventar** — Sticker mit Typ, Farben, Status, Bewertung, Foto und Notizen

### System
- **Export / Import** — vollständiges Backup als JSON inkl. aller Fotos (base64-eingebettet)
- **Automatische Updates** — GitHub-Check und Update per Knopfdruck direkt in der App
- **System-Logs** — journalctl-Ausgabe live in der App abrufbar
- **API-Schlüssel-Schutz** — alle Schreiboperationen erfordern einen Schlüssel

### v3 (Sync + Android)
- **Cloud-Sync** — Synchronisation zwischen Geräten via eigenem Server, Google Drive, OneDrive, Nextcloud oder Dropbox
- **JWT-Authentifizierung** — User-Accounts für Sync, 30-Tage-Token
- **Native Android-App** — Kotlin/Jetpack Compose, Material Design 3, Hilt DI, Room DB
- **Sync-Panel** — Cloud-Sync direkt in der Web-Oberfläche konfigurierbar (Username + Passwort)
- **Darstellungs-Toggle (Android)** — Einstellungen: „Flasche" (SVG-Illustration in Lackfarbe mit Schimmer-Variante) oder „Farb-Swatch"; Photo-Anzeige automatisch in Sticker- und Maniküre-Listen; per-Karte 📷/◎-Button für Lacke

---

## Installation

### v3 (empfohlen)

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)
```

### v2 (Legacy)
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)
```

Benötigt **Debian/Ubuntu** mit Node.js 20+. Nach der Installation erreichbar unter **http://SERVER-IP:3000**

---

## Erster Start — API-Schlüssel einrichten

Beim ersten Start wird ein Schlüssel generiert und in der Konsole angezeigt:

```
┌─────────────────────────────────────────────────────┐
│  API-Schlüssel: a3f8c2d1...                         │
│  (In der App unter Einstellungen ⚙ eingeben)        │
└─────────────────────────────────────────────────────┘
```

Diesen Schlüssel in der App unter dem **⚙-Button** (Footer) eintragen. Er wird im Browser gespeichert.

Schlüssel später abrufen:
```bash
# v2
cat /opt/nagellacke/backend/data/.api_key

# v3
cat /opt/nagellacke/v3/server/data/.api_key
```

---

## Sync-Account anlegen (v3, einmalig)

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"ich","password":"meinPasswort"}'
```

Den zurückgegebenen Token in der Android-App oder im Web unter **Einstellungen → Sync** eintragen.

---

## Update einspielen

**In der App:** Footer → „Updates prüfen" → „Jetzt updaten"

**Manuell:**
```bash
# v2
bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)

# v3
sudo bash /opt/nagellacke/install.sh
```

Daten bleiben dabei **immer erhalten**.

---

## Datenspeicherung

**v2:**
```
/opt/nagellacke/backend/data/data.json    ← Kollektion
/opt/nagellacke/backend/data/.api_key     ← API-Schlüssel
/opt/nagellacke/backend/data/photos/      ← Fotos
```

**v3:**
```
/opt/nagellacke/v3/server/data/data.json    ← Kollektion
/opt/nagellacke/v3/server/data/.api_key     ← API-Schlüssel (v2-kompatibel)
/opt/nagellacke/v3/server/data/.jwt_secret  ← JWT-Signing-Schlüssel
/opt/nagellacke/v3/server/data/users.json   ← Sync-User-Konten
/opt/nagellacke/v3/server/data/photos/      ← Fotos
```

Backup erstellen:
```bash
# v3
cp /opt/nagellacke/v3/server/data/data.json ~/backup-$(date +%F).json

# v2
cp /opt/nagellacke/backend/data/data.json ~/backup-$(date +%F).json
```

Oder direkt in der App: Footer → **↓ Export** (enthält alle Fotos eingebettet)

---

## Nützliche Befehle

```bash
# v2
systemctl status nagellacke
systemctl restart nagellacke
journalctl -u nagellacke -f

# v3
systemctl status nagellacke-v3
systemctl restart nagellacke-v3
journalctl -u nagellacke-v3 -f
```

---

## Lokale Entwicklung

```bash
# v2 (Terminal 1 – Backend)
cd backend && npm install && node server.js

# v2 (Terminal 2 – Frontend)
cd frontend && npm install && npm run dev

# v3 (Terminal 1 – Server)
cd v3 && npm install && npm run build:core && npm run dev:server

# v3 (Terminal 2 – Web-App)
cd v3 && npm run dev:web

# v3 Android-App (Android Studio / Gradle)
cd android && ./gradlew assembleDebug
```

Frontend läuft auf **http://localhost:5173**, API-Aufrufe werden automatisch an `:3000` weitergeleitet.

---

## Repo-Struktur

```
nagellacke/
├── backend/              ← v2 Node.js/Express Server
│   ├── server.js         ← Alle API-Routen, Auth, Rate-Limiting, v3-Upgrade
│   └── data/             ← Daten, Fotos, API-Key (automatisch angelegt)
├── frontend/             ← v2 React/Vite Frontend
│   └── src/
│       ├── App.jsx        ← State, Handler, 4 Views (~1370 Zeilen)
│       ├── themes.js      ← 6 Theme-Definitionen
│       ├── constants.js   ← FINISH_OPTIONS, STATUS_OPTIONS, SORT_OPTIONS, …
│       └── components/    ← PolishForm, StatsPage, DiaryPage, StickerPage, SyncPanel, …
├── android/               ← Native Android-App (Kotlin/Jetpack Compose)
├── install.sh             ← Installer (Debian/Ubuntu, systemd)
└── v3/                    ← v3 Monorepo (npm workspaces)
    ├── packages/
    │   ├── core/          ← Typen, Business-Logik, Merge-Algorithmus (TypeScript)
    │   └── sync/          ← Sync-Adapter: Server, GDrive, OneDrive, Nextcloud, Dropbox
    ├── server/            ← Fastify-Server (ersetzt v2 nach Upgrade)
    │   └── src/
    │       ├── index.ts   ← Alle Routen, JWT-Auth, Rate-Limiting, Update-Pipeline
    │       └── db.ts      ← Datei-Persistenz (data.json, users.json, Fotos)
    ├── apps/
    │   └── web/           ← v3 Web-App (React 18 + TypeScript + Vite)
    └── package.json       ← Monorepo-Root (npm workspaces, Node ≥20)
```

---

## Technik

| Schicht | v2 | v3 |
|--------|----|----|
| Frontend | React 18 + Vite | React 18 + Vite + TypeScript |
| Backend | Express 4 (JS) | Fastify 4 (TypeScript strict) |
| Speicher | JSON-Datei | JSON-Datei |
| Auth | API-Key | API-Key (v2-kompatibel) + JWT 30d (Sync) |
| Passwort-Hash | — | scrypt + Salt + timingSafeEqual |
| Sync | — | Server / GDrive / OneDrive / Nextcloud / Dropbox |
| Mobile | PWA | Expo React Native (Play Store) |
| Deployment | systemd | systemd + EnvironmentFile |
| Monorepo | — | npm workspaces |

Vollständige Architektur-Dokumentation: [ARCHITECTURE.md](ARCHITECTURE.md) · Änderungshistorie: [CHANGELOG.md](CHANGELOG.md)
