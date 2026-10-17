import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ROOT_DIR, DATA_DIR } from './config.js';
import { NOTIFICATION_TYPES, testNotification } from './core/normalize.js';
import { NotificationManager } from './core/NotificationManager.js';
import { sanitizeConfig, ANIMATIONS, POSITIONS, SOUND_PRESETS, UI_THEMES } from './core/schema.js';
import { recentLogs } from './logger.js';
import * as updates from './updates.js';
import { sendTelegram, findTelegramChat } from './telegram.js';
import { recapText } from './core/livestats.js';
import { API_LEVEL, APP_VERSION, BUILD_ID } from './version.js';
import { parseKofi, parseGenericDonation } from './sources/webhooks.js';
import { createLogger } from './logger.js';

const log = createLogger('server');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
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
      apiLevel: API_LEVEL,
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
      if (route === 'GET /chat') return serveStatic(res, '/chat.html');
      // Titoli di coda: la sorgente OBS legge lo stato senza token (contiene solo nomi e impostazioni).
      if (route === 'GET /api/credits/state' && app.credits) {
        const rev = Number(url.searchParams.get('rev'));
        return send(res, 200, {
          ...app.credits.store.snapshot(rev), account: app.auth.user?.login ?? null, configured: app.auth.configured,
          ui: app.config.get().ui?.theme ?? 'default', // tema della dashboard, anche per il pannello nel dock di OBS
          build: BUILD_ID, // dopo un aggiornamento la pagina si ricarica da sola
        });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/media/')) return serveStatic(res, url.pathname.slice('/media'.length), MEDIA_DIR);
      // Certificato da installare una volta sul PC per aprire la dashboard in https (pubblico: non contiene segreti)
      if (route === 'GET /twitchgestor-certificato.crt') {
        const file = app.httpsCertificate?.();
        if (!file) return send(res, 404, 'Indirizzo https non attivo');
        res.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="TwitchGestor-certificato.crt"' });
        return res.end(fs.readFileSync(file));
      }
      // La dashboard prova questo indirizzo in https: se risponde, il certificato è già installato
      if (route === 'GET /https-ok') return send(res, 204, '', { 'Access-Control-Allow-Origin': '*' });

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
        // --- Aggiornamenti (Raspberry) e copia di sicurezza ---
        if (route === 'GET /api/system') {
          // usato anche dallo script di aggiornamento: non aggiorna durante la live
          return send(res, 200, { version: APP_VERSION, commit: await updates.installedCommit(), busy: Boolean(await app.isBusy?.()) });
        }
        if (route === 'GET /api/raspberry/login.bat') {
          // Accesso a Twitch quando TwitchGestor gira sul Raspberry: Twitch accetta il ritorno solo su "localhost",
          // quindi il PC si collega al Raspberry con un tunnel SSH e l'accesso passa da http://localhost.
          const host = String(req.headers.host ?? '').replace(/:\d+$/, '').replace(/[^\w.\-:[\]]/g, '');
          const port = Number(process.env.PORT) || 3000;
          const user = os.userInfo().username.replace(/[^\w.\-]/g, '');
          const what = url.searchParams.get('kind') === 'bot' ? 'bot/login' : 'login';
          const bat = [
            '@echo off',
            'title TwitchGestor - accesso a Twitch',
            'echo.',
            `echo  Collego questo PC a TwitchGestor sul Raspberry (${host})...`,
            `echo  Se te la chiede, scrivi la password dell'utente "${user}" del Raspberry.`,
            'echo  Se TwitchGestor e\' ancora acceso su questo PC, spegnilo prima.',
            'echo  Finito l\'accesso su Twitch, chiudi questa finestra.',
            'echo.',
            `start "" cmd /c "timeout /t 6 >nul & start http://localhost:${port}/auth/${what}"`,
            `ssh -o StrictHostKeyChecking=accept-new -N -L ${port}:127.0.0.1:${port} ${user}@${host}`,
            'pause',
            '',
          ].join('\r\n');
          return send(res, 200, bat, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="Accedi a Twitch (${what === 'login' ? 'canale' : 'bot'}).bat"` });
        }
        if (route === 'GET /api/update') return send(res, 200, await updates.updateState());
        if (route === 'POST /api/update/check') {
          await updates.checkForUpdates({ force: true });
          return send(res, 200, await updates.updateState());
        }
        if (route === 'POST /api/update') {
          updates.requestUpdate();
          return send(res, 200, await updates.updateState());
        }
        if (route === 'PUT /api/update/settings') {
          updates.saveUpdateSettings(await readBody(req));
          return send(res, 200, await updates.updateState());
        }
        if (route === 'GET /api/backup') {
          const backup = await updates.createBackup();
          const name = `twitchgestor-${new Date().toISOString().slice(0, 10)}.tar.gz`;
          res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
          const stream = fs.createReadStream(backup.file);
          stream.on('close', backup.cleanup);
          stream.pipe(res);
          return undefined;
        }
        if (route === 'POST /api/backup/restore') {
          const tmp = path.join(DATA_DIR, `import-${Date.now()}.tar.gz`);
          fs.mkdirSync(DATA_DIR, { recursive: true });
          try {
            let size = 0;
            const out = fs.createWriteStream(tmp);
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 2 * 1024 ** 3) throw Object.assign(new Error('File troppo grande'), { status: 413 });
              if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
            }
            await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
            if (!size) throw Object.assign(new Error('File vuoto'), { status: 400 });
            const result = await updates.restoreBackup(tmp, { clientAddress: req.socket.remoteAddress });
            send(res, 200, { ...result, restarting: true, managed: updates.isManaged() });
          } finally {
            fs.rmSync(tmp, { force: true });
          }
          // riparte subito, senza salvare niente sopra ai file appena importati
          // (sul Raspberry si riavvia da solo; sul PC va riaperto)
          setTimeout(() => process.exit(0), 500);
          return undefined;
        }
        // --- Statistiche, riepiloghi e Telegram ---
        if (route === 'GET /api/stats') {
          const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 90, 7), 800);
          return send(res, 200, app.liveStats?.overview(days) ?? { days, lives: [], daily: [] });
        }
        if (route === 'GET /api/recaps') return send(res, 200, { recaps: app.liveStats?.recaps ?? [], live: Boolean(app.liveStats?.current) });
        if (route === 'PUT /api/telegram') {
          const body = await readBody(req);
          const config = app.config.save({ ...app.config.get(), telegram: { ...app.config.get().telegram, ...body.telegram } });
          return send(res, 200, { telegram: config.telegram });
        }
        if (route === 'POST /api/telegram/find') {
          const body = await readBody(req);
          const found = await findTelegramChat(body.token ?? app.config.get().telegram?.token);
          return send(res, 200, found);
        }
        if (route === 'POST /api/telegram/test') {
          const t = app.config.get().telegram ?? {};
          const last = app.liveStats?.recaps?.[0];
          await sendTelegram(t, last ? recapText(last) : '✅ TwitchGestor è collegato: qui arriveranno i riepiloghi delle tue live.');
          return send(res, 200, { ok: true });
        }
        if (route === 'GET /api/titles') return send(res, 200, { lives: app.titleLog?.lives ?? [], titles: app.titleLog?.titles() ?? [] });
        if (route === 'GET /api/obs') return send(res, 200, app.obs?.state() ?? null);
        if (route === 'PUT /api/obs/settings') {
          if (!app.obs) return send(res, 400, { error: 'Collegamento a OBS non disponibile' });
          const state = app.obs.configure(await readBody(req));
          app.broadcastState();
          return send(res, 200, state);
        }
        if (route === 'POST /api/obs/scene') {
          if (!app.obs) return send(res, 400, { error: 'Collegamento a OBS non disponibile' });
          return send(res, 200, await app.obs.setScene(String((await readBody(req)).scene ?? '')));
        }
        if (route === 'PUT /api/ui') {
          // Solo il tema: non tocca il resto delle impostazioni (es. modifiche non salvate nell'editor).
          const body = await readBody(req);
          if (body.theme !== undefined && !UI_THEMES.includes(body.theme)) return send(res, 400, { error: 'Tema sconosciuto' });
          const current = app.config.get();
          const config = app.config.save({ ...current, ui: { ...current.ui, ...body } });
          return send(res, 200, { ui: config.ui });
        }
        // --- Azioni rapide (come nel Gestore stream di Twitch) ---
        if (route === 'GET /api/actions/state') {
          if (!app.quickActions) return send(res, 400, { error: 'Azioni rapide non disponibili' });
          return send(res, 200, await app.quickActions.state());
        }
        if (route === 'GET /api/actions/categories') {
          return send(res, 200, await app.quickActions.run('categories', { query: url.searchParams.get('q') }));
        }
        if (req.method === 'POST' && url.pathname.startsWith('/api/actions/')) {
          const name = decodeURIComponent(url.pathname.slice('/api/actions/'.length));
          const result = await app.quickActions.run(name, await readBody(req));
          if (name === 'info' || name.startsWith('chat') || name === 'shield') app.broadcastState();
          return send(res, 200, result);
        }
        // --- Parole bannate ---
        if (route === 'PUT /api/chat-overlay') {
          // Solo l'aspetto della chat per OBS: non tocca le altre impostazioni.
          const body = await readBody(req, 1_000_000);
          const config = app.config.save({ ...app.config.get(), chatOverlay: body.chatOverlay });
          return send(res, 200, { chatOverlay: config.chatOverlay });
        }
        if (route === 'PUT /api/moderation') {
          const body = await readBody(req, 1_000_000);
          const config = app.config.save({ ...app.config.get(), moderation: body.moderation });
          app.broadcastState();
          return send(res, 200, { moderation: config.moderation });
        }
        if (route === 'POST /api/moderation/test') {
          const body = await readBody(req, 1_000_000);
          return send(res, 200, { result: (await app.testModeration?.(String(body.text ?? '').slice(0, 500), body.role, body.moderation)) ?? null });
        }
        if (route === 'GET /api/moderation/log') return send(res, 200, { history: app.moderator?.history ?? [] });
        if (route === 'POST /api/moderation/undo') {
          const body = await readBody(req);
          try {
            await app.moderator.undo(Number(body.index));
          } catch (err) {
            throw Object.assign(new Error(err.message), { status: err.status ?? 400 });
          }
          return send(res, 200, { history: app.moderator.history });
        }
        // --- Shoutout automatici ---
        if (route === 'PUT /api/shoutouts') {
          const body = await readBody(req, 1_000_000);
          const config = app.config.save({ ...app.config.get(), shoutouts: body.shoutouts });
          app.broadcastState();
          return send(res, 200, { shoutouts: config.shoutouts });
        }
        if (route === 'GET /api/shoutouts/log') {
          return send(res, 200, { history: app.autoShoutout?.history ?? [], seen: app.autoShoutout?.seen ?? [] });
        }
        if (route === 'POST /api/shoutouts/reset') {
          app.autoShoutout?.reset();
          return send(res, 200, { history: app.autoShoutout?.history ?? [], seen: [] });
        }
        if (route === 'POST /api/shoutouts/test') {
          const body = await readBody(req, 1_000_000);
          if (!app.autoShoutout) return send(res, 400, { error: 'Shoutout non disponibili' });
          const settings = body.shoutouts ? sanitizeConfig({ ...app.config.get(), shoutouts: body.shoutouts }, app.config.defaults()).shoutouts : undefined;
          try {
            return send(res, 200, await app.autoShoutout.preview(body.login, settings));
          } catch (err) {
            throw Object.assign(new Error(err.message), { status: err.status ?? 400 });
          }
        }
        if (route === 'PUT /api/commands') {
          // Solo i comandi della chat: non tocca le altre impostazioni.
          const body = await readBody(req, 1_000_000);
          const config = app.config.save({ ...app.config.get(), commands: body.commands });
          app.broadcastState();
          return send(res, 200, { commands: config.commands });
        }
        if (route === 'POST /api/commands/test') {
          const body = await readBody(req, 1_000_000);
          const reply = await app.testCommand?.(String(body.text ?? '').slice(0, 500), body.role, body.commands);
          return send(res, 200, { reply: reply ?? null });
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
  const clients = { overlay: new Set(), dashboard: new Set(), chat: new Set() };

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
      const hello = {
        overlay: () => ({ type: 'hello', build: BUILD_ID, overlay: app.config.get().overlay }),
        chat: () => ({ type: 'hello', build: BUILD_ID, settings: app.config.get().chatOverlay, badges: app.chatFeed?.badges ?? {}, messages: app.chatFeed?.messages ?? [] }),
        dashboard: () => ({ type: 'state', state: app.getState() }),
      }[role];
      ws.send(JSON.stringify(hello()));
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
    toChat: (m) => broadcast('chat', m),
  };
}
