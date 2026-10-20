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
import { sendNtfy, sendTelegramMsg, announceTelegram, announceDiscord } from './channels.js';
import { Announcements, cleanAnnounceSettings } from './core/announce.js';
import { createSecureLink } from './secure.js';

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
const HTTPS_PORT = Number(env.HOWLUP_HTTPS_PORT) || 8443; // https con Tailscale (per installarlo come app)
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
// https con Tailscale: per installare Howl-UP come app (si ricontrolla ogni 5 minuti, se Tailscale si collega dopo)
const secure = createSecureLink({ port: PORT || 3100, httpsPort: HTTPS_PORT, log });
if (!env.HOWLUP_TEST) { secure.refresh(); setInterval(() => secure.refresh(), 5 * 60000).unref(); }

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
  const host = hostOf(req);
  if (!/^[\w.-]+(:\d+)?$/.test(host) || /^(localhost|127\.)/.test(host)) return;
  const remote = /^100\.|\.ts\.net/.test(host);
  if (host !== linkHost && (remote || !/^100\.|\.ts\.net/.test(linkHost))) { linkHost = host; writeJson(path.join(DATA, 'link.json'), { host }); }
}
// l'indirizzo https di Tailscale (….ts.net:8443) va aperto in https, gli altri in http
const linkBase = () => (linkHost ? `${/\.ts\.net:\d+$/.test(linkHost) && linkHost.endsWith(`:${HTTPS_PORT}`) ? 'https' : 'http'}://${linkHost}` : `http://${env.HOWLUP_LINK_HOST || 'twitchgestor.local'}:${PORT}`);
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
let lastSend = null;
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
    const jobs = {};
    if (s.channels.ntfy.enabled) jobs.ntfy = sendNtfy(s.channels.ntfy, msg, { ackUrl, openUrl });
    if (s.channels.telegram.enabled) jobs.telegram = telegramTarget().then((t) => sendTelegramMsg(t ?? {}, msg, { ackUrl, openUrl }));
    const names = Object.keys(jobs);
    const settled = await Promise.allSettled(Object.values(jobs));
    const results = {};
    settled.forEach((r, i) => {
      results[names[i]] = r.status === 'fulfilled' ? 'ok' : r.reason.message;
      if (r.status === 'rejected') log(`Notifica (${names[i]}): ${r.reason.message}`);
    });
    // l'esito dell'ultimo invio si vede in Altro → Notifiche (così capisci perché non arriva)
    lastSend = { at: Date.now(), title: msg.title, results };
  },
});
async function notifyTick() {
  if (Date.now() - recapCache.at > 10 * 60000 && twitch.state.ok) recapCache = { at: Date.now(), value: await twitch.lastRecap().catch(() => recapCache.value) };
  await notifier.tick().catch((err) => log(`Notifiche: ${err.message}`));
}
if (!env.HOWLUP_TEST) setInterval(notifyTick, 30000).unref();

// --- annunci per la community quando cambiano le live (Telegram, Discord, storia Instagram) ---
const ANNOUNCE_FILE = path.join(DATA, 'announce.json');
const ANNOUNCE_STATE = path.join(DATA, 'announce-state.json');
const MASCOT_FILE = path.join(DATA, 'mascot.png');
let announceSettings = readJson(ANNOUNCE_FILE, {});
let loginCache = { at: 0, value: '' };
const announcements = new Announcements({
  store: { load: () => readJson(ANNOUNCE_STATE, null), save: (d) => writeJson(ANNOUNCE_STATE, d) },
  getSettings: () => announceSettings,
  getContext: () => ({ login: loginCache.value }),
  onChange: () => { rev = Date.now(); },
  log,
  async send(draft, { text, image, targets }) {
    const s = cleanAnnounceSettings(announceSettings);
    const want = (k) => (targets ? targets.includes(k) : s[k]);
    const results = {};
    if (want('telegram')) {
      try {
        const t = await telegramTarget();
        await announceTelegram({ token: t?.token, chatId: t?.channelId }, text, image);
        results.telegram = 'ok';
      } catch (err) { results.telegram = err.message; }
    }
    if (want('discord')) {
      try { await announceDiscord(s.discordWebhook, text, image); results.discord = 'ok'; } catch (err) { results.discord = err.message; }
    }
    for (const [k, v] of Object.entries(results)) if (v !== 'ok') log(`Annuncio (${k}): ${v}`);
    return results;
  },
});
let lastSeen = '';
async function announceTick() {
  if (!twitch.state.ok) return;
  if (Date.now() - loginCache.at > 30 * 60000) loginCache = { at: Date.now(), value: await twitch.login().catch(() => loginCache.value) };
  const sig = JSON.stringify(twitch.state.entries);
  if (sig !== lastSeen) { lastSeen = sig; announcements.observe(twitch.state.entries); }
  await announcements.tick();
}
if (!env.HOWLUP_TEST) setInterval(() => announceTick().catch((err) => log(`Annunci: ${err.message}`)), 5000).unref();

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
// dietro "tailscale serve" (https) la richiesta arriva da 127.0.0.1: il nome vero può stare in X-Forwarded-Host
const hostOf = (req) => String((/^(::ffff:)?127\.|^::1$/.test(req.socket.remoteAddress ?? '') && req.headers['x-forwarded-host']) || req.headers.host || '');
const sameOrigin = (req) => !req.headers.origin || [hostOf(req), req.headers.host].includes(new URL(req.headers.origin).host);

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

    // il lupo del canale per le storie (immagine pubblica come il logo)
    if (route === 'GET /mascot.png') {
      if (!fs.existsSync(MASCOT_FILE)) return send(res, 404, 'Nessuna immagine');
      res.writeHead(200, { 'Content-Type': fs.readFileSync(MASCOT_FILE).subarray(0, 4).toString('latin1') === 'RIFF' ? 'image/webp' : 'image/png', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(MASCOT_FILE).pipe(res);
    }

    if (url.pathname.startsWith('/api/')) {
      if (!authorized(req, url)) return send(res, 401, { error: 'Password mancante o sbagliata' });
      rememberHost(req);
      if (req.method !== 'GET' && (req.headers['x-howlup'] !== '1' || !sameOrigin(req))) return send(res, 403, { error: 'Richiesta non consentita' });

      if (route === 'GET /api/state') {
        if (url.searchParams.get('rev') === String(rev)) return send(res, 200, { rev, unchanged: true });
        return send(res, 200, { rev, ...agenda.state(), lives: lives(), pending: notifier.pending(), announce: announcements.drafts.filter((d) => d.status === 'draft').length, calendarPath: `/calendar/${calendarKey}.ics` });
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
      if (route === 'PUT /api/notes') return send(res, 200, { rev, note: agenda.saveNote((await readBody(req)).note) });
      const nm = /^\/api\/notes\/([\w-]+)$/.exec(url.pathname);
      if (nm && req.method === 'DELETE') {
        const ok = agenda.deleteNote(nm[1]);
        return send(res, ok ? 200 : 404, ok ? { rev } : { error: 'Nota non trovata' });
      }
      if (route === 'PUT /api/tasks') return send(res, 200, { rev, task: agenda.saveTask((await readBody(req)).task) });
      m = /^\/api\/tasks\/([\w-]+)$/.exec(url.pathname);
      if (m && req.method === 'DELETE') {
        const ok = agenda.deleteTask(m[1]);
        return send(res, ok ? 200 : 404, ok ? { rev } : { error: 'Non trovata' });
      }
      // --- notifiche ---
      if (route === 'GET /api/install') return send(res, 200, secure.state);
      if (route === 'POST /api/install/check') return send(res, 200, await secure.refresh());
      if (route === 'GET /api/notify') {
        return send(res, 200, { settings: notifyView(), pending: notifier.pending(), linkBase: linkBase(), last: lastSend, telegram: await telegramTarget().then((t) => (t?.chatId ? { name: t.name } : null)) });
      }
      if (route === 'PUT /api/notify') {
        notifySettings = cleanSettings((await readBody(req)).settings);
        writeJson(NOTIFY_FILE, notifySettings);
        return send(res, 200, { settings: notifyView() });
      }
      if (route === 'POST /api/notify/test') { lastSend = null; await notifier.test(); return send(res, 200, { rev, pending: notifier.pending(), last: lastSend }); }
      if (route === 'POST /api/notify/ack') {
        const body = await readBody(req);
        notifier.ack(body.id ? String(body.id) : '');
        return send(res, 200, { rev, pending: notifier.pending() });
      }
      // --- annunci ---
      if (route === 'GET /api/announce') {
        const t = await telegramTarget();
        return send(res, 200, { settings: cleanAnnounceSettings(announceSettings), drafts: announcements.drafts, login: loginCache.value, telegramChannel: t?.channelId ? (t.channelName || 'canale') : '', mascot: fs.existsSync(MASCOT_FILE) ? Math.round(fs.statSync(MASCOT_FILE).mtimeMs) : 0 });
      }
      if (route === 'PUT /api/announce') {
        announceSettings = cleanAnnounceSettings((await readBody(req)).settings);
        writeJson(ANNOUNCE_FILE, announceSettings);
        return send(res, 200, { settings: announceSettings });
      }
      if (route === 'POST /api/announce/mascot') {
        const body = await readBody(req, 5_000_000);
        const m = /^data:image\/(png|webp);base64,(.+)$/.exec(String(body.image ?? ''));
        if (!m) return send(res, 400, { error: 'Serve un\'immagine PNG o WebP' });
        fs.writeFileSync(MASCOT_FILE, Buffer.from(m[2], 'base64'));
        return send(res, 200, { ok: true });
      }
      if (route === 'DELETE /api/announce/mascot') { fs.rmSync(MASCOT_FILE, { force: true }); return send(res, 200, { ok: true }); }
      a = /^\/api\/announce\/([\w-]+)\/(send|hold|dismiss|text)$/.exec(url.pathname);
      if (a && req.method === 'POST') {
        const body = await readBody(req, 12_000_000);
        if (a[2] === 'text') return send(res, 200, { rev, draft: announcements.update(a[1], { text: body.text }) });
        if (a[2] === 'hold') return send(res, 200, { rev, draft: announcements.hold(a[1]) });
        if (a[2] === 'dismiss') return send(res, 200, { rev, draft: announcements.dismiss(a[1]) });
        if (typeof body.text === 'string') announcements.update(a[1], { text: body.text });
        const image = /^data:image\/png;base64,/.test(body.image ?? '') ? Buffer.from(body.image.split(',')[1], 'base64') : null;
        const targets = Array.isArray(body.targets) ? body.targets.filter((x) => ['telegram', 'discord'].includes(x)) : undefined;
        return send(res, 200, { rev, draft: await announcements.sendNow(a[1], { image, targets }) });
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
      if (route === 'PUT /api/shifts') { const r = agenda.setShifts(await readBody(req)); return send(res, 200, { rev, ...r, shift: agenda.shift }); }
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
