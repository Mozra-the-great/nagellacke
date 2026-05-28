# Nail Lacquer Kollektion

Persönliche Nagellack-Verwaltung als Self-hosted Web-App — läuft auf einem eigenen Server im Heimnetz, keine Cloud, keine Accounts.

![Version](https://img.shields.io/badge/version-2.1.5-pink) ![Stack](https://img.shields.io/badge/stack-React%20%2B%20Node.js-blueviolet) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Features

- **Kollektion verwalten** — Lacke anlegen, bearbeiten, löschen mit Name, Marke, Nummer, Farbe, Finish und Status
- **15 Finish-Typen** — Classic, Shimmer, Glitter, Metallic, Chrome, Matte, Satin, Duochrome, Holographic, Jelly, Neon, Magnetic, Gel Look, Top Coat, Base Coat
- **4 Status-Werte** — Vorhanden, Wunschliste, Leer, Nicht mehr da
- **Eigene Kategorien** — direkt im Bearbeitungsformular anlegen und löschen
- **Notizen** — freies Textfeld pro Lack (Kaufdatum, Bewertung, …)
- **Suche & Filter** — nach Name, Marke, Nummer, Finish, Kategorie, Status, Notizen
- **Sortierung** — nach Eingabereihenfolge, Name, Marke oder Farbton
- **Multi-Brand-Filter** — Marken-Schnellfilter bei mehr als einer Marke
- **Stapelaktionen** — mehrere Lacke gleichzeitig auswählen, Status setzen oder löschen
- **Undo** — Löschungen 5 Sekunden rückgängig machen
- **Statistiken** — Übersicht nach Marken, Finish, Status, Kategorien und Farbpalette
- **Foto-Farbpicker** — 📷 Kamera oder 🖼 Galerie öffnen, auf die Farbe tippen → wird direkt übernommen (kein Upload, rein clientseitig)
- **Export / Import** — vollständiges Backup als JSON
- **Automatische Updates** — GitHub-Check und Update per Knopfdruck direkt in der App
- **System-Logs** — journalctl-Ausgabe live in der App abrufbar
- **API-Schlüssel-Schutz** — alle Schreiboperationen erfordern einen Schlüssel
- **6 Themes** — Dark Luxury, Candy Pop, Warm Vintage, Neon Nightclub, Clean White, Forest Dark — jedes mit eigenem Font, Shapes, Farben und Vibe; Auswahl wird im Browser gespeichert
- **Sternebewertung** — 1–5 Sterne pro Lack, sortierbar, filterbar, Top-Bewertet-Liste in Statistik
- **Farbklick in Statistik** — Klick auf Farb-Dot zeigt welcher Lack diese Farbe hat; direkter Sprung zur Kollektion
- **Timestamps** — jeder Lack speichert `createdAt`/`updatedAt`; Sortierung „Neueste/Älteste zuerst"
- **Batch-Marke/Finish/Kategorie** — im Batch-Modus Marke setzen, Finish ändern oder Kategorie zu mehreren Lacken gleichzeitig hinzufügen
- **Import Merge-Modus** — beim Import wählen zwischen Ersetzen (Kollektion überschreiben) oder Zusammenführen (nur neue Lacke hinzufügen, Duplikate überspringen)
- **PWA** — installierbar als App (manifest.json + Service Worker mit Cache-First-Strategie)
- **Flaschenfoto** — pro Lack ein Foto hochladen; Karte zwischen SVG-Grafik und echtem Foto umschalten
- **Maniküre-Tagebuch** — Einträge mit Datum, Lacken aus der Kollektion, Notizen und optionalem Foto; eigene Ansicht neben Kollektion und Statistiken
- **Nail-Sticker-Inventar** — Sticker inventarisieren mit Name, Marke, Stil, Typ (Full Cover, Akzent, Wrap, 3D, Folie, Slider), mehreren Farben inkl. Transparent-Option, Status, Bewertung und Foto; eigener „Sticker"-Tab

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
# oder
journalctl -u nagellacke -n 100 | grep "API-Schlüssel"
```

---

## Update einspielen

**Variante A — In der App:** Einstellungen → „Updates prüfen" → „Jetzt updaten"

**Variante B — Manuell:**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)
```

Daten bleiben dabei **immer erhalten**.

---

## Datenspeicherung

```
/opt/nagellacke/backend/data/data.json    ← Kollektion (Lacke + Kategorien)
/opt/nagellacke/backend/data/.api_key     ← API-Schlüssel (nur root lesbar)
```

Backup erstellen:
```bash
cp /opt/nagellacke/backend/data/data.json ~/backup-$(date +%F).json
```

Oder direkt in der App: Footer → **↓ Export**

---

## Nützliche Befehle

```bash
systemctl status nagellacke        # Dienst-Status
systemctl restart nagellacke       # Neustart
journalctl -u nagellacke -f        # Live-Logs
cat /opt/nagellacke/backend/data/data.json   # Rohdaten
```

---

## Lokale Entwicklung

```bash
# Terminal 1 – Backend
cd backend && npm install && node server.js

# Terminal 2 – Frontend (Hot Reload)
cd frontend && npm install && npm run dev
```

Frontend läuft auf **http://localhost:5173**, API-Aufrufe werden automatisch an `:3000` weitergeleitet (Vite-Proxy).

---

## Technik (Kurzfassung)

| Schicht | Technologie | Begründung |
|--------|------------|------------|
| Frontend | React 18 + Vite | Reaktive UI, schneller Build |
| Backend | Node.js + Express | Minimal, keine Abhängigkeiten |
| Speicher | JSON-Datei | Kein Datenbankserver nötig |
| Deployment | systemd | Autostart + Restart bei Absturz |
| Auth | API-Key (Header) | Einfach, ausreichend für Heimnetz |

Vollständige Architektur-Dokumentation: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Entwicklung

Dieses Projekt wurde vollständig mit Hilfe von KI (Claude von Anthropic) entwickelt. Kein einzige Zeile Code wurde manuell geschrieben — alle Entscheidungen, Anforderungen und Reviews liefen über Konversationen mit dem Modell.

Mehr dazu: [AI_DEVELOPMENT.md](AI_DEVELOPMENT.md)

---

## Lizenz

[MIT](LICENSE) — mach damit was du willst, ich hafte für nichts.
