#!/usr/bin/env bash
# Accesso da fuori casa: installa Tailscale e permette a TwitchGestor di comandarlo.
# Lo lancia il servizio twitchgestor-remote quando premi "Attiva" in ⚙ Sistema (file data/remote-access-request).
# Il collegamento al tuo account Tailscale lo fai tu, dalla dashboard, aprendo il link che compare.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$DIR" || exit 1
OWNER="$(stat -c %U "$DIR")"
REQUEST="$DIR/data/remote-access-request"
STATUS="$DIR/data/remote-access-status.json"
rm -f "$REQUEST"

status() {
  printf '{"at":"%s","result":"%s","message":"%s"}\n' "$(date -Iseconds)" "$1" "${2:-}" > "$STATUS"
  chown "$OWNER" "$STATUS"
  echo "accesso da fuori casa: $1 ${2:-}"
}

status running "Installo Tailscale…"
if ! command -v tailscale >/dev/null 2>&1; then
  # script ufficiale di Tailscale: aggiunge il suo archivio dei pacchetti e lo installa
  if ! curl -fsSL https://tailscale.com/install.sh -o /tmp/tailscale-install.sh \
    || ! DEBIAN_FRONTEND=noninteractive timeout 900 sh /tmp/tailscale-install.sh >/tmp/tailscale-install.log 2>&1; then
    status error "installazione di Tailscale non riuscita (serve internet; riprova tra poco)"
    exit 1
  fi
fi
systemctl enable --now tailscaled >/dev/null 2>&1
sleep 2
# TwitchGestor (che non gira come amministratore) può collegare e scollegare Tailscale
if ! tailscale set --operator="$OWNER" >/dev/null 2>&1; then
  timeout 5 tailscale up --reset --accept-dns=false --operator="$OWNER" >/dev/null 2>&1
fi
status ok "Tailscale installato"
