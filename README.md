# Nail Lacquer Kollektion

Persönliche Nagellack-Verwaltung als Self-hosted Web-App — läuft auf einem eigenen Server im Heimnetz, keine externe Cloud nötig. Mit optionalem Cloud-Sync und nativer Android-App.

![Version](https://img.shields.io/badge/version-3.3.0--rc.1-pink) ![Stack](https://img.shields.io/badge/stack-React%20%2B%20Fastify%20%2B%20Kotlin-blueviolet) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

### → **[Projektseite ansehen](https://mozra-the-great.github.io/nagellacke/)**

Überblick über die App, Farben direkt an der Hand ausprobieren, und die [Datenschutzerklärung](https://mozra-the-great.github.io/nagellacke/privacy-policy.html).

---

## Was die App kann

- **Lacksammlung verwalten** — Farbe, 15 Finish-Typen (auch mehrere pro Lack), Status, Bewertung, Notizen, eigene Kategorien und ein Foto pro Flasche
- **Farbe aus dem Foto ziehen** — Foto öffnen, auf die Farbe tippen, fertig; dazu eine Duplikat-Warnung bei ähnlichem Farbton und gleichem Finish
- **Wunschliste** mit „Gekauft ✓", Nail-Sticker-Inventar und ein **Maniküre-Tagebuch** mit vier Foto-Slots je Eintrag
- **Statistiken** nach Marke, Finish, Status und Farbpalette — plus Wochen- und Monatsberichte, auf Wunsch automatisch per E-Mail
- **Optionale KI-Hilfe** — Farbe und Finish automatisch ermitteln, Vorschläge für die Wunschliste; die Websuche läuft über den eigenen Server statt über kostenpflichtige Anbieter-Suche
- **Sync zwischen Geräten** — eigener Server, Nextcloud, Google Drive, OneDrive oder Dropbox; jedes Konto hat seine eigene, private Sammlung, optional mit 2FA
- **Native Android-App** (Kotlin, Jetpack Compose, Material 3)
- **Export und Import** als vollständiges Backup inklusive aller Fotos

## Installation

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)
```

Debian/Ubuntu mit Node.js 20+, danach erreichbar unter `http://SERVER-IP:3000`.
→ **[Ausführliche Anleitung](docs/installation.md)**

## Dokumentation

| | |
|---|---|
| [Installation & Updates](docs/installation.md) | Installer, Update-Wege, systemd-Befehle |
| [Erste Schritte](docs/erste-schritte.md) | API-Schlüssel einrichten und rotieren |
| [Sync einrichten](docs/sync.md) | Konto anlegen, 2FA, Cloud-Anbieter |
| [Datenspeicherung & Backup](docs/datenspeicherung.md) | Wo was liegt, Backup und Export |
| [Entwicklung](docs/entwicklung.md) | Lokal starten, Builds, Tests, Repo-Struktur |
| [Architektur](ARCHITECTURE.md) | Datenfluss, Module, Entscheidungen |
| [Sicherheit](SECURITY.md) | Sicherheitshinweise und Meldeweg |
| [Änderungshistorie](CHANGELOG.md) | Was sich pro Version geändert hat |

## Lizenz

MIT — siehe [LICENSE](LICENSE).
