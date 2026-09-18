#!/usr/bin/env bash
# Einmalige Einrichtung des Tagesplaners in einem frischen Debian-LXC.
# Aufruf im Container als root:  bash install.sh [passwort]
set -euo pipefail

APP_DIR=/opt/tagesplaner
DATA_DIR=/var/lib/tagesplaner
ENV_FILE=/etc/tagesplaner.env
USER_NAME=tagesplaner
TZ_NAME=${TZ_NAME:-Europe/Berlin}
PASSWORD=${1:-}

[[ $EUID -eq 0 ]] || { echo "Bitte als root ausführen."; exit 1; }

echo "==> Pakete"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg cron >/dev/null

# node:sqlite gibt es erst ab Node 22.5 – Debian-Pakete sind zu alt, daher NodeSource.
if ! command -v node >/dev/null || [[ $(node -e 'console.log(process.versions.node.split(".")[0])') -lt 24 ]]; then
  echo "==> Node 24 installieren"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "    Node $(node --version)"

echo "==> Zeitzone $TZ_NAME"
ln -sf "/usr/share/zoneinfo/$TZ_NAME" /etc/localtime
echo "$TZ_NAME" > /etc/timezone

echo "==> Benutzer und Verzeichnisse"
id -u "$USER_NAME" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$USER_NAME"
mkdir -p "$APP_DIR" "$DATA_DIR" "$DATA_DIR/backups"
chown -R "$USER_NAME:$USER_NAME" "$APP_DIR" "$DATA_DIR"

if [[ ! -f $ENV_FILE ]]; then
  if [[ -z $PASSWORD ]]; then
    PASSWORD=$(head -c 12 /dev/urandom | base64 | tr -d '/+=' | head -c 14)
    GENERATED=1
  fi
  cat > "$ENV_FILE" <<ENVEOF
# Zugangspasswort der App. Nach Änderung: systemctl restart tagesplaner
TODO_PASSWORD=$PASSWORD
TODO_DB=$DATA_DIR/tagesplaner.db
PORT=3000
# Bestimmt, wann der Tageswechsel stattfindet.
TZ=$TZ_NAME
ENVEOF
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
else
  echo "    $ENV_FILE existiert schon – Passwort bleibt unverändert."
fi

echo "==> systemd-Service"
cat > /etc/systemd/system/tagesplaner.service <<'UNITEOF'
[Unit]
Description=Tagesplaner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tagesplaner
WorkingDirectory=/opt/tagesplaner
EnvironmentFile=/etc/tagesplaner.env
ExecStart=/usr/bin/node server/index.mjs
Restart=always
RestartSec=3

# Der Prozess braucht nur sein eigenes Verzeichnis und die DB.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/tagesplaner

[Install]
WantedBy=multi-user.target
UNITEOF

echo "==> Tägliches Backup (03:30, 14 Tage Aufbewahrung)"
cat > /etc/cron.d/tagesplaner-backup <<'CRONEOF'
30 3 * * * tagesplaner cd /opt/tagesplaner && TODO_DB=/var/lib/tagesplaner/tagesplaner.db /usr/bin/node server/backup.mjs /var/lib/tagesplaner/backups && find /var/lib/tagesplaner/backups -name '*.db' -mtime +14 -delete
CRONEOF

systemctl daemon-reload
systemctl enable tagesplaner >/dev/null 2>&1

echo
echo "Einrichtung fertig."
if [[ ${GENERATED:-0} == 1 ]]; then
  echo "  Passwort (generiert):  $PASSWORD"
  echo "  Steht auch in:         $ENV_FILE"
fi
echo "  App-Verzeichnis:       $APP_DIR   (hier kommen dist/ und server/ hin)"
echo "  Datenbank:             $DATA_DIR/tagesplaner.db"
echo
echo "Jetzt vom Mac aus die App hochschieben:  deploy/push.sh root@$(hostname -I | awk '{print $1}')"
