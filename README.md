# 💅 Nagellack Kollektion

Persönliche Nagellack-Verwaltung – gehostet auf eigenem Server.  
Daten werden in einer JSON-Datei auf dem Server gespeichert und überleben jeden Neustart.

## Installation (ein Befehl)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Mozra-the-great/nagellacke/main/install.sh)
```

> Benötigt Debian/Ubuntu LXC, läuft als root. Installiert automatisch Node.js 20.

Nach der Installation erreichbar unter **http://SERVER-IP:3000**

---

## Update einspielen

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/DEIN_USER/nagellacke/main/install.sh)
```

Derselbe Befehl – zieht die neueste Version und baut das Frontend neu.  
**Deine Daten bleiben dabei erhalten.**

---

## Datenspeicherung

```
/opt/nagellacke/backend/data/data.json
```

- Alle Lacke, Kategorien und Status werden hier gespeichert
- Bleibt nach Server-Neustart erhalten
- Kann als Backup einfach kopiert werden

---

## Nützliche Befehle

```bash
systemctl status nagellacke     # Status
systemctl restart nagellacke    # Neustart
journalctl -u nagellacke -f     # Live-Logs
cat /opt/nagellacke/backend/data/data.json   # Daten ansehen
```

---

## Lokale Entwicklung

```bash
# Terminal 1 – Backend
cd backend && npm install && node server.js

# Terminal 2 – Frontend (mit Hot Reload)
cd frontend && npm install && npm run dev
```

Frontend läuft auf http://localhost:5173, API-Calls werden automatisch an :3000 weitergeleitet.

---

## Technik

- **Frontend:** React + Vite
- **Backend:** Node.js + Express
- **Speicher:** JSON-Datei (`data.json`)
- **Service:** systemd
