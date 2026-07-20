#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-nagellacke-v3}"
SERVICE_USER="nagellacke"
INSTALL_DIR="/opt/nagellacke"
REPO_URL="https://github.com/Mozra-the-great/nagellacke.git"
PORT="${PORT:-3000}"

echo "=== Nagellacke v3 Installer ==="
echo "Installiert in: $INSTALL_DIR  |  Port: $PORT  |  Service: $SERVICE_NAME"

# Root-Check
if [[ $EUID -ne 0 ]]; then
  echo "Bitte als root ausführen (sudo bash install.sh)"
  exit 1
fi

# Node.js 20+ prüfen / installieren
if ! command -v node &>/dev/null || [[ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 20 ]]; then
  echo "Installiere Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js: $(node -v)"

# Dedizierter Service-User (keine Root-Rechte für den laufenden Prozess)
if ! getent group "$SERVICE_USER" >/dev/null; then
  groupadd --system "$SERVICE_USER"
fi
if ! id -u "$SERVICE_USER" &>/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin \
    --gid "$SERVICE_USER" --home-dir "$INSTALL_DIR" "$SERVICE_USER"
fi
usermod -aG systemd-journal "$SERVICE_USER"

# Repo klonen oder aktualisieren
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "Aktualisiere Repository..."
  git -C "$INSTALL_DIR" pull origin main
else
  echo "Klone Repository..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ── v2-Frontend bauen (wird von v3-Server ausgeliefert) ──────────────────────
echo "Baue v2-Frontend..."
npm install          --prefix "$INSTALL_DIR/frontend"
npm run build        --prefix "$INSTALL_DIR/frontend"

# ── v3-Server bauen ───────────────────────────────────────────────────────────
echo "Baue v3-Server..."
npm install                              --prefix "$INSTALL_DIR/v3"
npm run build:core   --prefix "$INSTALL_DIR/v3"
npm run build:server --prefix "$INSTALL_DIR/v3"

# v2-Frontend in public/ des v3-Servers kopieren
V3_SERVER="$INSTALL_DIR/v3/server"
mkdir -p "$V3_SERVER/public"
cp -r "$INSTALL_DIR/backend/public/." "$V3_SERVER/public/"

# ── Datenordner vorbereiten ────────────────────────────────────────────────────
DATA_DIR="$V3_SERVER/data"
mkdir -p "$DATA_DIR/photos"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# .env anlegen (einmalig)
ENV_FILE="$V3_SERVER/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  JWT_SECRET=$(openssl rand -hex 32)
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
SERVICE_NAME=$SERVICE_NAME
DATA_DIR=$DATA_DIR
JWT_SECRET=$JWT_SECRET
EOF
  chmod 600 "$ENV_FILE"
  echo "Neue .env angelegt."
fi

# ── Scoped sudo-Regel für Self-Update (nur systemctl restart) ─────────────────
SYSTEMCTL_BIN="$(command -v systemctl)"
SUDOERS_FILE="/etc/sudoers.d/${SERVICE_NAME}"
cat > "$SUDOERS_FILE" <<EOF
${SERVICE_USER} ALL=(root) NOPASSWD: ${SYSTEMCTL_BIN} restart ${SERVICE_NAME}
EOF
chmod 0440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

# ── Systemd-Service anlegen ────────────────────────────────────────────────────
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Nagellacke v3
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=$V3_SERVER
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable  "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ── v2-Service deaktivieren (optional, wird nach Upgrade überflüssig) ─────────
if systemctl is-active --quiet nagellacke 2>/dev/null; then
  echo ""
  echo "Hinweis: Der alte v2-Service (nagellacke) läuft noch."
  echo "  Nach erfolgreicher Prüfung deaktivieren mit:"
  echo "    systemctl disable --now nagellacke"
fi

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  Nagellacke v3 läuft!                           ║"
echo "║  http://$IP:$PORT                               ║"
echo "║                                                  ║"
echo "║  API-Schlüssel: journalctl -u $SERVICE_NAME -n 20 ║"
echo "╚══════════════════════════════════════════════════╝"
