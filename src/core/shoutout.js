/**
 * Shoutout automatici: quando una persona scelta scrive per la prima volta in chat durante la live,
 * il bot scrive un messaggio di presentazione e fa lo shoutout ufficiale di Twitch (/shoutout).
 * Non dipende da Node: lo usa anche la versione demo nel browser.
 *
 * Chi usa questo modulo fornisce:
 *   getConfig()          impostazioni correnti (config.shoutouts)
 *   send(text)           scrive in chat (con il bot, se collegato)
 *   shoutout(userId)     shoutout ufficiale di Twitch verso quel canale
 *   channelInfo(login)   { id, login, name, game, title, avatar } del canale (null se non esiste)
 *   liveSince()          inizio della live in corso (stringa ISO) oppure null se non sei in live
 *   onCard(info)         mostra la scheda dello shoutout nella chat di OBS (con immagine del canale)
 *   store                { load(), save(data) } per ricordare chi ha già avuto lo shoutout (anche dopo un riavvio)
 */

// Limiti di Twitch: uno shoutout ogni 2 minuti, lo stesso canale al massimo una volta all'ora.
export const OFFICIAL_GAP_MS = 2 * 60 * 1000 + 5000;
export const SAME_CHANNEL_MS = 60 * 60 * 1000;
export const DEFAULT_SHOUTOUT_MESSAGE = '📣 Passate a trovare {user}! L\'ultima volta era in live con {game} → {link}';

const LOGIN = /^\w{2,25}$/;
export const cleanLogin = (v) => {
  const s = String(v ?? '').trim().replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?twitch\.tv\//i, '').replace(/\/.*$/, '').toLowerCase();
  return LOGIN.test(s) ? s : '';
};

/** Testo del messaggio con i dati del canale. */
export function renderShoutout(template, info) {
  const values = {
    user: info.name || info.login,
    login: info.login,
    game: info.game || 'qualcosa di bello',
    title: info.title || '',
    link: `twitch.tv/${info.login}`,
  };
  return String(template || DEFAULT_SHOUTOUT_MESSAGE)
    .replace(/\{(user|login|game|title|link)\}/gi, (_, k) => values[k.toLowerCase()])
    .replace(/\s{2,}/g, ' ').trim().slice(0, 500);
}

export class AutoShoutout {
  #seen = new Set(); // login già salutati in questa live
  #key = null; // a quale live si riferisce #seen
  #queue = []; // shoutout ufficiali in attesa (Twitch ne permette uno ogni 2 minuti)
  #lastOfficial = -Infinity;
  #lastByChannel = new Map();
  #timer = null;
  #busy = new Set(); // login in lavorazione (due messaggi ravvicinati non fanno due shoutout)

  constructor({ getConfig, send, shoutout, channelInfo, liveSince, store, onChange, onCard, now = () => Date.now(), log = console }) {
    Object.assign(this, { getConfig, send, shoutoutFn: shoutout, channelInfo, liveSince, store, onChange, onCard, now, log });
    this.history = []; // ultimi shoutout, il più recente per primo
    try {
      const saved = store?.load?.();
      if (saved?.key) { this.#key = saved.key; this.#seen = new Set(saved.seen ?? []); }
    } catch { /* niente di salvato */ }
  }

  get settings() {
    return this.getConfig() ?? {};
  }

  /** La persona è nell'elenco? Ritorna la sua voce ({ login, message }) o null. */
  entryFor(login) {
    const l = String(login ?? '').toLowerCase();
    return (this.settings.users ?? []).find((u) => u.login === l) ?? null;
  }

  /** Chi ha già avuto lo shoutout in questa live. */
  get seen() {
    return [...this.#seen];
  }

  /**
   * Messaggio della chat: se è la prima volta (in questa live) di una persona dell'elenco, fa lo shoutout.
   * msg = { user: { id, login, name } }. Ritorna il record dello shoutout oppure null.
   */
  async handle(msg) {
    const cfg = this.settings;
    if (!cfg.enabled) return null;
    const login = String(msg.user?.login ?? '').toLowerCase();
    const entry = this.entryFor(login);
    if (!entry || this.#busy.has(login)) return null;
    this.#busy.add(login);
    try {
      const started = await this.liveSince?.();
      if (!started && cfg.onlyLive !== false) return null; // offline: niente, e resta da salutare per la prossima live
      // una "sessione" è la live in corso; fuori dalla live vale per tutto il giorno
      const key = started ? `live:${started}` : `day:${new Date(this.now()).toISOString().slice(0, 10)}`;
      if (key !== this.#key) { this.#key = key; this.#seen = new Set(); }
      if (this.#seen.has(login)) return null;
      this.#seen.add(login);
      this.#persist();
      return await this.#run(entry, { live: Boolean(started), user: msg.user });
    } finally {
      this.#busy.delete(login);
    }
  }

  /** Prova dalla dashboard: il messaggio che scriverebbe, senza scrivere né fare lo shoutout. */
  async preview(login, settings = this.settings) {
    const l = cleanLogin(login);
    if (!l) throw new Error('Nome del canale non valido');
    const info = await this.channelInfo(l);
    if (!info) throw new Error(`Il canale "${l}" non esiste su Twitch`);
    const entry = (settings.users ?? []).find((u) => u.login === l);
    return { text: renderShoutout(entry?.message || settings.message, info), name: info.name, game: info.game };
  }

  /** Fa di nuovo gli shoutout a tutti (dalla dashboard). */
  reset() {
    this.#seen = new Set();
    this.#persist();
    this.onChange?.();
  }

  async #run(entry, { live, user }) {
    const cfg = this.settings;
    const record = { at: this.now(), login: entry.login, name: user?.name || entry.login, chat: null, official: null };
    this.history.unshift(record);
    this.history.length = Math.min(this.history.length, 50);
    let info;
    try {
      info = await this.channelInfo(entry.login);
      if (!info) throw new Error('canale non trovato');
      record.name = info.name || record.name;
    } catch (err) {
      record.chat = `non riuscito: ${err.message}`;
      this.onChange?.();
      return record;
    }
    if (cfg.obsCard !== false) {
      try { this.onCard?.(info); } catch (err) { this.log.warn?.(`Scheda dello shoutout: ${err.message}`); }
    }
    if (cfg.chatMessage !== false) {
      const text = renderShoutout(entry.message || cfg.message, info);
      try {
        await this.send(text);
        record.chat = 'ok';
      } catch (err) {
        record.chat = `non riuscito: ${err.message}`;
      }
    }
    if (cfg.official !== false) {
      if (!live) record.official = 'saltato: si può fare solo quando sei in live';
      else this.#enqueue(record, info.id);
    }
    this.onChange?.();
    return record;
  }

  #enqueue(record, channelId) {
    record.official = 'in coda';
    this.#queue.push({ record, channelId });
    this.#pump();
  }

  /** Manda gli shoutout ufficiali rispettando i limiti di Twitch. */
  #pump() {
    if (this.#timer || !this.#queue.length) return;
    const now = this.now();
    const job = this.#queue[0];
    const sameWait = (this.#lastByChannel.get(job.channelId) ?? -Infinity) + SAME_CHANNEL_MS - now;
    if (sameWait > 0) {
      // lo stesso canale ha già avuto uno shoutout nell'ultima ora: Twitch lo rifiuterebbe
      this.#queue.shift();
      job.record.official = 'saltato: già fatto nell\'ultima ora';
      this.onChange?.();
      this.#pump();
      return;
    }
    const wait = Math.max(0, this.#lastOfficial + OFFICIAL_GAP_MS - now);
    this.#timer = setTimeout(async () => {
      this.#queue.shift();
      try {
        await this.shoutoutFn(job.channelId);
        job.record.official = 'ok';
        this.#lastOfficial = this.now();
        this.#lastByChannel.set(job.channelId, this.now());
      } catch (err) {
        job.record.official = `non riuscito: ${err.message}`;
        if (err.status === 429) this.#lastOfficial = this.now(); // Twitch chiede di aspettare
        this.log.warn?.(`Shoutout a ${job.record.name}: ${err.message}`);
      }
      this.#timer = null;
      this.onChange?.();
      this.#pump();
    }, wait);
    this.#timer?.unref?.();
  }

  #persist() {
    try { this.store?.save?.({ key: this.#key, seen: [...this.#seen] }); } catch { /* non importante */ }
  }
}

/** Scheda dello shoutout per la chat di OBS (pagina /chat). */
export function shoutoutCard(info, now = Date.now()) {
  return {
    id: `so-${info.login}-${now}`,
    kind: 'shoutout',
    userId: `so:${info.id ?? info.login}`, // non sparisce se la persona riceve un timeout
    login: info.login,
    name: info.name || info.login,
    avatar: info.avatar || '',
    game: info.game || '',
    title: info.title || '',
    text: '',
    at: now,
  };
}
