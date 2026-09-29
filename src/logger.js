const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, scope, ...args) {
  if (LEVELS[level] < minLevel) return;
  const time = new Date().toLocaleTimeString('it-IT');
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${time}] ${level.toUpperCase().padEnd(5)} [${scope}]`, ...args);
}

export function createLogger(scope) {
  return {
    debug: (...a) => log('debug', scope, ...a),
    info: (...a) => log('info', scope, ...a),
    warn: (...a) => log('warn', scope, ...a),
    error: (...a) => log('error', scope, ...a),
  };
}
