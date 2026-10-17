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

# --- cartella condivisa in rete (Samba): da Windows \\twitchgestor\TwitchGestor ---
# dentro: music (musica, una sottocartella per playlist), images e sounds (alert).
# Utente = quello del Raspberry, password = la stessa della dashboard. Se qualcosa va storto non blocca nulla.
setup_share() {
  set +e
  TOKEN="$(grep -E '^DASHBOARD_TOKEN=' "$DIR/.env" 2>/dev/null | cut -d= -f2-)"
  [ -n "$TOKEN" ] || return 0
  if ! command -v smbd >/dev/null 2>&1; then
    echo "Installo la cartella condivisa (Samba)…"
    DEBIAN_FRONTEND=noninteractive timeout 900 apt-get install -y -q samba >/dev/null 2>&1 \
      || { DEBIAN_FRONTEND=noninteractive timeout 600 apt-get update -q >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive timeout 900 apt-get install -y -q samba >/dev/null 2>&1; } \
      || { echo "Samba non installato (riprovo al prossimo aggiornamento)"; return 0; }
  fi
  for d in music images sounds; do
    mkdir -p "$DIR/data/media/$d"
  done
  chown "$ME" "$DIR/data/media" "$DIR/data/media/music" "$DIR/data/media/images" "$DIR/data/media/sounds"

  local CONF=/etc/samba/smb.conf
  local SECTION
  SECTION="$(cat <<SMB
# --- TwitchGestor (scritto da system-setup.sh, non modificare) ---
[TwitchGestor]
   comment = Musica, immagini e suoni di TwitchGestor
   path = $DIR/data/media
   valid users = $ME
   force user = $ME
   read only = no
   browseable = yes
   create mask = 0644
   directory mask = 0755
   hosts allow = 127.0.0.1 ::1 10. 172.16.0.0/12 192.168. 100.64.0.0/10 fe80::/10
# --- fine TwitchGestor ---
SMB
)"
  # toglie la sezione vecchia (e le righe vuote in fondo) e mette quella nuova
  local NEW_CONF
  NEW_CONF="$(sed '/^# --- TwitchGestor (scritto/,/^# --- fine TwitchGestor ---$/d' "$CONF" 2>/dev/null)"
  NEW_CONF="$(printf '%s\n\n%s' "$NEW_CONF" "$SECTION")"
  local CHANGED=0
  if [ "$NEW_CONF" != "$(cat "$CONF" 2>/dev/null)" ]; then
    printf '%s\n' "$NEW_CONF" > "$CONF"
    CHANGED=1
  fi
  # password della cartella = password della dashboard (si aggiorna se la cambi)
  printf '%s\n%s\n' "$TOKEN" "$TOKEN" | smbpasswd -s -a "$ME" >/dev/null 2>&1
  if [ "$CHANGED" = 1 ] || ! systemctl is-active --quiet smbd; then
    systemctl enable smbd nmbd >/dev/null 2>&1
    systemctl restart smbd nmbd >/dev/null 2>&1
  fi
  return 0
}
setup_share || true
