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
import { API_LEVEL, APP_VERSION } from '../src/core/apiLevel.js';
import { ChatCommands, humanDuration } from '../src/core/commands.js';
import { createQuickActions } from '../src/quickActions.js';
import { summarizeStream } from '../src/core/streamHealth.js';
import { ChatModerator } from '../src/core/moderation.js';
import { AutoShoutout, shoutoutCard } from '../src/core/shoutout.js';
import { LiveStats, computeRecap } from '../src/core/livestats.js';
import { Schedule, generateWeeks } from '../src/core/schedule.js';
import { ChatFeed, shouldShow } from '../src/core/chatOverlay.js';
import { MusicPlayer } from '../src/core/music.js';

const CHANNEL = { id: '0', login: 'canale_demo' };
const DEMO_SCENES = ['Inizio', 'Gioco', 'Chiacchiere', 'Pausa', 'Fine'];
const BOT = { id: '1', login: 'Wolfery' };
const UPLOAD_KINDS = {
  sounds: ['.mp3', '.ogg', '.wav'],
  images: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.webm', '.mp4'],
  music: ['.mp3', '.ogg', '.wav', '.m4a', '.flac', '.opus'],
};
// libreria musicale di prova: nella demo non c'è audio, il lettore "suona" in silenzio
const DEMO_MUSIC = [
  ['Chill', 'Lofi Girl - Pioggia sui tetti.mp3', 154], ['Chill', 'Lofi Girl - Caffè delle 3.mp3', 131], ['Chill', 'Nuvole basse.mp3', 176],
  ['Chill', 'Sognando - Notte in città.mp3', 142], ['Gaming', 'Pixel Hero - Boss Fight.mp3', 118], ['Gaming', 'Pixel Hero - Livello segreto.mp3', 127],
  ['Gaming', 'Arcade_Night.mp3', 149], ['Intro e pause', 'Sigla di apertura.mp3', 45], ['Intro e pause', 'Torno subito.mp3', 96],
].map(([folder, name, duration]) => ({ id: `${folder}/${name}`, url: '', folder, name, duration }));

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
/** Statistiche e riepiloghi di prova: 16 live nelle ultime 8 settimane (sempre gli stessi numeri). */
function demoStats() {
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const stats = new LiveStats({});
  const GAMES = [['Elden Ring', 'Elden Ring alla cieca: oggi si batte Malenia!'], ['Just Chatting', 'Chiacchiere e caffè con la chat ☕'], ['Minecraft', 'Minecraft hardcore: giorno 12'], ['Elden Ring', 'Elden Ring: DLC tutto da scoprire']];
  const day = 86400000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let followers = 812;
  for (let d = 70; d >= 0; d--) {
    followers += Math.round(rnd() * 3);
    stats.daily[new Date(today - d * day + 43200000).toISOString().slice(0, 10)] = { followers, subscribers: 14 + Math.round((70 - d) / 12) };
  }
  const NAMES = ['LunaRossa', 'Drago_TV', 'ModAnna', 'PixelGamer', 'NeveNera', 'GattoNinja', 'SuperNonna', 'VolpeRossa'];
  let f = 812;
  for (let i = 0; i < 16; i++) {
    const dayOffset = 56 - i * 3.5 - Math.round(rnd());
    const start = today.getTime() - Math.round(dayOffset) * day + (19 + Math.round(rnd() * 3)) * 3600000;
    const [game, title] = GAMES[i % GAMES.length];
    const minutes = 120 + Math.round(rnd() * 120);
    const base = (game === 'Just Chatting' ? 9 : 14) + i * 0.8;
    const samples = [];
    for (let m = 0; m < minutes; m += 2) samples.push([start + m * 60000, Math.max(1, Math.round(base * (0.6 + Math.sin((m / minutes) * Math.PI) * 0.6) + rnd() * 4 + (m > minutes * 0.6 && i % 3 === 0 ? 12 : 0)))]);
    const chatters = {};
    let messages = 0;
    for (const n of NAMES) { const c = Math.round(rnd() * 40); if (c) { chatters[n.toLowerCase()] = { name: n, count: c }; messages += c; } }
    const gained = 2 + Math.round(rnd() * 8);
    const live = { startedAt: start, endedAt: start + minutes * 60000, samples, messages, chatters, followersStart: f, followersEnd: f + gained, subscribersStart: 14, subscribersEnd: 14 + (i % 4 === 0 ? 1 : 0) };
    f += gained;
    const pick = (k) => NAMES.filter(() => rnd() < k);
    live.recap = computeRecap(live, {
      session: {
        follows: pick(0.3), subs: i % 4 === 0 ? ['NeveNera'] : [], resubs: i % 3 === 0 ? [{ name: 'LunaRossa', value: 7 + i }] : [],
        gifters: i % 5 === 0 ? [{ name: 'Drago_TV', value: 5 }] : [], cheers: i % 2 ? [{ name: 'PixelGamer', value: 100 * (1 + (i % 4)) }] : [],
        donations: i % 4 === 1 ? [{ name: 'SuperNonna', value: 5, currency: 'EUR' }] : [], raids: i % 3 === 0 ? [{ name: 'StreamerAmico', value: 12 + i }] : [], redemptions: pick(0.4),
      },
      titles: [{ at: start, title, game }],
      previous: stats.recaps,
    });
    stats.lives.unshift(live);
  }
  stats.now = () => Date.now();
  return stats;
}

/** Immagine del canale inventata (lettera iniziale su un colore) per gli shoutout della demo. */
function demoAvatar(login) {
  const hue = [...login].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},75%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,40%)"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><text x="50" y="66" font-family="Arial,sans-serif" font-size="50" font-weight="700" fill="#fff" text-anchor="middle">${login[0].toUpperCase()}</text></svg>`);
}

class DemoBackend {
  constructor() {
    this.log = createLogger('demo');
    this.startedAt = Date.now();
    this.defaults = defaults;
    this.config = sanitizeConfig(deepMerge(defaults, storage.get('tg-demo-config', {})), defaults);
    this.manager = new NotificationManager({ config: this.config });
    this.clients = { overlay: new Set(), dashboard: new Set(), chat: new Set(), music: new Set() };
    this.chatFeed = new ChatFeed({ send: (m) => this.#send('chat', m) });
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
        song: () => this.music?.songText() ?? 'nessuna canzone in riproduzione',
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
        delete: async (id) => { hide((m) => m.id === id); this.chatFeed.remove(id); },
        timeout: async (userId) => { hide((m) => m.user === userId); this.chatFeed.removeUser(userId); },
        ban: async (userId) => { hide((m) => m.user === userId); this.chatFeed.removeUser(userId); },
        unban: async () => {},
      },
      onAction: () => this.#send('dashboard', { type: 'moderation', history: this.moderator.history }),
    });
    this.quickActions = createQuickActions({
      helix: this.#fakeTwitch(),
      getUser: () => CHANNEL,
      onShoutout: (login) => {
        if (this.config.shoutouts?.obsCard !== false) this.autoShoutout.channelInfo(login).then((info) => this.chatFeed.push(shoutoutCard(info)));
      },
    });
    this.commands = new ChatCommands({
      ...commandDeps,
      getConfig: () => this.config.commands,
      send: (text) => this.#chat(this.bot ? this.bot.login : CHANNEL.login, text, true),
    });
    setInterval(() => this.commands.tick(), 30000);
    // shoutout automatici: nella demo la "live" è la simulazione e i canali sono inventati
    const DEMO_GAMES = ['Minecraft', 'Just Chatting', 'Elden Ring', 'Fortnite', 'Art', 'Valorant'];
    this.autoShoutout = new AutoShoutout({
      getConfig: () => this.config.shoutouts,
      log: this.log,
      send: (text) => this.#chat(this.bot ? this.bot.login : CHANNEL.login, text, true),
      shoutout: async () => { this.log.info('Shoutout di Twitch (simulato)'); },
      channelInfo: async (login) => ({ id: login, login, name: login.replace(/^\w/, (c) => c.toUpperCase()), game: DEMO_GAMES[login.length % DEMO_GAMES.length], title: 'live di prova', avatar: demoAvatar(login) }),
      onCard: (info) => this.chatFeed.push(shoutoutCard(info)),
      liveSince: async () => this.liveStartedAt ?? null,
      onChange: () => this.#send('dashboard', { type: 'shoutouts', history: this.autoShoutout.history, seen: this.autoShoutout.seen }),
    });
    // musica: stesso lettore del programma vero; qui un "OBS finto" fa scorrere il tempo dei brani
    this.musicLibrary = [...DEMO_MUSIC];
    this.music = new MusicPlayer({
      getLibrary: () => this.musicLibrary,
      store: { load: () => storage.get('tg-demo-music', null), save: (d) => storage.set('tg-demo-music', d) },
      onChange: () => this.#send('dashboard', { type: 'music', music: this.music.snapshot() }),
    });
    this.musicDuck = 0;
    setInterval(() => {
      const t = this.music.current;
      if (!t || !this.music.state.playing) return;
      const position = this.music.state.position + 1;
      if (position >= t.duration) this.music.fromPage({ type: 'ended', id: t.id });
      else if (position % 2 === 0) this.music.fromPage({ type: 'progress', id: t.id, position, duration: t.duration });
      else this.music.state.position = position;
    }, 1000);
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
          case 'DELETE /moderation/chat': this.chat = []; this.chatFeed.clear(); this.broadcastState(); return {};
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

  #toObsChat(id, user, text, bot = false) {
    const COLORS = ['#ff69b4', '#1e90ff', '#2fbf4a', '#ff7f50', '#daa520', '#8a2be2'];
    const msg = {
      id, userId: user, login: user.toLowerCase(), name: user, color: COLORS[user.length % COLORS.length], badges: [],
      fragments: [{ type: 'text', text }], text, bot, at: Date.now(),
    };
    if (shouldShow(msg, this.config.chatOverlay, { commandPrefix: this.config.commands?.prefix })) this.chatFeed.push(msg);
  }

  /** Un messaggio arrivato nella chat simulata: compare in chat e passa ai comandi. */
  #incoming(login, text, badges = []) {
    const id = this.#chat(login, text);
    const msg = { id, text, user: { id: login, login: login.toLowerCase(), name: login }, badges };
    this.moderator.handle(msg).then((moderated) => {
      if (moderated) return null;
      this.#toObsChat(id, login, text);
      this.autoShoutout.handle(msg).catch(() => {});
      return this.commands.handle(msg);
    }).catch(() => {});
  }

  // ---------- Canale in tempo reale (sostituisce il WebSocket) ----------

  connect(socket) {
    const role = socket.role in this.clients ? socket.role : 'dashboard';
    this.clients[role].add(socket);
    socket.deliver(role === 'overlay' ? { type: 'hello', overlay: this.config.overlay }
      : role === 'chat' ? { type: 'hello', settings: this.config.chatOverlay, badges: {}, messages: this.chatFeed.messages }
        : { type: 'state', state: this.getState() });
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
    // i messaggi del bot vanno nella chat per OBS solo se non sono nascosti; gli altri dopo la moderazione
    if (fromBot) this.#toObsChat(id, user, text, true);
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
      shoutouts: { enabled: Boolean(this.config.shoutouts?.enabled), by: this.bot ? this.bot.login : CHANNEL.login, byBot: Boolean(this.bot), botMissingScope: false },
      overlays: this.clients.overlay.size,
      musicPages: 1,
      remoteDemo: true, // ⚙ Sistema mostra l'accesso da fuori casa simulato (nel programma vero c'è solo sul Raspberry)
      obsBase: 'http://localhost:3000',
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
      this.liveStartedAt = null;
      this.log.info('Simulazione fermata');
      return;
    }
    this.liveStartedAt = new Date().toISOString(); // per gli shoutout: ogni simulazione è una live nuova
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
      // ogni tanto scrive una persona dell'elenco degli shoutout
      const friends = this.config.shoutouts?.enabled ? this.config.shoutouts.users ?? [] : [];
      this.#incoming(friends.length && Math.random() < 0.2 ? pick(friends).login : pick(VIEWERS), text);
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
      // ⚙ Sistema: nella demo niente aggiornamenti né copie di sicurezza (le impostazioni stanno in questo browser)
      // storico dei titoli: live di prova
      case 'GET /api/titles': {
        const day = 86400000;
        const at = (d, h) => Date.now() - d * day - (Date.now() % day) + h * 3600000;
        const lives = [
          { startedAt: at(1, 19), endedAt: at(1, 22.5), changes: [{ at: at(1, 19), title: 'Elden Ring alla cieca: oggi si batte Malenia!', game: 'Elden Ring', gameId: '512953' }, { at: at(1, 21), title: 'Elden Ring alla cieca: MALENIA CI HA DISTRUTTO', game: 'Elden Ring', gameId: '512953' }] },
          { startedAt: at(3, 20), endedAt: at(3, 23), changes: [{ at: at(3, 20), title: 'Chiacchiere e caffè con la chat ☕', game: 'Just Chatting', gameId: '509658' }] },
          { startedAt: at(5, 18), endedAt: at(5, 21.25), changes: [{ at: at(5, 18), title: 'Minecraft hardcore: giorno 12', game: 'Minecraft', gameId: '27471' }] },
          { startedAt: at(8, 20), endedAt: at(8, 22), changes: [{ at: at(8, 20), title: 'Chiacchiere e caffè con la chat ☕', game: 'Just Chatting', gameId: '509658' }] },
        ];
        const map = new Map();
        for (const l of lives) for (const c of l.changes) {
          const t = map.get(c.title) ?? { ...c, lastUsed: 0, count: 0 };
          t.count += 1; t.lastUsed = Math.max(t.lastUsed, c.at); map.set(c.title, t);
        }
        return ok({ lives, titles: [...map.values()].sort((a, b) => b.lastUsed - a.lastUsed) });
      }
      case 'GET /api/stats': {
        this.stats ??= demoStats();
        return ok(this.stats.overview(Math.min(Math.max(Number(url.searchParams.get('days')) || 90, 7), 800)));
      }
      case 'GET /api/recaps': this.stats ??= demoStats(); return ok({ recaps: this.stats.recaps, live: Boolean(this.simulation) });
      case 'PUT /api/telegram':
        this.config = sanitizeConfig({ ...this.config, telegram: { ...this.config.telegram, ...body?.telegram } }, this.defaults);
        return ok({ telegram: this.config.telegram });
      case 'POST /api/telegram/find': case 'POST /api/telegram/test': case 'POST /api/telegram/photo':
        return fail(400, 'Nella demo Telegram non è collegato: nel programma vero qui trovi la chat privata o il canale e mandi i messaggi di prova.');
      case 'GET /api/schedule': case 'PUT /api/schedule': case 'POST /api/schedule/publish': {
        if (!this.schedule) {
          this.schedule = new Schedule({ onChange: () => this.#send('dashboard', { type: 'schedule' }) });
          const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
          this.schedule.replace([
            ...generateWeeks({ from: d.toISOString().slice(0, 10), weeks: 2, days: [2, 4], time: '21:00', durationMin: 180, title: 'Elden Ring alla cieca: oggi si batte Malenia!', game: 'Elden Ring', gameId: '512953' }),
            ...generateWeeks({ from: d.toISOString().slice(0, 10), weeks: 2, days: [6], time: '18:30', durationMin: 120, title: 'Chiacchiere e caffè con la chat ☕', game: 'Just Chatting', gameId: '509658' }),
          ]);
        }
        const state = () => ({ entries: this.schedule.entries, next: this.schedule.next(), timezone: 'Europe/Rome', canPublish: true });
        if (method === 'PUT') this.schedule.replace(body?.entries);
        if (route === 'POST /api/schedule/publish') {
          const ids = body?.ids ?? [];
          for (const id of ids) this.schedule.setTwitchId(id, `demo-${id}`);
          return ok({ ...state(), results: ids.map((id) => ({ id, ok: true })) });
        }
        return ok(state());
      }
      // accesso da fuori casa simulato: Attiva → (installazione) → Collega → link → collegato
      case 'GET /api/remote': case 'POST /api/remote/install': case 'POST /api/remote/connect': case 'POST /api/remote/disconnect': {
        const r = (this.remoteSim ??= { step: 'off', at: 0 });
        if (route === 'POST /api/remote/install') Object.assign(r, { step: 'installing', at: Date.now() });
        if (route === 'POST /api/remote/connect') Object.assign(r, { step: 'login', at: Date.now() });
        if (route === 'POST /api/remote/disconnect') Object.assign(r, { step: 'installed', at: Date.now() });
        if (r.step === 'installing' && Date.now() - r.at > 5000) r.step = 'installed';
        if (r.step === 'login' && Date.now() - r.at > 8000) r.step = 'connected';
        const base = { httpPort: 3000, pending: false, install: r.step === 'off' ? null : { result: r.step === 'installing' ? 'running' : 'ok' } };
        if (r.step === 'off' || r.step === 'installing') return ok({ ...base, installed: false, state: 'NotInstalled', connected: false });
        if (r.step === 'installed') return ok({ ...base, installed: true, state: 'NeedsLogin', connected: false, authUrl: '' });
        if (r.step === 'login') return ok({ ...base, installed: true, state: 'NeedsLogin', connected: false, authUrl: 'https://login.tailscale.com/' });
        return ok({ ...base, installed: true, state: 'Running', connected: true, ip: '100.101.102.103', dnsName: 'twitchgestor.tail1234.ts.net', account: 'tuo-account@gmail.com' });
      }
      case 'GET /api/music':
        return ok({
          playlists: this.music.playlists(), tracks: this.musicLibrary.map((t) => ({ id: t.id, folder: t.folder, name: t.name })),
          player: this.music.snapshot(), pages: 1, settings: this.config.music, share: null,
        });
      case 'POST /api/music/play': case 'POST /api/music/toggle': case 'POST /api/music/next': case 'POST /api/music/prev':
      case 'POST /api/music/volume': case 'POST /api/music/shuffle': case 'POST /api/music/rescan': case 'POST /api/music/settings':
      case 'POST /api/music/upload': {
        const p = this.music;
        const action = route.slice('POST /api/music/'.length);
        if (action === 'upload') {
          const name = String(decodeURIComponent(headers['x-filename'] ?? '')).replace(/[\\/]/g, '_');
          if (!UPLOAD_KINDS.music.includes(ext(name))) return fail(400, `Formato non supportato. Usa: ${UPLOAD_KINDS.music.join(', ')}`);
          const folder = String(url.searchParams.get('folder') ?? '').replace(/[\\/]/g, '').slice(0, 60);
          this.musicLibrary.push({ id: folder ? `${folder}/${name}` : name, url: '', folder, name, duration: 120 });
          return ok({ path: `media/music/${folder ? `${folder}/` : ''}${name}` });
        }
        if (action === 'play') p.play({ playlist: body?.playlist, trackId: body?.trackId });
        else if (action === 'toggle') p.toggle();
        else if (action === 'next') p.next();
        else if (action === 'prev') p.prev();
        else if (action === 'volume') p.setVolume(body?.volume);
        else if (action === 'shuffle') p.setShuffle(body?.on);
        else if (action === 'settings') {
          this.config = sanitizeConfig({ ...this.config, music: { ...this.config.music, ...body } }, this.defaults);
          storage.set('tg-demo-config', diffConfig(this.config, this.defaults) ?? {});
        }
        return ok({ player: p.snapshot(), pages: 1, settings: this.config.music });
      }
      case 'GET /api/update': return ok({ managed: false, commit: '', settings: { auto: true, hour: 5 }, check: {} });
      case 'GET /api/backup': case 'POST /api/backup/restore':
        return fail(400, 'Nella demo non c\'è niente da esportare o importare: le impostazioni restano solo in questo browser.');
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
      case 'PUT /api/chat-overlay': {
        this.config = sanitizeConfig({ ...this.config, chatOverlay: body?.chatOverlay }, this.defaults);
        storage.set('tg-demo-config', diffConfig(this.config, this.defaults) ?? {});
        this.#send('chat', { type: 'settings', settings: this.config.chatOverlay });
        return ok({ chatOverlay: this.config.chatOverlay });
      }
      case 'PUT /api/shoutouts': {
        this.config = sanitizeConfig({ ...this.config, shoutouts: body?.shoutouts }, this.defaults);
        storage.set('tg-demo-config', diffConfig(this.config, this.defaults) ?? {});
        this.broadcastState();
        return ok({ shoutouts: this.config.shoutouts });
      }
      case 'GET /api/shoutouts/log': return ok({ history: this.autoShoutout.history, seen: this.autoShoutout.seen });
      case 'POST /api/shoutouts/reset': this.autoShoutout.reset(); return ok({ history: this.autoShoutout.history, seen: [] });
      case 'POST /api/shoutouts/test': {
        const settings = body?.shoutouts ? sanitizeConfig({ ...this.config, shoutouts: body.shoutouts }, this.defaults).shoutouts : undefined;
        try { return ok(await this.autoShoutout.preview(body?.login, settings)); } catch (err) { return fail(400, err.message); }
      }
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
