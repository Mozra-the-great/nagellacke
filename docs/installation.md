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

## Nützliche Befehle

```bash
systemctl status nagellacke-v3
systemctl restart nagellacke-v3
journalctl -u nagellacke-v3 -f
```

---

Weiter: [Erster Start — API-Schlüssel einrichten](erste-schritte.md) · [Sync einrichten](sync.md)
