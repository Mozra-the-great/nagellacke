# Datenspeicherung & Backup

```
/opt/nagellacke/v3/server/data/users/<user>/data.json  ← Kollektion (pro Benutzer)
/opt/nagellacke/v3/server/data/.api_key       ← API-Schlüssel
/opt/nagellacke/v3/server/data/.jwt_secret    ← JWT-Signing-Schlüssel
/opt/nagellacke/v3/server/data/users.json     ← Sync-User-Konten
/opt/nagellacke/v3/server/data/photos/        ← Fotos
/opt/nagellacke/v3/server/data/ai_config.json ← KI-Provider/Schlüssel (mode 0600, optional)
/opt/nagellacke/v3/server/data/schedule.json  ← Berichts-Zeitplan (optional)
/opt/nagellacke/v3/server/data/server_settings.json ← Admin-Panel-Einstellungen (mode 0600, optional)
```

Backup erstellen:
```bash
# pro Benutzer — oder gleich das ganze data/-Verzeichnis sichern
cp -r /opt/nagellacke/v3/server/data/users ~/backup-$(date +%F)/
```

Oder direkt in der App: Footer → **↓ Export** (enthält alle Fotos eingebettet)

## Android

Die App speichert die Sammlung lokal in einer Room-Datenbank und Fotos unter
`filesDir/photos`. Die Datenbank ist im Android-Backup enthalten, die gecachten Fotos
nicht — ein Fotoarchiv sprengt das 25-MB-Limit von Auto-Backup, wodurch das gesamte
Backup fehlschlagen würde. Details in [#223](https://github.com/Mozra-the-great/nagellacke/issues/223).

---

Weiter: [Entwicklung](entwicklung.md) · [Architektur](../ARCHITECTURE.md)
