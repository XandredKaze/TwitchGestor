import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ROOT_DIR } from './config.js';
import { NOTIFICATION_TYPES, testNotification } from './core/normalize.js';
import { parseKofi, parseGenericDonation } from './sources/webhooks.js';
import { createLogger } from './logger.js';

const log = createLogger('server');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
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
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
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

function serveStatic(res, urlPath) {
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'Non trovato');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
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
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === 'GET /') return send(res, 302, '', { Location: '/dashboard' });
      if (route === 'GET /overlay') return serveStatic(res, '/overlay.html');
      if (route === 'GET /dashboard') return serveStatic(res, '/dashboard.html');

      // --- Accesso Twitch ---
      if (route === 'GET /auth/login') {
        if (!app.auth.configured) return send(res, 400, 'Imposta TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET nel file .env');
        return send(res, 302, '', { Location: app.auth.authorizeUrl() });
      }
      if (route === 'GET /auth/callback') {
        await app.auth.handleCallback(Object.fromEntries(url.searchParams));
        return send(res, 302, '', { Location: '/dashboard' });
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
        if (!isAuthorized(req, url)) return send(res, 401, { error: 'Token dashboard mancante o errato' });
        if (req.method === 'POST' && url.pathname.startsWith('/api/test/')) {
          const type = url.pathname.slice('/api/test/'.length);
          if (!NOTIFICATION_TYPES.includes(type)) return send(res, 400, { error: `Tipo sconosciuto: ${type}` });
          app.manager.test(testNotification(type));
          return send(res, 200, { ok: true });
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
    if (url.pathname !== '/ws' || !(role in clients) || (role === 'dashboard' && !isAuthorized(req, url))) {
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
