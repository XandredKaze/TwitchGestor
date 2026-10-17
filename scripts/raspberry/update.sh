#!/usr/bin/env bash
# Aggiorna TwitchGestor sul Raspberry. Lo lancia il servizio twitchgestor-update:
#   - subito, quando premi "Aggiorna ora" nella dashboard (file data/update-request)
#   - ogni ora: aggiorna solo all'ora scelta nella dashboard, se l'aggiornamento automatico è attivo e non sei in live
# Prima salva una copia di impostazioni e dati; se la versione nuova non parte, torna da solo a quella di prima.
# Impostazioni (config/config.json), dati (data/) e .env non vengono mai sovrascritti dall'aggiornamento.
set -uo pipefail

# lo script stesso può cambiare con l'aggiornamento: gira da una copia
if [ -z "${TG_UPDATE_COPY:-}" ]; then
  TG_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
  cp "$0" /tmp/twitchgestor-update.sh
  TG_DIR="$TG_DIR" TG_UPDATE_COPY=1 exec /bin/bash /tmp/twitchgestor-update.sh "$@"
fi

DIR="$TG_DIR"
cd "$DIR" || exit 1
OWNER="$(stat -c %U "$DIR")"
OWNER_HOME="$(getent passwd "$OWNER" | cut -d: -f6)"
as_user() { runuser -u "$OWNER" -- env HOME="$OWNER_HOME" "$@"; }
REQUEST="$DIR/data/update-request"
MODE=auto
if [ -f "$REQUEST" ]; then MODE=manual; rm -f "$REQUEST"; fi
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)"; PORT="${PORT:-3000}"
TOKEN="$(grep -E '^DASHBOARD_TOKEN=' .env 2>/dev/null | cut -d= -f2-)"
system_info() { curl -fsS -m 8 -H "x-dashboard-token: $TOKEN" "http://127.0.0.1:$PORT/api/system" 2>/dev/null; }

# stato per la dashboard (data/update-status.json)
status() {
  as_user node -e '
    const [file, result, message, mode, version] = process.argv.slice(1);
    require("fs").writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), result, message, mode, version }, null, 2));
  ' "$DIR/data/update-status.json" "$1" "${2:-}" "$MODE" "${3:-}"
  echo "aggiornamento: $1 ${2:-}"
}

if [ "$MODE" = auto ]; then
  read -r AUTO HOUR < <(as_user node -e '
    let s = {}; try { s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); } catch {}
    console.log(s.auto !== false, Number.isInteger(s.hour) ? s.hour : 5);
  ' "$DIR/data/update-settings.json")
  [ "$AUTO" = true ] || exit 0
  [ "$(date +%-H)" = "$HOUR" ] || exit 0
fi

as_user git fetch --quiet origin main || { status error "GitHub non raggiungibile"; exit 1; }
OLD="$(as_user git rev-parse HEAD)"
NEW="$(as_user git rev-parse origin/main)"
if [ "$OLD" = "$NEW" ]; then
  [ "$MODE" = manual ] && status up-to-date
  exit 0
fi
# una versione che non è partita non si ritenta da sola ogni notte (si aspetta la prossima; a mano si può riprovare)
BAD_FILE="$DIR/data/update-bad-commit"
if [ "$MODE" = auto ] && [ "$(cat "$BAD_FILE" 2>/dev/null)" = "$NEW" ]; then exit 0; fi
if [ "$MODE" = auto ] && system_info | grep -q '"busy":true'; then
  status skipped-live "riprovo la prossima notte"
  exit 0
fi

status running
# copia di sicurezza (le ultime 5)
BACKUPS="$DIR/data/backups"
as_user mkdir -p "$BACKUPS"
BACKUP="$BACKUPS/prima-di-aggiornare-$(date +%Y%m%d-%H%M%S).tar.gz"
as_user tar -czf "$BACKUP" --exclude=data/backups -C "$DIR" config data .env 2>/dev/null
ls -1t "$BACKUPS"/prima-di-aggiornare-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f

# reinstalla i pacchetti solo se sono cambiati (non basta il numero di versione in package.json)
deps_of() {
  as_user node -e '
    const { execFileSync } = require("child_process");
    const show = (f) => { try { return JSON.parse(execFileSync("git", ["show", `${process.argv[1]}:${f}`], { encoding: "utf8" })); } catch { return {}; } };
    const lock = show("package-lock.json").packages ?? {};
    delete lock[""];
    console.log(JSON.stringify([show("package.json").dependencies ?? {}, lock]));
  ' "$1"
}
deps() {
  if [ "$(deps_of "$1")" != "$(deps_of "$2")" ] || [ ! -d node_modules ]; then
    as_user npm ci --omit=dev --no-audit --no-fund --loglevel=error
  fi
}
# la versione nuova risponde ed è proprio quella scaricata?
started() {
  for _ in $(seq 1 45); do
    sleep 2
    if systemctl is-active --quiet twitchgestor && system_info | grep -q "\"commit\":\"$1\""; then
      sleep 10 # e resta accesa
      systemctl is-active --quiet twitchgestor && return 0
    fi
  done
  return 1
}

if as_user git reset --hard --quiet "$NEW" && deps "$OLD" "$NEW"; then
  systemctl restart twitchgestor
  if started "$NEW"; then
    VERSION="$(as_user node -p 'require("./package.json").version')"
    rm -f "$BAD_FILE"
    status ok "" "$VERSION"
    exit 0
  fi
fi

# non è ripartito: torna alla versione di prima, con le impostazioni di prima
as_user git reset --hard --quiet "$OLD"
deps "$NEW" "$OLD"
as_user tar -xzf "$BACKUP" -C "$DIR" config/config.json 2>/dev/null
systemctl reset-failed twitchgestor 2>/dev/null
systemctl restart twitchgestor
started "$OLD"
as_user sh -c "echo $NEW > '$BAD_FILE'"
status rollback "la versione nuova non partiva"
exit 1
