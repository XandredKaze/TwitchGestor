import fs from 'node:fs';
import path from 'node:path';
import { ConfigStore, DATA_DIR, loadEnv } from './config.js';
import { NotificationManager } from './core/NotificationManager.js';
import { fromEventSub } from './core/normalize.js';
import { TwitchAuth, BOT_SCOPES } from './twitch/auth.js';
import { HelixClient } from './twitch/helix.js';
import { EventSubClient } from './twitch/eventsub.js';
import { StreamElementsSource } from './sources/streamelements.js';
import { createServer } from './server.js';
import { API_LEVEL, APP_VERSION, BUILD_ID, codeChangedSinceStart } from './version.js';
import { isManaged } from './updates.js';
import https from 'node:https';
import os from 'node:os';
import { ensureCertificates } from './https.js';
import * as remote from './remote.js';
import { CreditsStore, startCreditsScheduler } from './credits.js';
import { ObsClient } from './obs.js';
import { createQuickActions } from './quickActions.js';
import { ChatModerator } from './core/moderation.js';
import { ChatFeed, toChatMessage, shouldShow, badgeMap } from './core/chatOverlay.js';
import { ChatCommands, humanDuration } from './core/commands.js';
import { AutoShoutout, shoutoutCard } from './core/shoutout.js';
import { TitleLog } from './core/titles.js';
import { LiveStats, computeRecap, recapText } from './core/livestats.js';
import { liveSession } from './core/session.js';
import { sendTelegram } from './telegram.js';
import { TelegramNotifier, whenText, fillText } from './core/telegramNotify.js';
import { Goals } from './core/goals.js';
import { Schedule, fromLocal } from './core/schedule.js';
import { MusicPlayer } from './core/music.js';
import { scanLibrary } from './musiclib.js';
import { sanitizeConfig } from './core/schema.js';
import { createLogger } from './logger.js';

loadEnv();
const log = createLogger('app');
const env = process.env;
const port = Number(env.PORT) || 3000;
const host = env.HOST || '127.0.0.1';
// indirizzo https della dashboard (vedi startHttps): sul Raspberry porta 443
let httpsPort = Number(env.HTTPS_PORT) || (isManaged() ? 443 : 0);
let httpsReady = false;
let httpsNeedsSetup = false; // la porta 443 non è permessa: va rilanciato lo script di installazione
let caFile = null;
let httpsHosts = []; // nomi e indirizzi per cui vale il certificato https
let tailscaleInfo = null; // accesso da fuori casa collegato: { ip, dnsName }
const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');

const config = new ConfigStore();
config.watch();

const manager = new NotificationManager({ config: config.get(), historyFile: path.join(DATA_DIR, 'history.json') });
config.on('change', (c) => manager.setConfig(c));

// La voce (text-to-speech) è stata tolta: cancella i file rimasti dalle versioni precedenti.
for (const dir of ['tts', 'piper']) {
  const full = path.join(DATA_DIR, dir);
  if (fs.existsSync(full)) {
    fs.rm(full, { recursive: true, force: true }, (err) => { if (!err) log.info(`Cartella della voce non più usata eliminata: data/${dir}`); });
  }
}

const auth = new TwitchAuth({
  clientId: env.TWITCH_CLIENT_ID,
  clientSecret: env.TWITCH_CLIENT_SECRET,
  redirectUri: `${publicUrl}/auth/callback`,
  tokenFile: path.join(DATA_DIR, 'tokens.json'),
});
const helix = new HelixClient({ auth, eventSubUrl: env.EVENTSUB_API_URL });

// Account bot facoltativo (es. "Wolfery") che scrive i ringraziamenti in chat al posto tuo.
const botAuth = new TwitchAuth({
  clientId: env.TWITCH_CLIENT_ID,
  clientSecret: env.TWITCH_CLIENT_SECRET,
  redirectUri: `${publicUrl}/auth/callback`,
  tokenFile: path.join(DATA_DIR, 'bot-tokens.json'),
  scopes: BOT_SCOPES,
});
const botHelix = new HelixClient({ auth: botAuth });

/** Chi scrive in chat: il bot se collegato, altrimenti il tuo account. */
function chatAccount() {
  if (botAuth.user) return { kind: 'bot', user: botAuth.user, sameAsChannel: botAuth.user.id === auth.user?.id };
  if (auth.user) return { kind: 'channel', user: auth.user };
  return null;
}

// Titoli di coda: nomi di abbonati, gift e follower scaricati con l'account del canale.
const creditsStore = new CreditsStore({ file: path.join(DATA_DIR, 'credits.json') });
const creditsScheduler = startCreditsScheduler({
  store: creditsStore,
  getClient: () => (auth.user ? { helix, user: auth.user } : null),
  getHistory: () => manager.history,
});
manager.on('notification', () => creditsScheduler.updateSession());

// Scene di OBS (tramite OBS WebSocket, incluso in OBS 28+).
const obs = new ObsClient({ file: path.join(DATA_DIR, 'obs.json') });

// --- Comandi della chat (!discord, !uptime...): letti con il tuo account, risposte del bot ---
function sendChat(text) {
  if (!auth.user) return Promise.reject(new Error('account Twitch non collegato'));
  const client = botAuth.user ? botHelix : helix;
  return client.sendChatMessage(text, auth.user.id).then(() => log.info(`Chat (${client.auth.user.login}): ${text}`));
}

// contatori dei comandi con {count}, salvati in data/command-counts.json
const COUNTS_FILE = path.join(DATA_DIR, 'command-counts.json');
let counts = {};
try { counts = JSON.parse(fs.readFileSync(COUNTS_FILE, 'utf8')); } catch { /* ancora nessun contatore */ }
let countsTimer = null;
const commandCounts = {
  get: (id) => counts[id] ?? 0,
  set: (id, n) => {
    counts[id] = n;
    clearTimeout(countsTimer);
    countsTimer = setTimeout(() => fs.writeFile(COUNTS_FILE, JSON.stringify(counts), () => {}), 1000);
  },
};

// dati di Twitch per le variabili, tenuti in memoria per un minuto
const cache = new Map();
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
// senza account collegato le variabili che chiedono dati a Twitch lo dicono, invece di un "?"
const needsAccount = (fn) => (...args) => (auth.user ? fn(...args) : '(account Twitch non collegato)');
const channelInfo = () => cached('channel', async () => (await helix.request('GET', `/channels?broadcaster_id=${auth.user.id}`)).data?.[0] ?? {});

const commandDeps = {
  counts: commandCounts,
  log,
  vars: {
    channel: () => auth.user?.login ?? '',
    song: () => musicPlayer.songText(),
    nextlive: () => {
      const n = schedule.next();
      if (!n) return 'non ancora in programma';
      const d = new Date(fromLocal(n.start));
      return `${d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} alle ${n.start.slice(11)}${n.title ? `: ${n.title}` : ''}`;
    },
    scene: () => obs.current,
    lastfollow: () => manager.history.find((n) => n.type === 'follow' && !n.test)?.user?.name ?? 'nessuno, per ora',
    game: needsAccount(async () => (await channelInfo()).game_name || 'nessuna categoria'),
    title: needsAccount(async () => (await channelInfo()).title || ''),
    uptime: needsAccount(() => cached('stream', async () => {
      const live = (await helix.request('GET', `/streams?user_id=${auth.user.id}`)).data?.[0];
      return live ? humanDuration(Date.now() - Date.parse(live.started_at)) : 'zero minuti (adesso non è in live)';
    })),
    followage: needsAccount(async (user) => {
      if (!user?.id || user.id === auth.user?.id) return 'sempre: è il canale!';
      const f = (await helix.request('GET', `/channels/followers?broadcaster_id=${auth.user.id}&user_id=${encodeURIComponent(user.id)}`)).data?.[0];
      return f ? humanDuration(Date.now() - Date.parse(f.followed_at), { precise: true }) : 'mai: non segue ancora il canale';
    }),
  },
  actions: {
    async scene(wanted) {
      if (obs.status !== 'connesso') throw new Error('OBS non è collegato a TwitchGestor');
      const w = wanted.toLowerCase();
      const name = obs.scenes.find((s) => s.toLowerCase() === w)
        ?? obs.scenes.find((s) => s.toLowerCase().startsWith(w))
        ?? obs.scenes.find((s) => s.toLowerCase().includes(w));
      if (!name) throw new Error(`Scena "${wanted}" non trovata`);
      await obs.setScene(name);
      return name;
    },
    credits: () => creditsStore.set('cmd', { type: 'restart', at: Date.now() }),
  },
};
const commands = new ChatCommands({ ...commandDeps, getConfig: () => config.get().commands, send: sendChat });
setInterval(() => commands.tick(), 30000).unref();

/** Prova di un comando dalla dashboard: non scrive in chat e non cambia nulla. */
function testCommand(text, role = 'broadcaster', draft) {
  const settings = draft ? sanitizeConfig({ ...config.get(), commands: draft }, config.defaults()).commands : config.get().commands;
  const tester = new ChatCommands({ ...commandDeps, getConfig: () => settings, send: () => {} });
  const badges = role === 'everyone' ? [] : [{ set_id: role }];
  const name = role === 'broadcaster' ? auth.user?.login ?? 'tu' : 'spettatore_di_prova';
  return tester.handle({ text, user: { id: role === 'broadcaster' ? auth.user?.id : 'prova', login: name, name }, badges }, { dryRun: true });
}

const quickActions = createQuickActions({
  helix,
  getUser: () => auth.user,
  // shoutout fatto a mano dalle Azioni rapide: anche lui compare nella chat di OBS
  onShoutout: (login) => {
    if (config.get().shoutouts?.obsCard === false) return;
    autoShoutout.channelInfo(login).then((info) => info && chatFeed.push(shoutoutCard(info))).catch(() => {});
  },
});

// --- Chat per OBS (pagina /chat): messaggi della chat, senza bot, comandi e messaggi moderati ---
const chatFeed = new ChatFeed({ send: (m) => web?.toChat(m) });
chatFeed.badges = {};
async function loadBadges() {
  if (!auth.user) return;
  try {
    const [global, channel] = await Promise.all([
      helix.request('GET', '/chat/badges/global'),
      helix.request('GET', `/chat/badges?broadcaster_id=${auth.user.id}`),
    ]);
    chatFeed.badges = badgeMap(global, channel);
    web?.toChat({ type: 'badges', badges: chatFeed.badges });
  } catch (err) {
    log.warn(`Badge della chat non disponibili: ${err.message}`);
  }
}
setInterval(loadBadges, 6 * 3600 * 1000).unref();

// --- Parole bannate: il bot (o il tuo account) cancella, dà timeout o banna ---
function modAccount() {
  if (botAuth.user && botAuth.user.id !== auth.user?.id) return { helix: botHelix, id: botAuth.user.id, name: botAuth.user.login, bot: true };
  return { helix, id: auth.user?.id, name: auth.user?.login, bot: false };
}
async function modRequest(method, path, body) {
  if (!auth.user) throw new Error('account Twitch non collegato');
  const m = modAccount();
  const sep = path.includes('?') ? '&' : '?';
  try {
    return await m.helix.request(method, `${path}${sep}broadcaster_id=${auth.user.id}&moderator_id=${m.id}`, body);
  } catch (err) {
    if (err.status === 403 || /moderator/i.test(err.message)) throw new Error(`${m.name} non è moderatore del canale: scrivi /mod ${m.name} nella tua chat`);
    if (err.status === 401) throw new Error(`manca un permesso a ${m.name}: ${m.bot ? 'ricollega il bot' : 'esci e accedi di nuovo'} dalla dashboard`);
    throw err;
  }
}
const moderator = new ChatModerator({
  getConfig: () => config.get().moderation,
  log,
  warn: (text) => sendChat(text),
  act: {
    delete: (messageId) => modRequest('DELETE', `/moderation/chat?message_id=${encodeURIComponent(messageId)}`),
    timeout: (userId, seconds, reason) => modRequest('POST', '/moderation/bans', { data: { user_id: userId, duration: seconds, reason } }),
    ban: (userId, reason) => modRequest('POST', '/moderation/bans', { data: { user_id: userId, reason } }),
    unban: (userId) => modRequest('DELETE', `/moderation/bans?user_id=${encodeURIComponent(userId)}`),
  },
  onAction: (r) => {
    log.info(`Moderazione: ${r.user} → ${r.label} (parola "${r.word}")${r.error ? ` NON riuscita: ${r.error}` : ''}`);
    web.toDashboards({ type: 'moderation', history: moderator.history });
  },
});

// --- Shoutout automatici: le persone scelte, al primo messaggio in chat della live ---
/** Chi fa lo shoutout ufficiale: il bot, se collegato e con il permesso; altrimenti il tuo account. */
function shoutoutAccount() {
  if (botAuth.user && botAuth.user.id !== auth.user?.id && !botAuth.missingScopes.includes('moderator:manage:shoutouts')) {
    return { helix: botHelix, id: botAuth.user.id, name: botAuth.user.login, bot: true };
  }
  return { helix, id: auth.user?.id, name: auth.user?.login, bot: false };
}
const SHOUTOUT_FILE = path.join(DATA_DIR, 'shoutouts.json');
let liveCheck = { at: 0, value: null };
const autoShoutout = new AutoShoutout({
  getConfig: () => config.get().shoutouts,
  log,
  send: sendChat,
  async shoutout(channelId) {
    if (!auth.user) throw new Error('account Twitch non collegato');
    const a = shoutoutAccount();
    try {
      await a.helix.request('POST', `/chat/shoutouts?from_broadcaster_id=${auth.user.id}&to_broadcaster_id=${encodeURIComponent(channelId)}&moderator_id=${a.id}`);
      log.info(`Shoutout ufficiale fatto da ${a.name}`);
    } catch (err) {
      if (err.status === 403 || /moderator/i.test(err.message)) throw Object.assign(new Error(`${a.name} non è moderatore del canale: scrivi /mod ${a.name} nella tua chat`), { status: err.status });
      throw err;
    }
  },
  channelInfo: (login) => cached(`so:${login}`, async () => {
    if (!auth.user) throw new Error('account Twitch non collegato');
    const u = (await helix.request('GET', `/users?login=${encodeURIComponent(login)}`)).data?.[0];
    if (!u) return null;
    const c = (await helix.request('GET', `/channels?broadcaster_id=${u.id}`)).data?.[0] ?? {};
    return { id: u.id, login: u.login, name: u.display_name || u.login, game: c.game_name || '', title: c.title || '', avatar: u.profile_image_url || '' };
  }),
  async liveSince() {
    // controllato al massimo ogni 30 secondi (quando inizi la live se ne accorge subito dopo)
    if (!auth.user) return null;
    if (Date.now() - liveCheck.at > 30000) {
      const live = (await helix.request('GET', `/streams?user_id=${auth.user.id}`)).data?.[0];
      liveCheck = { at: Date.now(), value: live?.started_at ?? null };
    }
    return liveCheck.value;
  },
  store: {
    load: () => JSON.parse(fs.readFileSync(SHOUTOUT_FILE, 'utf8')),
    save: (data) => fs.writeFile(SHOUTOUT_FILE, JSON.stringify(data), () => {}),
  },
  onChange: () => web?.toDashboards({ type: 'shoutouts', history: autoShoutout.history, seen: autoShoutout.seen }),
  onCard: (info) => chatFeed.push(shoutoutCard(info)),
});

// --- Storico dei titoli delle live (data/titles.json) ---
const TITLES_FILE = path.join(DATA_DIR, 'titles.json');
const titleLog = new TitleLog({
  store: {
    load: () => JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8')),
    save: (data) => fs.writeFile(TITLES_FILE, JSON.stringify(data), () => {}),
  },
  onChange: () => web?.toDashboards({ type: 'titles' }),
});
/** Live in corso secondo Twitch (titolo e categoria compresi), o null. */
async function currentLive() {
  return (await helix.request('GET', `/streams?user_id=${auth.user.id}`)).data?.[0] ?? null;
}
// --- Statistiche e riepiloghi delle live (data/stats.json) ---
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const liveStats = new LiveStats({
  store: {
    load: () => JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')),
    save: (data) => fs.writeFile(STATS_FILE, JSON.stringify(data), () => {}),
  },
  onChange: () => web?.toDashboards({ type: 'stats' }),
});

// --- Goal (barre in OBS): follower, abbonati, bits, donazioni (conteggi in data/goals.json) ---
const GOALS_FILE = path.join(DATA_DIR, 'goals.json');
const goals = new Goals({
  getConfig: () => config.get().goals,
  store: {
    load: () => JSON.parse(fs.readFileSync(GOALS_FILE, 'utf8')),
    save: (data) => fs.writeFile(GOALS_FILE, JSON.stringify(data), () => {}),
  },
  onChange: () => {
    const list = goals.snapshot();
    web?.toGoals({ type: 'goals', goals: list });
    web?.toDashboards({ type: 'goals', goals: list });
  },
});
// i totali di Twitch si rileggono ogni 2 minuti (se c'è un goal di follower o abbonati) e poco dopo ogni follow/sub
setInterval(() => {
  if (goals.list.some((g) => g.type === 'followers' || g.type === 'subs')) refreshTotals().catch(() => {});
}, 120000).unref();
let goalRefresh = null;
manager.on('notification', (n) => {
  goals.notification(n);
  if (['follow', 'sub', 'giftsub'].includes(n.type) && !n.test) {
    clearTimeout(goalRefresh);
    goalRefresh = setTimeout(() => refreshTotals().catch(() => {}), 8000);
  }
});

/** Follower e abbonati totali del canale (per le statistiche dei giorni e della live e per i goal). */
async function refreshTotals() {
  if (!auth.user) return;
  const id = auth.user.id;
  const [f, sub] = await Promise.allSettled([
    helix.request('GET', `/channels/followers?broadcaster_id=${id}&first=1`),
    helix.request('GET', `/subscriptions?broadcaster_id=${id}&first=1`),
  ]);
  liveStats.totals({
    followers: f.status === 'fulfilled' ? f.value.total : undefined,
    subscribers: sub.status === 'fulfilled' ? sub.value.total : undefined,
  });
  goals.setTotals({
    followers: f.status === 'fulfilled' ? f.value.total : undefined,
    subs: sub.status === 'fulfilled' ? sub.value.total : undefined,
  });
}
setInterval(() => refreshTotals().catch(() => {}), 6 * 3600 * 1000).unref();

// --- Telegram: chat privata (riepiloghi e avvisi per te) e canale pubblico (per la community) ---
const TELEGRAM_STATE = path.join(DATA_DIR, 'telegram-state.json');
const telegram = new TelegramNotifier({
  getConfig: () => config.get().telegram,
  send: (where, text) => {
    const t = config.get().telegram ?? {};
    return sendTelegram({ token: t.token, chatId: where === 'channel' ? t.channelId : t.chatId }, text);
  },
  store: {
    load: () => JSON.parse(fs.readFileSync(TELEGRAM_STATE, 'utf8')),
    save: (data) => fs.writeFile(TELEGRAM_STATE, JSON.stringify(data), () => {}),
  },
  log,
});
/** Variabili per i messaggi di Telegram: nome del canale, link, prossima live. */
function telegramVars(extra = {}) {
  const n = schedule.next();
  return {
    channel: auth.user?.display_name || auth.user?.login || '',
    link: auth.user ? `https://twitch.tv/${auth.user.login}` : '',
    next: n ? `${whenText(fromLocal(n.start))}${n.title ? ` — ${n.title}` : ''}` : 'presto, resta sintonizzato!',
    title: '', game: '',
    ...extra,
  };
}
manager.on('notification', (n) => telegram.notification(n));
/** Anteprima dei messaggi del canale (pulsante "Prova" nella dashboard), con dati veri o di esempio. */
function telegramPreview(key) {
  const vars = telegramVars({ title: titleLog.titles()[0]?.title ?? 'Titolo della live', game: titleLog.titles()[0]?.game ?? 'Just Chatting', minutes: config.get().telegram?.reminderMin ?? 30 });
  const week = schedule.upcoming().filter((e) => fromLocal(e.start) < Date.now() + 7 * 86400000).map((e) => ({ id: e.id, start: fromLocal(e.start), title: e.title, game: e.game }));
  if (key === 'weeklyCaption') return `📅 Le live di questa settimana\n👉 ${vars.link}`;
  if (key === 'weekly') return week.length ? telegram.weeklyText(week, vars) : '📅 Nessuna live in programma nei prossimi 7 giorni (aggiungile in Programmazione).';
  return fillText(telegram.text(['liveStart', 'reminder', 'liveEnd'].includes(key) ? key : 'liveStart'), vars);
}
setInterval(() => {
  const entries = schedule.upcoming().map((e) => ({ id: e.id, start: fromLocal(e.start), title: e.title, game: e.game }));
  telegram.tick(entries, telegramVars());
}, 60000).unref();

/** Live iniziata (o ritrovata): storico dei titoli, statistiche e, se vuoi, avviso su Telegram. */
function liveStarted(stream) {
  titleLog.online({ startedAt: stream.started_at, title: stream.title, game: stream.game_name, gameId: stream.game_id });
  const isNew = !liveStats.current;
  liveStats.start(stream.started_at);
  if (!isNew) return;
  refreshTotals().catch(() => {});
  // solo se la live è iniziata da poco (non quando TwitchGestor si riaccende a live già in corso)
  if (Date.now() - new Date(stream.started_at).getTime() < 15 * 60000) {
    telegram.liveStart(telegramVars({ title: stream.title, game: stream.game_name }));
  }
}

/** Live finita: chiude statistiche e storico e prepara il riepilogo (più Telegram, se attivo). */
async function liveEnded(at = Date.now()) {
  titleLog.offline(at);
  const live = liveStats.current;
  if (!live) return;
  await refreshTotals().catch(() => {});
  liveStats.end(at);
  const titles = titleLog.lives.find((l) => Math.abs(l.startedAt - live.startedAt) < 60000)?.changes ?? [];
  live.recap = computeRecap(live, { session: liveSession(manager.history, live.startedAt, live.endedAt), titles, previous: liveStats.recaps });
  liveStats.save();
  log.info(`Riepilogo della live pronto (${Math.round(live.recap.durationMs / 60000)} minuti, media ${live.recap.viewers.average} spettatori)`);
  telegram.liveEnd(recapText(live.recap), telegramVars());
}

// --- Musica: libreria in data/media/music, riprodotta dalla pagina /music in OBS ---
const MUSIC_DIR = path.join(DATA_DIR, 'media', 'music');
const MUSIC_FILE = path.join(DATA_DIR, 'music.json');
let musicLibrary = scanLibrary(MUSIC_DIR);
const musicPlayer = new MusicPlayer({
  getLibrary: () => musicLibrary,
  send: (m) => web?.toMusic(m),
  store: {
    load: () => JSON.parse(fs.readFileSync(MUSIC_FILE, 'utf8')),
    save: (data) => fs.writeFile(MUSIC_FILE, JSON.stringify(data), () => {}),
  },
  onChange: () => web?.toDashboards({ type: 'music', music: musicPlayer.snapshot() }),
});
/** Rilegge la cartella (i file si possono aggiungere dalla cartella condivisa in qualsiasi momento). */
function rescanMusic() {
  const before = musicLibrary.map((t) => t.id).join('|');
  musicLibrary = scanLibrary(MUSIC_DIR);
  if (musicLibrary.map((t) => t.id).join('|') !== before) web?.toDashboards({ type: 'music', library: true, music: musicPlayer.snapshot() });
  return musicLibrary;
}
setInterval(rescanMusic, 60000).unref();

// --- Programmazione delle live (data/schedule.json) ---
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const schedule = new Schedule({
  store: {
    load: () => JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')),
    save: (data) => fs.writeFile(SCHEDULE_FILE, JSON.stringify(data), () => {}),
  },
  onChange: () => web?.toDashboards({ type: 'schedule' }),
});
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
/** Pochi minuti prima di una live in programma: imposta da solo titolo e categoria su Twitch. */
async function scheduleTick() {
  if (!auth.user) return;
  for (const e of schedule.due()) {
    try {
      await quickActions.run('info', { ...(e.title ? { title: e.title } : {}), ...(e.gameId ? { gameId: e.gameId } : {}) });
      schedule.markApplied(e.id);
      log.info(`Programmazione: impostati titolo e categoria della live delle ${e.start.slice(11)} ("${e.title}")`);
    } catch (err) {
      log.warn(`Programmazione: titolo non impostato (${err.message})`);
    }
  }
}
setInterval(() => scheduleTick().catch(() => {}), 60000).unref();
/** Calendario delle live su Twitch: crea o aggiorna la live in programma (serve il permesso channel:manage:schedule). */
async function publishSchedule(e) {
  if (!auth.user) throw Object.assign(new Error('Collega prima il tuo account Twitch'), { status: 409 });
  if (!auth.hasScope('channel:manage:schedule')) throw Object.assign(new Error('Per il calendario di Twitch serve un nuovo accesso: Esci e Accedi con Twitch'), { status: 409 });
  const body = {
    start_time: new Date(fromLocal(e.start)).toISOString(), timezone: TIMEZONE, duration: String(e.durationMin),
    ...(e.title ? { title: e.title } : {}), ...(e.gameId ? { category_id: e.gameId } : {}),
  };
  const base = `/schedule/segment?broadcaster_id=${auth.user.id}`;
  if (e.twitchId) {
    try {
      await helix.request('PATCH', `${base}&id=${encodeURIComponent(e.twitchId)}`, body);
      return e.twitchId;
    } catch { /* cancellata da Twitch: si ricrea */ }
  }
  const r = await helix.request('POST', base, { ...body, is_recurring: false });
  const seg = (r.data?.segments ?? []).find((x) => Date.parse(x.start_time) === Date.parse(body.start_time)) ?? r.data?.segments?.[0];
  if (!seg?.id) throw new Error('Twitch non ha confermato la live in programma');
  schedule.setTwitchId(e.id, seg.id);
  return seg.id;
}
async function unpublishSchedule(twitchId) {
  if (!auth.user || !twitchId) return;
  await helix.request('DELETE', `/schedule/segment?broadcaster_id=${auth.user.id}&id=${encodeURIComponent(twitchId)}`).catch(() => {});
}

/** Inizio live: Twitch a volte la mostra con qualche secondo di ritardo, quindi riprova. */
async function recordLiveStart(startedAt) {
  for (let i = 0; i < 4; i++) {
    try {
      const live = await currentLive();
      if (live) return liveStarted(live);
    } catch { /* riprova */ }
    await new Promise((r) => setTimeout(r, 15000));
  }
  const c = await channelInfo().catch(() => ({}));
  return liveStarted({ started_at: startedAt, title: c.title, game_name: c.game_name, game_id: c.game_id });
}

/**
 * Ogni minuto: spettatori della live in corso. Serve anche da rete di sicurezza se Twitch non avvisa
 * dell'inizio o della fine (es. programma riavviato): dopo 3 controlli "non in live" la chiude.
 */
let offlineChecks = 0;
async function liveTick() {
  if (!auth.user) return;
  let stream;
  try { stream = await currentLive(); } catch { return; }
  if (stream) {
    offlineChecks = 0;
    if (!liveStats.current || !titleLog.current) liveStarted(stream);
    liveStats.sample(stream.viewer_count);
    titleLog.seen();
  } else if (liveStats.current && ++offlineChecks >= 3) {
    offlineChecks = 0;
    await liveEnded(liveStats.current.samples.at(-1)?.[0] ?? Date.now());
  }
}
setInterval(() => liveTick().catch((err) => log.warn(`Statistiche della live: ${err.message}`)), 60000).unref();

/** All'avvio: se sei in live la ritrova, se una live era rimasta aperta la chiude con il suo riepilogo. */
async function syncLiveTitles() {
  try {
    refreshTotals().catch(() => {});
    const live = await currentLive();
    if (live) liveStarted(live);
    else {
      if (titleLog.current) titleLog.offline(titleLog.current.lastSeen ?? Date.now());
      if (liveStats.current) await liveEnded(liveStats.current.samples.at(-1)?.[0] ?? liveStats.current.startedAt);
    }
  } catch (err) {
    log.warn(`Stato della live non disponibile (${err.message})`);
  }
}

/** Prova della moderazione dalla dashboard: non fa nulla in chat. */
function testModeration(text, role = 'everyone', draft) {
  const settings = draft ? sanitizeConfig({ ...config.get(), moderation: draft }, config.defaults()).moderation : config.get().moderation;
  const tester = new ChatModerator({ getConfig: () => settings });
  return tester.handle({ text, user: { id: 'prova', login: 'prova', name: 'prova' }, badges: role === 'everyone' ? [] : [{ set_id: role }] }, { dryRun: true });
}

let eventsub = null;
const streamelements = env.STREAMELEMENTS_JWT ? new StreamElementsSource({ jwt: env.STREAMELEMENTS_JWT }) : null;

const app = {
  env,
  config,
  manager,
  auth,
  botAuth,
  credits: { store: creditsStore, refresh: (reason) => creditsScheduler.refresh(reason) },
  obs,
  testCommand,
  quickActions,
  moderator,
  testModeration,
  autoShoutout,
  titleLog,
  liveStats,
  music: {
    player: musicPlayer,
    library: () => musicLibrary,
    rescan: rescanMusic,
  },
  schedule: {
    state: () => ({ entries: schedule.entries, next: schedule.next(), timezone: TIMEZONE, canPublish: Boolean(auth.user && auth.hasScope('channel:manage:schedule')) }),
    replace(list) {
      const before = new Map(schedule.entries.map((e) => [e.id, e]));
      const after = schedule.replace(list);
      const ids = new Set(after.map((e) => e.id));
      for (const [id, e] of before) if (!ids.has(id) && e.twitchId) unpublishSchedule(e.twitchId);
      return after;
    },
    async publish(ids) {
      const results = [];
      for (const e of schedule.entries.filter((x) => ids.includes(x.id))) {
        try { await publishSchedule(e); results.push({ id: e.id, ok: true }); } catch (err) { results.push({ id: e.id, ok: false, error: err.message }); }
      }
      return results;
    },
  },
  chatFeed,
  /** In live adesso? (OBS sta trasmettendo o Twitch ti mostra in live): lo script di aggiornamento aspetta. */
  async isBusy() {
    if (obs.state().stream?.active) return true;
    if (!auth.user) return false;
    try {
      return Boolean(await autoShoutout.liveSince());
    } catch {
      return false;
    }
  },
  chatAccount,
  telegramPreview,
  goals,
  getState() {
    return {
      apiLevel: API_LEVEL,
      version: APP_VERSION,
      build: BUILD_ID,
      managed: isManaged(), // installato sul Raspberry: aggiornamenti dalla dashboard
      httpsUrl: httpsReady ? httpsBase() : null,
      httpsNeedsSetup,
      httpsHosts,
      restartNeeded: codeChangedSinceStart(),
      twitch: {
        configured: auth.configured,
        user: auth.user,
        status: eventsub?.status ?? 'disconnesso',
        missingScopes: auth.user ? auth.missingScopes : [],
        failedSubscriptions: eventsub?.failedSubscriptions ?? [],
      },
      sources: {
        streamelements: streamelements?.status ?? 'disattivato',
        kofi: env.KOFI_VERIFICATION_TOKEN ? 'attivo' : 'disattivato',
        webhook: env.DONATION_WEBHOOK_SECRET ? 'attivo' : 'disattivato',
      },
      ui: config.get().ui,
      overlays: web?.clients.overlay.size ?? 0,
      musicPages: web?.musicPages() ?? 0,
      obs: obs.state(),
      moderation: {
        enabled: Boolean(config.get().moderation?.enabled),
        by: auth.user ? modAccount().name : null,
        byBot: auth.user ? modAccount().bot : false,
        missingScope: Boolean(auth.user && (modAccount().bot
          ? ['moderator:manage:chat_messages', 'moderator:manage:banned_users'].some((s) => botAuth.missingScopes.includes(s))
          : auth.missingScopes.includes('moderator:manage:banned_users'))),
      },
      shoutouts: {
        enabled: Boolean(config.get().shoutouts?.enabled),
        by: auth.user ? shoutoutAccount().name : null,
        byBot: auth.user ? shoutoutAccount().bot : false,
        // il bot è collegato ma gli manca il permesso nuovo: va ricollegato
        botMissingScope: Boolean(botAuth.user && botAuth.user.id !== auth.user?.id && botAuth.missingScopes.includes('moderator:manage:shoutouts')),
      },
      commands: {
        enabled: Boolean(config.get().commands?.enabled),
        missingScope: Boolean(auth.user && auth.missingScopes.includes('user:read:chat')),
        reading: Boolean(eventsub && eventsub.status === 'connesso' && !eventsub.failedSubscriptions?.some((f) => f.type === 'channel.chat.message')),
      },
      chatReplies: Boolean(config.get().chat?.enabled),
      chatAccount: chatAccount(),
      overlayUrl: `${publicUrl}/overlay`,
      types: Object.fromEntries(Object.entries(config.get().types).map(([k, v]) => [k, { label: v.label ?? k, color: v.color }])),
      queue: manager.queueState(),
      stats: { ...manager.stats, donors: undefined, topDonors: manager.topDonors() },
      history: manager.history.slice(0, 200),
    };
  },
  broadcastState() {
    web?.toDashboards({ type: 'state', state: app.getState() });
  },
  logout() {
    auth.logout();
  },
  logoutBot() {
    botAuth.logout();
    log.info('Account bot scollegato: i messaggi in chat useranno il tuo account');
    app.broadcastState();
  },
  shutdown() {
    shutdown();
  },
};

const web = createServer(app);

// --- Collegamenti tra i moduli ---
manager.on('alert', (alert) => {
  web.toOverlays({ type: 'alert', alert });
  web.toDashboards({ type: 'alert', alert });
  // la musica si abbassa mentre c'è l'alert, così si sentono suono e voce
  if (config.get().music?.duck !== false) web.toMusic({ type: 'duck', ms: alert.duration ?? 5000, level: config.get().music?.duckLevel ?? 0.3 });
});
manager.on('skip', (alert) => web.toOverlays({ type: 'skip', id: alert.id }));
manager.on('queue', (queue) => web.toDashboards({ type: 'queue', queue }));
manager.on('notification', () => app.broadcastState());
manager.on('chat', (text) => {
  if (!auth.user) return;
  sendChat(text).catch((err) => log.warn(`Invio messaggio in chat fallito: ${err.message}`));
});
config.on('change', (c) => {
  web.toOverlays({ type: 'hello', overlay: c.overlay });
  web.toChat({ type: 'settings', settings: c.chatOverlay });
  app.broadcastState();
});

obs.on('status', () => app.broadcastState());
obs.on('scenes', (state) => web.toDashboards({ type: 'obs', obs: state }));
// Inizio della diretta: quello di Twitch (come il contatore di Twitch), non quello di OBS.
// OBS inizia a contare quando parte l'invio del video, che può essere prima che Twitch ti mostri in live.
const twitchLive = { checkedAt: 0, startedAt: null };
async function checkTwitchLive() {
  if (!auth.user) return;
  // ogni 15 secondi finché Twitch non ti mostra in live, poi ogni minuto
  if (Date.now() - twitchLive.checkedAt < (twitchLive.startedAt ? 60000 : 15000)) return;
  twitchLive.checkedAt = Date.now();
  try {
    const live = (await helix.request('GET', `/streams?user_id=${auth.user.id}`)).data?.[0];
    twitchLive.startedAt = live ? Date.parse(live.started_at) : null;
  } catch (err) {
    log.warn(`Stato della live su Twitch non disponibile: ${err.message}`);
  }
}
obs.on('stream', (stream) => {
  telegram.streamHealth(stream);
  if (stream.active) checkTwitchLive();
  else Object.assign(twitchLive, { checkedAt: 0, startedAt: null });
  stream.liveSince = stream.active ? twitchLive.startedAt ?? null : null; // ms (orologio del PC)
  stream.twitchLive = Boolean(stream.active && twitchLive.startedAt);
  stream.twitchChecked = Boolean(auth.user);
  web.toDashboards({ type: 'stream', stream });
});

function startEventSub() {
  eventsub?.stop();
  if (!auth.user) return;
  eventsub = new EventSubClient({ helix, userId: auth.user.id, url: env.EVENTSUB_WS_URL });
  eventsub.on('event', (type, payload, messageId) => {
    if (type === 'channel.chat.message') {
      if (payload.chatter_user_id === botAuth.user?.id) {
        // il bot non risponde a sé stesso; nella chat di OBS compare solo se non è nascosto
        const shown = toChatMessage(payload, { botId: botAuth.user.id });
        if (shouldShow(shown, config.get().chatOverlay)) chatFeed.push(shown);
        return;
      }
      liveStats.chat(payload.chatter_user_login, payload.chatter_user_name); // per il riepilogo della live
      const msg = {
        id: payload.message_id,
        text: payload.message?.text,
        user: { id: payload.chatter_user_id, login: payload.chatter_user_login, name: payload.chatter_user_name },
        badges: payload.badges,
      };
      // prima le parole bannate: un messaggio moderato non esegue comandi e non compare nella chat di OBS
      moderator.handle(msg)
        .then((moderated) => {
          if (moderated) return null;
          const shown = toChatMessage(payload, { botId: botAuth.user?.id });
          if (shouldShow(shown, config.get().chatOverlay, { commandPrefix: config.get().commands?.prefix })) chatFeed.push(shown);
          autoShoutout.handle(msg).catch((err) => log.warn(`Shoutout automatico non riuscito: ${err.message}`));
          return commands.handle(msg);
        })
        .catch((err) => log.warn(`Messaggio della chat non gestito: ${err.message}`));
      return;
    }
    if (type === 'stream.online') { recordLiveStart(payload.started_at).catch((err) => log.warn(`Storico dei titoli: ${err.message}`)); return; }
    if (type === 'stream.offline') { liveEnded().catch((err) => log.warn(`Fine live: ${err.message}`)); return; }
    if (type === 'channel.update') { titleLog.update({ title: payload.title, game: payload.category_name, gameId: payload.category_id }); return; }
    if (type === 'channel.chat.message_delete') { chatFeed.remove(payload.message_id); return; }
    if (type === 'channel.chat.clear_user_messages') { chatFeed.removeUser(payload.target_user_id); return; }
    if (type === 'channel.chat.clear') { chatFeed.clear(); return;
    }
    const n = fromEventSub(type, payload, messageId);
    if (n) manager.ingest(n);
    if (n && ['follow', 'sub', 'resub', 'giftsub'].includes(n.type)) creditsScheduler.soon();
  });
  eventsub.on('status', () => app.broadcastState());
  eventsub.start();
}

auth.on('authorized', (user) => {
  log.info(`Accesso Twitch effettuato come ${user.login}`);
  startEventSub();
  auth.startPeriodicValidation();
  creditsScheduler.refresh('accesso');
  loadBadges();
  app.broadcastState();
});
botAuth.on('authorized', (user) => {
  if (user.id === auth.user?.id) log.warn(`Hai collegato come bot lo stesso account del canale (${user.login}): per usare Wolfery accedi con il suo account`);
  else log.info(`Account bot collegato: ${user.login}. I ringraziamenti in chat li scriverà lui`);
  botAuth.startPeriodicValidation();
  app.broadcastState();
});

auth.on('unauthorized', () => {
  eventsub?.stop();
  eventsub = null;
  app.broadcastState();
});

if (streamelements) {
  streamelements.on('notification', (n) => manager.ingest(n));
  streamelements.on('status', () => app.broadcastState());
  streamelements.start();
}

web.server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  log.warn(`La porta ${port} è già in uso: TwitchGestor è probabilmente già in esecuzione (${publicUrl}/dashboard)`);
  process.exit(0);
});

// Indirizzo https (sul Raspberry, porta 443): Twitch mostra player e chat solo su https o "localhost",
// e solo sulla porta standard (443). Stesse pagine e API dell'indirizzo normale; OBS usa quello normale.
// La porta 443 richiede il permesso dato dal servizio (scripts/raspberry/system-setup.sh): senza,
// si usa la 3443 e la dashboard chiede di rilanciare l'installazione.
// Il servizio di aggiornamento (che ha i permessi di sistema) sistema i servizi e riavvia TwitchGestor.
// Al massimo una richiesta al giorno, per non ripetere all'infinito se qualcosa non va.
function askSystemSetup() {
  if (!isManaged()) return;
  const marker = path.join(DATA_DIR, 'system-setup-requested');
  try {
    if (fs.existsSync(marker) && Date.now() - fs.statSync(marker).mtimeMs < 86400000) return;
    fs.writeFileSync(marker, new Date().toISOString());
    fs.writeFileSync(path.join(DATA_DIR, 'update-request'), new Date().toISOString());
  } catch (err) {
    log.warn(`Richiesta di sistemare i servizi non riuscita: ${err.message}`);
  }
}
const httpsBase = () => `https://${os.hostname().toLowerCase()}.local${httpsPort === 443 ? '' : `:${httpsPort}`}`;
const secureServers = [];
const CERT_DIR = path.join(DATA_DIR, 'https');
const hostsOf = (names) => names.split(',').map((n) => n.replace(/^(DNS|IP):/, ''));
async function startHttps() {
  if (!httpsPort) return;
  const certs = await ensureCertificates(CERT_DIR, { tailscale: tailscaleInfo });
  if (!certs) return;
  caFile = certs.caFile;
  httpsHosts = hostsOf(certs.names);
  const listen = (port) => {
    const secure = https.createServer({ key: certs.key, cert: certs.cert }, (req, res) => web.server.emit('request', req, res));
    secureServers.push(secure);
    secure.on('upgrade', (req, socket, head) => web.server.emit('upgrade', req, socket, head));
    secure.on('error', (err) => {
      if (err.code === 'EACCES' && port === 443) {
        log.warn('Porta 443 non ancora permessa: uso la 3443 e chiedo al servizio di aggiornamento di sistemarla.');
        httpsNeedsSetup = true;
        askSystemSetup();
        httpsPort = 3443;
        listen(3443);
      } else log.warn(`Indirizzo https non disponibile: ${err.message}`);
    });
    secure.listen(port, host, () => {
      httpsReady = true;
      log.info(`Dashboard in https: ${httpsBase()}/dashboard`);
      app.broadcastState();
      // chi ha ancora aperto il vecchio indirizzo con :3443 viene portato su quello nuovo (stesso nome o indirizzo)
      if (port === 443) {
        const redirect = https.createServer({ key: certs.key, cert: certs.cert }, (req, res) => {
          const name = String(req.headers.host ?? '').replace(/:\d+$/, '');
          res.writeHead(301, { Location: `${httpsHosts.includes(name) ? `https://${name}` : httpsBase()}${req.url}` });
          res.end();
        }).on('error', () => {});
        secureServers.push(redirect);
        redirect.listen(3443, host);
      }
    });
  };
  listen(httpsPort);
}

// Accesso da fuori casa (Tailscale): quando è collegato il certificato vale anche per l'indirizzo 100.x
// e il nome .ts.net del Raspberry. Si controlla ogni minuto e il certificato si cambia senza riavviare.
let httpsRefreshing = false;
async function refreshRemote() {
  if (!isManaged() || httpsRefreshing) return;
  httpsRefreshing = true;
  try {
    const st = await remote.status();
    const next = st.connected && st.ip ? { ip: st.ip, dnsName: st.dnsName } : null;
    if (JSON.stringify(next) !== JSON.stringify(tailscaleInfo)) {
      tailscaleInfo = next;
      if (secureServers.length) {
        const certs = await ensureCertificates(CERT_DIR, { tailscale: tailscaleInfo });
        if (certs) {
          for (const s of secureServers) s.setSecureContext({ key: certs.key, cert: certs.cert });
          caFile = certs.caFile;
          httpsHosts = hostsOf(certs.names);
          app.broadcastState();
        }
      }
    }
  } catch (err) {
    log.warn(`Accesso da fuori casa: ${err.message}`);
  } finally {
    httpsRefreshing = false;
  }
}
setInterval(refreshRemote, 60000).unref();
app.remote = {
  httpPort: port,
  status: () => remote.status(),
  install: () => remote.requestInstall(),
  connect: async () => { const url = await remote.connect(); setTimeout(refreshRemote, 3000); return url; },
  disconnect: async () => { await remote.disconnect(); await refreshRemote(); },
  refresh: refreshRemote,
};
app.httpsCertificate = () => caFile;

// Numero del processo: serve allo script di OBS per spegnere il programma quando gira nascosto.
const PID_FILE = path.join(DATA_DIR, 'twitchgestor.pid');

web.server.listen(port, host, async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  log.info(`Dashboard: ${publicUrl}/dashboard${env.DASHBOARD_TOKEN ? '?token=…' : ''}`);
  log.info(`Overlay per OBS: ${publicUrl}/overlay`);
  obs.start();
  await refreshRemote();
  startHttps();
  if (!auth.configured) {
    log.warn('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET mancanti nel file .env: Twitch non verrà collegato');
    return;
  }
  if (!auth.user) {
    log.info(`Apri ${publicUrl}/auth/login per collegare il tuo account Twitch`);
    return;
  }
  try {
    if (await auth.validate()) {
      startEventSub();
      refreshTotals().catch(() => {});
      syncLiveTitles();
      creditsScheduler.onStart();
      loadBadges();
    }
  } catch (err) {
    log.error(`Impossibile verificare il token Twitch: ${err.message}`);
  }
  auth.startPeriodicValidation();
  if (botAuth.user) {
    botAuth.validate()
      .then((ok) => { if (ok) log.info(`Account bot: ${botAuth.user.login}`); })
      .catch((err) => log.warn(`Impossibile verificare l'account bot: ${err.message}`));
    botAuth.startPeriodicValidation();
  }
});

function shutdown() {
  log.info('Chiusura…');
  eventsub?.stop();
  streamelements?.stop();
  obs.stop();
  manager.stop();
  creditsStore.saveNow();
  try {
    if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.rmSync(PID_FILE);
  } catch { /* già rimosso */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
