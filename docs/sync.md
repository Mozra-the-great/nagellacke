# Sync einrichten

## Sync-Account anlegen (einmalig)

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"ich","password":"meinPasswort"}'
```

Den zurückgegebenen Token in der Android-App oder im Web unter **Einstellungen → Sync** eintragen.

Alternativ lässt sich das Konto direkt in der App anlegen: **Einstellungen → Sync → Eigener Server → Registrieren**.

## Zwei-Faktor-Authentifizierung (2FA)

Optional und jederzeit abschaltbar, unter **Einstellungen → Sicherheit** in der Web-App.
Beim Aktivieren werden Recovery-Codes angezeigt — die einmalig sichern, sie sind der
einzige Weg zurück ins Konto, wenn der Authenticator verloren geht.

> Die Android-App unterstützt den 2FA-Login noch nicht ([#227](https://github.com/Mozra-the-great/nagellacke/issues/227)).
> Wer 2FA aktiviert, kann sich dort vorerst nicht anmelden.

## Andere Sync-Anbieter

Neben dem eigenen Server unterstützt die App Nextcloud sowie (in der Android-App
vorbereitet) Google Drive, OneDrive und Dropbox. Diese legen eine JSON-Datei im
jeweiligen Cloud-Speicher ab, statt einen eigenen Server zu benötigen.

---

Weiter: [Datenspeicherung & Backup](datenspeicherung.md) · [Entwicklung](entwicklung.md)
