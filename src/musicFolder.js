/**
 * Organizzare la musica (scheda Musica → Organizza): spostare brani tra playlist (= sottocartelle di
 * data/media/music), rinominare una playlist, eliminare brani e riordinare in automatico per artista.
 * Usato anche da Musicante per mettere i download nuovi nella playlist dell'artista.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readId3 } from './core/id3.js';
import { cleanPlaylist, planByArtist, summarizePlan, artistOf, VARIE } from './core/musicOrganize.js';

const AUDIO = /\.(mp3|ogg|wav|m4a|flac|opus)$/i;
const err = (status, message) => Object.assign(new Error(message), { status });

/** Artista e titolo scritti dentro un MP3 (si legge solo l'inizio del file). */
export function readTags(file) {
  if (!/\.mp3$/i.test(file)) return {};
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return readId3(buf.subarray(0, n));
  } catch {
    return {};
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Sposta un file in una cartella senza mai sovrascriverne uno con lo stesso nome. Ritorna il percorso nuovo. */
export function moveFile(file, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  let dest = path.join(dir, `${base}${ext}`);
  if (dest === file) return file;
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${base} (${n})${ext}`);
  try { fs.renameSync(file, dest); } catch { fs.copyFileSync(file, dest); fs.rmSync(file, { force: true }); }
  return dest;
}

/**
 * La cartella giusta per un brano appena scaricato (download "per artista" di Musicante), con la stessa regola
 * del riordino: la playlist dell'artista se c'è già; se in "Varie" c'è già un suo brano, nasce la sua playlist
 * (e quel brano ci si sposta); altrimenti "Varie". Ritorna il percorso della cartella.
 */
export function placeNewTrack(musicDir, file) {
  const artist = artistOf({ name: path.basename(file), tags: readTags(file) });
  const varie = path.join(musicDir, VARIE);
  if (!artist) return varie;
  const key = artist.toLowerCase();
  let existing = [];
  try { existing = fs.readdirSync(musicDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* cartella nuova */ }
  const own = existing.find((f) => f.toLowerCase() === key && f !== VARIE);
  if (own) return path.join(musicDir, own);
  let mates = [];
  try {
    mates = fs.readdirSync(varie).filter((n) => AUDIO.test(n))
      .filter((n) => artistOf({ name: n, tags: readTags(path.join(varie, n)) }).toLowerCase() === key);
  } catch { /* "Varie" non c'è ancora */ }
  if (!mates.length) return varie;
  const dir = path.join(musicDir, artist);
  for (const n of mates) moveFile(path.join(varie, n), dir);
  return dir;
}

export function createMusicFolder({ dir }) {
  /** Percorso sul disco di un brano ("Playlist/brano.mp3"), mai fuori dalla cartella della musica. */
  function abs(id) {
    const p = path.resolve(dir, String(id ?? ''));
    if (!p.startsWith(dir + path.sep) || !AUDIO.test(p)) throw err(400, 'Brano non valido');
    return p;
  }
  function folderPath(name) {
    const clean = cleanPlaylist(name);
    return { clean, p: clean ? path.join(dir, clean) : dir };
  }
  const rel = (p) => path.relative(dir, p).split(path.sep).join('/');
  const folders = () => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name); } catch { return []; } };

  /** Sposta i brani nella playlist (anche nuova; '' = cartella principale). skip: brani da non toccare. */
  function move(ids, folder, { skip = [] } = {}) {
    const { p: target } = folderPath(folder);
    let moved = 0;
    const skipped = [];
    for (const id of ids ?? []) {
      if (skip.includes(id)) { skipped.push(id); continue; }
      const src = abs(id);
      if (!fs.existsSync(src)) continue;
      if (path.dirname(src) === target) continue;
      moveFile(src, target);
      moved += 1;
    }
    cleanEmpty();
    return { moved, skipped };
  }

  function remove(ids, { skip = [] } = {}) {
    let removed = 0;
    const skipped = [];
    for (const id of ids ?? []) {
      if (skip.includes(id)) { skipped.push(id); continue; }
      const p = abs(id);
      if (fs.existsSync(p)) { fs.rmSync(p, { force: true }); removed += 1; }
    }
    cleanEmpty();
    return { removed, skipped };
  }

  /** Rinomina una playlist; se esiste già una con quel nome, i brani si uniscono. */
  function renameFolder(from, to, { skip = [] } = {}) {
    const { clean: a, p: src } = folderPath(from);
    const { clean: b, p: dest } = folderPath(to);
    if (!a || !b) throw err(400, 'Nome della playlist non valido');
    if (!fs.existsSync(src)) throw err(404, 'Playlist non trovata');
    if (a === b) return { moved: 0, skipped: [] };
    const ids = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (AUDIO.test(e.name)) ids.push(rel(p)); } };
    walk(src);
    if (!fs.existsSync(dest) && !skip.some((id) => id.startsWith(`${a}/`)) && a.toLowerCase() !== b.toLowerCase()) {
      fs.renameSync(src, dest); // la via veloce: rinomina la cartella intera
      return { moved: ids.length, skipped: [] };
    }
    return move(ids, b, { skip });
  }

  /** Brani di una playlist (o di tutta la musica se folder è null) con i dati letti dai file. */
  function tracksIn(folder) {
    const out = [];
    const walk = (d, depth) => {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory() && depth < 2) walk(p, depth + 1);
        else if (e.isFile() && AUDIO.test(e.name)) {
          const id = rel(p);
          out.push({ id, name: e.name, folder: id.includes('/') ? id.split('/')[0] : '', tags: readTags(p) });
        }
      }
    };
    if (folder === null || folder === undefined || folder === '*') walk(dir, 0);
    else {
      const { clean, p } = folderPath(folder);
      if (!clean) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isFile() && AUDIO.test(e.name)) out.push({ id: e.name, name: e.name, folder: '', tags: readTags(path.join(dir, e.name)) }); }
      else walk(p, 1);
    }
    return out;
  }

  /** Anteprima del riordino per artista (niente viene spostato). */
  function preview(folder) {
    const tracks = tracksIn(folder);
    const plan = planByArtist(tracks, { existing: folders().filter((f) => f !== VARIE) });
    return { total: tracks.length, groups: summarizePlan(plan), plan };
  }

  /** Riordina per artista. */
  function organize(folder, { skip = [] } = {}) {
    const { plan } = preview(folder);
    let moved = 0;
    const skipped = [];
    for (const p of plan) {
      if (p.from === p.to) continue;
      if (skip.includes(p.id)) { skipped.push(p.id); continue; }
      moveFile(abs(p.id), path.join(dir, p.to));
      moved += 1;
    }
    cleanEmpty();
    return { moved, skipped };
  }

  /** Le playlist rimaste vuote spariscono. */
  function cleanEmpty() {
    for (const f of folders()) {
      const p = path.join(dir, f);
      try {
        const left = fs.readdirSync(p).filter((n) => !n.startsWith('.'));
        if (!left.length) fs.rmSync(p, { recursive: true, force: true });
      } catch { /* niente */ }
    }
  }

  return { move, remove, renameFolder, preview, organize, folders };
}
