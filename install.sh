#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  Nagellack Kollektion – Installer
#  Usage: bash <(curl -fsSL https://raw.githubusercontent.com/DEIN_USER/nagellacke/main/install.sh)
# ─────────────────────────────────────────────

INSTALL_DIR="/opt/nagellacke"
SERVICE_NAME="nagellacke"
PORT=3000
REPO_URL="https://github.com/DEIN_USER/nagellacke"   # <-- anpassen!

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[•]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   💅  Nagellack Kollektion Setup      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Root check ──
if [ "$EUID" -ne 0 ]; then
  error "Bitte als root ausführen: sudo bash install.sh"
fi

# ── 1. System packages ──
info "Paketlisten aktualisieren…"
apt-get update -qq

info "Installiere Abhängigkeiten (git, curl)…"
apt-get install -y -qq git curl ca-certificates

# ── 2. Node.js 20 ──
if ! command -v node &>/dev/null || [[ $(node -e "process.exit(+process.version.slice(1).split('.')[0] < 18)") ]]; then
  info "Installiere Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs
else
  success "Node.js bereits installiert ($(node --version))"
fi

# ── 3. Clone or update repo ──
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Repository aktualisieren…"
  git -C "$INSTALL_DIR" pull --quiet
else
  info "Repository klonen nach $INSTALL_DIR…"
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi

# ── 4. Backend dependencies ──
info "Backend-Abhängigkeiten installieren…"
cd "$INSTALL_DIR/backend"
npm install --silent --omit=dev

# ── 5. Frontend build ──
info "Frontend-Abhängigkeiten installieren…"
cd "$INSTALL_DIR/frontend"
npm install --silent

info "Frontend bauen…"
npm run build --silent
success "Frontend gebaut → $INSTALL_DIR/backend/public"

# ── 6. Data directory ──
mkdir -p "$INSTALL_DIR/backend/data"
chown -R root:root "$INSTALL_DIR"

# ── 7. Systemd service ──
info "Systemd-Service einrichten…"
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Nagellack Kollektion
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=PORT=${PORT}
# Daten bleiben in: ${INSTALL_DIR}/backend/data/data.json

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --quiet "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ── 8. Done ──
sleep 1
if systemctl is-active --quiet "$SERVICE_NAME"; then
  IP=$(hostname -I | awk '{print $1}')
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║   ✓  Installation abgeschlossen!      ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  🌐  Erreichbar unter:  ${CYAN}http://${IP}:${PORT}${NC}"
  echo -e "  💾  Daten gespeichert: ${CYAN}${INSTALL_DIR}/backend/data/data.json${NC}"
  echo ""
  echo -e "  Nützliche Befehle:"
  echo -e "  ${YELLOW}systemctl status ${SERVICE_NAME}${NC}   – Status anzeigen"
  echo -e "  ${YELLOW}systemctl restart ${SERVICE_NAME}${NC}  – Neu starten"
  echo -e "  ${YELLOW}journalctl -u ${SERVICE_NAME} -f${NC}   – Logs ansehen"
  echo -e "  ${YELLOW}bash install.sh${NC}                   – Update einspielen"
  echo ""
else
  error "Service konnte nicht gestartet werden. Logs: journalctl -u $SERVICE_NAME"
fi
