#!/usr/bin/env bash
# Cartella condivisa in rete (Samba): da Windows \\twitchgestor\TwitchGestor
# dentro: music (musica, una sottocartella per playlist), images e sounds (alert), overlay (grafiche delle scene di OBS).
# Utente = quello del Raspberry, password = la stessa della dashboard. Se qualcosa va storto non blocca nulla.
#   uso: sudo bash share-setup.sh <cartella di TwitchGestor> <utente> [quick]
#   quick (ogni 5 minuti da update.sh): sistema solo gli indirizzi ammessi se sono cambiati
#   e aggiorna l'elenco degli accessi rifiutati per la dashboard.
set +e
DIR="$1"
ME="$2"
MODE="${3:-full}"
CONF=/etc/samba/smb.conf
OUT="$DIR/data/condivisa-stato.json"

# come la legge TwitchGestor: senza virgolette, spazi o "a capo" di Windows (altrimenti la password non corrisponde)
TOKEN="$(grep -E '^DASHBOARD_TOKEN=' "$DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/")"
[ -n "$TOKEN" ] || exit 0
[ "$MODE" = quick ] && ! command -v smbd >/dev/null 2>&1 && exit 0

# Indirizzi che possono entrare: rete di casa (IPv4), Tailscale e rete di casa in IPv6. Windows spesso si collega
# in IPv6 con l'indirizzo "pubblico" della rete di casa: si ammette il blocco (/64) di questa rete, che il
# fornitore può cambiare (per questo si ricontrolla ogni 5 minuti).
v6_networks() {
  ip -6 -o addr show scope global 2>/dev/null | awk '{print $4}' | python3 -c '
import ipaddress, sys
nets = sorted({str(ipaddress.ip_interface(a.strip()).network) for a in sys.stdin if a.strip()})
print(" ".join(n for n in nets if not n.startswith("fd7a:115c:a1e0")))  # Tailscale ha già il suo blocco qui sotto
' 2>/dev/null
}
ALLOW="127.0.0.1 ::1 10. 172.16.0.0/12 192.168. 100.64.0.0/10 fe80::/10 fc00::/7 $(v6_networks)"
ALLOW="$(echo $ALLOW)"

SECTION="$(cat <<SMB
# --- TwitchGestor (scritto da share-setup.sh, non modificare) ---
[TwitchGestor]
   comment = Musica, immagini, suoni e overlay di TwitchGestor
   path = $DIR/data/media
   valid users = $ME
   force user = $ME
   read only = no
   browseable = yes
   create mask = 0644
   directory mask = 0755
   hosts allow = $ALLOW
# --- fine TwitchGestor ---
SMB
)"
# toglie la sezione vecchia (e le righe vuote in fondo) e mette quella nuova
NEW_CONF="$(sed '/^# --- TwitchGestor (scritto/,/^# --- fine TwitchGestor ---$/d' "$CONF" 2>/dev/null)"
NEW_CONF="$(printf '%s\n\n%s' "$NEW_CONF" "$SECTION")"

# accessi rifiutati di recente (li scrive Samba): la dashboard li mostra per capire cosa non va
denied_json() {
  local LOGS
  LOGS="$(ls -t /var/log/samba/log.* 2>/dev/null | head -n 5)"
  [ -n "$LOGS" ] || { echo '[]'; return; }
  # shellcheck disable=SC2086
  tail -n 400 $LOGS 2>/dev/null | grep -oE 'Denied connection from [^ ]+|NT_STATUS_(LOGON_FAILURE|WRONG_PASSWORD|ACCESS_DENIED|NO_SUCH_USER)[^,]*' \
    | tail -n 5 | python3 -c 'import json, sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))' 2>/dev/null || echo '[]'
}

write_status() { # smbd account path login lan
  printf '{"at":"%s","user":"%s","smbd":"%s","account":"%s","path":"%s","login":"%s","lan":"%s","allow":"%s","denied":%s}\n' \
    "$(date -Iseconds)" "$ME" "$1" "$2" "$3" "$4" "$5" "$ALLOW" "$(denied_json)" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
  chown "$ME" "$OUT" 2>/dev/null
}

if [ "$MODE" = quick ]; then
  if [ "$NEW_CONF" = "$(cat "$CONF" 2>/dev/null)" ]; then
    # niente da cambiare: aggiorna solo gli accessi rifiutati nello stato (se c'è già)
    if [ -f "$OUT" ]; then
      python3 - "$OUT" "$(denied_json)" <<'PY' 2>/dev/null
import json, sys
p, denied = sys.argv[1], json.loads(sys.argv[2])
s = json.load(open(p))
s["denied"] = denied
json.dump(s, open(p + ".tmp", "w"))
PY
      [ -f "$OUT.tmp" ] && mv "$OUT.tmp" "$OUT" && chown "$ME" "$OUT" 2>/dev/null
    fi
    exit 0
  fi
  echo "cartella condivisa: indirizzi della rete cambiati, aggiorno"
fi

# --- installazione completa ---
if ! command -v smbd >/dev/null 2>&1; then
  echo "Installo la cartella condivisa (Samba)…"
  DEBIAN_FRONTEND=noninteractive timeout 900 apt-get install -y -q samba smbclient >/dev/null 2>&1 \
    || { DEBIAN_FRONTEND=noninteractive timeout 600 apt-get update -q >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive timeout 900 apt-get install -y -q samba smbclient >/dev/null 2>&1; } \
    || { echo "Samba non installato (riprovo al prossimo aggiornamento)"; exit 0; }
fi
# smbclient: serve al controllo qui sotto (prova a entrare nella cartella come farebbe Windows)
command -v smbclient >/dev/null 2>&1 || DEBIAN_FRONTEND=noninteractive timeout 600 apt-get install -y -q smbclient >/dev/null 2>&1

for d in music images sounds overlay; do
  mkdir -p "$DIR/data/media/$d"
done
chown "$ME" "$DIR/data/media" "$DIR/data/media/music" "$DIR/data/media/images" "$DIR/data/media/sounds" "$DIR/data/media/overlay"

CHANGED=0
if [ "$NEW_CONF" != "$(cat "$CONF" 2>/dev/null)" ]; then
  printf '%s\n' "$NEW_CONF" > "$CONF"
  CHANGED=1
fi
# password della cartella = password della dashboard (si aggiorna se la cambi)
printf '%s\n%s\n' "$TOKEN" "$TOKEN" | smbpasswd -s -a "$ME" >/dev/null 2>&1 \
  || echo "Cartella condivisa: password per $ME non impostata (smbpasswd non riuscito)"
smbpasswd -e "$ME" >/dev/null 2>&1 # l'utente della cartella deve essere attivo
if [ "$CHANGED" = 1 ] || ! systemctl is-active --quiet smbd; then
  systemctl enable smbd nmbd >/dev/null 2>&1
  systemctl restart smbd nmbd >/dev/null 2>&1
  sleep 2
fi

# --- controllo: entra con utente e password come farebbe Windows (anche dagli indirizzi di rete del Raspberry,
# così si controllano gli indirizzi ammessi). Se l'utente manca o la password non va, lo ricrea.
SMBD=no; ACCOUNT=no; PATHOK=no; LOGIN=""; LAN=""
systemctl is-active --quiet smbd && SMBD=yes
pdbedit -L 2>/dev/null | cut -d: -f1 | grep -qx "$ME" && ACCOUNT=yes
runuser -u "$ME" -- test -r "$DIR/data/media" -a -x "$DIR/data/media" && PATHOK=yes
try_login() { # indirizzo utente
  smbclient "//$(hostname)/TwitchGestor" -I "$1" -U "$2%$TOKEN" -c 'ls' >/dev/null 2>/tmp/tg-smb.err && echo ok \
    || { grep -o 'NT_STATUS_[A-Z_]*' /tmp/tg-smb.err | head -n1 | grep . || echo errore; }
}
if command -v smbclient >/dev/null 2>&1; then
  LOGIN="$(try_login 127.0.0.1 "$ME")"
  if [ "$LOGIN" != ok ]; then
    smbpasswd -x "$ME" >/dev/null 2>&1
    printf '%s\n%s\n' "$TOKEN" "$TOKEN" | smbpasswd -s -a "$ME" >/dev/null 2>&1
    smbpasswd -e "$ME" >/dev/null 2>&1
    systemctl restart smbd >/dev/null 2>&1
    sleep 2
    LOGIN="$(try_login 127.0.0.1 "$ME")"
    pdbedit -L 2>/dev/null | cut -d: -f1 | grep -qx "$ME" && ACCOUNT=yes
  fi
  # dagli indirizzi con cui lo vede il PC (rete di casa IPv4 e IPv6)
  for A in $(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1) \
           $(ip -6 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1); do
    case "$A" in 100.*|fd7a:115c:a1e0*) continue ;; esac # Tailscale
    LAN="$LAN $A=$(try_login "$A" "$(hostname)\\$ME")"
  done
  rm -f /tmp/tg-smb.err
else
  LOGIN="smbclient non installato"
fi
LAN="$(echo $LAN)"
write_status "$SMBD" "$ACCOUNT" "$PATHOK" "$LOGIN" "$LAN"
echo "cartella condivisa: accesso $LOGIN; dalla rete: ${LAN:-nessun indirizzo}"
exit 0
