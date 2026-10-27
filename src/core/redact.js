/**
 * Toglie password, token e chiavi da un testo (il rapporto per l'assistenza), così si può incollare in chat.
 * secrets: valori da nascondere ovunque compaiano (es. quelli del file .env).
 */

const HIDDEN = '[nascosto]';
const SECRET_KEY = /(TOKEN|SECRET|PASSWORD|PASSWD|PASS|KEY|COOKIE|AUTH)/i;

/** Dalle righe "CHIAVE=valore" del file .env, i valori da nascondere (per nome della chiave). */
export function envSecrets(envText) {
  const out = [];
  for (const line of String(envText ?? '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][\w]*)\s*=\s*(.*)$/.exec(line);
    if (!m || !SECRET_KEY.test(m[1])) continue;
    const value = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= 4) out.push(value);
  }
  return out;
}

export function redact(text, secrets = []) {
  let t = String(text ?? '');
  // prima i valori noti (i più lunghi prima, così un pezzo non ne lascia scoperto un altro)
  for (const s of [...new Set(secrets.map(String))].filter((s) => s.length >= 4).sort((a, b) => b.length - a.length)) {
    t = t.split(s).join(HIDDEN);
  }
  return t
    .replace(/oauth:[a-z0-9]+/gi, `oauth:${HIDDEN}`)
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/g, `$1 ${HIDDEN}`)
    .replace(/([?&](?:token|access_token|code|key|password)=)[^&\s"']+/gi, `$1${HIDDEN}`)
    // "password": "…", access_token=…, client_secret: …
    .replace(/((?:access_token|refresh_token|client_secret|password|passwd|secret|api[_-]?key|token)["']?\s*[:=]\s*["']?)([^\s"',;&}]{4,})/gi, `$1${HIDDEN}`);
}
