# Sync einrichten

## Sync-Account anlegen (einmalig)

In der Web-App: **Mehr → Sync → Eigener Server**, Server-URL eintragen und unten **„Noch kein Konto? Registrieren“** wählen. Das erste Konto auf einem frischen Server wird automatisch zum Admin; weitere Konten kann man nur anlegen, solange die Registrierung offen ist (Admin → Server-Einstellungen, oder `ALLOW_REGISTRATION=true`).

Per Skript geht es auch direkt über die API:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"ich","password":"meinPasswort"}'
```

Auf einer öffentlichen Instanz kann zusätzlich eine kleine Rechenaufgabe (Proof of Work) oder eine bestätigte E-Mail-Adresse verlangt werden; die Web-App löst das selbst.

## Anmelden: Passwort, 2FA, Passkeys

- **Zwei-Faktor-Authentifizierung (2FA):** optional und jederzeit abschaltbar, unter **Mehr → Sicherheit**. Beim Aktivieren werden Recovery-Codes angezeigt — die einmalig sichern, sie sind der einzige Weg zurück ins Konto, wenn der Authenticator verloren geht.
- **Passkeys:** unter **Mehr → Sicherheit** lassen sich Passkeys hinterlegen (nur über https oder localhost; ein Passkey-Login ersetzt Passwort und 2FA).
- **Passwort vergessen:** erscheint auf der Anmeldemaske, sobald der Admin SMTP und die App-URL eingerichtet hat; die Mail geht nur an eine bereits bestätigte Adresse des Kontos raus.

## Andere Sync-Anbieter

Neben dem eigenen Server funktioniert **Nextcloud** (WebDAV, mit App-Passwort). Google Drive, OneDrive und Dropbox sind in der Auswahl und im Code vorbereitet, aber die OAuth-Anmeldung ist weder in der Web-App noch in der eingefrorenen Android-App fertig — dafür bitte den eigenen Server oder Nextcloud nutzen. Diese Anbieter legen eine JSON-Datei im jeweiligen Speicher ab, statt einen eigenen Server zu benötigen.

> **Android (eingefroren, #372):** Die Android-App unterstützt den 2FA-Login nicht ([#227](https://github.com/Mozra-the-great/nagellacke/issues/227)); wer 2FA aktiviert, kann sich dort nicht anmelden.

---

Weiter: [Datenspeicherung & Backup](datenspeicherung.md) · [Entwicklung](entwicklung.md)
