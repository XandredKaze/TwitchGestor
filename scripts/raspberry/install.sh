#!/usr/bin/env bash
# Installa TwitchGestor su Raspberry Pi (Raspberry Pi OS a 64 bit, anche "Lite"). Si lancia una volta sola:
#
#   curl -fsSL https://raw.githubusercontent.com/XandredKaze/TwitchGestor/main/scripts/raspberry/install.sh | bash
#
# Cosa fa: installa Node.js e git, scarica TwitchGestor in ~/twitchgestor, prepara il file .env e crea tre servizi:
#   twitchgestor          il programma, parte da solo all'accensione e si riavvia se si blocca
#   twitchgestor-update   l'aggiornamento (dal pulsante della dashboard o ogni notte, mai durante la live)
# Rilanciarlo non cancella niente: impostazioni e dati restano dove sono.
set -euo pipefail

REPO="https://github.com/XandredKaze/TwitchGestor.git"
DIR="${TWITCHGESTOR_DIR:-$HOME/twitchgestor}"
ME="$(id -un)"
say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

if [ "$(id -u)" -eq 0 ]; then
  echo "Lancia lo script con il tuo utente normale (senza sudo): la password la chiede lui quando serve."
  exit 1
fi

say "Pacchetti di sistema (git, curl, avahi per il nome $(hostname).local)"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl ca-certificates avahi-daemon >/dev/null

NODE_MAJOR=22
[ "$(uname -m)" = "aarch64" ] || NODE_MAJOR=20 # sistema a 32 bit: Node 20 (meglio installare quello a 64 bit)
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  say "Node.js $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi
echo "Node.js $(node -v)"

if [ -d "$DIR/.git" ]; then
  say "TwitchGestor è già in $DIR: lo aggiorno"
  git -C "$DIR" fetch --quiet origin main
  git -C "$DIR" reset --hard --quiet origin/main
else
  say "Scarico TwitchGestor in $DIR"
  git clone --quiet "$REPO" "$DIR"
fi
cd "$DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

say "Impostazioni (.env)"
[ -f .env ] || cp .env.example .env
set_env() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
set_env HOST 0.0.0.0                  # raggiungibile dagli altri dispositivi di casa
set_env TWITCHGESTOR_MANAGED raspberry # aggiornamenti dalla dashboard
grep -q '^PUBLIC_URL=.' .env || set_env PUBLIC_URL http://localhost:3000
if ! grep -q '^DASHBOARD_TOKEN=.' .env; then
  set_env DASHBOARD_TOKEN "$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')" # password della dashboard
fi
PORT="$(grep -E '^PORT=' .env | cut -d= -f2)"; PORT="${PORT:-3000}"
TOKEN="$(grep -E '^DASHBOARD_TOKEN=' .env | cut -d= -f2-)"
mkdir -p data

say "Servizi (avvio automatico e aggiornamenti)"
sudo tee /etc/systemd/system/twitchgestor.service >/dev/null <<UNIT
[Unit]
Description=TwitchGestor
After=network-online.target
Wants=network-online.target

[Service]
User=$ME
WorkingDirectory=$DIR
ExecStart=$(command -v node) src/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/twitchgestor-update.service >/dev/null <<UNIT
[Unit]
Description=Aggiornamento di TwitchGestor

[Service]
Type=oneshot
ExecStart=/bin/bash $DIR/scripts/raspberry/update.sh
UNIT

# il pulsante "Aggiorna ora" della dashboard crea data/update-request
sudo tee /etc/systemd/system/twitchgestor-update.path >/dev/null <<UNIT
[Unit]
Description=Aggiornamento di TwitchGestor chiesto dalla dashboard

[Path]
PathExists=$DIR/data/update-request
Unit=twitchgestor-update.service

[Install]
WantedBy=multi-user.target
UNIT

# controllo ogni ora: aggiorna solo all'ora scelta nella dashboard (predefinita le 5) e mai durante la live
sudo tee /etc/systemd/system/twitchgestor-update.timer >/dev/null <<UNIT
[Unit]
Description=Aggiornamento notturno di TwitchGestor

[Timer]
OnCalendar=*-*-* *:07:00
Unit=twitchgestor-update.service

[Install]
WantedBy=timers.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now twitchgestor.service twitchgestor-update.path twitchgestor-update.timer >/dev/null
sudo systemctl restart twitchgestor.service

IP="$(hostname -I | awk '{print $1}')"
say "Fatto! TwitchGestor è acceso e si avvierà da solo a ogni accensione."
cat <<INFO

  Dashboard (da PC o telefono, la prima volta con questo indirizzo: la password poi resta salvata):
    http://$IP:$PORT/dashboard?token=$TOKEN
    http://$(hostname).local:$PORT/dashboard?token=$TOKEN

  In OBS cambia l'indirizzo delle sorgenti browser da localhost a quello del Raspberry:
    http://$IP:$PORT/overlay      http://$IP:$PORT/chat      http://$IP:$PORT/credits

  Per portare impostazioni e accessi dal PC: nella dashboard del PC "⚙ Sistema → Esporta tutto",
  poi nella dashboard del Raspberry "⚙ Sistema → Importa".

INFO
