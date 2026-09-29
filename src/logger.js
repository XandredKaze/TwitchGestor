import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

// Quando il programma gira nascosto non c'è una finestra: i messaggi finiscono anche in data/twitchgestor.log.
export const LOG_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'twitchgestor.log');
let stream = null;
if (!process.env.NODE_TEST_CONTEXT) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2_000_000) fs.renameSync(LOG_FILE, `${LOG_FILE}.old`);
    stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  } catch {
    stream = null;
  }
}

const recent = [];

/** Ultime righe del registro, mostrate nella dashboard. */
export function recentLogs() {
  return recent.slice();
}

function log(level, scope, ...args) {
  if (LEVELS[level] < minLevel) return;
  const time = new Date().toLocaleTimeString('it-IT');
  const line = `[${time}] ${level.toUpperCase().padEnd(5)} [${scope}] ${format(...args)}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(line);
  stream?.write(`${new Date().toISOString().slice(0, 10)} ${line}\n`);
  recent.push({ level, line });
  if (recent.length > 200) recent.shift();
}

export function createLogger(scope) {
  return {
    debug: (...a) => log('debug', scope, ...a),
    info: (...a) => log('info', scope, ...a),
    warn: (...a) => log('warn', scope, ...a),
    error: (...a) => log('error', scope, ...a),
  };
}
