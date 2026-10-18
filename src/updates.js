/**
 * Aggiornamenti e copie di sicurezza.
 *
 * Sul Raspberry (installato con scripts/raspberry/install.sh, TWITCHGESTOR_MANAGED=raspberry nel .env)
 * l'aggiornamento lo fa il servizio di sistema "twitchgestor-update": questo modulo controlla se su
 * GitHub c'è una versione nuova e gli chiede di partire creando il file data/update-request.
 * Il servizio salva una copia di impostazioni e dati, scarica la versione nuova, riavvia TwitchGestor
 * e, se non riparte, torna da solo alla versione precedente. Le impostazioni non vengono mai toccate:
 * stanno in config/config.json, data/ e .env, che gli aggiornamenti non sovrascrivono.
 *
 * La copia di sicurezza (Esporta/Importa) serve a portare tutto da un computer all'altro
 * (es. dal PC al Raspberry) senza reinserire niente.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT_DIR, DATA_DIR } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('aggiornamenti');
const REQUEST_FILE = path.join(DATA_DIR, 'update-request');
const STATUS_FILE = path.join(DATA_DIR, 'update-status.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'update-settings.json');
const ENV_FILE = path.join(ROOT_DIR, '.env');
const BRANCH = 'main';

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { cwd: ROOT_DIR, timeout: 120000, maxBuffer: 20 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
    if (err) reject(Object.assign(new Error((stderr || err.message).trim().split('\n').at(-1)), { cause: err }));
    else resolve(stdout.trim());
  });
});
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

export const isManaged = () => process.env.TWITCHGESTOR_MANAGED === 'raspberry';

/** Versione installata (commit di git), se il programma è stato scaricato con git. */
let installed = null;
export async function installedCommit() {
  if (installed !== null) return installed;
  try { installed = (await run('git', ['rev-parse', 'HEAD'])).slice(0, 40); } catch { installed = ''; }
  return installed;
}

let lastFetch = 0;
let cached = null;
/** Controlla su GitHub se c'è una versione nuova (al massimo ogni 10 minuti, se non richiesto). */
export async function checkForUpdates({ force = false } = {}) {
  const current = await installedCommit();
  if (!current) return { available: false, error: 'Questa copia di TwitchGestor non è stata installata con git.' };
  if (force || !cached || Date.now() - lastFetch > 10 * 60 * 1000) {
    try {
      await run('git', ['fetch', '--quiet', 'origin', BRANCH]);
      const [behind, log1] = await Promise.all([
        run('git', ['rev-list', '--count', `HEAD..origin/${BRANCH}`]),
        run('git', ['log', '--format=%h%x09%cI%x09%s', '-n', '15', `HEAD..origin/${BRANCH}`]),
      ]);
      cached = {
        available: Number(behind) > 0,
        behind: Number(behind),
        changes: log1 ? log1.split('\n').map((l) => { const [hash, date, ...s] = l.split('\t'); return { hash, date, text: s.join('\t') }; }) : [],
        checkedAt: Date.now(),
      };
      lastFetch = Date.now();
    } catch (err) {
      return { available: false, error: `Non riesco a controllare GitHub: ${err.message}`, checkedAt: Date.now() };
    }
  }
  return cached;
}

export function updateSettings() {
  return { auto: true, hour: 5, ...readJson(SETTINGS_FILE, {}) };
}
export function saveUpdateSettings(input = {}) {
  const s = updateSettings();
  if (typeof input.auto === 'boolean') s.auto = input.auto;
  if (Number.isInteger(input.hour) && input.hour >= 0 && input.hour <= 23) s.hour = input.hour;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
  return s;
}

/** Stato dell'ultimo aggiornamento (scritto dallo script di aggiornamento). */
export function lastUpdate() {
  return readJson(STATUS_FILE, null);
}

/** Chiede al servizio di sistema di aggiornare adesso. */
export function requestUpdate() {
  if (!isManaged()) throw Object.assign(new Error('L\'aggiornamento automatico c\'è solo su Raspberry (installato con lo script).'), { status: 400 });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(REQUEST_FILE, new Date().toISOString());
  log.info('Aggiornamento richiesto dalla dashboard');
  return { requested: true };
}

export async function updateState() {
  return {
    managed: isManaged(),
    commit: (await installedCommit()).slice(0, 7),
    pending: fs.existsSync(REQUEST_FILE),
    settings: updateSettings(),
    last: lastUpdate(),
    check: await checkForUpdates(),
  };
}

// ---------- Copia di sicurezza: esporta e importa ----------

// Cosa entra nella copia: impostazioni, dati (accessi a Twitch, storico, immagini e suoni, titoli di coda...) e .env.
// La musica no: può pesare gigabyte e resta comunque nella cartella (o sul tuo PC).
const MUSIC_IN_DATA = path.join('media', 'music');
const SKIP_IN_DATA = new Set(['backups', 'twitchgestor.pid', 'twitchgestor.log', 'update-request', 'update-status.json', 'update-bad-commit', 'system-setup-requested', 'remote-access-request', 'remote-access-status.json', 'tts', 'piper']);

/** Crea un file .tar.gz con tutto quello che serve per ripartire su un altro computer. Ritorna il percorso. */
export async function createBackup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-export-'));
  const stage = path.join(tmp, 'twitchgestor');
  fs.mkdirSync(path.join(stage, 'config'), { recursive: true });
  const userConfig = path.join(ROOT_DIR, 'config', 'config.json');
  if (fs.existsSync(userConfig)) fs.copyFileSync(userConfig, path.join(stage, 'config', 'config.json'));
  if (fs.existsSync(ENV_FILE)) fs.copyFileSync(ENV_FILE, path.join(stage, 'env.txt'));
  if (fs.existsSync(DATA_DIR)) {
    for (const entry of fs.readdirSync(DATA_DIR)) {
      if (SKIP_IN_DATA.has(entry)) continue;
      fs.cpSync(path.join(DATA_DIR, entry), path.join(stage, 'data', entry), {
        recursive: true,
        filter: (from) => path.relative(DATA_DIR, from) !== MUSIC_IN_DATA,
      });
    }
  }
  fs.writeFileSync(path.join(stage, 'twitchgestor-backup.json'), JSON.stringify({ createdAt: new Date().toISOString(), from: os.hostname() }));
  const file = path.join(tmp, 'twitchgestor.tar.gz');
  await run('tar', ['-czf', file, '-C', tmp, 'twitchgestor']);
  fs.rmSync(stage, { recursive: true, force: true });
  return { file, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

/** Righe "CHIAVE=valore" del file .env. */
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

// Queste restano quelle del computer su cui importi (es. sul Raspberry HOST=0.0.0.0 e la password della dashboard).
const LOCAL_ENV_KEYS = ['HOST', 'PORT', 'PUBLIC_URL', 'DASHBOARD_TOKEN', 'TWITCHGESTOR_MANAGED'];

/** Unisce il .env importato con quello di questo computer: chiavi di Twitch e donazioni da quello importato. */
export function mergeEnv(localText, importedText) {
  const local = parseEnv(localText);
  const imported = parseEnv(importedText);
  const merged = { ...local };
  for (const [k, v] of Object.entries(imported)) if (!LOCAL_ENV_KEYS.includes(k) && v !== '') merged[k] = v;
  const trimmed = String(localText).replace(/\s+$/, '');
  const lines = (trimmed ? trimmed.split(/\r?\n/) : []).map((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    return m && m[1] in merged ? `${m[1]}=${merged[m[1]]}` : line;
  });
  for (const [k, v] of Object.entries(merged)) if (!(k in local)) lines.push(`${k}=${v}`);
  return lines.join('\n').replace(/\n*$/, '\n');
}

const isLoopback = (h) => /^(127\.|localhost$|::1$)/i.test(String(h ?? ''));
const lanAddress = (addr) => {
  const a = String(addr ?? '').replace(/^::ffff:/, '');
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a) ? a : null;
};

/**
 * Importa una copia di sicurezza (file .tar.gz creato da "Esporta").
 * clientAddress: indirizzo del computer da cui stai importando. Se OBS era impostato su "questo PC" (127.0.0.1)
 * e importi dal PC dove gira OBS, l'indirizzo di OBS diventa quello del PC.
 */
export async function restoreBackup(archive, { clientAddress } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-import-'));
  try {
    try {
      await run('tar', ['-xzf', archive, '-C', tmp]);
    } catch {
      throw Object.assign(new Error('Il file non è una copia di TwitchGestor valida'), { status: 400 });
    }
    const src = path.join(tmp, 'twitchgestor');
    if (!fs.existsSync(path.join(src, 'twitchgestor-backup.json'))) throw Object.assign(new Error('Il file non è una copia di TwitchGestor'), { status: 400 });
    // prima una copia di quello che c'è adesso, per sicurezza
    const safety = await createBackup();
    const backups = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(backups, { recursive: true });
    fs.copyFileSync(safety.file, path.join(backups, `prima-di-importare-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`));
    safety.cleanup();

    const userConfig = path.join(src, 'config', 'config.json');
    if (fs.existsSync(userConfig)) {
      JSON.parse(fs.readFileSync(userConfig, 'utf8')); // deve essere valido
      fs.mkdirSync(path.join(ROOT_DIR, 'config'), { recursive: true });
      fs.copyFileSync(userConfig, path.join(ROOT_DIR, 'config', 'config.json'));
    }
    const dataSrc = path.join(src, 'data');
    if (fs.existsSync(dataSrc)) {
      for (const entry of fs.readdirSync(dataSrc)) {
        if (SKIP_IN_DATA.has(entry)) continue;
        fs.cpSync(path.join(dataSrc, entry), path.join(DATA_DIR, entry), { recursive: true, force: true });
      }
    }
    const envSrc = path.join(src, 'env.txt');
    if (fs.existsSync(envSrc)) {
      const local = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
      fs.writeFileSync(ENV_FILE, mergeEnv(local, fs.readFileSync(envSrc, 'utf8')));
    }
    const obsFile = path.join(DATA_DIR, 'obs.json');
    const pc = lanAddress(clientAddress);
    let obsHost = null;
    if (pc && fs.existsSync(obsFile)) {
      const obs = readJson(obsFile, null);
      if (obs && isLoopback(obs.host) && !isLoopback(pc)) {
        obs.host = pc;
        fs.writeFileSync(obsFile, JSON.stringify(obs, null, 2));
        obsHost = pc;
      }
    }
    log.info(`Copia di sicurezza importata${obsHost ? ` (OBS ora su ${obsHost})` : ''}`);
    return { ok: true, obsHost };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
