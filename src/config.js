import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createLogger } from './logger.js';
import { sanitizeConfig, diffConfig } from './core/schema.js';

const log = createLogger('config');

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
// I valori predefiniti stanno tra i file del programma (src/core/defaults.json), così si aggiornano
// sempre insieme al codice. In config/ restano solo le impostazioni dell'utente (config.json).
const DEFAULT_FILE = path.join(ROOT_DIR, 'src', 'core', 'defaults.json');
const OLD_DEFAULT_FILE = path.join(ROOT_DIR, 'config', 'default.json');
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
 * Configurazione = valori predefiniti (src/core/defaults.json) + config/config.json (facoltativo, solo le chiavi da cambiare).
 * Il file utente viene ricaricato automaticamente quando lo salvi, anche durante la live.
 */
export class ConfigStore extends EventEmitter {
  constructor() {
    super();
    this.current = this.#load();
    if (fs.existsSync(OLD_DEFAULT_FILE)) {
      log.info('config/default.json è di una versione precedente e non viene più usato: puoi cancellarlo');
    }
  }

  #load() {
    const defaults = readJson(DEFAULT_FILE);
    if (!fs.existsSync(USER_FILE)) return defaults;
    return deepMerge(defaults, readJson(USER_FILE));
  }

  get() {
    return this.current;
  }

  defaults() {
    return readJson(DEFAULT_FILE);
  }

  /** Salva le impostazioni arrivate dalla dashboard (validate) e le applica subito. */
  save(input) {
    const defaults = this.defaults();
    const next = sanitizeConfig(input, defaults);
    const diff = diffConfig(next, defaults) ?? {};
    fs.mkdirSync(path.dirname(USER_FILE), { recursive: true });
    fs.writeFileSync(USER_FILE, `${JSON.stringify(diff, null, 2)}\n`);
    this.current = deepMerge(defaults, diff);
    this.emit('change', this.current);
    return this.current;
  }

  watch() {
    let timer;
    fs.watchFile(USER_FILE, { interval: 1000 }, (curr, prev) => {
      if (curr.mtimeMs === prev.mtimeMs) return;
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
