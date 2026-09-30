import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

export { API_LEVEL, APP_VERSION } from './core/apiLevel.js';

const SRC_DIR = path.join(ROOT_DIR, 'src');

/** "Impronta" dei file del programma: cambia quando vengono sostituiti sul disco. */
function codeStamp() {
  let stamp = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.js')) {
        const st = fs.statSync(p);
        stamp = (stamp * 31 + Math.round(st.mtimeMs) + st.size) % 2 ** 48;
      }
    }
  };
  try { walk(SRC_DIR); } catch { /* cartella non leggibile */ }
  return stamp;
}

const startedWith = codeStamp();
let checkedAt = 0;
let stale = false;

/** Vero se i file del programma sono stati aggiornati dopo l'avvio (serve un riavvio). */
export function codeChangedSinceStart() {
  if (!stale && Date.now() - checkedAt > 10000) {
    checkedAt = Date.now();
    stale = codeStamp() !== startedWith;
  }
  return stale;
}
