import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logger.js';

const log = createLogger('config');

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
const DEFAULT_FILE = path.join(ROOT_DIR, 'config', 'default.json');
const USER_FILE = path.join(ROOT_DIR, 'config', 'config.json');

export function loadEnv() {
  const envFile = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Unione ricorsiva: gli oggetti si fondono, array e valori semplici vengono sostituiti. */
export function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Configurazione = config/default.json + config/config.json (facoltativo, solo le chiavi da cambiare).
 * Il file utente viene ricaricato automaticamente quando lo salvi, anche durante la live.
 */
export class ConfigStore extends EventEmitter {
  constructor() {
    super();
    this.current = this.#load();
  }

  #load() {
    const defaults = readJson(DEFAULT_FILE);
    if (!fs.existsSync(USER_FILE)) return defaults;
    return deepMerge(defaults, readJson(USER_FILE));
  }

  get() {
    return this.current;
  }

  watch() {
    let timer;
    fs.watchFile(USER_FILE, { interval: 1000 }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          this.current = this.#load();
          log.info('config/config.json ricaricato');
          this.emit('change', this.current);
        } catch (err) {
          log.error(`config/config.json non valido, mantengo la configurazione precedente: ${err.message}`);
        }
      }, 200);
    });
  }
}
