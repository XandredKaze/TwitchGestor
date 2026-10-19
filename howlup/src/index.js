/**
 * Howl-UP: agenda, cose da fare e (presto) automatismi, accanto a TwitchGestor sullo stesso Raspberry.
 * Pagina: http://<raspberry>:3100 (anche dal telefono, a casa o con Tailscale). Password: la stessa della dashboard.
 * Dati: data/howlup/ (dentro la cartella di TwitchGestor, quindi nelle copie di sicurezza e negli aggiornamenti).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Agenda, toICS, livesToEvents } from './core/agenda.js';
import { createTwitchLink } from './twitchgestor.js';
import { Notifier, cleanSettings } from './core/notifier.js';
import { sendNtfy, sendTelegramMsg } from './channels.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..'); // cartella di TwitchGestor
const PUBLIC = path.resolve(HERE, '..', 'public');
const CORE = path.join(HERE, 'core');
const DATA = process.env.HOWLUP_DATA || path.join(ROOT, 'data', 'howlup');
const AGENDA_FILE = path.join(DATA, 'agenda.json');
const KEY_FILE = path.join(DATA, 'calendar-key');
const NOTIFY_FILE = path.join(DATA, 'notify.json'); // impostazioni delle notifiche
const NOTIFY_STATE = path.join(DATA, 'notify-state.json'); // cosa è stato mandato e confermato

if (!process.env.HOWLUP_TEST && fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'));
const env = process.env;
const PORT = env.HOWLUP_PORT !== undefined ? Number(env.HOWLUP_PORT) : 3100;
const HOST = env.HOST || '127.0.0.1';
const log = (...a) => console.log(new Date().toLocaleTimeString('it-IT'), '[howl-up]', ...a);

fs.mkdirSync(DATA, { recursive: true });
// scrittura sicura: prima un file temporaneo, poi lo scambio (niente file a metà se va via la corrente)
function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

let rev = Date.now(); // cambia a ogni modifica: le pagine aperte (telefono, PC) si aggiornano
const agenda = new Agenda({
  store: { load: () => JSON.parse(fs.readFileSync(AGENDA_FILE, 'utf8')), save: (d) => writeJson(AGENDA_FILE, d) },
  onChange: () => { rev = Date.now(); },
});
agenda.cleanupDone();

// live in programma: stanno nella Programmazione di TwitchGestor (stesso Raspberry)
const twitch = createTwitchLink({
  port: Number(env.PORT) || 3000,
  token: env.DASHBOARD_TOKEN ?? '',
  onChange: () => { rev = Date.now(); },
  log,
});
if (!env.HOWLUP_NO_TWITCH) {
  // all'avvio TwitchGestor potrebbe non essere ancora pronto (partono insieme): si riprova ogni 3 secondi
  (async () => {
    for (let i = 0; i < 40 && !(await twitch.refresh()).ok; i++) await new Promise((r) => setTimeout(r, 3000));
    setInterval(() => twitch.refresh(), 15000).unref();
  })();
}
const lives = () => ({ ok: twitch.state.ok, error: twitch.state.error, canPublish: twitch.state.canPublish, entries: twitch.state.entries });

// chiave del link del calendario (diversa dalla password: il link finisce nelle app del calendario)
let calendarKey = '';
try { calendarKey = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { /* prima volta */ }
if (!/^[a-f0-9]{24}$/.test(calendarKey)) { calendarKey = crypto.randomBytes(12).toString('hex'); fs.writeFileSync(KEY_FILE, calendarKey); }

// --- notifiche: buongiorno, riepilogo della settimana, promemoria; si ripetono finché non le confermi ---
const readJson = (file, def) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } };
let notifySettings = readJson(NOTIFY_FILE, {});
const secrets = readJson(path.join(DATA, 'secrets.json'), {});
if (!/^[a-f0-9]{24}$/.test(secrets.ackKey ?? '')) secrets.ackKey = crypto.randomBytes(12).toString('hex');
if (!/^howlup-[a-f0-9]{12}$/.test(secrets.ntfyTopic ?? '')) secrets.ntfyTopic = `howlup-${crypto.randomBytes(6).toString('hex')}`;
writeJson(path.join(DATA, 'secrets.json'), secrets);
// indirizzo per i pulsanti delle notifiche: quello con cui hai aperto Howl-UP l'ultima volta (meglio quello di Tailscale)
let linkHost = readJson(path.join(DATA, 'link.json'), {}).host ?? '';
function rememberHost(req) {
  const host = String(req.headers.host ?? '');
  if (!/^[\w.-]+(:\d+)?$/.test(host) || /^(localhost|127\.)/.test(host)) return;
  const remote = /^100\.|\.ts\.net/.test(host);
  if (host !== linkHost && (remote || !/^100\.|\.ts\.net/.test(linkHost))) { linkHost = host; writeJson(path.join(DATA, 'link.json'), { host }); }
}
const linkBase = () => (linkHost ? `http://${linkHost}` : `http://${env.HOWLUP_LINK_HOST || 'twitchgestor.local'}:${PORT}`);
const notifyView = () => {
  const s = cleanSettings(notifySettings);
  if (!s.channels.ntfy.topic) s.channels.ntfy.topic = secrets.ntfyTopic;
  return s;
};
let tgCache = { at: 0, value: null };
async function telegramTarget() {
  if (Date.now() - tgCache.at > 5 * 60000) tgCache = { at: Date.now(), value: await twitch.telegram().catch(() => null) };
  return tgCache.value;
}
let recapCache = { at: 0, value: null };
const notifier = new Notifier({
  getSettings: notifyView,
  getData: () => ({ ...agenda.state(), events: [...agenda.events, ...livesToEvents(twitch.state.entries)] }),
  getExtra: () => ({ recap: recapCache.value }),
  store: { load: () => readJson(NOTIFY_STATE, null), save: (d) => { writeJson(NOTIFY_STATE, d); rev = Date.now(); } },
  log,
  async send(msg) {
    const s = notifyView();
    const ackUrl = `${linkBase()}/ack/${msg.id}?k=${secrets.ackKey}`;
    const openUrl = `${linkBase()}/#today`;
    const jobs = [];
    if (s.channels.ntfy.enabled) jobs.push(sendNtfy(s.channels.ntfy, msg, { ackUrl, openUrl }));
    if (s.channels.telegram.enabled) jobs.push(telegramTarget().then((t) => sendTelegramMsg(t ?? {}, msg, { ackUrl, openUrl })));
    const results = await Promise.allSettled(jobs);
    for (const r of results) if (r.status === 'rejected') log(`Notifica: ${r.reason.message}`);
  },
});
async function notifyTick() {
  if (Date.now() - recapCache.at > 10 * 60000 && twitch.state.ok) recapCache = { at: Date.now(), value: await twitch.lastRecap().catch(() => recapCache.value) };
  await notifier.tick().catch((err) => log(`Notifiche: ${err.message}`));
}
if (!env.HOWLUP_TEST) setInterval(notifyTick, 30000).unref();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2',
};

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const authorized = (req, url) => !env.DASHBOARD_TOKEN || safeEqual(req.headers['x-dashboard-token'] ?? url.searchParams.get('token'), env.DASHBOARD_TOKEN);
const sameOrigin = (req) => !req.headers.origin || new URL(req.headers.origin).host === req.headers.host;

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string';
  res.writeHead(status, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isText ? body : JSON.stringify(body));
}

function serveFile(res, base, rel) {
  let file;
  try { file = path.normalize(path.join(base, decodeURIComponent(rel))); } catch { return send(res, 400, 'Percorso non valido'); }
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Non trovato');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

async function readBody(req, limit = 200_000) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw Object.assign(new Error('Richiesta troppo grande'), { status: 413 });
  }
  try { return data ? JSON.parse(data) : {}; } catch { throw Object.assign(new Error('Dati non validi'), { status: 400 }); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /' || route === 'GET /index.html') return serveFile(res, PUBLIC, 'index.html');
    if (req.method === 'GET' && url.pathname.startsWith('/core/')) return serveFile(res, CORE, url.pathname.slice(6));
    // calendario per le app (Google Calendar, iPhone, ICSx⁵): link con una chiave sua
    if (req.method === 'GET' && url.pathname === `/calendar/${calendarKey}.ics`) {
      return send(res, 200, toICS([...agenda.events, ...livesToEvents(twitch.state.entries)], { categories: agenda.categories }), { 'Content-Type': 'text/calendar; charset=utf-8' });
    }

    // "✅ Ho visto" dalla notifica (ntfy o Telegram): con la chiave delle notifiche, senza password
    let a = /^\/ack\/([\w-]+)$/.exec(url.pathname);
    if (a && (req.method === 'GET' || req.method === 'POST')) {
      if (!safeEqual(url.searchParams.get('k'), secrets.ackKey)) return send(res, 403, 'Link non valido');
      notifier.ack(a[1]);
      if (req.method === 'POST') return send(res, 200, { ok: true });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Howl-UP</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#121016;color:#ece8f2;font:600 20px system-ui,sans-serif;text-align:center"><div><div style="font-size:56px">✅</div><p>Visto! La notifica non si ripete più.</p><p><a href="/#today" style="color:#e36dc9">Apri Howl-UP</a></p></div></body>');
    }

    if (url.pathname.startsWith('/api/')) {
      if (!authorized(req, url)) return send(res, 401, { error: 'Password mancante o sbagliata' });
      rememberHost(req);
      if (req.method !== 'GET' && (req.headers['x-howlup'] !== '1' || !sameOrigin(req))) return send(res, 403, { error: 'Richiesta non consentita' });

      if (route === 'GET /api/state') {
        if (url.searchParams.get('rev') === String(rev)) return send(res, 200, { rev, unchanged: true });
        return send(res, 200, { rev, ...agenda.state(), lives: lives(), pending: notifier.pending(), calendarPath: `/calendar/${calendarKey}.ics` });
      }
      if (route === 'PUT /api/events') return send(res, 200, { rev, event: agenda.saveEvent((await readBody(req)).event) });
      let m = /^\/api\/events\/([\w-]+)(\/occurrence)?$/.exec(url.pathname);
      if (m && req.method === 'POST' && m[2]) {
        const body = await readBody(req);
        return send(res, 200, { rev, event: agenda.saveOccurrence(m[1], String(body.day ?? ''), body.event ?? {}) });
      }
      if (m && req.method === 'DELETE' && !m[2]) {
        const ok = agenda.deleteEvent(m[1], url.searchParams.get('only') || '');
        return send(res, ok ? 200 : 404, ok ? { rev } : { error: 'Impegno non trovato' });
      }
      if (route === 'PUT /api/tasks') return send(res, 200, { rev, task: agenda.saveTask((await readBody(req)).task) });
      m = /^\/api\/tasks\/([\w-]+)$/.exec(url.pathname);
      if (m && req.method === 'DELETE') {
        const ok = agenda.deleteTask(m[1]);
        return send(res, ok ? 200 : 404, ok ? { rev } : { error: 'Non trovata' });
      }
      // --- notifiche ---
      if (route === 'GET /api/notify') {
        return send(res, 200, { settings: notifyView(), pending: notifier.pending(), linkBase: linkBase(), telegram: await telegramTarget().then((t) => (t ? { name: t.name } : null)) });
      }
      if (route === 'PUT /api/notify') {
        notifySettings = cleanSettings((await readBody(req)).settings);
        writeJson(NOTIFY_FILE, notifySettings);
        return send(res, 200, { settings: notifyView() });
      }
      if (route === 'POST /api/notify/test') { await notifier.test(); return send(res, 200, { rev, pending: notifier.pending() }); }
      if (route === 'POST /api/notify/ack') {
        const body = await readBody(req);
        notifier.ack(body.id ? String(body.id) : '');
        return send(res, 200, { rev, pending: notifier.pending() });
      }
      // --- live (Programmazione di TwitchGestor) ---
      if (route === 'PUT /api/lives') return send(res, 200, { rev, live: await twitch.saveLive((await readBody(req)).live), lives: lives() });
      if (route === 'POST /api/lives/weeks') return send(res, 200, { rev, added: (await twitch.addWeeks(await readBody(req))).length, lives: lives() });
      if (route === 'GET /api/lives/categories') return send(res, 200, await twitch.categories(url.searchParams.get('q') ?? ''));
      m = /^\/api\/lives\/([\w-]+)$/.exec(url.pathname);
      if (m && req.method === 'DELETE') {
        const ok = await twitch.deleteLive(m[1]);
        return send(res, ok ? 200 : 404, ok ? { rev, lives: lives() } : { error: 'Live non trovata' });
      }
      if (route === 'PUT /api/categories') return send(res, 200, { rev, categories: agenda.saveCategories((await readBody(req)).categories) });
      return send(res, 404, { error: 'Non trovato' });
    }
    if (req.method === 'GET') return serveFile(res, PUBLIC, url.pathname.slice(1));
    return send(res, 404, 'Non trovato');
  } catch (err) {
    const status = err.status ?? 500;
    if (status >= 500) log(err);
    return send(res, status, url.pathname.startsWith('/api/') ? { error: err.message } : err.message);
  }
});

setInterval(() => agenda.cleanupDone(), 6 * 3600 * 1000).unref();
export const ready = new Promise((resolve) => server.listen(PORT, HOST, () => { log(`Howl-UP pronto: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${server.address().port}`); resolve(server.address().port); }));
export { server, agenda };
