/**
 * Musicante: scarica la musica in MP3 (anche playlist intere) con yt-dlp, direttamente nella cartella
 * della musica di TwitchGestor (data/media/music, una sottocartella = una playlist del lettore della live).
 * Pagina: http://<raspberry>:3200 (anche dal telefono, a casa o con Tailscale). Password: la stessa della dashboard.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Downloads } from './core/downloads.js';
import { cleanUrl, cleanFolder } from './core/ytdlp.js';
import { createTool } from './tool.js';
import { placeNewTrack } from '../../src/musicFolder.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..'); // cartella di TwitchGestor
const PUBLIC = path.resolve(HERE, '..', 'public');
const CORE = path.join(HERE, 'core');
if (!process.env.MUSICANTE_TEST && fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
const env = process.env;
const DATA = env.MUSICANTE_DATA || path.join(ROOT, 'data', 'musicante');
const MUSIC = env.MUSICANTE_MUSIC || path.join(ROOT, 'data', 'media', 'music');
const PORT = env.MUSICANTE_PORT !== undefined ? Number(env.MUSICANTE_PORT) : 3200;
const HOST = env.HOST || '127.0.0.1';
const TG_PORT = Number(env.PORT) || 3000;
const log = (...a) => console.log(new Date().toLocaleTimeString('it-IT'), '[musicante]', ...a);

fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(MUSIC, { recursive: true });
const JOBS_FILE = path.join(DATA, 'download.json');
const writeJson = (file, data) => { const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); };
const readJson = (file, def) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } };

let rev = Date.now(); // cambia a ogni novità: la pagina si aggiorna
const tool = createTool({ dataDir: DATA, log });

/** Cartella di destinazione dentro la musica (mai fuori). */
function folderPath(folder) {
  const name = cleanFolder(folder);
  const dir = path.resolve(MUSIC, name);
  if (dir !== MUSIC && !dir.startsWith(MUSIC + path.sep)) throw Object.assign(new Error('Cartella non valida'), { status: 400 });
  return dir;
}

// dopo ogni download TwitchGestor ricontrolla la cartella, così i brani compaiono subito nel lettore
async function rescanTwitchGestor() {
  try {
    await fetch(`http://127.0.0.1:${TG_PORT}/api/music/rescan`, {
      method: 'POST',
      headers: { 'x-twitchgestor': '1', 'Content-Type': 'application/json', ...(env.DASHBOARD_TOKEN ? { 'x-dashboard-token': env.DASHBOARD_TOKEN } : {}) },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* TwitchGestor ricontrolla comunque la cartella ogni minuto */ }
}

const downloads = new Downloads({
  store: { load: () => readJson(JOBS_FILE, []), save: (list) => writeJson(JOBS_FILE, list) },
  onChange: () => { rev = Date.now(); },
  log,
  // "per artista": ogni brano nella playlist del suo artista (o in "Varie"), come il riordino di TwitchGestor
  run: (job, opts) => tool.run(job, { ...opts, dir: job.byArtist ? (file) => placeNewTrack(MUSIC, file) : folderPath(job.folder) }).finally(() => { if (!env.MUSICANTE_TEST) rescanTwitchGestor(); }),
});

/** Sottocartelle della musica (le playlist di TwitchGestor). */
function folders() {
  try {
    return fs.readdirSync(MUSIC, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b, 'it'));
  } catch { return []; }
}

// --- pagina e API ---
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const authorized = (req, url) => !env.DASHBOARD_TOKEN || safeEqual(req.headers['x-dashboard-token'] ?? url.searchParams.get('token'), env.DASHBOARD_TOKEN);
const sameOrigin = (req) => !req.headers.origin || new URL(req.headers.origin).host === String(req.headers['x-forwarded-host'] || req.headers.host || '');

function send(res, status, body) {
  const isText = typeof body === 'string';
  res.writeHead(status, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(isText ? body : JSON.stringify(body));
}
function serveFile(res, base, rel) {
  let file;
  try { file = path.normalize(path.join(base, decodeURIComponent(rel))); } catch { return send(res, 400, 'Percorso non valido'); }
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Non trovato');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
async function readBody(req, limit = 100_000) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw Object.assign(new Error('Richiesta troppo grande'), { status: 413 });
  }
  try { return data ? JSON.parse(data) : {}; } catch { throw Object.assign(new Error('Dati non validi'), { status: 400 }); }
}

const view = () => ({ rev, tool: tool.state, folders: folders(), jobs: downloads.list().map((j) => ({ ...j, overall: Math.round(Downloads.overall(j)) })) });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /' || route === 'GET /index.html') return serveFile(res, PUBLIC, 'index.html');
    if (req.method === 'GET' && url.pathname.startsWith('/core/')) return serveFile(res, CORE, url.pathname.slice(6));
    if (!url.pathname.startsWith('/api/')) {
      if (req.method === 'GET') return serveFile(res, PUBLIC, url.pathname.slice(1));
      return send(res, 404, 'Non trovato');
    }
    if (!authorized(req, url)) return send(res, 401, { error: 'Password mancante o sbagliata' });
    if (req.method !== 'GET' && (req.headers['x-musicante'] !== '1' || !sameOrigin(req))) return send(res, 403, { error: 'Richiesta non consentita' });

    // TwitchGestor lo chiede prima di aggiornarsi: durante un download l'aggiornamento aspetta
    if (route === 'GET /api/busy') return send(res, 200, { busy: downloads.list().some((j) => j.status === 'running' || j.status === 'queued') });
    if (route === 'GET /api/state') {
      if (url.searchParams.get('rev') === String(rev)) return send(res, 200, { rev, unchanged: true });
      return send(res, 200, view());
    }
    if (route === 'POST /api/probe') {
      const body = await readBody(req);
      const u = cleanUrl(body.url);
      if (!u) return send(res, 400, { error: 'Incolla un link valido (https://…)' });
      return send(res, 200, { info: await tool.probe({ url: u, playlist: body.playlist === true }) });
    }
    if (route === 'POST /api/downloads') {
      const body = await readBody(req);
      folderPath(body.folder); // controlla la cartella
      const job = downloads.add(body);
      return send(res, 200, { job, ...view() });
    }
    if (route === 'POST /api/downloads/clear') { downloads.clearFinished(); return send(res, 200, view()); }
    const m = /^\/api\/downloads\/([\w-]+)(\/cancel)?$/.exec(url.pathname);
    if (m && req.method === 'POST' && m[2]) return send(res, downloads.cancel(m[1]) ? 200 : 404, view());
    if (m && req.method === 'DELETE' && !m[2]) return send(res, downloads.remove(m[1]) ? 200 : 404, view());
    if (route === 'PUT /api/cookies') { tool.setCookies((await readBody(req, 2_000_000)).text); rev = Date.now(); return send(res, 200, view()); }
    if (route === 'DELETE /api/cookies') { tool.setCookies(''); rev = Date.now(); return send(res, 200, view()); }
    if (route === 'POST /api/tool/update') { await tool.update(); rev = Date.now(); return send(res, 200, view()); }
    return send(res, 404, { error: 'Non trovato' });
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) log(`Errore: ${err.message}`);
    return send(res, status, { error: err.message });
  }
});

// yt-dlp: si scarica alla prima accensione e si aggiorna una volta al giorno (mai durante un download)
if (!env.MUSICANTE_TEST || env.MUSICANTE_YTDLP) {
  tool.ensure().then(() => { rev = Date.now(); });
}
if (!env.MUSICANTE_TEST) {
  setInterval(async () => {
    if (downloads.current || Date.now() - tool.state.updatedAt < 23 * 3600000) return;
    await tool.update();
    rev = Date.now();
  }, 3600000).unref();
}

export const ready = new Promise((resolve) => server.listen(PORT, HOST, () => { log(`Musicante pronto: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${server.address().port}`); resolve(server.address().port); }));
export { server, downloads, tool };
