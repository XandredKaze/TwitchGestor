/**
 * TwitchGestor – versione demo che gira interamente nel browser.
 *
 * Questo file sostituisce il server: intercetta le chiamate della pagina (fetch verso /api/... e
 * WebSocket verso /ws) e le gestisce qui, riusando lo stesso codice del programma vero
 * (coda degli alert, filtri, varianti, testi, validazione delle impostazioni).
 * Non si collega a Twitch: gli eventi sono simulati. Le impostazioni restano solo in questo browser.
 *
 * Si compila con: npm run build:demo  (vedi scripts/build-demo.mjs)
 */
import defaults from '../src/core/defaults.json';
import { NotificationManager } from '../src/core/NotificationManager.js';
import { NOTIFICATION_TYPES, testNotification } from '../src/core/normalize.js';
import { sanitizeConfig, diffConfig, ANIMATIONS, POSITIONS, SOUND_PRESETS, UI_THEMES } from '../src/core/schema.js';
import { recentLogs, createLogger } from '../src/logger.js';
import { liveSession } from '../src/core/session.js';
import { cleanText } from '../src/core/ttsText.js';
import { API_LEVEL, APP_VERSION } from '../src/core/apiLevel.js';
import { ChatCommands, humanDuration } from '../src/core/commands.js';
import { createQuickActions } from '../src/quickActions.js';
import { summarizeStream } from '../src/core/streamHealth.js';
import { ChatModerator } from '../src/core/moderation.js';

const CHANNEL = { id: '0', login: 'canale_demo' };
const DEMO_SCENES = ['Inizio', 'Gioco', 'Chiacchiere', 'Pausa', 'Fine'];
const BOT = { id: '1', login: 'Wolfery' };
const UPLOAD_KINDS = {
  sounds: ['.mp3', '.ogg', '.wav'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.webm', '.mp4'],
  music: ['.mp3', '.ogg', '.wav', '.m4a', '.flac'],
};

const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage non disponibile */ }
  },
};

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k], v) : v;
  return out;
}

function ext(name) {
  return (/\.[^./]+$/.exec(name) || [''])[0].toLowerCase();
}

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

// Nomi di prova per i titoli di coda (come il pulsante "Nomi di prova" del pannello).
function demoCreditsData() {
  const a = ['Luna', 'Drago', 'Pixel', 'Neve', 'Volpe', 'Ombra', 'Razzo', 'Gatto', 'Nebbia', 'Fulmine', 'Orso', 'Tempesta'];
  const b = ['Rossa', '_TV', '92', 'Gamer', 'Nera', 'Lampo', 'XD', 'Zeta', 'Plays', '_it'];
  const nm = (i) => a[i % a.length] + b[(i * 7) % b.length] + (i > 20 ? i : '');
  const gifters = ['GeneroSO', 'ZioSub', 'Mecenate_', ''];
  const subs = [];
  for (let i = 0; i < 26; i++) {
    const gift = i % 4 === 0;
    subs.push({ name: nm(i), gift, gifter: gift ? gifters[(i / 4) % 4] : '', tier: '1000' });
  }
  subs.push({ name: 'GeneroSO', gift: false, gifter: '', tier: '1000' });
  subs[1].tier = '2000'; subs[5].tier = '2000'; subs[9].tier = '3000';
  const pickN = (from, n) => Array.from({ length: n }, (_, i) => nm(from + i));
  return {
    fetchedAt: 0, demo: true, subs, followers: pickN(50, 40),
    moderators: ['ModAnna', 'ModLuca', 'Wolfery'], vips: pickN(120, 4),
    bits: Object.fromEntries(['day', 'week', 'month', 'year', 'all'].map((p, k) => [p, pickN(140, 6).map((name, i) => ({ name, value: (6 - i) * 250 * (k + 1) }))])),
    chatters: pickN(200, 25).map((name) => ({ name, at: Date.now() })),
    session: { ...liveSession([], Date.now()), live: true },
  };
}

const VIEWER_CHAT = ['ciao a tutti!', 'che bella live 🔥', 'GG', 'ahahah', 'forza!', 'da dove stai giocando?', 'quel salto era perfetto', 'LUL', 'buonasera chat', '💜💜💜'];
const VIEWERS = ['PizzaConAnanas', 'LupoSolitario', 'GattoNinja', 'CaffèCorretto', 'MarioRossi92', 'SuperNonna', 'VolpeRossa', 'NebbiaZeta'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

class DemoBackend {
  constructor() {
    this.log = createLogger('demo');
    this.startedAt = Date.now();
    this.defaults = defaults;
    this.config = sanitizeConfig(deepMerge(defaults, storage.get('tg-demo-config', {})), defaults);
    this.manager = new NotificationManager({ config: this.config });
    this.clients = { overlay: new Set(), dashboard: new Set() };
    this.media = { sounds: [], images: [], music: [] };
    this.chat = [];
    this.chatSeq = 0;
    this.bot = { ...BOT };
    this.simulation = null;
    this.credits = {
      rev: Date.now(),
      state: storage.get('tg-demo-credits', null) ?? { data: demoCreditsData() },
    };

    this.manager.on('alert', (alert) => {
      this.#send('overlay', { type: 'alert', alert });
      this.#send('dashboard', { type: 'alert', alert });
    });
    this.manager.on('skip', (alert) => this.#send('overlay', { type: 'skip', id: alert.id }));
    this.manager.on('queue', (queue) => this.#send('dashboard', { type: 'queue', queue }));
    this.manager.on('notification', () => {
      this.broadcastState();
      const data = this.credits.state.data;
      if (data) {
        this.credits.state.data = { ...data, session: { ...liveSession(this.manager.history, this.startedAt), live: true } };
        this.credits.rev += 1;
      }
    });
    this.manager.on('chat', (text) => {
      this.#chat(this.bot ? this.bot.login : CHANNEL.login, text, true);
      this.log.info(`Chat (${this.bot ? this.bot.login : CHANNEL.login}): ${text}`);
    });
    // comandi della chat: stesso codice del programma vero, con dati finti
    const commandDeps = {
      log: this.log,
      vars: {
        channel: () => CHANNEL.login,
        scene: () => this.scene ?? DEMO_SCENES[1],
        uptime: () => humanDuration(Date.now() - this.startedAt + 47 * 60000),
        followage: (user) => (user?.login === CHANNEL.login ? 'sempre: è il canale!' : humanDuration((5 + (user?.login?.length ?? 3) * 23) * 86400000, { precise: true })),
        game: () => 'Just Chatting',
        title: () => 'Live demo di TwitchGestor',
        lastfollow: () => this.manager.history.find((n) => n.type === 'follow')?.user?.name ?? 'nessuno, per ora',
      },
      actions: {
        scene: async (wanted) => {
          const w = wanted.toLowerCase();
          const name = DEMO_SCENES.find((s) => s.toLowerCase().startsWith(w)) ?? DEMO_SCENES.find((s) => s.toLowerCase().includes(w));
          if (!name) throw new Error(`Scena "${wanted}" non trovata`);
          this.scene = name;
          this.broadcastState();
          return name;
        },
        credits: () => { this.credits.state.cmd = { type: 'restart', at: Date.now() }; this.credits.rev += 1; },
      },
    };
    this.commandDeps = commandDeps;
    // diretta simulata: bitrate e salute come li manderebbe OBS ogni 2 secondi
    this.streamSamples = [];
    this.streamHistory = [];
    this.stream = null;
    setInterval(() => this.#tickStream(), 2000);
    // parole bannate nella chat simulata: il bot cancella davvero i messaggi
    const hide = (pred) => { this.chat = this.chat.filter((m) => !pred(m)); this.broadcastState(); };
    this.moderator = new ChatModerator({
      getConfig: () => this.config.moderation,
      log: this.log,
      warn: (text) => this.#chat(this.bot ? this.bot.login : CHANNEL.login, text, true),
      act: {
        delete: async (id) => hide((m) => m.id === id),
        timeout: async (userId) => hide((m) => m.user === userId),
        ban: async (userId) => hide((m) => m.user === userId),
        unban: async () => {},
      },
      onAction: () => this.#send('dashboard', { type: 'moderation', history: this.moderator.history }),
    });
    this.quickActions = createQuickActions({ helix: this.#fakeTwitch(), getUser: () => CHANNEL });
    this.commands = new ChatCommands({
      ...commandDeps,
      getConfig: () => this.config.commands,
      send: (text) => this.#chat(this.bot ? this.bot.login : CHANNEL.login, text, true),
    });
    setInterval(() => this.commands.tick(), 30000);
    this.log.info('Demo avviata: nessun collegamento a Twitch, gli eventi sono simulati');
  }

  /** Twitch finto per le azioni rapide: risponde come le API vere, con dati in memoria. */
  #fakeTwitch() {
    const tw = {
      channel: { title: 'Live demo di TwitchGestor', game_id: '509658', game_name: 'Just Chatting' },
      chat: { emote_mode: false, follower_mode: false, follower_mode_duration: 0, subscriber_mode: false, slow_mode: false, slow_mode_wait_time: 30, unique_chat_mode: false },
      shield: false, poll: null, prediction: null,
    };
    const GAMES = ['Just Chatting', 'Minecraft', 'Fortnite', 'League of Legends', 'Valorant', 'GTA V', 'Elden Ring', 'The Legend of Zelda: Tears of the Kingdom', 'Art', 'Music', 'Chess', 'Among Us'];
    const params = (url) => Object.fromEntries(new URL(url, 'http://x').searchParams);
    const vote = () => { // voti finti che arrivano col tempo
      for (const c of tw.poll?.choices ?? []) c.votes += Math.floor(Math.random() * 3);
      for (const o of tw.prediction?.status === 'ACTIVE' ? tw.prediction.outcomes : []) { o.users += Math.floor(Math.random() * 2); o.channel_points = o.users * 250; }
    };
    return {
      request: async (method, url, body) => {
        const path = url.split('?')[0];
        const p = params(url);
        vote();
        switch (`${method} ${path}`) {
          case 'GET /channels': return { data: [tw.channel] };
          case 'PATCH /channels':
            if (body.title) tw.channel.title = body.title;
            if (body.game_id) tw.channel = { ...tw.channel, game_id: body.game_id, game_name: GAMES[Number(body.game_id) - 1] ?? tw.channel.game_name };
            this.log.info(`Titolo: "${tw.channel.title}" · categoria: ${tw.channel.game_name}`);
            return {};
          case 'GET /search/categories':
            return { data: GAMES.map((name, i) => ({ id: String(i + 1), name })).filter((g) => g.name.toLowerCase().includes(p.query.toLowerCase())).slice(0, 8) };
          case 'GET /chat/settings': return { data: [tw.chat] };
          case 'PATCH /chat/settings': Object.assign(tw.chat, body); return { data: [tw.chat] };
          case 'GET /moderation/shield_mode': return { data: [{ is_active: tw.shield }] };
          case 'PUT /moderation/shield_mode': tw.shield = body.is_active; return {};
          case 'DELETE /moderation/chat': this.chat = []; this.broadcastState(); return {};
          case 'POST /chat/announcements': this.#chat(CHANNEL.login, `📢 ${body.message}`); return {};
          case 'POST /streams/markers': return { data: [{ id: 'm1' }] };
          case 'POST /clips': return { data: [{ id: 'clip', edit_url: 'https://www.twitch.tv/' }] };
          case 'POST /channels/commercial': return { data: [{ length: body.length, message: `Pubblicità di ${body.length} secondi (simulata)` }] };
          case 'GET /users': return { data: [{ id: '99', login: p.login, display_name: p.login }] };
          case 'POST /raids': case 'DELETE /raids': case 'POST /chat/shoutouts': return {};
          case 'GET /polls': return { data: tw.poll ? [tw.poll] : [] };
          case 'POST /polls':
            tw.poll = { id: 'poll1', status: 'ACTIVE', title: body.title, duration: body.duration, started_at: new Date().toISOString(), choices: body.choices.map((c) => ({ title: c.title, votes: 0 })) };
            return {};
          case 'PATCH /polls': if (tw.poll) tw.poll.status = 'TERMINATED'; return {};
          case 'GET /predictions': return { data: tw.prediction ? [tw.prediction] : [] };
          case 'POST /predictions':
            tw.prediction = { id: 'pred1', status: 'ACTIVE', title: body.title, prediction_window: body.prediction_window, created_at: new Date().toISOString(), outcomes: body.outcomes.map((o, i) => ({ id: `o${i}`, title: o.title, users: 0, channel_points: 0 })) };
            return {};
          case 'PATCH /predictions': if (tw.prediction) tw.prediction.status = body.status; return {};
          default: throw Object.assign(new Error(`Non simulato nella demo: ${method} ${path}`), { status: 404 });
        }
      },
    };
  }

  #tickStream() {
    const active = Boolean(this.simulation);
    const prev = this.streamSamples.at(-1);
    if (!active) {
      this.streamSamples = [];
      this.streamHistory = [];
    } else if (!prev?.active) this.liveSince = Date.now();
    // ogni tanto la rete fa i capricci (per vedere come cambia l'indicatore)
    const wobble = active && Math.random() < 0.08;
    const kbps = active ? (wobble ? 2500 + Math.random() * 1500 : 5800 + Math.random() * 400) : 0;
    const frames = 120;
    const sample = {
      t: Date.now(), active, reconnecting: false,
      bytes: (prev?.bytes ?? 0) + (kbps * 2000) / 8,
      skipped: (prev?.skipped ?? 0) + (wobble ? Math.round(frames * 0.03) : 0),
      total: (prev?.total ?? 0) + (active ? frames : 0),
      congestion: wobble ? 0.3 : Math.random() * 0.04,
      durationMs: active ? Date.now() - this.liveSince : 0,
      fps: 60, cpu: 6 + Math.random() * 4, renderSkipped: 0, renderTotal: 0,
    };
    this.streamSamples.push(sample);
    if (this.streamSamples.length > 10) this.streamSamples.shift();
    const st = summarizeStream(this.streamSamples, this.streamHistory);
    if (active && prev?.active) {
      this.streamHistory.push(st.bitrateKbps);
      if (this.streamHistory.length > 90) this.streamHistory.shift();
    }
    // come nella realtà: Twitch ti mostra in live qualche secondo dopo che OBS ha iniziato a trasmettere
    const twitchSince = active && Date.now() - this.liveSince > 6000 ? this.liveSince + 6000 : null;
    this.stream = { ...st, history: [...this.streamHistory], liveSince: twitchSince, twitchLive: Boolean(twitchSince), twitchChecked: true };
    this.#send('dashboard', { type: 'stream', stream: this.stream });
  }

  /** Un messaggio arrivato nella chat simulata: compare in chat e passa ai comandi. */
  #incoming(login, text, badges = []) {
    const id = this.#chat(login, text);
    const msg = { id, text, user: { id: login, login: login.toLowerCase(), name: login }, badges };
    this.moderator.handle(msg).then((moderated) => (moderated ? null : this.commands.handle(msg))).catch(() => {});
  }

  // ---------- Canale in tempo reale (sostituisce il WebSocket) ----------

  connect(socket) {
    const role = socket.role in this.clients ? socket.role : 'dashboard';
    this.clients[role].add(socket);
    socket.deliver(role === 'overlay' ? { type: 'hello', overlay: this.config.overlay } : { type: 'state', state: this.getState() });
    this.broadcastState();
  }

  disconnect(socket) {
    for (const set of Object.values(this.clients)) set.delete(socket);
    this.broadcastState();
  }

  #send(role, message) {
    for (const socket of [...this.clients[role]]) {
      try {
        socket.deliver(message);
      } catch {
        this.clients[role].delete(socket); // pagina chiusa (es. anteprima ricaricata)
      }
    }
  }

  broadcastState() {
    clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => this.#send('dashboard', { type: 'state', state: this.getState() }), 30);
  }

  #chat(user, text, fromBot = false) {
    const id = `msg${++this.chatSeq}`;
    this.chat.push({ id, user, text, bot: fromBot, at: Date.now() });
    if (this.chat.length > 60) this.chat.shift();
    this.broadcastState();
    return id;
  }

  chatAccount() {
    return this.bot ? { kind: 'bot', user: this.bot, sameAsChannel: false } : { kind: 'channel', user: CHANNEL };
  }

  getState() {
    const m = this.manager;
    return {
      apiLevel: API_LEVEL,
      version: `${APP_VERSION} demo`,
      twitch: { configured: true, user: CHANNEL, status: 'simulato', missingScopes: [], failedSubscriptions: [] },
      sources: { streamelements: 'disattivato', kofi: 'disattivato', webhook: 'disattivato' },
      ui: this.config.ui,
      commands: { enabled: Boolean(this.config.commands?.enabled), missingScope: false, reading: true },
      moderation: { enabled: Boolean(this.config.moderation?.enabled), by: this.bot ? this.bot.login : CHANNEL.login, byBot: Boolean(this.bot), missingScope: false },
      overlays: this.clients.overlay.size,
      chatReplies: Boolean(this.config.chat?.enabled),
      chatAccount: this.chatAccount(),
      overlayUrl: 'overlay.html',
      types: Object.fromEntries(Object.entries(this.config.types).map(([k, v]) => [k, { label: v.label ?? k, color: v.color }])),
      queue: m.queueState(),
      stats: { ...m.stats, donors: undefined, topDonors: m.topDonors() },
      history: m.history.slice(0, 200),
      obs: { enabled: true, host: '127.0.0.1', port: 4455, hasPassword: true, status: 'connesso', error: '', scenes: DEMO_SCENES, current: this.scene ?? DEMO_SCENES[1], stream: this.stream },
      demo: { simulating: Boolean(this.simulation), chat: this.chat.slice(-40) },
    };
  }

  // ---------- Eventi simulati ----------

  setSimulation(on) {
    clearTimeout(this.simulation);
    clearTimeout(this.chatTimer);
    this.simulation = null;
    if (!on) {
      this.log.info('Simulazione fermata');
      return;
    }
    this.log.info('Simulazione avviata: arriveranno eventi finti ogni pochi secondi');
    const weights = [['follow', 30], ['cheer', 12], ['sub', 10], ['resub', 10], ['giftsub', 6], ['redemption', 14], ['donation', 10], ['raid', 4]];
    const total = weights.reduce((s, [, w]) => s + w, 0);
    const next = () => {
      let r = Math.random() * total;
      const type = weights.find(([, w]) => (r -= w) < 0)[0];
      const n = { ...testNotification(type), test: false, source: 'demo' };
      this.manager.ingest(n);
      this.simulation = setTimeout(next, 5000 + Math.random() * 7000);
    };
    const talk = () => {
      // ogni tanto uno spettatore usa un comando
      const p = this.config.commands?.prefix || '!';
      const banned = this.config.moderation?.enabled ? this.config.moderation.words ?? [] : [];
      // ogni tanto qualcuno scrive una parola bannata (per vedere il bot all'opera)
      if (banned.length && Math.random() < 0.12) {
        this.#incoming(pick(VIEWERS), `ma che ${pick(banned).text.replace(/\*$/, 'a')} questa partita`);
        this.chatTimer = setTimeout(talk, 2500 + Math.random() * 3500);
        return;
      }
      const text = Math.random() < 0.25 ? p + pick(['uptime', 'followage', 'comandi', 'social', 'discord']) : pick(VIEWER_CHAT);
      this.#incoming(pick(VIEWERS), text);
      this.chatTimer = setTimeout(talk, 2500 + Math.random() * 3500);
    };
    this.simulation = setTimeout(next, 800);
    this.chatTimer = setTimeout(talk, 1500);
  }

  // ---------- API (sostituisce le richieste al server) ----------

  async handle(method, url, body, headers) {
    const route = `${method} ${url.pathname}`;
    const ok = (data = { ok: true }) => ({ status: 200, data });
    const fail = (status, error) => ({ status, data: { error } });
    const draft = (b) => (b?.config ? sanitizeConfig(b.config, this.defaults) : null);
    const m = this.manager;

    switch (route) {
      case 'GET /api/state': return ok(this.getState());
      case 'GET /api/logs': return ok({ logs: recentLogs() });
      case 'GET /api/config':
        return ok({
          apiLevel: API_LEVEL,
          config: this.config, defaults: this.defaults,
          options: { animations: ANIMATIONS, positions: POSITIONS, sounds: SOUND_PRESETS },
          media: this.media, chatAccount: this.chatAccount(), twitchConfigured: true,
        });
      case 'PUT /api/config': {
        this.config = sanitizeConfig(body?.config, this.defaults);
        storage.set('tg-demo-config', diffConfig(this.config, this.defaults) ?? {});
        m.setConfig(this.config);
        this.#send('overlay', { type: 'hello', overlay: this.config.overlay });
        this.broadcastState();
        this.log.info('Impostazioni salvate (solo in questo browser)');
        return ok({ config: this.config });
      }
      case 'GET /api/actions/state': return ok(await this.quickActions.state());
      case 'GET /api/actions/categories': return ok(await this.quickActions.run('categories', { query: url.searchParams.get('q') }));
      case 'PUT /api/moderation': {
        this.config = sanitizeConfig({ ...this.config, moderation: body?.moderation }, this.defaults);
        storage.set('tg-demo-config', diffConfig(this.config, this.defaults) ?? {});
        this.broadcastState();
        return ok({ moderation: this.config.moderation });
      }
      case 'POST /api/moderation/test': {
        const settings = body?.moderation ? sanitizeConfig({ ...this.config, moderation: body.moderation }, this.defaults).moderation : this.config.moderation;
        const tester = new ChatModerator({ getConfig: () => settings });
        return ok({ result: await tester.handle({ text: String(body?.text ?? ''), user: { id: 'prova', name: 'prova' }, badges: [] }, { dryRun: true }) });
      }
      case 'GET /api/moderation/log': return ok({ history: this.moderator.history });
      case 'POST /api/moderation/undo':
        try { await this.moderator.undo(Number(body?.index)); } catch (err) { return fail(400, err.message); }
        return ok({ history: this.moderator.history });
      case 'PUT /api/commands': {
        this.config = sanitizeConfig({ ...this.config, commands: body?.commands }, this.defaults);
        storage.set('tg-demo-config', diffConfig(this.config, this.defaults) ?? {});
        this.broadcastState();
        return ok({ commands: this.config.commands });
      }
      case 'POST /api/commands/test': {
        const settings = body?.commands ? sanitizeConfig({ ...this.config, commands: body.commands }, this.defaults).commands : this.config.commands;
        const tester = new ChatCommands({ ...this.commandDeps, getConfig: () => settings, send: () => {} });
        const role = body?.role ?? 'broadcaster';
        const name = role === 'broadcaster' ? CHANNEL.login : 'spettatore_di_prova';
        const reply = await tester.handle({ text: String(body?.text ?? ''), user: { id: name, login: name, name }, badges: role === 'everyone' ? [] : [{ set_id: role }] }, { dryRun: true });
        return ok({ reply });
      }
      case 'POST /api/demo/chat': {
        const text = String(body?.text ?? '').trim().slice(0, 500);
        if (text) this.#incoming(CHANNEL.login, text, [{ set_id: 'broadcaster' }]);
        return ok();
      }
      case 'PUT /api/ui': {
        if (body?.theme !== undefined && !UI_THEMES.includes(body.theme)) return fail(400, 'Tema sconosciuto');
        this.config = sanitizeConfig({ ...this.config, ui: { ...this.config.ui, ...body } }, this.defaults);
        storage.set('tg-demo-config', diffConfig(this.config, this.defaults) ?? {});
        this.broadcastState();
        return ok({ ui: this.config.ui });
      }
      // Nella demo non ci sono voci di sistema: la voce è quella del browser.
      case 'GET /api/tts/voices': return ok({ engine: null, voices: [] });
      case 'POST /api/tts/test': {
        const cfg = (draft(body) ?? this.config).tts ?? {};
        return ok({ fallback: true, text: cleanText(body?.text || 'Ciao! Questa è la voce degli alert di TwitchGestor.', cfg), rate: cfg.rate ?? 0, volume: (cfg.volume ?? 100) / 100 });
      }
      case 'POST /api/preview': {
        if (!NOTIFICATION_TYPES.includes(body?.type)) return fail(400, 'Tipo sconosciuto');
        const builder = new NotificationManager({ config: draft(body) ?? this.config });
        return ok({ alert: builder.buildAlert(sampleNotification(body.type, body.sample)) });
      }
      case 'POST /api/queue/pause': m.pause(); return ok();
      case 'POST /api/queue/resume': m.resume(); return ok();
      case 'POST /api/queue/skip': m.skip(); return ok();
      case 'POST /api/queue/clear': m.clearQueue(); return ok();
      case 'POST /api/stats/reset': m.resetStats(); this.broadcastState(); return ok();
      case 'POST /api/auth/logout': return fail(400, 'Nella demo l\'account del canale è simulato e non si può scollegare.');
      case 'POST /api/auth/bot/logout': this.bot = null; this.broadcastState(); return ok();
      case 'POST /api/shutdown': return fail(400, 'Nella demo il programma non si spegne: chiudi semplicemente la pagina.');
      case 'GET /api/obs': return ok(this.getState().obs);
      case 'PUT /api/obs/settings': return fail(400, 'Nella demo OBS è simulato: il collegamento si configura nel programma installato sul PC.');
      case 'POST /api/obs/scene': {
        if (!DEMO_SCENES.includes(body?.scene)) return fail(400, 'Scena sconosciuta');
        this.scene = body.scene;
        this.log.info(`Scena OBS (simulata): ${body.scene}`);
        this.broadcastState();
        return ok(this.getState().obs);
      }
      case 'POST /api/demo/simulate': this.setSimulation(Boolean(body?.on)); this.broadcastState(); return ok();
      case 'POST /api/upload': {
        const kind = url.searchParams.get('kind');
        return this.#upload(kind, decodeURIComponent(headers['x-filename'] ?? ''), body, (p) => ok({ path: p, media: this.media }));
      }
      // --- titoli di coda ---
      case 'GET /api/credits/state': {
        const rev = Number(url.searchParams.get('rev'));
        const snap = rev === this.credits.rev ? { rev } : { rev: this.credits.rev, state: this.credits.state };
        return ok({ ...snap, account: CHANNEL.login, configured: true, ui: this.config.ui?.theme ?? 'default' });
      }
      case 'POST /api/credits/fetch':
        return fail(409, 'Nella demo non c\'è un collegamento a Twitch: usa "Nomi di prova".');
      default:
        break;
    }

    if (method === 'POST' && url.pathname.startsWith('/api/actions/')) {
      try {
        return ok(await this.quickActions.run(decodeURIComponent(url.pathname.slice('/api/actions/'.length)), body ?? {}));
      } catch (err) {
        return fail(err.status ?? 400, err.message);
      }
    }
    if (method === 'POST' && url.pathname.startsWith('/api/test/')) {
      const type = url.pathname.slice('/api/test/'.length);
      if (!NOTIFICATION_TYPES.includes(type)) return fail(400, `Tipo sconosciuto: ${type}`);
      m.test(sampleNotification(type, body?.sample), draft(body));
      return ok();
    }
    if (method === 'POST' && url.pathname.startsWith('/api/replay/')) {
      return m.replay(decodeURIComponent(url.pathname.slice('/api/replay/'.length))) ? ok() : fail(404, 'Notifica non trovata');
    }
    if (method === 'PUT' && url.pathname.startsWith('/api/credits/state/')) {
      const key = decodeURIComponent(url.pathname.slice('/api/credits/state/'.length));
      if (!['settings', 'data', 'cmd', 'status'].includes(key)) return fail(400, 'Chiave non consentita');
      if (body === null || body === undefined) delete this.credits.state[key];
      else this.credits.state[key] = body;
      this.credits.rev += 1;
      storage.set('tg-demo-credits', { settings: this.credits.state.settings, data: this.credits.state.data });
      return ok({ rev: this.credits.rev });
    }
    if (method === 'PUT' && url.pathname.startsWith('/api/credits/upload/')) {
      return this.#upload('music', decodeURIComponent(url.pathname.slice('/api/credits/upload/'.length)), body, (p) => ok({ name: p }));
    }
    return fail(404, 'Non trovato');
  }

  /** I file caricati restano nella memoria della pagina (spariscono ricaricandola). */
  #upload(kind, name, blob, done) {
    if (!UPLOAD_KINDS[kind]) return { status: 400, data: { error: 'Tipo di file non valido' } };
    if (!UPLOAD_KINDS[kind].includes(ext(name))) return { status: 400, data: { error: `Formato non supportato. Usa: ${UPLOAD_KINDS[kind].join(', ')}` } };
    // il file può arrivare da una pagina interna (es. titoli di coda): instanceof Blob lì non funziona
    if (!blob || typeof blob.size !== 'number' || typeof blob.slice !== 'function' || !blob.size) return { status: 400, data: { error: 'File vuoto' } };
    const safeName = name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const p = `${URL.createObjectURL(blob)}#${encodeURIComponent(safeName)}`;
    this.media[kind].push(p);
    this.log.info(`File caricato nella demo: ${safeName} (resta finché non ricarichi la pagina)`);
    return done(p);
  }
}

// ---------- Collegamento della pagina al backend finto ----------

/** Le pagine dentro la dashboard (overlay, anteprime, titoli di coda) usano il backend della pagina principale. */
function findBackend() {
  let w = window;
  while (w !== w.parent) {
    try {
      if (w.parent.__tgDemoBackend) return w.parent.__tgDemoBackend;
    } catch {
      break; // pagina esterna (es. il visualizzatore): ci fermiamo
    }
    w = w.parent;
  }
  window.__tgDemoBackend = new DemoBackend();
  return window.__tgDemoBackend;
}

const backend = findBackend();

class DemoSocket {
  constructor(url) {
    this.url = String(url);
    this.readyState = 0;
    this.role = new URL(this.url, location.href).searchParams.get('role');
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.({});
      backend.connect(this);
    });
    window.addEventListener('pagehide', () => this.close());
  }

  deliver(message) {
    if (this.readyState !== 1) return;
    const data = JSON.stringify(message);
    setTimeout(() => this.onmessage?.({ data }));
  }

  send() { /* le pagine non inviano messaggi */ }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    backend.disconnect(this);
  }

  addEventListener(type, fn) {
    const prev = this[`on${type}`];
    this[`on${type}`] = (e) => { prev?.(e); fn(e); };
  }
}
DemoSocket.OPEN = 1;
DemoSocket.prototype.OPEN = 1;

const realWebSocket = window.WebSocket;
window.WebSocket = function WebSocket(url, protocols) {
  return new URL(String(url), location.href).pathname.endsWith('/ws') ? new DemoSocket(url) : new realWebSocket(url, protocols);
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const i = url.pathname.indexOf('/api/');
  if (i === -1) return realFetch(input, init);
  const apiUrl = new URL(url.pathname.slice(i) + url.search, 'http://demo');
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  let body = init.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  await new Promise((r) => setTimeout(r, 30));
  const { status, data } = await backend.handle((init.method ?? 'GET').toUpperCase(), apiUrl, body, headers);
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
};

// Nel visualizzatore di claude.ai le finestre di conferma non esistono: nella demo si procede
// direttamente e i messaggi compaiono come avviso in basso.
window.confirm = () => true;
window.alert = (message) => {
  const show = () => {
    const box = document.createElement('div');
    box.textContent = String(message);
    box.setAttribute('role', 'status');
    Object.assign(box.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)', zIndex: 99,
      maxWidth: 'min(520px, calc(100vw - 32px))', padding: '12px 16px', borderRadius: '10px',
      background: '#2b2238', color: '#fff', font: '14px/1.4 system-ui, sans-serif', boxShadow: '0 8px 30px rgba(0,0,0,.35)',
    });
    document.body.append(box);
    setTimeout(() => box.remove(), 4500);
  };
  if (document.body) show(); else window.addEventListener('DOMContentLoaded', show);
};
