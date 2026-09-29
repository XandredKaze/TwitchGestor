import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createLogger } from './logger.js';

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

/**
 * Scarica abbonati e follower del canale con l'account collegato a TwitchGestor
 * e li salva nello stato dei titoli di coda. Una categoria che fallisce non blocca l'altra.
 */
export async function fetchCreditsData({ store, helix, user }) {
  const settings = store.get('settings', {});
  const prev = store.get('data', {});
  const data = {
    fetchedAt: Date.now(),
    demo: false,
    subs: prev.demo ? [] : prev.subs ?? [],
    followers: prev.demo ? [] : prev.followers ?? [],
  };
  const errors = [];
  try {
    const subs = await helixAll(helix, 'subscriptions', { broadcaster_id: user.id });
    data.subs = subs.filter((s) => s.user_id !== user.id).map((s) => ({
      name: s.user_name,
      gift: Boolean(s.is_gift),
      tier: s.tier,
      gifter: s.gifter_login === 'ananonymousgifter' ? '' : s.gifter_name || '',
    }));
  } catch (err) {
    errors.push(`Abbonati: ${err.message}`);
  }
  try {
    const maxFollowers = Number(settings.maxFollowers ?? 200);
    const max = maxFollowers > 0 ? maxFollowers : Infinity;
    data.followers = (await helixAll(helix, 'channels/followers', { broadcaster_id: user.id }, max)).map((f) => f.user_name);
  } catch (err) {
    errors.push(`Follower: ${err.message}`);
  }
  store.set('data', data);
  store.set('status', { at: Date.now(), error: errors.join(' · ') });
  if (errors.length) log.warn(`Aggiornamento parziale: ${errors.join(' · ')}`);
  else log.info(`Aggiornati: ${data.subs.length} abbonati, ${data.followers.length} follower`);
  return { data, errors };
}

/**
 * Aggiornamento automatico: all'avvio (se impostato), ogni N minuti e poco dopo
 * ogni follow, sub o gift ricevuto in live.
 */
export function startCreditsScheduler({ store, getClient }) {
  let running = null;
  let soonTimer = null;

  async function refresh(reason) {
    const client = getClient();
    if (!client) return { skipped: 'Account Twitch non collegato' };
    if (running) return running;
    log.debug(`Aggiornamento (${reason})`);
    running = fetchCreditsData({ store, ...client })
      .catch((err) => {
        store.set('status', { at: Date.now(), error: err.message });
        return { errors: [err.message] };
      })
      .finally(() => { running = null; });
    return running;
  }

  const timer = setInterval(() => {
    const s = store.get('settings', {});
    const every = Number(s.fetchEvery ?? 30);
    const last = store.get('data', {}).fetchedAt ?? 0;
    if (every > 0 && Date.now() - last >= every * 60000) refresh('periodico');
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
  };
}
