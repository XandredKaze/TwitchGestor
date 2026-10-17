#!/usr/bin/env bash
# Servizi di sistema di TwitchGestor (con sudo). Lo usano install.sh e, dopo ogni aggiornamento, update.sh:
# così anche i cambiamenti ai servizi arrivano da soli, senza rilanciare l'installazione.
#   uso: sudo bash system-setup.sh <cartella di TwitchGestor> <utente>
set -euo pipefail
DIR="$1"
ME="$2"
NODE="$(command -v node)"

cat > /etc/systemd/system/twitchgestor.service <<UNIT
[Unit]
Description=TwitchGestor
After=network-online.target
Wants=network-online.target

[Service]
User=$ME
WorkingDirectory=$DIR
ExecStart=$NODE src/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
# porta 443 per la dashboard in https (Twitch mostra player e chat solo sulla porta standard)
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/twitchgestor-update.service <<UNIT
[Unit]
Description=Aggiornamento di TwitchGestor

[Service]
Type=oneshot
ExecStart=/bin/bash $DIR/scripts/raspberry/update.sh
UNIT

# il pulsante "Aggiorna ora" della dashboard crea data/update-request
cat > /etc/systemd/system/twitchgestor-update.path <<UNIT
[Unit]
Description=Aggiornamento di TwitchGestor chiesto dalla dashboard

[Path]
PathExists=$DIR/data/update-request
Unit=twitchgestor-update.service

[Install]
WantedBy=multi-user.target
UNIT

# controllo ogni ora: aggiorna solo all'ora scelta nella dashboard (predefinita le 5) e mai durante la live
cat > /etc/systemd/system/twitchgestor-update.timer <<UNIT
[Unit]
Description=Aggiornamento notturno di TwitchGestor

[Timer]
OnCalendar=*-*-* *:07:00
Unit=twitchgestor-update.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable twitchgestor.service twitchgestor-update.path twitchgestor-update.timer >/dev/null 2>&1
systemctl start twitchgestor-update.path twitchgestor-update.timer
