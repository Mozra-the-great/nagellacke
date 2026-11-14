# Datenspeicherung & Backup

```
/opt/nagellacke/v3/server/data/users/<user>/data.json  ← Kollektion (pro Benutzer)
/opt/nagellacke/v3/server/data/users.json     ← Konten (Passwort-Hashes, Rollen, 2FA, Passkeys)
/opt/nagellacke/v3/server/data/photos/        ← Fotos (gemeinsames Verzeichnis, Zugriff nur mit Anmeldung)
/opt/nagellacke/v3/server/data/photo_owners.json ← wer welches Foto hochgeladen hat (Besitzprüfung beim Löschen)
/opt/nagellacke/v3/server/data/pending_deletions.json ← vom Admin gelöschte Konten: was nach 30 Tagen endgültig entfernt wird (optional)
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

## Löschen und Aufbewahrungsfristen

Der Server räumt beim Start und danach stündlich selbst auf (`src/retention.ts`); alle Schritte sind wiederholbar und lassen Daten nicht gelöschter Konten unberührt.

- **Konto löschen durch das Konto selbst** (Mehr → Sync): sofort und endgültig, samt Sammlung, Berichtsplan, KI-Aufträgen und den Fotos, die nur dieses Konto verwendet.
- **Konto löschen durch einen Admin** (Admin → Benutzer): Login, Berichtsplan (samt Abmeldeliste) und KI-Aufträge sind sofort weg. Die Sammlung wird zu `users/<name>/data.json.deleted-<Zeitstempel>` umbenannt, und die Fotodateien des Kontos bleiben liegen; beides steht in `pending_deletions.json`. **30 Tage nach dem Löschen** entfernt der Server die umbenannte Datei und die Fotos endgültig und streicht den Eintrag. Ein Foto, das die Sammlung eines anderen Kontos noch verwendet, bleibt. Danach gibt es **keine Wiederherstellung** mehr; in den 30 Tagen gibt es dafür keine Funktion in der App, sondern nur von Hand (umbenannte Datei zurück nach `data.json` kopieren und Konto neu anlegen). Die Frist (`ADMIN_DELETION_RETENTION_DAYS`) steht an einer Stelle in `v3/server/src/retention.ts`.
- **Gelöschte Einträge** (Lack, Sticker, Maniküre, Kategorie): bleiben als Löschmarkierung (`deletedAt`), damit andere Geräte die Löschung beim Sync erfahren. **90 Tage** nach dem Löschen werden sie endgültig entfernt, in der Kollektion auf dem Server (bei jedem Sync-Schreiben und stündlich für alle Konten) und in der lokalen Kopie der Web-App (beim Laden und nach jedem Sync). Die Frist (`TOMBSTONE_RETENTION_DAYS`) steht in `v3/packages/core/src/logic.ts`. **Grenze:** Ein Gerät, das länger als 90 Tage offline war und den Eintrag noch als vorhanden kennt, lädt ihn beim nächsten Sync wieder hoch, die Löschung kommt dann zurück. Die Foto-Dateien gelöschter Einträge entfernt die Web-App beim Löschen selbst (nach dem Rückgängig-Fenster); der Server räumt beim Entfernen der Markierung keine Fotos direkt auf, das übernimmt die Foto-Aufräumung (nächster Punkt).
- **Verwaiste Fotodateien**: Eine Datei in `photos/`, die in keiner Sammlung auf der Platte mehr vorkommt (auch nicht in gelöschten Einträgen oder in der umbenannten Sammlung eines vom Admin gelöschten Kontos) und **älter als 7 Tage** ist, entfernt der Server beim Start und stündlich samt Besitz-Eintrag. Das fängt Fotos auf, deren Löschung beim Entfernen eines Eintrags fehlschlug. Die 7 Tage (`ORPHAN_PHOTO_GRACE_DAYS` in `v3/server/src/retention.ts`) schützen Uploads, deren Eintrag noch nicht synchronisiert ist. Fotos ohne vermerkten Uploader (Upload per API-Schlüssel) werden genauso beurteilt. Lässt sich eine Sammlung nicht lesen, wird in diesem Lauf nichts entfernt.

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
