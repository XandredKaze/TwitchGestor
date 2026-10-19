/**
 * Howl-UP – agenda: impegni (anche ricorrenti), cose da fare e categorie.
 * Non dipende da Node: lo usano il programma sul Raspberry, la pagina nel browser e la demo.
 *
 * Le date sono "ora locale" senza fuso: giorno "2026-10-20", ora "21:00".
 *   impegno:      { id, title, category, date, time, endTime, allDay, notes, remindMin,
 *                   repeat: { freq: 'none'|'daily'|'weekly'|'monthly'|'yearly', interval, days: [1..7], until }, skip: [date] }
 *   cosa da fare: { id, title, category, due, done, doneAt, notes }
 */

export const DEFAULT_CATEGORIES = [
  { id: 'live', name: 'Live', color: '#e36dc9', icon: '🔴' },
  { id: 'work', name: 'Lavoro', color: '#6d8ce3', icon: '💼' },
  { id: 'personal', name: 'Personale', color: '#4fbf8a', icon: '🏠' },
];
export const FREQS = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
export const WEEKDAYS = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (n) => String(n).padStart(2, '0');

/** "2026-10-20" ⇄ Date (a mezzogiorno, così il cambio dell'ora legale non sposta il giorno). */
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return dateKey(d); };
export const weekday = (s) => ((parseDate(s).getDay() + 6) % 7) + 1; // 1 = lunedì … 7 = domenica
export const today = (now = Date.now()) => dateKey(new Date(now));
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const monthsBetween = (a, b) => { const x = parseDate(a); const y = parseDate(b); return (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth(); };

let counter = 0;
export const newId = (prefix = 'e') => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const str = (v, max) => String(v ?? '').slice(0, max);
const cleanId = (v, prefix) => (/^[\w-]{1,40}$/.test(String(v ?? '')) ? String(v) : newId(prefix));

/** Un impegno con i campi ripuliti (null se non valido). */
export function cleanEvent(e = {}, categories = DEFAULT_CATEGORIES) {
  if (!e || typeof e !== 'object' || !DATE.test(String(e.date ?? '')) || !String(e.title ?? '').trim()) return null;
  const allDay = e.allDay === true || !TIME.test(String(e.time ?? ''));
  const r = e.repeat && typeof e.repeat === 'object' ? e.repeat : {};
  const freq = FREQS.includes(r.freq) ? r.freq : 'none';
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => d >= 1 && d <= 7))].sort() : [];
  const remind = Number(e.remindMin);
  return {
    id: cleanId(e.id, 'e'),
    title: str(e.title, 140).trim(),
    category: categories.some((c) => c.id === e.category) ? e.category : categories[0]?.id ?? 'personal',
    date: e.date,
    time: allDay ? '' : e.time,
    endTime: !allDay && TIME.test(String(e.endTime ?? '')) && e.endTime > e.time ? e.endTime : '',
    allDay,
    notes: str(e.notes, 2000),
    remindMin: Number.isFinite(remind) && remind >= 0 && remind <= 10080 ? Math.round(remind) : null,
    repeat: freq === 'none' ? { freq } : {
      freq,
      interval: Math.min(Math.max(Math.round(Number(r.interval) || 1), 1), 52),
      days: freq === 'weekly' ? (days.length ? days : [weekday(e.date)]) : [],
      until: DATE.test(String(r.until ?? '')) && r.until >= e.date ? r.until : '',
    },
    skip: Array.isArray(e.skip) ? e.skip.filter((d) => DATE.test(String(d))).slice(-500) : [],
    source: typeof e.source === 'string' ? e.source.slice(0, 40) : '',
  };
}

export function cleanTask(t = {}, categories = DEFAULT_CATEGORIES) {
  if (!t || typeof t !== 'object' || !String(t.title ?? '').trim()) return null;
  return {
    id: cleanId(t.id, 't'),
    title: str(t.title, 200).trim(),
    category: categories.some((c) => c.id === t.category) ? t.category : '',
    due: DATE.test(String(t.due ?? '')) ? t.due : '',
    done: t.done === true,
    doneAt: t.done === true ? Number(t.doneAt) || Date.now() : null,
    notes: str(t.notes, 2000),
  };
}

export function cleanCategories(list) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  const seen = new Set();
  const out = list.filter((c) => c && typeof c === 'object').slice(0, 20).map((c) => ({
    id: cleanId(c.id, 'c'),
    name: str(c.name, 30).trim() || 'Senza nome',
    color: /^#[0-9a-f]{6}$/i.test(String(c.color ?? '')) ? c.color : '#9a8fb0',
    icon: str(c.icon, 4),
  })).filter((c) => !seen.has(c.id) && seen.add(c.id));
  return out.length ? out : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
}

/** L'impegno cade in questo giorno? */
export function occursOn(e, day) {
  if (day < e.date || e.skip?.includes(day)) return false;
  const r = e.repeat ?? { freq: 'none' };
  if (r.freq === 'none') return day === e.date;
  if (r.until && day > r.until) return false;
  const n = r.interval || 1;
  switch (r.freq) {
    case 'daily': return daysBetween(e.date, day) % n === 0;
    case 'weekly': {
      if (!r.days.includes(weekday(day))) return false;
      const weeks = Math.floor((daysBetween(e.date, day) + weekday(e.date) - 1) / 7);
      return weeks % n === 0;
    }
    case 'monthly': return parseDate(day).getDate() === parseDate(e.date).getDate() && monthsBetween(e.date, day) % n === 0;
    case 'yearly': return day.slice(5) === e.date.slice(5) && (Number(day.slice(0, 4)) - Number(e.date.slice(0, 4))) % n === 0;
    default: return false;
  }
}

/** Gli impegni giorno per giorno tra from e to (compresi), in ordine di ora. */
export function occurrences(events, from, to) {
  const out = [];
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) {
    for (const e of events) {
      if (occursOn(e, d)) out.push({ ...e, day: d, key: `${e.id}@${d}` });
    }
  }
  return out.sort((a, b) => (a.day + (a.allDay ? '' : a.time)).localeCompare(b.day + (b.allDay ? '' : b.time)));
}

/** "ogni martedì e giovedì", "ogni 2 settimane il lunedì", "ogni mese il 15"… */
export function repeatText(e) {
  const r = e.repeat ?? { freq: 'none' };
  if (r.freq === 'none') return '';
  const n = r.interval || 1;
  const list = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} e ${a.at(-1)}` : a[0] ?? '');
  const until = r.until ? ` fino al ${parseDate(r.until).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}` : '';
  switch (r.freq) {
    case 'daily': return (n === 1 ? 'ogni giorno' : `ogni ${n} giorni`) + until;
    case 'weekly': {
      const names = r.days.join() === '1,2,3,4,5' ? 'dal lunedì al venerdì' : r.days.length === 7 ? 'tutti i giorni' : r.days.join() === '6,7' ? 'il fine settimana' : list(r.days.map((d) => WEEKDAYS[d - 1]));
      const short = /^(dal|tutti|il)/.test(names);
      return (n === 1 ? (short ? names : `ogni ${names}`) : `ogni ${n} settimane (${names})`) + until;
    }
    case 'monthly': return (n === 1 ? `ogni mese il ${parseDate(e.date).getDate()}` : `ogni ${n} mesi il ${parseDate(e.date).getDate()}`) + until;
    case 'yearly': return (n === 1 ? 'ogni anno' : `ogni ${n} anni`) + until;
    default: return '';
  }
}

/** Calendario .ics da aggiungere a Google Calendar o al calendario del telefono (si aggiorna da solo). */
export function toICS(events, { name = 'Howl-UP', categories = DEFAULT_CATEGORIES, now = Date.now() } = {}) {
  const esc = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const d = (s) => s.replace(/-/g, '');
  const dt = (s, t) => `${d(s)}T${t.replace(':', '')}00`;
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Howl-UP//IT', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
  for (const e of events) {
    const cat = categories.find((c) => c.id === e.category);
    lines.push('BEGIN:VEVENT', `UID:${e.id}@howl-up`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(`${cat?.icon ? `${cat.icon} ` : ''}${e.title}`)}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${d(e.date)}`, `DTEND;VALUE=DATE:${d(addDays(e.date, 1))}`);
    else {
      lines.push(`DTSTART:${dt(e.date, e.time)}`);
      const end = e.endTime || (() => { const [h, m] = e.time.split(':').map(Number); return `${pad(Math.min(23, h + 1))}:${pad(h >= 23 ? 59 : m)}`; })();
      lines.push(`DTEND:${dt(e.date, end)}`);
    }
    const r = e.repeat ?? { freq: 'none' };
    if (r.freq !== 'none') {
      const parts = [`FREQ=${r.freq.toUpperCase()}`, `INTERVAL=${r.interval || 1}`];
      if (r.freq === 'weekly') parts.push(`BYDAY=${r.days.map((x) => DAYS[x - 1]).join(',')}`);
      if (r.until) parts.push(`UNTIL=${d(r.until)}T235959`);
      lines.push(`RRULE:${parts.join(';')}`);
      for (const s of e.skip ?? []) lines.push(e.allDay ? `EXDATE;VALUE=DATE:${d(s)}` : `EXDATE:${dt(s, e.time)}`);
    }
    if (cat) lines.push(`CATEGORIES:${esc(cat.name)}`);
    if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
    if (e.remindMin != null) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${e.remindMin}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // righe al massimo 75 caratteri, come vuole il formato
  return lines.flatMap((l) => { const out = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; } out.push(s); return out; }).join('\r\n') + '\r\n';
}

/**
 * L'agenda salvata: { categories, events, tasks }. Le modifiche passano da qui (dati sempre puliti).
 * store: { load(), save(data) }
 */
export class Agenda {
  constructor({ store, onChange, now = () => Date.now() } = {}) {
    Object.assign(this, { store, onChange, now });
    let saved = null;
    try { saved = store?.load?.(); } catch { /* prima volta */ }
    this.categories = cleanCategories(saved?.categories);
    this.events = (saved?.events ?? []).map((e) => cleanEvent(e, this.categories)).filter(Boolean);
    this.tasks = (saved?.tasks ?? []).map((t) => cleanTask(t, this.categories)).filter(Boolean);
  }

  state() {
    return { categories: this.categories, events: this.events, tasks: this.tasks };
  }

  saveEvent(input) {
    const e = cleanEvent(input, this.categories);
    if (!e) throw Object.assign(new Error('Servono almeno titolo e giorno'), { status: 400 });
    const i = this.events.findIndex((x) => x.id === e.id);
    if (i >= 0) this.events[i] = e; else this.events.push(e);
    this.#save();
    return e;
  }

  /** Elimina l'impegno, oppure solo un giorno di un impegno ricorrente (only = "2026-10-20"). */
  deleteEvent(id, only) {
    const e = this.events.find((x) => x.id === id);
    if (!e) return false;
    if (only && e.repeat.freq !== 'none') e.skip = [...new Set([...e.skip, only])];
    else this.events = this.events.filter((x) => x.id !== id);
    this.#save();
    return true;
  }

  /**
   * Modifica solo un giorno di un impegno ricorrente: quel giorno si toglie dalla serie
   * e diventa un impegno a sé con le modifiche.
   */
  saveOccurrence(id, day, input) {
    const e = this.events.find((x) => x.id === id);
    if (!e) throw Object.assign(new Error('Impegno non trovato'), { status: 404 });
    e.skip = [...new Set([...e.skip, day])];
    const single = this.saveEvent({ ...e, date: day, ...input, id: newId('e'), repeat: { freq: 'none' }, skip: [] });
    return single;
  }

  saveTask(input) {
    const t = cleanTask(input, this.categories);
    if (!t) throw Object.assign(new Error('Serve il titolo'), { status: 400 });
    const old = this.tasks.find((x) => x.id === t.id);
    if (old?.done && t.done) t.doneAt = old.doneAt; // resta la data di quando l'hai fatta
    const i = this.tasks.findIndex((x) => x.id === t.id);
    if (i >= 0) this.tasks[i] = t; else this.tasks.push(t);
    this.#save();
    return t;
  }

  deleteTask(id) {
    const n = this.tasks.length;
    this.tasks = this.tasks.filter((x) => x.id !== id);
    if (this.tasks.length !== n) this.#save();
    return this.tasks.length !== n;
  }

  /** Le cose fatte da più di 30 giorni si tolgono da sole. */
  cleanupDone() {
    const limit = this.now() - 30 * 86400000;
    const n = this.tasks.length;
    this.tasks = this.tasks.filter((t) => !t.done || (t.doneAt ?? 0) > limit);
    if (this.tasks.length !== n) this.#save();
  }

  saveCategories(list) {
    this.categories = cleanCategories(list);
    const ids = new Set(this.categories.map((c) => c.id));
    for (const e of this.events) if (!ids.has(e.category)) e.category = this.categories[0].id;
    for (const t of this.tasks) if (t.category && !ids.has(t.category)) t.category = '';
    this.#save();
    return this.categories;
  }

  #save() {
    try { this.store?.save?.(this.state()); } catch { /* lo dice il programma */ }
    this.onChange?.();
  }
}

/**
 * Le live della Programmazione di TwitchGestor come impegni di Howl-UP (si modificano da qui ma restano
 * salvate in TwitchGestor). entry: { id, start: "2026-10-20T21:00", durationMin, title, game, notes, autoTitle, twitchId }
 */
export function livesToEvents(entries = []) {
  return entries.filter((e) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(e?.start ?? ''))).map((e) => {
    const [h, m] = e.start.slice(11).split(':').map(Number);
    const end = h * 60 + m + (Number(e.durationMin) || 120);
    return {
      id: `tg-${e.id}`, liveId: e.id, source: 'twitchgestor',
      title: e.title || 'Live', category: 'live', date: e.start.slice(0, 10), time: e.start.slice(11),
      endTime: end < 24 * 60 ? `${pad(Math.floor(end / 60))}:${pad(end % 60)}` : '', durationMin: Number(e.durationMin) || 120,
      allDay: false, notes: e.notes ?? '', remindMin: 30, repeat: { freq: 'none' }, skip: [],
      game: e.game ?? '', gameId: e.gameId ?? '', autoTitle: e.autoTitle !== false, published: Boolean(e.twitchId),
    };
  });
}
