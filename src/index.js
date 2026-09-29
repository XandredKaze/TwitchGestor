import path from 'node:path';
import { ConfigStore, DATA_DIR, loadEnv } from './config.js';
import { NotificationManager } from './core/NotificationManager.js';
import { fromEventSub } from './core/normalize.js';
import { TwitchAuth } from './twitch/auth.js';
import { HelixClient } from './twitch/helix.js';
import { EventSubClient } from './twitch/eventsub.js';
import { StreamElementsSource } from './sources/streamelements.js';
import { createServer } from './server.js';
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

let eventsub = null;
const streamelements = env.STREAMELEMENTS_JWT ? new StreamElementsSource({ jwt: env.STREAMELEMENTS_JWT }) : null;

const app = {
  env,
  config,
  manager,
  auth,
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
  helix.sendChatMessage(text).catch((err) => log.warn(`Invio messaggio in chat fallito: ${err.message}`));
});
config.on('change', (c) => web.toOverlays({ type: 'hello', overlay: c.overlay }));

function startEventSub() {
  eventsub?.stop();
  if (!auth.user) return;
  eventsub = new EventSubClient({ helix, userId: auth.user.id, url: env.EVENTSUB_WS_URL });
  eventsub.on('event', (type, payload, messageId) => {
    const n = fromEventSub(type, payload, messageId);
    if (n) manager.ingest(n);
  });
  eventsub.on('status', () => app.broadcastState());
  eventsub.start();
}

auth.on('authorized', (user) => {
  log.info(`Accesso Twitch effettuato come ${user.login}`);
  startEventSub();
  auth.startPeriodicValidation();
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

web.server.listen(port, host, async () => {
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
    if (await auth.validate()) startEventSub();
  } catch (err) {
    log.error(`Impossibile verificare il token Twitch: ${err.message}`);
  }
  auth.startPeriodicValidation();
});

function shutdown() {
  log.info('Chiusura…');
  eventsub?.stop();
  streamelements?.stop();
  manager.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
