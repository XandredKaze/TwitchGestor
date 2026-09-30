import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createLogger } from './logger.js';
import { liveSession } from './core/session.js';

const log = createLogger('titoli-coda');

/** Chiavi che la pagina dei titoli di coda può scrivere. I dati da Twitch li scrive solo il server. */
const WRITABLE = new Set(['settings', 'data', 'cmd', 'status']);
const MAX_VALUE = 2_000_000;

/**
 * Stato condiviso dei titoli di coda (impostazioni, nomi, comandi), salvato in data/credits.json.
 * Pannello, anteprima e sorgente OBS lo leggono ogni secondo: ricevono tutto solo se la revisione è cambiata.
 */
export class CreditsStore extends EventEmitter {
  #file;
  #saveTimer = null;

  constructor({ file }) {
    super();
    this.#file = file;
    this.state = {};
    this.rev = Date.now();
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Tiene solo le chiavi note: un state.json del vecchio Credit Roll contiene anche i token
      // di Twitch ("auth"), che qui non servono e non devono finire nella pagina.
      for (const key of WRITABLE) if (saved[key] !== undefined) this.state[key] = saved[key];
    } catch { /* primo avvio */ }
  }

  snapshot(clientRev) {
    return clientRev === this.rev ? { rev: this.rev } : { rev: this.rev, state: this.state };
  }

  set(key, value, { fromPage = false } = {}) {
    if (fromPage && !WRITABLE.has(key)) throw Object.assign(new Error('Chiave non consentita'), { status: 400 });
    if (JSON.stringify(value ?? null).length > MAX_VALUE) throw Object.assign(new Error('Dati troppo grandi'), { status: 413 });
    if (value === null || value === undefined) delete this.state[key];
    else this.state[key] = value;
    this.rev += 1;
    this.#scheduleSave();
    this.emit('change', key);
    return this.rev;
  }

  get(key, fallback) {
    return this.state[key] ?? fallback;
  }

  #scheduleSave() {
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this.#saveTimer);
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    fs.writeFileSync(`${this.#file}.tmp`, JSON.stringify(this.state));
    fs.renameSync(`${this.#file}.tmp`, this.#file);
  }
}

async function helixAll(helix, pathName, query, max = Infinity) {
  const out = [];
  let cursor;
  do {
    const params = new URLSearchParams({ ...query, first: '100' });
    if (cursor) params.set('after', cursor);
    const page = await helix.request('GET', `/${pathName}?${params}`);
    out.push(...(page.data ?? []));
    cursor = page.pagination?.cursor;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

const LIVE_WINDOW_HOURS = 12;
const CHATTERS_KEEP_MS = LIVE_WINDOW_HOURS * 3600 * 1000;
const CHATTERS_EVERY_MS = 5 * 60 * 1000;
export const BITS_PERIODS = ['day', 'week', 'month', 'year', 'all'];

/** Quali dati extra servono, in base alle sezioni aggiunte nel pannello. */
function neededSources(settings) {
  const sources = new Set((settings.customSections ?? []).filter((c) => c.show !== false).map((c) => c.source ?? 'manual'));
  const bitsPeriods = new Set((settings.customSections ?? [])
    .filter((c) => c.source === 'bits' && c.show !== false)
    .map((c) => (BITS_PERIODS.includes(c.period) ? c.period : 'all')));
  return { sources, bitsPeriods };
}

/** Inizio della live in corso, o null se il canale non è in live. */
async function liveStartedAt(helix, user) {
  const page = await helix.request('GET', `/streams?user_id=${encodeURIComponent(user.id)}`);
  return page.data?.[0]?.started_at ?? null;
}

async function fetchChatters(helix, user, prev = []) {
  const now = Date.now();
  const list = await helixAll(helix, 'chat/chatters', { broadcaster_id: user.id, moderator_id: user.id }, 5000);
  const seen = new Map(prev.filter((c) => now - c.at < CHATTERS_KEEP_MS).map((c) => [c.name, c.at]));
  for (const c of list) if (c.user_id !== user.id) seen.set(c.user_name, now);
  return [...seen].map(([name, at]) => ({ name, at }));
}

/** Eventi della live (follower, sub, bits, donazioni...) presi dallo storico di TwitchGestor. */
export function sessionFrom(history, startedAt) {
  const since = startedAt ?? Date.now() - LIVE_WINDOW_HOURS * 3600 * 1000;
  return { ...liveSession(history, since), live: Boolean(startedAt) };
}

/**
 * Scarica abbonati e follower del canale con l'account collegato a TwitchGestor
 * e li salva nello stato dei titoli di coda. Una categoria che fallisce non blocca l'altra.
 * Scarica anche i dati che servono alle sezioni aggiunte (moderatori, VIP, bits, chat).
 */
export async function fetchCreditsData({ store, helix, user, history = [] }) {
  const settings = store.get('settings', {});
  const prev = store.get('data', {});
  const { sources, bitsPeriods } = neededSources(settings);
  const data = {
    ...(prev.demo ? {} : prev),
    fetchedAt: Date.now(),
    demo: false,
    subs: prev.demo ? [] : prev.subs ?? [],
    followers: prev.demo ? [] : prev.followers ?? [],
  };
  const errors = [];
  const attempt = async (label, fn) => {
    try {
      await fn();
    } catch (err) {
      errors.push(`${label}: ${err.status === 401 || /scope/i.test(err.message) ? 'serve un nuovo accesso a Twitch (esci e accedi di nuovo dalla dashboard)' : err.message}`);
    }
  };

  await attempt('Abbonati', async () => {
    const subs = await helixAll(helix, 'subscriptions', { broadcaster_id: user.id });
    data.subs = subs.filter((s) => s.user_id !== user.id).map((s) => ({
      name: s.user_name,
      gift: Boolean(s.is_gift),
      tier: s.tier,
      gifter: s.gifter_login === 'ananonymousgifter' ? '' : s.gifter_name || '',
    }));
  });
  await attempt('Follower', async () => {
    const maxFollowers = Number(settings.maxFollowers ?? 200);
    const max = maxFollowers > 0 ? maxFollowers : Infinity;
    data.followers = (await helixAll(helix, 'channels/followers', { broadcaster_id: user.id }, max)).map((f) => f.user_name);
  });
  if (sources.has('mods')) {
    await attempt('Moderatori', async () => {
      data.moderators = (await helixAll(helix, 'moderation/moderators', { broadcaster_id: user.id })).map((m) => m.user_name);
    });
  }
  if (sources.has('vips')) {
    await attempt('VIP', async () => {
      data.vips = (await helixAll(helix, 'channels/vips', { broadcaster_id: user.id })).map((v) => v.user_name);
    });
  }
  if (bitsPeriods.size) {
    data.bits = { ...(data.bits ?? {}) };
    for (const period of bitsPeriods) {
      await attempt('Classifica bits', async () => {
        const page = await helix.request('GET', `/bits/leaderboard?count=100&period=${period}`);
        data.bits[period] = (page.data ?? []).map((b) => ({ name: b.user_name, value: b.score }));
      });
    }
  }
  if (sources.has('chatters')) {
    await attempt('Chat', async () => {
      data.chatters = await fetchChatters(helix, user, data.chatters);
      data.chattersAt = Date.now();
    });
  }
  await attempt('Stato della live', async () => {
    data.liveStartedAt = await liveStartedAt(helix, user);
  });
  data.session = sessionFrom(history, data.liveStartedAt);

  store.set('data', data);
  store.set('status', { at: Date.now(), error: errors.join(' · ') });
  if (errors.length) log.warn(`Aggiornamento parziale: ${errors.join(' · ')}`);
  else log.info(`Aggiornati: ${data.subs.length} abbonati, ${data.followers.length} follower`);
  return { data, errors };
}

/**
 * Aggiornamento automatico: all'avvio (se impostato), ogni N minuti e poco dopo
 * ogni follow, sub o gift ricevuto in live. Gli eventi della live si aggiornano subito.
 */
export function startCreditsScheduler({ store, getClient, getHistory = () => [] }) {
  let running = null;
  let soonTimer = null;
  let sessionTimer = null;

  async function refresh(reason) {
    const client = getClient();
    if (!client) return { skipped: 'Account Twitch non collegato' };
    if (running) return running;
    log.debug(`Aggiornamento (${reason})`);
    running = fetchCreditsData({ store, ...client, history: getHistory() })
      .catch((err) => {
        store.set('status', { at: Date.now(), error: err.message });
        return { errors: [err.message] };
      })
      .finally(() => { running = null; });
    return running;
  }

  async function refreshChatters() {
    const client = getClient();
    const data = store.get('data', {});
    if (!client || data.demo) return;
    try {
      const chatters = await fetchChatters(client.helix, client.user, data.chatters);
      store.set('data', { ...store.get('data', {}), chatters, chattersAt: Date.now() });
    } catch (err) {
      log.debug(`Chat non letta: ${err.message}`);
    }
  }

  const timer = setInterval(() => {
    const s = store.get('settings', {});
    const every = Number(s.fetchEvery ?? 30);
    const data = store.get('data', {});
    if (every > 0 && Date.now() - (data.fetchedAt ?? 0) >= every * 60000) refresh('periodico');
    // "Chi era in chat": la lista si raccoglie durante la live, ogni 5 minuti
    else if (neededSources(s).sources.has('chatters') && Date.now() - (data.chattersAt ?? 0) >= CHATTERS_EVERY_MS) refreshChatters();
  }, 60000);
  timer.unref();

  return {
    refresh,
    onStart() {
      if (store.get('settings', {}).fetchOnStart ?? true) refresh('avvio');
    },
    /** Dopo un evento in live aspetta 20 secondi (Twitch aggiorna gli elenchi con un po' di ritardo). */
    soon() {
      clearTimeout(soonTimer);
      soonTimer = setTimeout(() => refresh('nuovo evento'), 20000);
      soonTimer.unref();
    },
    /** Ricalcola subito gli eventi della live (non serve chiedere niente a Twitch). */
    updateSession() {
      clearTimeout(sessionTimer);
      sessionTimer = setTimeout(() => {
        const data = store.get('data', {});
        if (data.demo) return;
        store.set('data', { ...data, session: sessionFrom(getHistory(), data.liveStartedAt) });
      }, 1500);
      sessionTimer.unref?.();
    },
  };
}
