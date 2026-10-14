# Datenspeicherung & Backup

```
/opt/nagellacke/v3/server/data/users/<user>/data.json  ← Kollektion (pro Benutzer)
/opt/nagellacke/v3/server/data/users.json     ← Konten (Passwort-Hashes, Rollen, 2FA, Passkeys)
/opt/nagellacke/v3/server/data/photos/        ← Fotos (gemeinsames Verzeichnis, Zugriff nur mit Anmeldung)
/opt/nagellacke/v3/server/data/photo_owners.json ← wer welches Foto hochgeladen hat (Besitzprüfung beim Löschen)
/opt/nagellacke/v3/server/data/.api_key       ← API-Schlüssel
/opt/nagellacke/v3/server/data/.jwt_secret    ← JWT-Signing-Schlüssel (falls JWT_SECRET nicht gesetzt ist)
/opt/nagellacke/v3/server/data/server_settings.json ← Admin-Panel-Einstellungen inkl. SMTP (mode 0600, optional)
/opt/nagellacke/v3/server/data/ai_config.json ← KI-Provider/Schlüssel (mode 0600, optional)
/opt/nagellacke/v3/server/data/ai_jobs.json   ← laufende/abgeschlossene KI-Hintergrundjobs
/opt/nagellacke/v3/server/data/schedule.json  ← Berichts-Zeitpläne, pro Benutzer (optional)
/opt/nagellacke/v3/server/data/branding.json  ← Branding der Instanz (+ branding/ für das Logo, optional)
/opt/nagellacke/v3/server/data/legal.json     ← Impressum/Datenschutz der Instanz (optional)
/opt/nagellacke/v3/server/data/audit.json     ← Protokoll der Admin-Aktionen (begrenzt)
/opt/nagellacke/v3/server/data/update_state.json ← Ergebnis des letzten Selbst-Updates
```

Im Container-Deployment liegt dasselbe Verzeichnis im Volume (`DATA_DIR=/data`).

Backup erstellen:
```bash
# das ganze data/-Verzeichnis sichern (Konten, Kollektionen, Fotos, Einstellungen)
cp -a /opt/nagellacke/v3/server/data ~/backup-$(date +%F)
```

Oder direkt in der App: **Mehr → Daten → Export ZIP** (Kollektion samt aller Fotos; **Import** liest sie wieder ein). Dein Konto selbst (Stammdaten, Kollektion, Berichtsplan) lässt sich unter **Mehr → Sync** als JSON exportieren.

## Android (eingefroren)

> Die Android-App ist seit #372 eingefroren; dieser Abschnitt beschreibt den letzten Stand.

Die App speichert die Sammlung lokal in einer Room-Datenbank und Fotos unter
`filesDir/photos`. Die Datenbank ist im Android-Backup enthalten, die gecachten Fotos
nicht — ein Fotoarchiv sprengt das 25-MB-Limit von Auto-Backup, wodurch das gesamte
Backup fehlschlagen würde. Details in [#223](https://github.com/Mozra-the-great/nagellacke/issues/223).

---

Weiter: [Entwicklung](entwicklung.md) · [Architektur](../ARCHITECTURE.md)
