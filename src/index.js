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
import { CreditsStore, startCreditsScheduler } from './credits.js';
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
});

let eventsub = null;
const streamelements = env.STREAMELEMENTS_JWT ? new StreamElementsSource({ jwt: env.STREAMELEMENTS_JWT }) : null;

const app = {
  env,
  config,
  manager,
  auth,
  botAuth,
  credits: { store: creditsStore, refresh: (reason) => creditsScheduler.refresh(reason) },
  chatAccount,
  getState() {
    return {
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
      overlays: web?.clients.overlay.size ?? 0,
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
  const client = botAuth.user ? botHelix : helix;
  client.sendChatMessage(text, auth.user.id)
    .then(() => log.info(`Chat (${client.auth.user.login}): ${text}`))
    .catch((err) => log.warn(`Invio messaggio in chat fallito (${client.auth.user.login}): ${err.message}`));
});
config.on('change', (c) => {
  web.toOverlays({ type: 'hello', overlay: c.overlay });
  app.broadcastState();
});

function startEventSub() {
  eventsub?.stop();
  if (!auth.user) return;
  eventsub = new EventSubClient({ helix, userId: auth.user.id, url: env.EVENTSUB_WS_URL });
  eventsub.on('event', (type, payload, messageId) => {
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
  manager.stop();
  creditsStore.saveNow();
  try {
    if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.rmSync(PID_FILE);
  } catch { /* già rimosso */ }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
