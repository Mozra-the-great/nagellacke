# KI-gestützte Entwicklung

Dieses Projekt wurde vollständig mit Hilfe von **Claude** (Sprachmodell von Anthropic) entwickelt. Der Entwickler (Moritz) hat **keine einzige Zeile Code selbst geschrieben** — alle Implementierungen, Refactorings und Sicherheits-Fixes entstanden in Konversationen mit dem Modell.

---

## Was bedeutet „vollständig KI-entwickelt"?

In diesem Projekt gab es eine klare Rollenverteilung:

**Moritz (Mensch):**
- Idee und Vision für das Produkt
- Anforderungen formulieren ("ich will, dass man Kategorien direkt im Formular anlegen kann")
- Design-Entscheidungen treffen ("der Button soll größer und prominenter sein")
- Feedback geben ("das gefällt mir nicht", "mach weiter", "was würdest du noch vorschlagen?")
- Entscheiden, welche Vorschläge umgesetzt werden
- Testen und beurteilen

**Claude (KI):**
- Gesamten Quellcode schreiben — Frontend (React/JSX), Backend (Node.js/Express), Deployment-Skript
- Architektur entwerfen und begründen
- Bugs identifizieren und beheben
- Sicherheitsprobleme erkennen und schließen
- Code-Qualität beurteilen
- Neue Features vorschlagen und ausarbeiten
- Dokumentation verfassen (inkl. dieser Datei)
- Git-Commits erstellen, Tags setzen, pushen

---

## Verwendetes Tool

**Claude Code** — das offizielle CLI-Tool von Anthropic für Claude. Es läuft direkt im Terminal bzw. als VS Code Extension und hat Zugriff auf das lokale Dateisystem, kann Dateien lesen und schreiben, Git-Befehle ausführen und Shell-Kommandos starten.

Modell: `claude-sonnet-4-6` (Anthropic, 2025)

---

## Wie sah die Entwicklung konkret aus?

Die gesamte App entstand in mehreren Konversationssitzungen. Jede Sitzung baute auf der vorherigen auf. Zwischen den Sitzungen hatte das Modell Zugriff auf eine komprimierte Zusammenfassung der bisherigen Arbeit.

### Typischer Ablauf einer Sitzung

1. Moritz beschreibt eine Anforderung in natürlicher Sprache (auf Deutsch)
2. Claude liest den aktuellen Code, um Kontext zu verstehen
3. Claude schlägt eine Umsetzung vor (oder fragt nach bei Unklarheiten)
4. Claude schreibt den Code direkt in die Dateien
5. Moritz schaut sich das Ergebnis an, gibt Feedback
6. Claude korrigiert oder baut weiter

Kein "Code kopieren und einfügen" — Claude schreibt direkt ins Repo.

### Beispiel-Konversation (aus v1.5.0)

> **Moritz:** „man sollte in der ansicht in der man einen neuen lack einpflegt / alten bearbeitet auch neue Kategorien hinzufügen, nicht in der filter Liste. Und ändere um das der Button neuer Lack nicht in der selben ebene liegt wie filter sondern einen größeren präsenteren Button ist"

> **Claude:** [liest App.jsx, analysiert den aktuellen Aufbau, entwirft inline-Kategorie-Erstellung im Formular mit lokalem State, verschiebt den Add-Button in eine eigene Zeile mit Gradient-Border-Styling, schreibt die Änderungen direkt in die Datei]

---

## Entwicklungsgeschichte

### v1.0.0 — Grundfunktionen
Erste Konversation. Claude hat Anforderung (persönliche Nagellack-Verwaltung, self-hosted, JSON-Speicherung) analysiert und die komplette App von Grund auf gebaut: React-SPA, Express-Backend, systemd-Service, Installations-Skript.

### v1.1.0 — System-Log-Viewer
Feature-Request: Systemlogs direkt in der App sehen. Claude hat eine `LogPanel`-Komponente mit Live-Polling, Zeilenauswahl und `journalctl`-Integration gebaut.

### v1.2.0 — Multi-Brand-Support
Anforderung: mehrere Nagellack-Marken verwalten. Claude hat das Datenmodell um ein `brand`-Feld erweitert, Datenmigration für bestehende Einträge eingebaut und einen Marken-Schnellfilter ergänzt.

### v1.3.0 — Statistiken
Feature-Request: Statistiken über die Kollektion. Claude hat eine vollständige Statistik-Seite mit Balkendiagrammen nach Marke, Finish, Status, Kategorien und einer sortierten Farbpalette gebaut.

### v1.4.0 — Finish-Typen & Filter
15 Finish-Typen (Classic, Shimmer, Glitter, Metallic, Chrome, …), Marken-Autovervollständigung mit 40+ Vorschlägen, dynamische Finish-Filter (nur angezeigte Typen tauchen auf).

### v1.5.0 — Major UX Update
Umfangreiche Session: Kategorien im Bearbeitungsformular anlegen/löschen, Notizen-Feld, Batch-Selektion mit Mehrfach-Status-Setzen, Undo-Snackbar (5 Sekunden), Export/Import als JSON, Sortierung nach Name/Marke/Farbton, überarbeitetes Flakon-SVG-Icon.

In derselben Session: Claude hat auf Anfrage eigenständig eine Feature-Brainstorming-Liste mit 10+ Ideen entwickelt und 9 davon direkt implementiert.

### v1.6.0 — Security Hardening & Bug-Fixes
Claude hat eine vollständige Sicherheitsanalyse des Repos durchgeführt und dabei folgendes gefunden und behoben:
- Kritisch: Alle Schreibendpunkte waren ohne Authentifizierung erreichbar → API-Key-System eingebaut
- Hoch: Kein Rate-Limiting → In-Memory-Limiter eingebaut
- Hoch: Fehlerdetails (Stacktraces, Pfade) wurden an den Browser geschickt → unterbunden
- Hoch: Keine Payload-Größenbeschränkung → `express.json({ limit: "2mb" })`
- Mittel: Mehrere React-Bugs (Formular-Reset, hexToHue-Crash bei ungültigen Farben, Index-Probleme beim Batch-Select)
- Low: Doppeltes parseInt, veraltete Code-Patterns

---

## Qualitätssicherung

Da keine Tests existieren (für ein Einzelperson-Heimnetz-Tool wäre das Over-Engineering), war die primäre Qualitätssicherung:

1. **Claude selbst** — hat aktiv auf Bugs, unsicheren Code und schlechte Patterns hingewiesen, oft ohne explizite Anfrage
2. **Sicherheitsanalyse auf Anfrage** — Moritz hat explizit gebeten, das gesamte Repo auf Probleme zu analysieren; Claude hat strukturiert nach Schweregrad aufgelistet
3. **Manuelles Testen** — Moritz hat die App nach jeder Session im Browser getestet
4. **Vite-Build** als Syntax-Check für das Frontend

---

## Beobachtungen zur KI-Entwicklung

**Was gut funktioniert hat:**

- Anforderungen in Alltagssprache formulieren — Claude übersetzt sie in konkrete technische Entscheidungen
- Schnelle Iteration: Feature-Idee → fertiger Code in Minuten
- Claude hat aktiv bessere Alternativen vorgeschlagen ("statt X würde ich Y empfehlen, weil…")
- Architekturentscheidungen wurden begründet, nicht nur umgesetzt
- Fehlende Sicherheitsaspekte wurden proaktiv angesprochen

**Was besondere Aufmerksamkeit brauchte:**

- Bei sehr langen Sitzungen (viele Änderungen) musste manchmal klargestellt werden, was genau noch fehlt
- Kontextverlust zwischen Sitzungen (Claude hat keine dauerhafte Erinnerung) — gelöst durch automatische Zusammenfassungen
- Bei komplexen Refactorings war präzises Feedback ("das ist nicht das, was ich meinte") wichtig

**Was das aussagt:**

Dieses Projekt zeigt, dass es heute möglich ist, eine vollständige, produktionsreife Web-Applikation zu entwickeln, ohne selbst programmieren zu können — vorausgesetzt, man kann klare Anforderungen formulieren, Ergebnisse beurteilen und sinnvolle Entscheidungen treffen. Die Rolle des Entwicklers verschiebt sich vom Code-Schreiben zur Produkt-Definition und Qualitätskontrolle.

---

## Technische Details zur KI-Nutzung

- **Tool:** Claude Code (VS Code Extension + CLI)
- **Modell:** claude-sonnet-4-6
- **Zugriffe:** Dateisystem (Read/Write/Edit), Git, Shell (PowerShell + Bash)
- **Sprache der Konversationen:** Deutsch
- **Codesprache:** Englisch (Variablen, Kommentare), Deutsch (UI-Texte)
- **Commits:** von Claude erstellt (Co-Author-Tag in allen Commits)

Alle Commits tragen den Co-Autor-Eintrag:
```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```
