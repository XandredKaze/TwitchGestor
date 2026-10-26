/**
 * Scheda "Overlay": grafiche e media delle scene di OBS tenuti nella cartella condivisa del Raspberry
 * (data/media/overlay, da Windows \\twitchgestor\TwitchGestor\overlay) invece che sul PC.
 * Qui c'è solo la logica pura (nomi sicuri, quali sorgenti di OBS usano un file, dove ricollegarle):
 * la usano il programma sul Raspberry e la demo nel browser.
 */

export const OVERLAY_TYPES = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.apng'],
  video: ['.webm', '.mp4', '.mov', '.mkv', '.m4v'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.opus'],
  // pagine HTML locali delle sorgenti browser, con quello che usano
  web: ['.html', '.htm', '.css', '.js', '.json', '.ttf', '.otf', '.woff', '.woff2'],
};
export const OVERLAY_EXTS = Object.values(OVERLAY_TYPES).flat();
export const OVERLAY_LIMIT = 500 * 1024 * 1024; // i video delle scene possono essere grandi

const extOf = (name) => {
  const m = /\.[^./\\]+$/.exec(String(name ?? ''));
  return m ? m[0].toLowerCase() : '';
};

/** 'image' | 'video' | 'audio' | 'web' | '' */
export function overlayType(name) {
  const e = extOf(name);
  return Object.keys(OVERLAY_TYPES).find((k) => OVERLAY_TYPES[k].includes(e)) ?? '';
}

/** Un pezzo di percorso (cartella o file) sicuro: niente "..", barre o caratteri che Windows non accetta. */
export function cleanSegment(input) {
  return String(input ?? '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .trim();
}

/** "Scena 1/sfondo.png" → percorso relativo sicuro (al massimo 3 cartelle); '' se non valido. */
export function cleanRelPath(input) {
  const parts = String(input ?? '').split(/[\\/]+/).map(cleanSegment).filter(Boolean);
  if (parts.length > 4) return '';
  return parts.join('/');
}

/** Nome di un file caricato: sicuro e con un'estensione ammessa ('' se non ammessa). */
export function cleanFileName(input) {
  const name = cleanSegment(String(input ?? '').split(/[\\/]/).pop());
  return name && OVERLAY_EXTS.includes(extOf(name)) ? name : '';
}

/** Le sorgenti di OBS che leggono un file, e in quale impostazione. */
export const FILE_SOURCES = {
  image_source: { key: 'file', label: 'Immagine' },
  ffmpeg_source: { key: 'local_file', label: 'Video / audio', local: 'is_local_file' },
  browser_source: { key: 'local_file', label: 'Browser (file locale)', local: 'is_local_file' },
  gif_source: { key: 'file', label: 'GIF' },
};

/** Il file usato da una sorgente ('' se non usa un file, es. una sorgente browser con un indirizzo web). */
export function sourceFile(kind, settings = {}) {
  const def = FILE_SOURCES[kind];
  if (!def) return '';
  if (def.local && settings[def.local] === false) return '';
  return String(settings[def.key] ?? '').trim();
}

/** Ultimo pezzo di un percorso Windows o Linux. */
export const baseName = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '';

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Percorso con cui OBS legge un file della cartella overlay.
 * root: '\\\\twitchgestor\\TwitchGestor\\overlay' (rete, da Windows) oppure la cartella sul disco.
 */
export function targetPath(root, rel) {
  const sep = String(root).includes('\\') ? '\\' : '/';
  return [String(root).replace(/[\\/]+$/, ''), ...String(rel).split('/').filter(Boolean)].join(sep);
}

/** Se un percorso è dentro la cartella overlay, ritorna il percorso relativo ("Scena/file.png"), altrimenti null. */
export function relInside(root, filePath) {
  const r = norm(root);
  const f = String(filePath ?? '').replace(/\\/g, '/');
  if (!r || !f.toLowerCase().startsWith(`${r}/`)) return null;
  return f.slice(r.length + 1).replace(/^\/+/, '');
}

/**
 * Per ogni sorgente di OBS che usa un file: dov'è il file e se nella cartella di Gestor ce n'è uno con lo stesso nome.
 * inputs: [{ name, kind, settings, scenes }]; files: [{ path, name }] (percorsi relativi alla cartella overlay).
 * Ritorna [{ name, kind, label, scenes, file, onGestor, rel, match, missing }] (solo le sorgenti con un file).
 */
export function classifySources(inputs, { root, files = [] }) {
  const byName = new Map();
  for (const f of files) {
    const k = String(f.name ?? baseName(f.path)).toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(f.path);
  }
  const exists = new Set(files.map((f) => norm(f.path)));
  const out = [];
  for (const input of inputs ?? []) {
    const file = sourceFile(input.kind, input.settings);
    if (!file) continue;
    const rel = root ? relInside(root, file) : null;
    const onGestor = rel !== null;
    // con più file con lo stesso nome si sceglie quello nella cartella che ha il nome della scena, se c'è
    const candidates = onGestor ? [] : byName.get(baseName(file).toLowerCase()) ?? [];
    const sceneDirs = (input.scenes ?? []).map((s) => cleanSegment(s).toLowerCase());
    const match = candidates.find((p) => sceneDirs.includes(p.split('/')[0].toLowerCase())) ?? candidates[0] ?? null;
    out.push({
      name: input.name,
      kind: input.kind,
      label: FILE_SOURCES[input.kind]?.label ?? input.kind,
      scenes: input.scenes ?? [],
      file,
      onGestor,
      rel: onGestor ? rel : null,
      missing: onGestor && !exists.has(norm(rel)), // collegata a Gestor ma il file non c'è più
      match,
    });
  }
  return out.sort((a, b) => Number(a.onGestor) - Number(b.onGestor) || a.name.localeCompare(b.name, 'it'));
}

/** Impostazioni da mandare a OBS (SetInputSettings) per far leggere alla sorgente il file nella cartella di Gestor. */
export function linkSettings(kind, path) {
  const def = FILE_SOURCES[kind];
  if (!def) return null;
  return { [def.key]: path, ...(def.local ? { [def.local]: true } : {}) };
}

/** "12,3 MB" */
export function formatSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toLocaleString('it-IT', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

/**
 * Legge da OBS (obs-websocket 5) le sorgenti che usano un file e in quali scene stanno.
 * request: (tipo, dati) => Promise (es. obs.request). Ritorna [{ name, kind, settings, scenes }].
 */
export async function readObsSources(request) {
  const { inputs = [] } = await request('GetInputList');
  const kindOf = (i) => i.unversionedInputKind || i.inputKind;
  const wanted = inputs.filter((i) => FILE_SOURCES[kindOf(i)]);
  const scenesOf = new Map();
  const add = (source, scene) => {
    if (!scenesOf.has(source)) scenesOf.set(source, []);
    if (!scenesOf.get(source).includes(scene)) scenesOf.get(source).push(scene);
  };
  const { scenes = [] } = await request('GetSceneList');
  for (const s of [...scenes].reverse()) { // OBS le elenca dal basso: così restano nell'ordine che vedi
    const { sceneItems = [] } = await request('GetSceneItemList', { sceneName: s.sceneName }).catch(() => ({}));
    for (const it of sceneItems) {
      add(it.sourceName, s.sceneName);
      if (it.isGroup) {
        const group = await request('GetGroupSceneItemList', { sceneName: it.sourceName }).catch(() => ({}));
        for (const g of group.sceneItems ?? []) add(g.sourceName, s.sceneName);
      }
    }
  }
  const out = [];
  for (const i of wanted) {
    const { inputSettings = {} } = await request('GetInputSettings', { inputName: i.inputName }).catch(() => ({}));
    out.push({ name: i.inputName, kind: kindOf(i), settings: inputSettings, scenes: scenesOf.get(i.inputName) ?? [] });
  }
  return out;
}
