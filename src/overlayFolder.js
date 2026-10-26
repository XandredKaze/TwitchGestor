/**
 * Scheda "Overlay": la cartella data/media/overlay (sul Raspberry è nella cartella condivisa,
 * da Windows \\twitchgestor\TwitchGestor\overlay) con le grafiche, i video e i suoni delle scene di OBS.
 * Da qui si caricano e si organizzano i file e, su richiesta, si fanno leggere alle sorgenti di OBS
 * i file di questa cartella invece di quelli sul PC (ricordando il percorso di prima per poter tornare indietro).
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  OVERLAY_LIMIT, OVERLAY_EXTS, overlayType, cleanRelPath, cleanFileName,
  classifySources, readObsSources, targetPath, linkSettings, baseName,
} from './core/overlayFiles.js';

const err = (status, message) => Object.assign(new Error(message), { status });

/**
 * dir: cartella sul disco; linksFile: dove si ricordano i percorsi di prima;
 * obs: client di OBS (request, status); root(): percorso con cui OBS (sul PC) vede la cartella, o '' se non lo vede.
 */
export function createOverlayFolder({ dir, linksFile, obs, root = () => '' }) {
  fs.mkdirSync(dir, { recursive: true });
  const readLinks = () => { try { return JSON.parse(fs.readFileSync(linksFile, 'utf8')); } catch { return {}; } };
  const writeLinks = (links) => {
    fs.mkdirSync(path.dirname(linksFile), { recursive: true });
    fs.writeFileSync(linksFile, JSON.stringify(links, null, 2));
  };

  /** Percorso sul disco di un file o cartella (mai fuori dalla cartella overlay). */
  function abs(rel, { allowRoot = false } = {}) {
    const clean = cleanRelPath(rel);
    if (!clean && !allowRoot) throw err(400, 'Percorso non valido');
    const p = path.resolve(dir, clean);
    if (p !== dir && !p.startsWith(dir + path.sep)) throw err(400, 'Percorso non valido');
    return p;
  }

  function list() {
    const files = [];
    const folders = [];
    const walk = (d, rel, depth) => {
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue; // file nascosti e caricamenti in corso
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          folders.push(r);
          if (depth < 4) walk(path.join(d, e.name), r, depth + 1);
        } else if (e.isFile()) {
          let st;
          try { st = fs.statSync(path.join(d, e.name)); } catch { continue; }
          files.push({ path: r, name: e.name, folder: rel, size: st.size, mtime: st.mtimeMs, type: overlayType(e.name), url: `/media/overlay/${r.split('/').map(encodeURIComponent).join('/')}` });
        }
      }
    };
    walk(dir, '', 1);
    folders.sort((a, b) => a.localeCompare(b, 'it'));
    files.sort((a, b) => a.path.localeCompare(b.path, 'it'));
    return { files, folders, root: root(), limit: OVERLAY_LIMIT, exts: OVERLAY_EXTS };
  }

  /** Salva un file caricato (lo scrive a pezzi su disco: i video possono essere grandi). */
  async function save(req, folder, rawName) {
    const name = cleanFileName(rawName);
    if (!name) throw err(400, `Formato non supportato. Usa: ${OVERLAY_EXTS.join(', ')}`);
    const d = abs(folder, { allowRoot: true });
    fs.mkdirSync(d, { recursive: true });
    const ext = path.extname(name);
    let final = name;
    for (let i = 2; fs.existsSync(path.join(d, final)); i++) final = `${path.basename(name, ext)} (${i})${ext}`;
    const tmp = path.join(d, `.caricamento-${randomUUID()}`);
    let size = 0;
    const out = fs.createWriteStream(tmp);
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > OVERLAY_LIMIT) throw err(413, `File troppo grande (massimo ${OVERLAY_LIMIT / 1024 / 1024} MB)`);
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
      if (!size) throw err(400, 'File vuoto');
      fs.renameSync(tmp, path.join(d, final));
    } catch (e) {
      out.destroy();
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    return path.relative(dir, path.join(d, final)).split(path.sep).join('/');
  }

  function mkdir(rel) {
    const p = abs(rel);
    fs.mkdirSync(p, { recursive: true });
    return cleanRelPath(rel);
  }

  /** Rinomina o sposta (to = nuovo percorso relativo). Le sorgenti di OBS collegate seguono il file. */
  async function rename(from, to) {
    const src = abs(from);
    if (!fs.existsSync(src)) throw err(404, 'File non trovato');
    const isDir = fs.statSync(src).isDirectory();
    const dest = abs(to);
    if (!isDir && !OVERLAY_EXTS.includes(path.extname(dest).toLowerCase())) throw err(400, 'Mantieni l\'estensione del file (es. .png, .mp4)');
    if (dest.toLowerCase() === src.toLowerCase() && dest !== src) {
      // solo maiuscole/minuscole: passaggio intermedio (Windows non distingue)
      const mid = `${src}.rinomina-${randomUUID()}`;
      fs.renameSync(src, mid);
      fs.renameSync(mid, dest);
    } else {
      if (dest === src) return { from: cleanRelPath(from), to: cleanRelPath(to), relinked: 0 };
      if (fs.existsSync(dest)) throw err(409, 'Esiste già un file o una cartella con quel nome');
      if (isDir && dest.startsWith(src + path.sep)) throw err(400, 'Non puoi spostare una cartella dentro sé stessa');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(src, dest);
    }
    const fromRel = path.relative(dir, src).split(path.sep).join('/');
    const toRel = path.relative(dir, dest).split(path.sep).join('/');
    let relinked = 0;
    // le sorgenti che usavano il file (o i file nella cartella) ora leggono il nuovo percorso
    if (obs?.status === 'connesso' && root()) {
      try {
        for (const s of await sources().then((r) => r.sources)) {
          if (!s.onGestor || !s.rel) continue;
          const r = s.rel.toLowerCase();
          const f = fromRel.toLowerCase();
          if (r !== f && !(isDir && r.startsWith(`${f}/`))) continue;
          const next = toRel + s.rel.slice(fromRel.length);
          await obs.request('SetInputSettings', { inputName: s.name, inputSettings: linkSettings(s.kind, targetPath(root(), next)), overlay: true });
          relinked += 1;
        }
      } catch { /* OBS non risponde: le sorgenti si ricollegano a mano */ }
    }
    return { from: fromRel, to: toRel, relinked };
  }

  function remove(rel) {
    const p = abs(rel);
    if (!fs.existsSync(p)) throw err(404, 'File non trovato');
    fs.rmSync(p, { recursive: true, force: true });
  }

  /** Le sorgenti di OBS che usano un file: sul PC o già nella cartella di Gestor. */
  async function sources() {
    if (!obs) return { connected: false, error: 'Collegamento a OBS non disponibile', sources: [] };
    if (obs.status !== 'connesso') return { connected: false, error: obs.error || 'OBS non è collegato a TwitchGestor', sources: [] };
    const links = readLinks();
    const r = root();
    const inputs = await readObsSources((type, data) => obs.request(type, data));
    const files = list().files.map((f) => ({ path: f.path, name: f.name }));
    const found = classifySources(inputs, { root: r, files }).map((s) => ({ ...s, previous: links[s.name]?.previous ?? null }));
    return { connected: true, root: r, sources: found };
  }

  /** Fa leggere a una sorgente il file della cartella overlay (rel; se manca, quello con lo stesso nome). */
  async function link(name, rel) {
    const r = root();
    if (!r) throw err(409, 'OBS non può vedere la cartella: la cartella condivisa del Raspberry non è ancora attiva');
    const { sources: all, connected, error } = await sources();
    if (!connected) throw err(409, error);
    const s = all.find((x) => x.name === name);
    if (!s) throw err(404, 'Sorgente non trovata in OBS');
    const target = rel ? cleanRelPath(rel) : s.match;
    if (!target) throw err(400, `Nella cartella overlay non c'è un file che si chiama "${baseName(s.file)}": caricalo prima`);
    if (!fs.existsSync(abs(target))) throw err(404, 'File non trovato nella cartella overlay');
    const links = readLinks();
    if (!s.onGestor) { links[name] = { previous: s.file, kind: s.kind, at: Date.now() }; writeLinks(links); }
    await obs.request('SetInputSettings', { inputName: name, inputSettings: linkSettings(s.kind, targetPath(r, target)), overlay: true });
    return { name, path: target };
  }

  /** Collega tutte le sorgenti che hanno un file con lo stesso nome nella cartella overlay. */
  async function linkAll() {
    const { sources: all, connected, error } = await sources();
    if (!connected) throw err(409, error);
    let done = 0;
    const failed = [];
    for (const s of all.filter((x) => !x.onGestor && x.match)) {
      try { await link(s.name, s.match); done += 1; } catch (e) { failed.push(`${s.name}: ${e.message}`); }
    }
    return { linked: done, failed };
  }

  /** Torna al file di prima (sul PC). */
  async function restore(name) {
    const links = readLinks();
    const prev = links[name];
    if (!prev?.previous) throw err(404, 'Non ricordo il file di prima per questa sorgente');
    if (obs?.status !== 'connesso') throw err(409, 'OBS non è collegato a TwitchGestor');
    await obs.request('SetInputSettings', { inputName: name, inputSettings: linkSettings(prev.kind, prev.previous), overlay: true });
    delete links[name];
    writeLinks(links);
    return { name, path: prev.previous };
  }

  return { dir, list, save, mkdir, rename, remove, sources, link, linkAll, restore };
}
