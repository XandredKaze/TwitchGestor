import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ROOT_DIR, DATA_DIR } from './config.js';
import { NOTIFICATION_TYPES, testNotification } from './core/normalize.js';
import { NotificationManager } from './core/NotificationManager.js';
import { sanitizeConfig, ANIMATIONS, POSITIONS, SOUND_PRESETS } from './core/schema.js';
import { recentLogs } from './logger.js';
import { cleanText } from './core/ttsText.js';
import { parseKofi, parseGenericDonation } from './sources/webhooks.js';
import { createLogger } from './logger.js';

const log = createLogger('server');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const TTS_DIR = path.join(DATA_DIR, 'tts');
const UPLOAD_KINDS = {
  sounds: ['.mp3', '.ogg', '.wav'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.webm', '.mp4'],
  music: ['.mp3', '.ogg', '.wav', '.m4a', '.flac'],
};
const UPLOAD_LIMIT = 30 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aiff': 'audio/aiff',
  '.flac': 'audio/flac',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Protezione da siti esterni: il browser può inviare richieste a localhost da qualsiasi pagina web.
 * Accettiamo solo richieste senza Origin (OBS, curl, webhook) o dalla stessa origine della dashboard.
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return !origin;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function send(res, status, body, headers = {}) {
  const isString = typeof body === 'string';
  res.writeHead(status, {
    'Content-Type': isString ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isString ? body : JSON.stringify(body));
}

async function readBody(req, limit = 100_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Richiesta troppo grande'), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  const type = req.headers['content-type'] ?? '';
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('JSON non valido'), { status: 400 });
  }
}

function serveStatic(res, urlPath, baseDir = PUBLIC_DIR) {
  let file;
  try {
    file = path.normalize(path.join(baseDir, decodeURIComponent(urlPath)));
  } catch {
    return send(res, 400, 'Percorso non valido');
  }
  if (!file.startsWith(baseDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'Non trovato');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

/** Notifica di prova con l'importo o la ricompensa scelti nell'anteprima della dashboard. */
function sampleNotification(type, sample = {}) {
  const n = testNotification(type);
  const amount = Number(sample?.amount);
  if (sample?.amount !== undefined && sample?.amount !== '' && Number.isFinite(amount) && amount >= 0) {
    n.amount = amount;
    if (type === 'resub') n.months = amount;
  }
  if (typeof sample?.reward === 'string' && sample.reward.trim() && n.reward) n.reward.title = sample.reward.slice(0, 60);
  return n;
}

function listMedia() {
  const out = {};
  for (const kind of Object.keys(UPLOAD_KINDS)) {
    const dir = path.join(MEDIA_DIR, kind);
    out[kind] = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => UPLOAD_KINDS[kind].includes(path.extname(f).toLowerCase())).sort().map((f) => `media/${kind}/${f}`)
      : [];
  }
  return out;
}

/** Salva un file caricato dalla dashboard in data/media/<tipo>/ con un nome sicuro. */
async function saveUpload(req, kind, rawName) {
  if (!UPLOAD_KINDS[kind]) throw Object.assign(new Error('Tipo di file non valido'), { status: 400 });
  const name = path.basename(String(rawName ?? '')).normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(-80);
  const ext = path.extname(name).toLowerCase();
  if (!name || !UPLOAD_KINDS[kind].includes(ext)) {
    throw Object.assign(new Error(`Formato non supportato. Usa: ${UPLOAD_KINDS[kind].join(', ')}`), { status: 400 });
  }
  const dir = path.join(MEDIA_DIR, kind);
  fs.mkdirSync(dir, { recursive: true });
  let final = name;
  for (let i = 1; fs.existsSync(path.join(dir, final)); i++) final = `${path.basename(name, ext)}-${i}${ext}`;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > UPLOAD_LIMIT) throw Object.assign(new Error('File troppo grande (massimo 30 MB)'), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) throw Object.assign(new Error('File vuoto'), { status: 400 });
  fs.writeFileSync(path.join(dir, final), Buffer.concat(chunks));
  return `media/${kind}/${final}`;
}

/**
 * Server HTTP + WebSocket.
 *   /overlay      pagina da aggiungere in OBS come "Sorgente browser"
 *   /dashboard    pannello di controllo
 *   /ws           canale in tempo reale verso overlay e dashboard
 *   /webhooks/*   donazioni in arrivo da servizi esterni
 */
export function createServer(app) {
  const { env } = app;
  const isAuthorized = (req, url) => !env.DASHBOARD_TOKEN
    || safeEqual(req.headers['x-dashboard-token'] ?? url.searchParams.get('token'), env.DASHBOARD_TOKEN);

  const routes = {
    'GET /api/state': () => app.getState(),
    'POST /api/queue/pause': () => app.manager.pause(),
    'POST /api/queue/resume': () => app.manager.resume(),
    'POST /api/queue/skip': () => app.manager.skip(),
    'POST /api/queue/clear': () => app.manager.clearQueue(),
    'POST /api/stats/reset': () => {
      app.manager.resetStats();
      app.broadcastState();
    },
    'POST /api/auth/logout': () => app.logout(),
    'POST /api/auth/bot/logout': () => app.logoutBot(),
    'GET /api/logs': () => ({ logs: recentLogs() }),
    'GET /api/config': () => ({
      config: app.config.get(),
      defaults: app.config.defaults(),
      options: { animations: ANIMATIONS, positions: POSITIONS, sounds: SOUND_PRESETS },
      media: listMedia(),
      chatAccount: app.chatAccount(),
      twitchConfigured: app.auth.configured,
    }),
    'POST /api/shutdown': () => {
      setTimeout(() => app.shutdown(), 300);
      return { ok: true };
    },
  };
  const draft = (body) => (body?.config ? sanitizeConfig(body.config, app.config.defaults()) : null);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === 'GET /') return send(res, 302, '', { Location: '/dashboard' });
      if (route === 'GET /overlay') return serveStatic(res, '/overlay.html');
      if (route === 'GET /dashboard') return serveStatic(res, '/dashboard.html');
      if (route === 'GET /credits') return serveStatic(res, '/credits.html');
      // Titoli di coda: la sorgente OBS legge lo stato senza token (contiene solo nomi e impostazioni).
      if (route === 'GET /api/credits/state' && app.credits) {
        const rev = Number(url.searchParams.get('rev'));
        return send(res, 200, { ...app.credits.store.snapshot(rev), account: app.auth.user?.login ?? null, configured: app.auth.configured });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/media/')) return serveStatic(res, url.pathname.slice('/media'.length), MEDIA_DIR);
      if (req.method === 'GET' && url.pathname.startsWith('/tts/')) return serveStatic(res, url.pathname.slice('/tts'.length), app.tts?.dir ?? TTS_DIR);

      // --- Accesso Twitch ---
      if (route === 'GET /auth/login') {
        if (!app.auth.configured) return send(res, 400, 'Imposta TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET nel file .env');
        return send(res, 302, '', { Location: app.auth.authorizeUrl() });
      }
      if (route === 'GET /auth/bot/login') {
        if (!app.botAuth.configured) return send(res, 400, 'Imposta TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET nel file .env');
        return send(res, 302, '', { Location: app.botAuth.authorizeUrl() });
      }
      if (route === 'GET /auth/callback') {
        // Un solo indirizzo di ritorno per entrambi gli accessi: lo "state" dice se era il bot.
        const params = Object.fromEntries(url.searchParams);
        const isBot = app.botAuth.ownsState(params.state);
        await (isBot ? app.botAuth : app.auth).handleCallback(params);
        return send(res, 302, '', { Location: isBot ? '/dashboard#chat' : '/dashboard' });
      }

      // --- Webhook donazioni ---
      if (route === 'POST /webhooks/kofi') {
        const n = parseKofi(await readBody(req), env.KOFI_VERIFICATION_TOKEN);
        if (n) app.manager.ingest(n);
        return send(res, 200, { ok: true });
      }
      if (route === 'POST /webhooks/donation') {
        if (!env.DONATION_WEBHOOK_SECRET || !safeEqual(req.headers['x-webhook-secret'], env.DONATION_WEBHOOK_SECRET)) {
          return send(res, 401, { error: 'Segreto webhook non valido' });
        }
        app.manager.ingest(parseGenericDonation(await readBody(req)));
        return send(res, 200, { ok: true });
      }

      // --- API dashboard ---
      if (url.pathname.startsWith('/api/')) {
        // Spegnimento chiesto dallo script di OBS: solo da questo PC e con un'intestazione che una
        // pagina web non può inviare senza permesso (il server non risponde alle richieste CORS).
        const localStop = route === 'POST /api/shutdown' && req.headers['x-twitchgestor-stop'] === '1'
          && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        if (!localStop && !isAuthorized(req, url)) return send(res, 401, { error: 'Token dashboard mancante o errato' });
        // Le azioni richiedono un'intestazione che solo la dashboard invia: una pagina di un altro sito
        // non può aggiungerla senza un permesso (CORS) che questo server non concede mai.
        if (req.method !== 'GET' && !localStop && (req.headers['x-twitchgestor'] !== '1' || !sameOrigin(req))) {
          return send(res, 403, { error: 'Richiesta non consentita' });
        }
        if (req.method === 'POST' && url.pathname.startsWith('/api/test/')) {
          const type = url.pathname.slice('/api/test/'.length);
          if (!NOTIFICATION_TYPES.includes(type)) return send(res, 400, { error: `Tipo sconosciuto: ${type}` });
          const body = await readBody(req, 1_000_000);
          app.manager.test(sampleNotification(type, body.sample), draft(body));
          return send(res, 200, { ok: true });
        }
        if (route === 'POST /api/preview') {
          const body = await readBody(req, 1_000_000);
          if (!NOTIFICATION_TYPES.includes(body.type)) return send(res, 400, { error: 'Tipo sconosciuto' });
          const builder = new NotificationManager({ config: draft(body) ?? app.config.get() });
          return send(res, 200, { alert: builder.buildAlert(sampleNotification(body.type, body.sample)) });
        }
        if (route === 'GET /api/tts/voices') {
          return send(res, 200, { engine: app.tts?.engine?.name ?? null, voices: (await app.tts?.voices()) ?? [] });
        }
        if (route === 'POST /api/tts/test') {
          const body = await readBody(req, 1_000_000);
          const cfg = (draft(body) ?? app.config.get()).tts ?? {};
          const text = cleanText(body.text || 'Ciao! Questa è la voce degli alert di TwitchGestor.', cfg);
          const result = await app.tts?.synthesize(text, cfg).catch((err) => {
            throw Object.assign(new Error(`La voce non funziona: ${err.message}`), { status: 500 });
          });
          return send(res, 200, result ? { ...result, text } : { fallback: true, text, rate: cfg.rate ?? 0, volume: (cfg.volume ?? 100) / 100 });
        }
        if (route === 'PUT /api/config') {
          const config = app.config.save((await readBody(req, 1_000_000)).config);
          return send(res, 200, { config });
        }
        if (req.method === 'PUT' && url.pathname.startsWith('/api/credits/state/')) {
          const key = decodeURIComponent(url.pathname.slice('/api/credits/state/'.length));
          const rev = app.credits.store.set(key, (await readBody(req, 2_100_000)) ?? null, { fromPage: true });
          return send(res, 200, { rev });
        }
        if (route === 'POST /api/credits/fetch') {
          const result = await app.credits.refresh('pannello');
          if (result?.skipped) return send(res, 409, { error: result.skipped });
          return send(res, 200, { ok: true, errors: result?.errors ?? [] });
        }
        if (req.method === 'PUT' && url.pathname.startsWith('/api/credits/upload/')) {
          const saved = await saveUpload(req, 'music', decodeURIComponent(url.pathname.slice('/api/credits/upload/'.length)));
          return send(res, 200, { name: saved });
        }
        if (route === 'POST /api/upload') {
          const saved = await saveUpload(req, url.searchParams.get('kind'), req.headers['x-filename'] && decodeURIComponent(req.headers['x-filename']));
          return send(res, 200, { path: saved, media: listMedia() });
        }
        if (req.method === 'POST' && url.pathname.startsWith('/api/replay/')) {
          const ok = app.manager.replay(decodeURIComponent(url.pathname.slice('/api/replay/'.length)));
          return send(res, ok ? 200 : 404, ok ? { ok } : { error: 'Notifica non trovata' });
        }
        const handler = routes[route];
        if (!handler) return send(res, 404, { error: 'Non trovato' });
        return send(res, 200, (await handler()) ?? { ok: true });
      }

      if (req.method === 'GET') return serveStatic(res, url.pathname);
      return send(res, 404, 'Non trovato');
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) log.error(err);
      else log.warn(`${route}: ${err.message}`);
      return send(res, status, url.pathname.startsWith('/auth/') ? err.message : { error: err.message });
    }
  });

  // --- WebSocket ---
  const wss = new WebSocketServer({ noServer: true });
  const clients = { overlay: new Set(), dashboard: new Set() };

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const role = url.searchParams.get('role');
    if (url.pathname !== '/ws' || !(role in clients) || !sameOrigin(req) || (role === 'dashboard' && !isAuthorized(req, url))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients[role].add(ws);
      ws.on('close', () => {
        clients[role].delete(ws);
        app.broadcastState();
      });
      ws.send(JSON.stringify(role === 'overlay'
        ? { type: 'hello', overlay: app.config.get().overlay }
        : { type: 'state', state: app.getState() }));
      app.broadcastState();
    });
  });

  // Ping periodico per tenere vive le connessioni (OBS a volte le lascia cadere in silenzio).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) ws.ping();
  }, 30000);
  server.on('close', () => clearInterval(heartbeat));

  function broadcast(role, message) {
    const data = JSON.stringify(message);
    for (const ws of clients[role]) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  return {
    server,
    clients,
    toOverlays: (m) => broadcast('overlay', m),
    toDashboards: (m) => broadcast('dashboard', m),
  };
}
