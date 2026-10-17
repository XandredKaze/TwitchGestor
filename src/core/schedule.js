/**
 * Programmazione delle live: le live in programma (giorno, ora, durata, titolo, categoria),
 * la creazione di più settimane in un colpo e il titolo/categoria impostati da soli poco prima dell'inizio.
 * Non dipende da Node: lo usa anche la versione demo nel browser.
 *
 * Le date sono "ora locale" del Raspberry/PC, nel formato "2026-10-24T21:00".
 */

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const APPLY_BEFORE_MIN = 10; // il titolo si imposta 10 minuti prima dell'inizio

const pad = (n) => String(n).padStart(2, '0');
export const toLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fromLocal = (s) => new Date(s).getTime();

let counter = 0;
const newId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Una live in programma, con i campi ripuliti. */
export function cleanEntry(e = {}) {
  if (!e || typeof e !== 'object' || !LOCAL.test(String(e.start ?? ''))) return null;
  const n = (v, min, max, def) => { const x = Number(v); return Number.isFinite(x) ? Math.min(Math.max(Math.round(x), min), max) : def; };
  return {
    id: /^[\w-]{1,40}$/.test(String(e.id ?? '')) ? e.id : newId(),
    start: e.start,
    durationMin: n(e.durationMin, 15, 24 * 60, 120),
    title: String(e.title ?? '').slice(0, 140),
    game: String(e.game ?? '').slice(0, 100),
    gameId: /^\d{0,20}$/.test(String(e.gameId ?? '')) ? String(e.gameId ?? '') : '',
    notes: String(e.notes ?? '').slice(0, 300),
    autoTitle: e.autoTitle !== false,
    applied: e.applied === true,
    twitchId: typeof e.twitchId === 'string' ? e.twitchId.slice(0, 100) : '',
  };
}

/**
 * Crea le live di più settimane: days = giorni della settimana (1 = lunedì … 7 = domenica),
 * time = "21:00", da "from" (data "2026-10-20") per "weeks" settimane.
 */
export function generateWeeks({ from, weeks = 4, days = [], time = '21:00', durationMin = 120, title = '', game = '', gameId = '' }) {
  const out = [];
  const [hh, mm] = String(time).split(':').map(Number);
  const start = new Date(`${from}T00:00`);
  if (Number.isNaN(start.getTime())) return out;
  for (let i = 0; i < Math.min(Math.max(weeks, 1), 12) * 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, hh || 0, mm || 0);
    const weekday = ((d.getDay() + 6) % 7) + 1;
    if (days.includes(weekday)) out.push(cleanEntry({ start: toLocal(d.getTime()), durationMin, title, game, gameId }));
  }
  return out;
}

export class Schedule {
  constructor({ store, now = () => Date.now(), onChange } = {}) {
    Object.assign(this, { store, now, onChange });
    this.entries = [];
    try {
      const saved = store?.load?.();
      if (Array.isArray(saved?.entries)) this.entries = saved.entries.map(cleanEntry).filter(Boolean);
    } catch { /* ancora niente */ }
    this.#sort();
  }

  /** Le live in programma da adesso in poi (comprese quelle in corso). */
  upcoming() {
    const now = this.now();
    return this.entries.filter((e) => fromLocal(e.start) + e.durationMin * 60000 > now);
  }

  /** La prossima live in programma (non ancora iniziata). */
  next() {
    const now = this.now();
    return this.entries.find((e) => fromLocal(e.start) > now) ?? null;
  }

  /** Sostituisce l'elenco (dalla dashboard). Le live passate da più di 60 giorni si tolgono. */
  replace(list) {
    const old = new Map(this.entries.map((e) => [e.id, e]));
    const limit = this.now() - 60 * 86400000;
    this.entries = (Array.isArray(list) ? list : []).slice(0, 500).map(cleanEntry).filter(Boolean)
      .filter((e) => fromLocal(e.start) > limit)
      .map((e) => {
        const prev = old.get(e.id);
        // se cambi giorno, ora, titolo o categoria, il titolo si reimposta di nuovo
        if (prev && (prev.start !== e.start || prev.title !== e.title || prev.gameId !== e.gameId)) e.applied = false;
        return e;
      });
    this.#sort();
    this.save();
    return this.entries;
  }

  /** Le live il cui titolo va impostato adesso (da 10 minuti prima dell'inizio fino alla fine). */
  due() {
    const now = this.now();
    return this.entries.filter((e) => e.autoTitle && !e.applied && (e.title || e.gameId)
      && now >= fromLocal(e.start) - APPLY_BEFORE_MIN * 60000 && now < fromLocal(e.start) + e.durationMin * 60000);
  }

  markApplied(id) {
    const e = this.entries.find((x) => x.id === id);
    if (e) { e.applied = true; this.save(); }
  }

  setTwitchId(id, twitchId) {
    const e = this.entries.find((x) => x.id === id);
    if (e) { e.twitchId = twitchId; this.save(); }
  }

  save() {
    try { this.store?.save?.({ entries: this.entries }); } catch { /* non importante */ }
    this.onChange?.();
  }

  #sort() {
    this.entries.sort((a, b) => a.start.localeCompare(b.start));
  }
}
