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

# Howl-UP (agenda): stessa cartella e stessi aggiornamenti di TwitchGestor, pagina sulla porta 3100
cat > /etc/systemd/system/howlup.service <<UNIT
[Unit]
Description=Howl-UP
After=network-online.target
Wants=network-online.target

[Service]
User=$ME
WorkingDirectory=$DIR
ExecStart=$NODE howlup/src/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

# Musicante (scarica la musica in MP3 con yt-dlp nella cartella della musica): pagina sulla porta 3200
cat > /etc/systemd/system/musicante.service <<UNIT
[Unit]
Description=Musicante
After=network-online.target
Wants=network-online.target

[Service]
User=$ME
WorkingDirectory=$DIR
ExecStart=$NODE musicante/src/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

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

# controllo ogni 5 minuti: aggiorna appena c'è una versione nuova (o solo all'ora scelta), mai durante la live
cat > /etc/systemd/system/twitchgestor-update.timer <<UNIT
[Unit]
Description=Aggiornamento automatico di TwitchGestor

[Timer]
OnCalendar=*:0/5
Unit=twitchgestor-update.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable twitchgestor.service howlup.service musicante.service twitchgestor-update.path twitchgestor-update.timer >/dev/null 2>&1
{ [ -f "$DIR/howlup/src/index.js" ] && systemctl start howlup.service; } || true
{ [ -f "$DIR/musicante/src/index.js" ] && systemctl start musicante.service; } || true
systemctl start twitchgestor-update.path twitchgestor-update.timer
systemctl restart twitchgestor-update.timer # il nuovo orario vale subito

# --- Musicante: ffmpeg (converte in MP3) e python3 (fa girare yt-dlp). Se qualcosa va storto non blocca nulla ---
setup_musicante() {
  set +e
  local need=""
  command -v ffmpeg >/dev/null 2>&1 || need="$need ffmpeg"
  command -v python3 >/dev/null 2>&1 || need="$need python3"
  [ -n "$need" ] || return 0
  echo "Installo per Musicante:$need…"
  DEBIAN_FRONTEND=noninteractive timeout 1800 apt-get install -y -q $need >/dev/null 2>&1 \
    || { DEBIAN_FRONTEND=noninteractive timeout 600 apt-get update -q >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive timeout 1800 apt-get install -y -q $need >/dev/null 2>&1; } \
    || { echo "Pacchetti per Musicante non installati (riprovo al prossimo aggiornamento)"; return 0; }
  systemctl restart musicante.service 2>/dev/null
  return 0
}
setup_musicante || true

# --- cartella condivisa in rete (Samba): scripts/raspberry/share-setup.sh ---
bash "$(dirname "$0")/share-setup.sh" "$DIR" "$ME" || true

# --- accesso da fuori casa: il pulsante "Attiva" in ⚙ Sistema crea data/remote-access-request ---
cat > /etc/systemd/system/twitchgestor-remote.service <<UNIT
[Unit]
Description=Accesso da fuori casa per TwitchGestor (Tailscale)
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $DIR/scripts/raspberry/remote-access.sh
UNIT

cat > /etc/systemd/system/twitchgestor-remote.path <<UNIT
[Unit]
Description=Accesso da fuori casa chiesto dalla dashboard

[Path]
PathExists=$DIR/data/remote-access-request
Unit=twitchgestor-remote.service

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now twitchgestor-remote.path >/dev/null 2>&1 || true
