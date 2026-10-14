# Installation & Updates

## Installation

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)
```

Benötigt **Debian/Ubuntu** mit Node.js 20+. Nach der Installation erreichbar unter **http://SERVER-IP:3000**

## Update einspielen

**In der App (Admin-Konto):** Tab **Admin → API-Schlüssel & Update → Update prüfen → Update installieren** (zur Bestätigung ist das Passwort nötig). Der Server holt den aktuellen Stand von `main`, baut neu und startet sich selbst neu; den Fortschritt zeigt die App. Ohne Admin-Konto geht es auch über **Mehr → Admin** (Abschnitt für den API-Schlüssel), siehe [Erster Start](erste-schritte.md).

**Manuell:**
```bash
sudo bash /opt/nagellacke/install.sh
```

Daten bleiben dabei **immer erhalten**.

## Container-Deployment (Docker)

`v3/Dockerfile` ist der alternative Weg für eigenständige Cloud-Hosts (so läuft
die öffentliche Instanz `nailvault.de`). Das Image enthält bewusst nur das
Build-Ergebnis, kein git und keinen Checkout — **das Update in der App
funktioniert dort nicht** und wird deshalb auch nicht angeboten. Die App zeigt
stattdessen an, dass dieses Deployment über das Image aktualisiert wird; neue
Versionen erkennt sie trotzdem.

Welche App-Version dort läuft, ist **fest gepinnt** (Release-Tag oder Commit) und wird im Infrastruktur-Repo `homelab-infra` verwaltet; ein Update ist dort eine bewusste Änderung dieses Pins, nicht ein Pull von `main`. Wer das Image selbst betreibt, baut es aus dem gewünschten Stand neu (`docker compose up -d --build`).

Die Daten liegen im Volume (`DATA_DIR=/data`) und bleiben davon unberührt.

Setzt das Deployment einen Fork ein, zeigt `NAGELLACKE_REPO=owner/repo` die
Update-Prüfung auf das richtige Repository; ohne die Variable prüft sie
`Mozra-the-great/nagellacke`.

## Nützliche Befehle

```bash
systemctl status nagellacke-v3
systemctl restart nagellacke-v3
journalctl -u nagellacke-v3 -f
```

---

Weiter: [Erster Start — API-Schlüssel einrichten](erste-schritte.md) · [Sync einrichten](sync.md)
