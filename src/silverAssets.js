// Silver (il compagno sul desktop del PC): la sua immagine e la sua voce restano solo qui sul Raspberry
// (in data/silver, mai su GitHub né dentro Silver.exe). Le carichi tu dal pannello; Silver le scarica da qui.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const DIR = path.join(DATA_DIR, 'silver');
const LIMIT = { image: 15 * 1024 * 1024, voice: 5 * 1024 * 1024 };
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg' };

// che file è davvero (dai primi byte, non dal nome)
export function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
  return null;
}

function find(kind) {
  for (const ext of kind === 'image' ? ['png', 'jpg', 'webp'] : ['mp3']) {
    const file = path.join(DIR, `${kind}.${ext}`);
    if (fs.existsSync(file)) return { file, ext };
  }
  return null;
}

// versione (data di modifica): Silver riscarica solo quando cambia; 0 = non c'è
export function versions() {
  const v = (kind) => { const f = find(kind); return f ? Math.round(fs.statSync(f.file).mtimeMs) : 0; };
  return { image: v('image'), voice: v('voice') };
}

export async function save(req, kind) {
  if (!(kind in LIMIT)) throw Object.assign(new Error('Tipo sconosciuto'), { status: 400 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT[kind]) throw Object.assign(new Error(`File troppo grande (massimo ${LIMIT[kind] / 1024 / 1024} MB)`), { status: 413 });
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  const ext = sniff(buf);
  if (kind === 'image' ? !['png', 'jpg', 'webp'].includes(ext) : ext !== 'mp3') {
    throw Object.assign(new Error(kind === 'image' ? 'Serve un\'immagine PNG, JPG o WEBP' : 'Serve un file MP3'), { status: 400 });
  }
  fs.mkdirSync(DIR, { recursive: true });
  const old = find(kind);
  if (old) fs.rmSync(old.file);
  fs.writeFileSync(path.join(DIR, `${kind}.${ext}`), buf);
  return versions();
}

export function remove(kind) {
  const f = find(kind);
  if (f) fs.rmSync(f.file);
  return versions();
}

// per mandarlo a Silver: { file, type } oppure null
export function get(kind) {
  const f = find(kind);
  return f ? { file: f.file, type: TYPES[f.ext] } : null;
}
