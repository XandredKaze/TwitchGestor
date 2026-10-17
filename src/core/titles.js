/**
 * Storico dei titoli delle live: per ogni diretta inizio, fine, titolo e categoria,
 * più ogni cambio di titolo o categoria fatto durante la live.
 * Non dipende da Node: lo usa anche la versione demo nel browser.
 *
 * Chi usa questo modulo fornisce store = { load(), save(data) } per tenerlo su disco.
 */

const MAX_LIVES = 300;

export class TitleLog {
  constructor({ store, now = () => Date.now(), onChange } = {}) {
    this.store = store;
    this.now = now;
    this.onChange = onChange;
    this.lives = []; // la più recente per prima: { startedAt, endedAt, changes: [{ at, title, game, gameId }] }
    try {
      const saved = store?.load?.();
      if (Array.isArray(saved?.lives)) this.lives = saved.lives;
    } catch { /* ancora niente */ }
  }

  /** La live in corso (quella senza fine), se c'è. */
  get current() {
    return this.lives.find((l) => !l.endedAt) ?? null;
  }

  /** Inizia una live (o ritrova quella già registrata con lo stesso orario di inizio). */
  online({ startedAt, title, game, gameId }) {
    const start = Date.parse(startedAt) || this.now();
    let live = this.lives.find((l) => Math.abs(l.startedAt - start) < 60000);
    if (!live) {
      // una live rimasta "aperta" (es. programma spento durante la fine) si chiude qui
      for (const l of this.lives) if (!l.endedAt) l.endedAt = l.lastSeen ?? l.startedAt;
      live = { startedAt: start, endedAt: null, lastSeen: this.now(), changes: [] };
      this.lives.unshift(live);
      this.lives.length = Math.min(this.lives.length, MAX_LIVES);
    } else {
      live.endedAt = null;
    }
    this.#change(live, { title, game, gameId }, start);
    this.#save();
    return live;
  }

  /** Titolo o categoria cambiati (conta solo durante una live). */
  update({ title, game, gameId }) {
    const live = this.current;
    if (!live) return null;
    this.#change(live, { title, game, gameId }, this.now());
    this.#save();
    return live;
  }

  /** La live è finita (at: quando, se si sa; altrimenti adesso). */
  offline(at) {
    const live = this.current;
    if (!live) return;
    live.endedAt = at ?? this.now();
    this.#save();
  }

  /** Durante la live: tiene nota dell'ultimo momento in cui era in corso (serve se il programma si spegne). */
  seen() {
    const live = this.current;
    if (live) { live.lastSeen = this.now(); this.#save(false); }
  }

  /** Titoli usati, senza doppioni: il più recente per primo, con quante live e l'ultima volta. */
  titles() {
    const map = new Map();
    for (const live of this.lives) {
      for (const c of live.changes) {
        if (!c.title) continue;
        const key = c.title.trim().toLowerCase();
        const t = map.get(key) ?? { title: c.title, game: c.game, gameId: c.gameId, lastUsed: 0, lives: new Set() };
        if (c.at > t.lastUsed) Object.assign(t, { title: c.title, game: c.game || t.game, gameId: c.gameId || t.gameId, lastUsed: c.at });
        t.lives.add(live.startedAt);
        map.set(key, t);
      }
    }
    return [...map.values()].map((t) => ({ title: t.title, game: t.game, gameId: t.gameId ?? '', lastUsed: t.lastUsed, count: t.lives.size }))
      .sort((a, b) => b.lastUsed - a.lastUsed);
  }

  #change(live, { title, game, gameId }, at) {
    const last = live.changes.at(-1);
    const next = { title: title ?? last?.title ?? '', game: game ?? last?.game ?? '', gameId: gameId ?? (game === undefined ? last?.gameId : '') ?? '' };
    if (last && last.title === next.title && last.game === next.game) return;
    live.changes.push({ at, ...next });
  }

  #save(notify = true) {
    try { this.store?.save?.({ lives: this.lives }); } catch { /* non importante */ }
    if (notify) this.onChange?.();
  }
}
