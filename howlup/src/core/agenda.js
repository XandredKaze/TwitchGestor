/**
 * Howl-UP – agenda: impegni (anche ricorrenti), cose da fare e categorie.
 * Non dipende da Node: lo usano il programma sul Raspberry, la pagina nel browser e la demo.
 *
 * Le date sono "ora locale" senza fuso: giorno "2026-10-20", ora "21:00".
 *   impegno:      { id, title, category, date, time, endTime, allDay, notes, remindMin,
 *                   repeat: { freq: 'none'|'daily'|'weekly'|'monthly'|'yearly', interval, days: [1..7], until }, skip: [date] }
 *   cosa da fare: { id, title, category, due, done, doneAt, notes }
 *   nota:         { id, title, subtitle, date, time, body, createdAt, updatedAt }  (giorno e ora facoltativi)
 */

export const DEFAULT_CATEGORIES = [
  { id: 'live', name: 'Live', color: '#e36dc9', icon: '🔴' },
  { id: 'work', name: 'Lavoro', color: '#6d8ce3', icon: '💼' },
  { id: 'personal', name: 'Personale', color: '#4fbf8a', icon: '🏠' },
];
// turni da dipendente: orario sempre uguale, si segnano i giorni di un mese o di una settimana in un colpo solo
export const SHIFT_CATEGORY = { id: 'cube', name: 'Cube', color: '#9b7be0', icon: '🌙' };
export const DEFAULT_SHIFT = { title: 'Turno al Cube', category: 'cube', time: '23:00', endTime: '07:00', remindMin: 60 };
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
    // fine prima dell'inizio = finisce il giorno dopo (turni di notte: 23:00–07:00)
    endTime: !allDay && TIME.test(String(e.endTime ?? '')) && e.endTime !== e.time ? e.endTime : '',
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

/** Impostazioni del turno (titolo, tipo, orario, promemoria). */
export function cleanShift(x = {}, categories = DEFAULT_CATEGORIES) {
  const o = x && typeof x === 'object' ? x : {};
  const d = DEFAULT_SHIFT;
  const remind = Number(o.remindMin);
  return {
    title: str(o.title, 140).trim() || d.title,
    category: categories.some((c) => c.id === o.category) ? o.category : (categories.some((c) => c.id === d.category) ? d.category : categories[0]?.id ?? 'personal'),
    time: TIME.test(String(o.time ?? '')) ? o.time : d.time,
    endTime: TIME.test(String(o.endTime ?? '')) ? o.endTime : d.endTime,
    remindMin: o.remindMin === null ? null : Number.isFinite(remind) && remind >= 0 && remind <= 10080 ? Math.round(remind) : d.remindMin,
  };
}

/** Una nota con i campi ripuliti (null se manca il titolo). */
export function cleanNote(n = {}, now = Date.now()) {
  if (!n || typeof n !== 'object' || !String(n.title ?? '').trim()) return null;
  const date = DATE.test(String(n.date ?? '')) ? n.date : '';
  return {
    id: cleanId(n.id, 'n'),
    title: str(n.title, 200).trim(),
    subtitle: str(n.subtitle, 200).trim(),
    date,
    time: date && TIME.test(String(n.time ?? '')) ? n.time : '',
    body: str(n.body, 20000),
    createdAt: Number(n.createdAt) || now,
    updatedAt: now,
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

/**
 * Caratteristiche di un'intera categoria: orario (inizio e fine), promemoria e note fisse.
 * Orario e promemoria si usano per gli impegni nuovi; le note fisse compaiono in tutti gli impegni del tipo.
 * remindMin: null = nessun promemoria, undefined = non impostato.
 */
export function cleanCategoryDefaults(d) {
  const o = d && typeof d === 'object' ? d : {};
  const out = {};
  if (TIME.test(String(o.time ?? ''))) out.time = o.time;
  if (out.time && TIME.test(String(o.endTime ?? '')) && o.endTime !== out.time) out.endTime = o.endTime;
  const r = Number(o.remindMin);
  if (o.remindMin === null) out.remindMin = null;
  else if (o.remindMin !== undefined && o.remindMin !== '' && Number.isFinite(r) && r >= 0 && r <= 10080) out.remindMin = Math.round(r);
  const notes = str(o.notes, 1000).trim();
  if (notes) out.notes = notes;
  return out;
}

export function cleanCategories(list) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  const seen = new Set();
  const out = list.filter((c) => c && typeof c === 'object').slice(0, 20).map((c) => ({
    id: cleanId(c.id, 'c'),
    name: str(c.name, 30).trim() || 'Senza nome',
    color: /^#[0-9a-f]{6}$/i.test(String(c.color ?? '')) ? c.color : '#9a8fb0',
    icon: str(c.icon, 4),
    defaults: cleanCategoryDefaults(c.defaults),
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
/**
 * Impegni che si sovrappongono a quello che stai salvando (solo quelli con orario).
 * Fine prima dell'inizio = il giorno dopo; senza fine si conta un'ora (le live: la loro durata).
 * Per un impegno che si ripete si guardano i prossimi 60 giorni. Ritorna [{ day, time, endTime, title, category, with }]
 */
export function findOverlaps(candidate, events, { today: t = today(), skipId = candidate?.id, max = 5 } = {}) {
  if (!candidate || candidate.allDay || !TIME.test(String(candidate.time ?? ''))) return [];
  const span = (o) => {
    const start = parseDate(o.day).getTime() - 12 * 3600000 + toMinutes(o.time) * 60000;
    let end;
    if (o.endTime) end = parseDate(o.day).getTime() - 12 * 3600000 + (toMinutes(o.endTime) + (o.endTime <= o.time ? 1440 : 0)) * 60000;
    else end = start + (Number(o.durationMin) || 60) * 60000;
    return [start, end];
  };
  const single = (candidate.repeat?.freq ?? 'none') === 'none';
  const from = single ? candidate.date : (candidate.date > t ? candidate.date : t);
  const to = single ? candidate.date : addDays(from, 60);
  const mine = occurrences([{ ...candidate, id: candidate.id || '__new' }], from, to);
  if (!mine.length) return [];
  const others = occurrences(events.filter((e) => e.id !== skipId && !e.allDay && e.time), addDays(from, -1), addDays(to, 1));
  const out = [];
  for (const m of mine) {
    const [a, b] = span(m);
    for (const o of others) {
      const [c, d] = span(o);
      if (a < d && c < b) out.push({ day: o.day, time: o.time, endTime: o.endTime, title: o.title, category: o.category, with: m.day });
      if (out.length >= max) return out;
    }
  }
  return out;
}
const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

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
      lines.push(`DTEND:${dt(end < e.time ? addDays(e.date, 1) : e.date, end)}`);
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
    this.notes = (saved?.notes ?? []).map((n) => ({ ...cleanNote(n, n?.updatedAt), updatedAt: Number(n?.updatedAt) || Date.now() })).filter((n) => n.id);
    // il tipo "Cube" per i turni c'è sempre (si può rinominare o cambiare colore in Altro → Categorie)
    if (!saved?.shift && !this.categories.some((c) => c.id === SHIFT_CATEGORY.id)) this.categories = [...this.categories, { ...SHIFT_CATEGORY }];
    this.shift = cleanShift(saved?.shift, this.categories);
  }

  state() {
    return { categories: this.categories, events: this.events, tasks: this.tasks, shift: this.shift, notes: this.notes };
  }

  /**
   * Turni da dipendente tra from e to (per esempio un mese o una settimana): days sono i giorni in cui lavori.
   * I turni già segnati restano come sono (anche con lo straordinario), quelli tolti si cancellano, i nuovi
   * prendono l'orario del turno. shift (facoltativo): nuove impostazioni del turno.
   */
  setShifts({ from, to, days = [], shift } = {}) {
    if (!DATE.test(String(from ?? '')) || !DATE.test(String(to ?? '')) || to < from || daysBetween(from, to) > 62) throw Object.assign(new Error('Periodo non valido'), { status: 400 });
    if (shift) {
      if (shift.category === SHIFT_CATEGORY.id && !this.categories.some((c) => c.id === SHIFT_CATEGORY.id)) this.categories = [...this.categories, { ...SHIFT_CATEGORY }];
      this.shift = cleanShift(shift, this.categories);
    }
    const want = new Set((Array.isArray(days) ? days : []).filter((d) => DATE.test(String(d)) && d >= from && d <= to));
    const inRange = (e) => e.source === 'shift' && e.date >= from && e.date <= to;
    const before = this.events.length;
    this.events = this.events.filter((e) => !inRange(e) || want.has(e.date));
    const removed = before - this.events.length;
    const have = new Set(this.events.filter(inRange).map((e) => e.date));
    const s = this.shift;
    let added = 0;
    for (const date of [...want].sort()) {
      if (have.has(date)) continue;
      this.events.push(cleanEvent({ title: s.title, category: s.category, date, time: s.time, endTime: s.endTime, remindMin: s.remindMin, source: 'shift' }, this.categories));
      added++;
    }
    this.#save();
    return { added, removed };
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

  saveNote(input) {
    const old = this.notes.find((x) => x.id === input?.id);
    const n = cleanNote({ ...input, createdAt: old?.createdAt }, this.now());
    if (!n) throw Object.assign(new Error('Serve il titolo'), { status: 400 });
    if (old) this.notes = this.notes.map((x) => (x.id === n.id ? n : x)); else this.notes.push(n);
    this.#save();
    return n;
  }

  deleteNote(id) {
    const n = this.notes.length;
    this.notes = this.notes.filter((x) => x.id !== id);
    if (this.notes.length !== n) this.#save();
    return this.notes.length !== n;
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
    const before = new Map(this.categories.map((c) => [c.id, c.defaults ?? {}]));
    this.categories = cleanCategories(list);
    // orario e promemoria cambiati: valgono anche per gli impegni già in calendario da oggi in poi,
    // tranne quelli che avevi cambiato a mano (diversi dal valore di prima)
    const t = today(this.now());
    for (const c of this.categories) {
      const old = before.get(c.id) ?? {};
      const now = c.defaults ?? {};
      for (const e of this.events) {
        if (e.category !== c.id || e.allDay || e.source === 'twitchgestor') continue;
        if (e.date < t && (e.repeat.freq === 'none' || (e.repeat.until && e.repeat.until < t))) continue;
        for (const k of ['time', 'endTime', 'remindMin']) {
          if (!(k in now) || now[k] === old[k]) continue;
          // prima c'era un valore della categoria: si cambiano solo gli impegni che lo avevano ancora
          if (!(k in old) || e[k] === old[k]) e[k] = now[k];
        }
      }
    }
    const ids = new Set(this.categories.map((c) => c.id));
    for (const e of this.events) if (!ids.has(e.category)) e.category = this.categories[0].id;
    for (const t of this.tasks) if (t.category && !ids.has(t.category)) t.category = '';
    this.shift = cleanShift(this.shift, this.categories);
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
