# Installation & Updates

## Installation

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)
```

Benötigt **Debian/Ubuntu** mit Node.js 20+. Nach der Installation erreichbar unter **http://SERVER-IP:3000**

## Update einspielen

**In der App:** Footer → „Updates prüfen" → „Jetzt updaten"

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

Update von Hand auf dem Host:

```bash
cd /opt/nailvault
git -C src fetch origin main
git -C src reset --hard FETCH_HEAD
docker compose up -d --build
```

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
