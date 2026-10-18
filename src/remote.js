/**
 * Accesso da fuori casa (sul Raspberry) con Tailscale: una rete privata gratuita tra i tuoi dispositivi,
 * senza aprire porte sul router. Dalla dashboard (⚙ Sistema):
 *   1. "Attiva": il servizio di sistema installa Tailscale (scripts/raspberry/remote-access.sh, con i permessi
 *      di sistema) e permette a TwitchGestor di comandarlo;
 *   2. "Collega": TwitchGestor avvia il collegamento e mostra il link di Tailscale da aprire una volta;
 *   3. da lì la dashboard si apre da ovunque con l'indirizzo 100.x.x.x del Raspberry (app Tailscale attiva).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { DATA_DIR } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('remote');
const REQUEST_FILE = path.join(DATA_DIR, 'remote-access-request');
const STATUS_FILE = path.join(DATA_DIR, 'remote-access-status.json');

const run = (args, timeout = 8000) => new Promise((resolve, reject) => {
  execFile('tailscale', args, { timeout }, (err, stdout, stderr) => (err ? reject(Object.assign(new Error((stderr || err.message).trim()), { code: err.code })) : resolve(stdout)));
});

/** Indirizzo IPv4 di Tailscale (100.64.0.0/10) tra quelli del computer. */
export function tailscaleAddresses(interfaces = os.networkInterfaces()) {
  return Object.values(interfaces).flat()
    .filter((i) => i && i.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address))
    .map((i) => i.address);
}

/** Dallo stato di "tailscale status --json" a quello che serve alla dashboard. */
export function parseStatus(json) {
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  const self = s?.Self ?? {};
  const ips = (self.TailscaleIPs ?? s?.TailscaleIPs ?? []).filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
  const state = s?.BackendState ?? 'Unknown';
  return {
    state,
    connected: state === 'Running',
    authUrl: typeof s?.AuthURL === 'string' && /^https:\/\/login\.tailscale\.com\//.test(s.AuthURL) ? s.AuthURL : '',
    ip: ips[0] ?? '',
    dnsName: String(self.DNSName ?? '').replace(/\.$/, ''),
    account: s?.User?.[self.UserID]?.LoginName ?? '',
  };
}

let login = null; // "tailscale up" in attesa che tu apra il link
let lastAuthUrl = '';

function readInstallStatus() {
  try { return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch { return null; }
}

/** Stato completo per la dashboard. */
export async function status() {
  const install = readInstallStatus();
  const pending = fs.existsSync(REQUEST_FILE);
  try {
    const st = parseStatus(await run(['status', '--json']));
    if (!st.authUrl && !st.connected && login) st.authUrl = lastAuthUrl;
    return { installed: true, pending, install, ...st, waitingLogin: Boolean(login) };
  } catch (err) {
    if (err.code === 'ENOENT') return { installed: false, pending, install, state: 'NotInstalled', connected: false };
    // installato ma non ancora avviato o senza permesso: lo sistema "Attiva"
    return { installed: true, pending, install, state: 'NoState', connected: false, error: err.message.split('\n')[0] };
  }
}

/** Chiede al servizio di sistema di installare Tailscale (lo fa scripts/raspberry/remote-access.sh). */
export function requestInstall() {
  fs.writeFileSync(REQUEST_FILE, new Date().toISOString());
  try { fs.rmSync(STATUS_FILE, { force: true }); } catch { /* niente */ }
}

/**
 * Avvia il collegamento: "tailscale up" resta in attesa finché non apri il link (al massimo 15 minuti).
 * Ritorna il link appena Tailscale lo dà.
 */
export async function connect() {
  if (login) return lastAuthUrl;
  const me = os.userInfo().username;
  lastAuthUrl = '';
  const child = spawn('tailscale', ['up', '--reset', '--accept-dns=false', `--operator=${me}`, '--timeout=15m'], { stdio: ['ignore', 'pipe', 'pipe'] });
  login = child;
  let output = '';
  let exitCode = null;
  const found = new Promise((resolve) => {
    const onData = (d) => {
      output += d;
      const m = /https:\/\/login\.tailscale\.com\/\S+/.exec(output);
      if (m) { lastAuthUrl = m[0]; resolve(m[0]); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      login = null;
      exitCode = code;
      if (code === 0) log.info('Accesso da fuori casa collegato (Tailscale)');
      else if (output.trim()) log.warn(`Tailscale: ${output.trim().split('\n').pop()}`);
      resolve('');
    });
    child.on('error', () => { login = null; resolve(''); });
  });
  const url = await Promise.race([found, new Promise((r) => setTimeout(() => r(''), 20000))]);
  if (!url && !login && exitCode !== 0) {
    const msg = output.trim().split('\n').pop() || 'Tailscale non risponde';
    throw Object.assign(new Error(/access denied|operator|permission/i.test(msg)
      ? 'TwitchGestor non ha ancora il permesso di usare Tailscale: premi di nuovo "Attiva" e aspetta un minuto.'
      : `Collegamento non riuscito: ${msg}`), { status: 500 });
  }
  return url;
}

/** Scollega il Raspberry dalla rete Tailscale (si può ricollegare quando vuoi). */
export async function disconnect() {
  login?.kill();
  login = null;
  await run(['logout'], 20000);
  log.info('Accesso da fuori casa scollegato');
}
