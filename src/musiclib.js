/**
 * Libreria musicale: i file audio in data/media/music (e nelle sue sottocartelle, che diventano playlist).
 * È la stessa cartella condivisa in rete dal Raspberry: basta copiarci dentro i file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readTags } from './musicFolder.js';

// artista e titolo letti dentro i file, ricordati finché il file non cambia (si rilegge la cartella ogni minuto)
const tagCache = new Map();
function tagsOf(file) {
  let st;
  try { st = fs.statSync(file); } catch { return {}; }
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = tagCache.get(file);
  if (hit?.key === key) return hit.tags;
  const tags = readTags(file);
  tagCache.set(file, { key, tags });
  return tags;
}

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
        const tags = tagsOf(path.join(dir, r));
        out.push({ id: r, url: `/media/music/${r.split('/').map(encodeURIComponent).join('/')}`, folder: rel.split('/')[0] ?? '', name: e.name, artist: tags.artist || tags.albumArtist || '', title: tags.title || '' });
      }
    }
  };
  walk('', 0);
  // mix divisi per capitoli con una versione vecchia di Musicante: dentro ogni file c'è il titolo del video intero.
  // Se lo stesso titolo è dentro 3 o più brani della stessa cartella, si usa il nome del file (quello del capitolo).
  const same = new Map();
  for (const t of out) if (t.title) { const k = `${path.dirname(t.id)}\n${t.title}`; same.set(k, (same.get(k) ?? 0) + 1); }
  for (const t of out) if (t.title && same.get(`${path.dirname(t.id)}\n${t.title}`) >= 3) t.title = '';
  return out.sort((a, b) => a.id.localeCompare(b.id, 'it'));
}
