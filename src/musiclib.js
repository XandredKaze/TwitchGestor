/**
 * Libreria musicale: i file audio in data/media/music (e nelle sue sottocartelle, che diventano playlist).
 * È la stessa cartella condivisa in rete dal Raspberry: basta copiarci dentro i file.
 */

import fs from 'node:fs';
import path from 'node:path';

const AUDIO = new Set(['.mp3', '.ogg', '.wav', '.m4a', '.flac', '.opus']);

/** Brani della cartella (fino a due livelli di sottocartelle). */
export function scanLibrary(dir) {
  const out = [];
  const walk = (rel, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory() && depth < 2) walk(r, depth + 1);
      else if (e.isFile() && AUDIO.has(path.extname(e.name).toLowerCase())) {
        out.push({ id: r, url: `/media/music/${r.split('/').map(encodeURIComponent).join('/')}`, folder: rel.split('/')[0] ?? '', name: e.name });
      }
    }
  };
  walk('', 0);
  return out.sort((a, b) => a.id.localeCompare(b.id, 'it'));
}
