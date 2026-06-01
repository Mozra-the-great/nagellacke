# Nail Lacquer Kollektion

Persönliche Nagellack-Verwaltung als Self-hosted Web-App — läuft auf einem eigenen Server im Heimnetz, keine Cloud, keine Accounts.

![Version](https://img.shields.io/badge/version-2.1.9-pink) ![Stack](https://img.shields.io/badge/stack-React%20%2B%20Node.js-blueviolet) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Versionen

| Version | Status | Beschreibung |
|---------|--------|-------------|
| **v2** (aktuell) | ✅ Stabil | Self-hosted Web-App, kein Sync |
| **v3** (in Entwicklung) | 🚧 Beta | + Sync-Server für Android-App, per Knopfdruck aus v2 installierbar |

**Upgrade v2 → v3:** Einstellungen → „Updates prüfen" → Button **„Upgrade auf v3 (mit Sync)"** erscheint nach dem Update. Alle Daten und Fotos werden automatisch übernommen.

---

## Features

- **Kollektion verwalten** — Lacke anlegen, bearbeiten, löschen mit Name, Marke, Nummer, Farbe, Finish und Status
- **15 Finish-Typen** — Classic, Shimmer, Glitter, Metallic, Chrome, Matte, Satin, Duochrome, Holographic, Jelly, Neon, Magnetic, Gel Look, Top Coat, Base Coat
- **4 Status-Werte** — Vorhanden, Wunschliste, Leer, Nicht mehr da
- **Eigene Kategorien** — direkt im Bearbeitungsformular anlegen und löschen
- **Notizen** — freies Textfeld pro Lack (Kaufdatum, Bewertung, …)
- **Suche & Filter** — nach Name, Marke, Nummer, Finish, Kategorie, Status, Notizen
- **Sortierung** — nach Eingabereihenfolge, Name, Marke oder Farbton
- **Stapelaktionen** — mehrere Lacke gleichzeitig auswählen, Status setzen oder löschen
- **Undo** — Löschungen 5 Sekunden rückgängig machen
- **Statistiken** — Übersicht nach Marken, Finish, Status, Kategorien und Farbpalette
- **Foto-Farbpicker** — Kamera oder Galerie öffnen, auf die Farbe tippen → wird direkt übernommen
- **Export / Import** — vollständiges Backup als JSON inkl. aller Fotos (base64-eingebettet)
- **Automatische Updates** — GitHub-Check und Update per Knopfdruck direkt in der App
- **System-Logs** — journalctl-Ausgabe live in der App abrufbar
- **API-Schlüssel-Schutz** — alle Schreiboperationen erfordern einen Schlüssel
- **6 Themes** — Dark Luxury, Candy Pop, Warm Vintage, Neon Nightclub, Clean White, Forest Dark
- **Sternebewertung** — 1–5 Sterne pro Lack, sortierbar, Top-Bewertet-Liste in Statistik
- **Timestamps** — `createdAt`/`updatedAt`; Sortierung „Neueste/Älteste zuerst"
- **PWA** — installierbar als App (manifest.json + Service Worker)
- **Flaschenfoto** — pro Lack ein Foto hochladen; zwischen SVG-Grafik und echtem Foto umschalten
- **Maniküre-Tagebuch** — Einträge mit Datum, Lacken, Notizen und Foto
- **Nail-Sticker-Inventar** — Sticker mit Typ, Farben, Status, Bewertung und Foto

---

## Installation (ein Befehl)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)
```

Benötigt **Debian/Ubuntu**. Installiert automatisch Node.js 20.

Nach der Installation erreichbar unter **http://SERVER-IP:3000**

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
cat /opt/nagellacke/backend/data/.api_key
```

---

## Update einspielen

**Variante A — In der App:** Footer → „Updates prüfen" → „Jetzt updaten"

**Variante B — Manuell:**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)
```

Daten bleiben dabei **immer erhalten**.

---

## Upgrade auf v3 (mit Sync-Server)

v3 ersetzt v2 auf dem gleichen Port (3000) und bringt einen **Sync-Server** für die Android-App mit.

**Per Knopfdruck aus v2:**
1. v2 auf dem neuesten Stand bringen (Update-Knopf)
2. Footer → **„Upgrade auf v3 (mit Sync)"** klicken
3. Warten (~3 Min.) — die App startet automatisch neu
4. Daten und Fotos werden automatisch übernommen, API-Schlüssel bleibt gleich

**Manuell auf dem Server:**
```bash
sudo bash /opt/nagellacke/v3/server/install.sh
```

**Nach dem Upgrade — Sync-Account anlegen (einmalig):**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"ich","password":"meinPasswort"}'
```
Den zurückgegebenen Token in der Android-App unter Einstellungen → Sync eintragen.

---

## Datenspeicherung

**v2:**
```
/opt/nagellacke/backend/data/data.json    ← Kollektion
/opt/nagellacke/backend/data/.api_key     ← API-Schlüssel
/opt/nagellacke/backend/data/photos/      ← Fotos
```

**v3 (nach Upgrade):**
```
/opt/nagellacke/v3/server/data/data.json  ← Kollektion (von v2 migriert)
/opt/nagellacke/v3/server/data/.api_key   ← API-Schlüssel (von v2 übernommen)
/opt/nagellacke/v3/server/data/photos/    ← Fotos (von v2 kopiert)
```

Backup erstellen:
```bash
# v2
cp /opt/nagellacke/backend/data/data.json ~/backup-$(date +%F).json

# v3
cp /opt/nagellacke/v3/server/data/data.json ~/backup-$(date +%F).json
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
```

Frontend läuft auf **http://localhost:5173**, API-Aufrufe werden automatisch an `:3000` (v2) bzw. `:3001` (v3 dev) weitergeleitet.

---

## Repo-Struktur

```
nagellacke/
├── backend/          ← v2 Node.js/Express Server
├── frontend/         ← v2 React/Vite Frontend (auch von v3 ausgeliefert)
├── install.sh        ← v2 Installer
└── v3/               ← v3 (Sync-Server + Android-App)
    ├── packages/core/     Typen, Business-Logik, Merge-Algorithmus
    ├── packages/sync/     Sync-Adapter (Server, GDrive, OneDrive, Nextcloud, Dropbox)
    ├── server/            Fastify-Server (ersetzt v2 nach Upgrade)
    ├── apps/web/          v3 Web-App (React, noch in Entwicklung)
    └── apps/android/      Expo React Native Android-App
```

---

## Technik

| Schicht | v2 | v3 |
|--------|----|----|
| Frontend | React 18 + Vite | React 18 + Vite (identisch) |
| Backend | Express | Fastify |
| Speicher | JSON-Datei | JSON-Datei |
| Auth | API-Key | API-Key (Web) + JWT (Sync) |
| Sync | — | Server / GDrive / OneDrive / Nextcloud / Dropbox |
| Mobile | PWA | Expo React Native (Play Store) |
| Deployment | systemd | systemd |

Vollständige Architektur-Dokumentation: [ARCHITECTURE.md](ARCHITECTURE.md)
