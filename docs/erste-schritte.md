# Erster Start — API-Schlüssel einrichten

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

## Schlüssel rotieren

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

Weiter: [Sync einrichten](sync.md) · [Datenspeicherung & Backup](datenspeicherung.md)
