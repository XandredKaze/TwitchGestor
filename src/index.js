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
import { API_LEVEL, APP_VERSION, codeChangedSinceStart } from './version.js';
import { CreditsStore, startCreditsScheduler } from './credits.js';
import { TtsService, PiperManager } from './tts.js';
import { ObsClient } from './obs.js';
import { createQuickActions } from './quickActions.js';
import { ChatModerator } from './core/moderation.js';
import { ChatCommands, humanDuration } from './core/commands.js';
import { sanitizeConfig } from './core/schema.js';
import { createLogger } from './logger.js';

loadEnv();
const log = createLogger('app');
const env = process.env;
const port = Number(env.PORT) || 3000;
const host = env.HOST || '127.0.0.1';
const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '');

const config = new ConfigStore();
config.watch();

const manager = new NotificationManager({ config: config.get(), historyFile: path.join(DATA_DIR, 'history.json') });
config.on('change', (c) => manager.setConfig(c));

// Voce (text-to-speech): l'audio si crea mentre l'alert aspetta in coda, poi l'overlay lo suona.
const tts = new TtsService({ dir: path.join(DATA_DIR, 'tts'), piper: new PiperManager({ dir: path.join(DATA_DIR, 'piper') }) });
manager.prepareAlert = async (alert) => {
  const result = await tts.synthesize(alert.tts.text, config.get().tts);
  if (!result) return; // nessuna voce di sistema: l'overlay proverà con quella del browser
  const delay = alert.sound ? 1200 : 300; // la voce parte dopo il suono dell'alert
  alert.tts = { ...alert.tts, url: result.url, delay };
  alert.duration = Math.max(alert.duration, delay + result.duration * 1000 + 800);
};

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

const quickActions = createQuickActions({ helix, getUser: () => auth.user });

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
  tts,
  obs,
  testCommand,
  quickActions,
  moderator,
  testModeration,
  chatAccount,
  getState() {
    return {
      apiLevel: API_LEVEL,
      version: APP_VERSION,
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
      obs: obs.state(),
      moderation: {
        enabled: Boolean(config.get().moderation?.enabled),
        by: auth.user ? modAccount().name : null,
        byBot: auth.user ? modAccount().bot : false,
        missingScope: Boolean(auth.user && (modAccount().bot
          ? ['moderator:manage:chat_messages', 'moderator:manage:banned_users'].some((s) => botAuth.missingScopes.includes(s))
          : auth.missingScopes.includes('moderator:manage:banned_users'))),
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
      if (payload.chatter_user_id === botAuth.user?.id) return; // il bot non risponde a sé stesso
      const msg = {
        id: payload.message_id,
        text: payload.message?.text,
        user: { id: payload.chatter_user_id, login: payload.chatter_user_login, name: payload.chatter_user_name },
        badges: payload.badges,
      };
      // prima le parole bannate: un messaggio moderato non esegue comandi
      moderator.handle(msg)
        .then((moderated) => (moderated ? null : commands.handle(msg)))
        .catch((err) => log.warn(`Messaggio della chat non gestito: ${err.message}`));
      return;
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

// Numero del processo: serve allo script di OBS per spegnere il programma quando gira nascosto.
const PID_FILE = path.join(DATA_DIR, 'twitchgestor.pid');

web.server.listen(port, host, async () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  log.info(`Dashboard: ${publicUrl}/dashboard${env.DASHBOARD_TOKEN ? '?token=…' : ''}`);
  log.info(`Overlay per OBS: ${publicUrl}/overlay`);
  obs.start();
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
      creditsScheduler.onStart();
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
