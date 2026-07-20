#!/bin/bash
set -e

# ─────────────────────────────────────────────
#  Nagellack Kollektion – Installer (v3)
#  Usage: sudo bash install.sh
# ─────────────────────────────────────────────

INSTALL_DIR="/opt/nagellacke"
SERVICE_NAME="nagellacke-v3"
SERVICE_USER="nagellacke"
PORT=3000
REPO_URL="https://github.com/Mozra-the-great/nagellacke"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[•]${NC} $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   💅  Nagellack Kollektion v3 Setup   ║${NC}"
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
NODE_MAJOR=$(node --version 2>/dev/null | grep -oP '(?<=v)\d+' || echo 0)
if ! command -v node &>/dev/null || [[ "$NODE_MAJOR" -lt 20 ]]; then
  info "Installiere Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs
else
  success "Node.js bereits installiert ($(node --version))"
fi

# ── 3. Dedicated service user (no login, no root privileges) ──
if ! getent group "$SERVICE_USER" >/dev/null; then
  info "Erstelle Service-Gruppe '$SERVICE_USER'…"
  groupadd --system "$SERVICE_USER"
fi
if ! id -u "$SERVICE_USER" &>/dev/null; then
  info "Erstelle Service-User '$SERVICE_USER'…"
  useradd --system --no-create-home --shell /usr/sbin/nologin \
    --gid "$SERVICE_USER" --home-dir "$INSTALL_DIR" "$SERVICE_USER"
fi
# Damit /api/logs (journalctl) ohne root funktioniert:
usermod -aG systemd-journal "$SERVICE_USER"

# ── 4. Clone or update repo ──
if [ -d "$INSTALL_DIR/.git" ]; then
  info "Repository aktualisieren…"
  git -C "$INSTALL_DIR" fetch --quiet origin main
  git -C "$INSTALL_DIR" reset --hard --quiet origin/main
else
  info "Repository klonen nach $INSTALL_DIR…"
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
fi

# ── 5. Install dependencies ──
info "Abhängigkeiten installieren (v3 monorepo)…"
cd "$INSTALL_DIR/v3"
npm install --silent

# ── 6. Build ──
info "Core-Paket bauen…"
npm run build:core --silent

info "Sync-Paket bauen…"
npm run build:sync --silent

info "Server bauen…"
npm run build:server --silent

info "Web-App bauen…"
npm run build:web --silent

# ── 7. Deploy web app to server public/ ──
WEB_DIST="$INSTALL_DIR/v3/apps/web/dist"
SERVER_PUBLIC="$INSTALL_DIR/v3/server/public"
if [ -d "$WEB_DIST" ]; then
  info "Web-App nach public/ kopieren…"
  rm -rf "$SERVER_PUBLIC"
  cp -r "$WEB_DIST" "$SERVER_PUBLIC"
  success "Web-App deployed → $SERVER_PUBLIC"
fi

# ── 8. Data directory ──
mkdir -p "$INSTALL_DIR/v3/server/data"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# ── 9. Stop old v2 service if running ──
if systemctl is-active --quiet nagellacke.service 2>/dev/null; then
  info "Alten v2-Service stoppen…"
  systemctl stop nagellacke
  systemctl disable nagellacke
  success "v2-Service gestoppt"
fi

# ── 10. Scoped sudo rule for self-update (systemctl restart only) ──
# Der Service läuft unprivilegiert; /api/update/apply braucht aber einen
# Neustart via systemctl. Statt die ganze App als root laufen zu lassen,
# erlauben wir nur genau diesen einen Befehl passwortlos per sudoers.
SYSTEMCTL_BIN="$(command -v systemctl)"
SUDOERS_FILE="/etc/sudoers.d/${SERVICE_NAME}"
info "Sudo-Regel für Service-Neustart einrichten…"
cat > "$SUDOERS_FILE" <<EOF
${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} restart ${SERVICE_NAME}
EOF
chmod 0440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null || error "Sudoers-Datei ungültig: $SUDOERS_FILE"

# ── 11. Systemd service ──
info "Systemd-Service einrichten ($SERVICE_NAME)…"
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Nagellack Kollektion v3
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}/v3/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=PORT=${PORT}
Environment=SERVICE_NAME=${SERVICE_NAME}
# IMPORTANT: Replace the placeholder below with the actual domain of this server.
# Example: Environment=ALLOWED_ORIGIN=https://nails.example.com
Environment=ALLOWED_ORIGIN=https://your-domain.example
# Daten: ${INSTALL_DIR}/v3/server/data/

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --quiet "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ── 12. Done ──
sleep 1
if systemctl is-active --quiet "$SERVICE_NAME"; then
  IP=$(hostname -I | awk '{print $1}')
  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║   ✓  Installation abgeschlossen!      ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  🌐  Erreichbar unter:  ${CYAN}http://${IP}:${PORT}${NC}"
  echo -e "  💾  Daten gespeichert: ${CYAN}${INSTALL_DIR}/v3/server/data/${NC}"
  echo ""
  echo -e "  Nützliche Befehle:"
  echo -e "  ${YELLOW}systemctl status ${SERVICE_NAME}${NC}    – Status anzeigen"
  echo -e "  ${YELLOW}systemctl restart ${SERVICE_NAME}${NC}   – Neu starten"
  echo -e "  ${YELLOW}journalctl -u ${SERVICE_NAME} -f${NC}    – Logs ansehen"
  echo -e "  ${YELLOW}sudo bash install.sh${NC}               – Update einspielen"
  echo ""
else
  error "Service konnte nicht gestartet werden. Logs: journalctl -u $SERVICE_NAME"
fi
