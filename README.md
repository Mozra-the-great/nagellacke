# Nail Lacquer Kollektion

Persönliche Nagellack-Verwaltung als Self-hosted Web-App — läuft auf einem eigenen Server im Heimnetz, keine externe Cloud nötig. Mit optionalem Cloud-Sync und nativer Android-App.

![Version](https://img.shields.io/badge/version-3.2.0-pink) ![Stack](https://img.shields.io/badge/stack-React%20%2B%20Fastify%20%2B%20Kotlin-blueviolet) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

**→ [Projektseite](https://mozra-the-great.github.io/nagellacke/)** — Überblick über die App, Farben direkt an der Hand ausprobieren, und die [Datenschutzerklärung](https://mozra-the-great.github.io/nagellacke/privacy-policy.html). Statisch aus [`docs/`](docs/) gebaut und über den [Pages-Workflow](.github/workflows/pages.yml) automatisch auf GitHub Pages deployt, sobald sich dort etwas ändert.

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
- **Wunschliste** — eigener Bereich, „Gekauft ✓" setzt den Status zurück auf Vorhanden

### Suche & UI
- **Suche & Filter** — nach Name, Marke, Nummer, Finish, Kategorie, Status, Notizen
- **Sortierung** — nach Eingabereihenfolge, Name, Marke, Farbton oder Bewertung
- **Undo** — Löschungen 3 Sekunden rückgängig machen

### Weitere Bereiche
- **Statistiken** — Übersicht nach Marken, Finish, Status, Kategorien, Farbpalette; Zähler für Sticker und Maniküren
- **Maniküre-Tagebuch** — Einträge mit Datum, Lacken, Stickern, Notizen und 4 Foto-Slots (Finger/Daumen rechts/links)
- **Nail-Sticker-Inventar** — Sticker mit Typ, Farben, Status, Bewertung, Foto und Notizen
- **Berichte** — Wochen-/Monatsberichte als HTML, optional per E-Mail und automatischem Zeitplan (bei aktivem Server-Sync)

### KI-Funktionen (optional, hinter eigenem Schalter)
- **Auto-Fill** — Farbe & Finish für einen neuen Lack per KI ermitteln
- **Smart-Cart** — Vorschläge für die Wunschliste, direkt in den Warenkorb übernehmbar
- **Eigene Websuche** — läuft über den eigenen Server (DuckDuckGo, SearXNG oder Brave), nicht über die kostenpflichtige Suche der KI-Anbieter

### Sync & Mobile
- **Cloud-Sync** — Synchronisation zwischen Geräten via eigenem Server, Google Drive, OneDrive, Nextcloud oder Dropbox
- **JWT-Authentifizierung** — User-Accounts für Sync, 7-Tage-Access-Token mit Refresh-Token (30 Tage); jedes Konto hat seine eigene, private Sammlung
- **Native Android-App** — Kotlin/Jetpack Compose, Material Design 3, Hilt DI, Room DB
- **Sync-Panel** — Cloud-Sync direkt in der Web-Oberfläche konfigurierbar (Username + Passwort)
- **Darstellungs-Toggle (Android)** — Einstellungen: „Flasche" (SVG-Illustration in Lackfarbe mit Schimmer-Variante) oder „Farb-Swatch"; Photo-Anzeige automatisch in Sticker- und Maniküre-Listen; per-Karte 📷/◎-Button für Lacke

### System
- **Export / Import** — vollständiges Backup als JSON (Web) bzw. ZIP (Android) inkl. aller Fotos
- **Automatische Updates** — GitHub-Check und Update per Knopfdruck direkt in der App
- **System-Logs** — journalctl-Ausgabe live in der App abrufbar
- **API-Schlüssel-Schutz** — alle Schreiboperationen erfordern einen Schlüssel

---

## Installation

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)
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

> **⚠️ Dieser Schlüssel ist ein De-facto-Root-Credential, kein normaler API-Key.**
> Er schaltet `/api/update/apply` frei — das zieht ungeprüft den aktuellen `origin/main`,
> installiert Dependencies (inkl. `postinstall`-Skripten) und baut/startet die App neu.
> Wer den Schlüssel hat, kann effektiv beliebigen Code auf dem Server zur Ausführung
> bringen. Genauso vertraulich behandeln wie ein root-Passwort — nicht in Screenshots,
> Chats oder Tickets teilen. (#73)

Schlüssel später abrufen:
```bash
cat /opt/nagellacke/v3/server/data/.api_key
```

### Schlüssel rotieren

Der Schlüssel läuft nicht ab. Er autorisiert `/api/update/apply` — und damit
das Ausführen beliebigen Repo-Codes auf dem Host — deshalb ist ein Leak wie ein
verlorener Shell-Zugang zu behandeln. Nach einem verlorenen Gerät, einem
geteilten Browser oder einfach turnusmäßig rotieren:

```bash
# Variante 1 — im laufenden Betrieb, mit dem aktuellen Schlüssel.
# Antwortet mit dem neuen Schlüssel; der alte ist ab sofort ungültig.
curl -X POST http://localhost:3000/api/admin/api-key/rotate \
  -H "X-Api-Key: $ALTER_SCHLUESSEL"

# Variante 2 — ohne den aktuellen Schlüssel (z. B. wenn er verloren ist).
# Erfordert Shell-Zugriff; der neue Schlüssel steht beim Start in der Konsole.
rm /opt/nagellacke/v3/server/data/.api_key
systemctl restart nagellacke-v3
journalctl -u nagellacke-v3 -n 20
```

Danach den neuen Schlüssel in der App unter **⚙ → Einstellungen** eintragen.
Ist der Schlüssel älter als 180 Tage, weist der Server beim Start darauf hin.

---

## Sync-Account anlegen (einmalig)

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
sudo bash /opt/nagellacke/install.sh
```

Daten bleiben dabei **immer erhalten**.

---

## Datenspeicherung

```
/opt/nagellacke/v3/server/data/users/<user>/data.json  ← Kollektion (pro Benutzer)
/opt/nagellacke/v3/server/data/.api_key       ← API-Schlüssel
/opt/nagellacke/v3/server/data/.jwt_secret    ← JWT-Signing-Schlüssel
/opt/nagellacke/v3/server/data/users.json     ← Sync-User-Konten
/opt/nagellacke/v3/server/data/photos/        ← Fotos
/opt/nagellacke/v3/server/data/ai_config.json ← KI-Provider/Schlüssel (mode 0600, optional)
/opt/nagellacke/v3/server/data/schedule.json  ← Berichts-Zeitplan (optional)
```

Backup erstellen:
```bash
# pro Benutzer — oder gleich das ganze data/-Verzeichnis sichern
cp -r /opt/nagellacke/v3/server/data/users ~/backup-$(date +%F)/
```

Oder direkt in der App: Footer → **↓ Export** (enthält alle Fotos eingebettet)

---

## Nützliche Befehle

```bash
systemctl status nagellacke-v3
systemctl restart nagellacke-v3
journalctl -u nagellacke-v3 -f
```

---

## Lokale Entwicklung

```bash
# Terminal 1 – Server
cd v3 && npm install && npm run build:core && npm run dev:server

# Terminal 2 – Web-App
cd v3 && npm run dev:web

# Android-App (Android Studio / Gradle)
cd android && ./gradlew assembleDebug
```

Frontend läuft auf **http://localhost:5173**, API-Aufrufe werden automatisch an `:3000` weitergeleitet.

---

## Repo-Struktur

```
nagellacke/
├── android/               ← Native Android-App (Kotlin/Jetpack Compose, Hilt, Room)
├── docs/                  ← Projektseite auf GitHub Pages (statisch, keine Abhängigkeiten)
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

---

## Technik

| Schicht | Technologie |
|--------|-------------|
| Frontend | React 18 + Vite + TypeScript |
| Backend | Fastify 4 (TypeScript strict) |
| Speicher | JSON-Datei |
| Auth | API-Key (Admin) + JWT 7d/30d (Sync) |
| Passwort-Hash | scrypt + Salt + timingSafeEqual |
| Sync | Server / GDrive / OneDrive / Nextcloud / Dropbox |
| Mobile | Native Android (Kotlin, Jetpack Compose, Hilt, Room) — Play Store |
| Deployment | systemd + EnvironmentFile |
| Monorepo | npm workspaces |
| Projektseite | Statisches HTML unter `docs/`, GitHub Pages via Actions-Workflow |

Vollständige Architektur-Dokumentation: [ARCHITECTURE.md](ARCHITECTURE.md) · Änderungshistorie: [CHANGELOG.md](CHANGELOG.md)
