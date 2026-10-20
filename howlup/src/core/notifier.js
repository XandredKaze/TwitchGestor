/**
 * Howl-UP – notifiche: buongiorno all'ora scelta, riepilogo della settimana, promemoria prima degli impegni.
 * Ogni notifica ha "✅ Ho visto": finché non la confermi si ripete (ogni N minuti, al massimo M volte, mai di notte).
 * Non dipende da Node: lo usano il programma sul Raspberry e la demo.
 *
 * Chi usa questo modulo fornisce:
 *   getSettings()    impostazioni (vedi DEFAULT_SETTINGS)
 *   getData()        { events, tasks, categories } con le live già dentro gli events
 *   getExtra()       { recap } facoltativo: l'ultima live finita (dai riepiloghi di TwitchGestor)
 *   send(msg)        manda { id, kind, title, text, repeat } ai canali (ntfy, Telegram); può essere async
 *   store            { load(), save(data) } per ricordare cosa è stato mandato e confermato
 */

import { occurrences, today, addDays, parseDate, weekday } from './agenda.js';

export const DEFAULT_SETTINGS = {
  briefing: { enabled: true, time: '08:00', days: [1, 2, 3, 4, 5, 6, 7] },
  weekly: { enabled: true, day: 7, time: '20:00' },
  reminders: { enabled: true },
  repeat: { enabled: true, everyMin: 15, maxTimes: 6, quietFrom: '23:00', quietTo: '07:30' },
  channels: { ntfy: { enabled: false, server: 'https://ntfy.sh', topic: '' }, telegram: { enabled: false } },
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** Impostazioni ripulite (quelle mancanti prendono il valore predefinito). */
export function cleanSettings(s = {}) {
  const d = DEFAULT_SETTINGS;
  const o = (v) => (v && typeof v === 'object' ? v : {});
  const time = (v, def) => (TIME.test(String(v ?? '')) ? v : def);
  const n = (v, min, max, def) => { const x = Number(v); return Number.isFinite(x) ? Math.min(Math.max(Math.round(x), min), max) : def; };
  const days = Array.isArray(o(s.briefing).days) ? [...new Set(o(s.briefing).days.map(Number).filter((x) => x >= 1 && x <= 7))].sort() : d.briefing.days;
  const topic = String(o(o(s.channels).ntfy).topic ?? '').trim();
  const server = String(o(o(s.channels).ntfy).server ?? '').trim();
  return {
    briefing: { enabled: o(s.briefing).enabled !== false, time: time(o(s.briefing).time, d.briefing.time), days },
    weekly: { enabled: o(s.weekly).enabled !== false, day: n(o(s.weekly).day, 1, 7, d.weekly.day), time: time(o(s.weekly).time, d.weekly.time) },
    reminders: { enabled: o(s.reminders).enabled !== false },
    repeat: {
      enabled: o(s.repeat).enabled !== false,
      everyMin: n(o(s.repeat).everyMin, 5, 240, d.repeat.everyMin),
      maxTimes: n(o(s.repeat).maxTimes, 1, 30, d.repeat.maxTimes),
      quietFrom: time(o(s.repeat).quietFrom, d.repeat.quietFrom),
      quietTo: time(o(s.repeat).quietTo, d.repeat.quietTo),
    },
    channels: {
      ntfy: {
        enabled: o(o(s.channels).ntfy).enabled === true,
        server: /^https?:\/\/[\w.-]+(:\d+)?$/.test(server) ? server : d.channels.ntfy.server,
        topic: /^[\w-]{6,64}$/.test(topic) ? topic : '',
      },
      telegram: { enabled: o(o(s.channels).telegram).enabled === true },
    },
  };
}

/** È "notte" (niente ripetizioni)? Gestisce anche le fasce a cavallo della mezzanotte. */
export function isQuiet(now, from, to) {
  const m = now.getHours() * 60 + now.getMinutes();
  const a = toMin(from);
  const b = toMin(to);
  if (a === b) return false;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

const line = (o, cats) => {
  const c = cats.find((x) => x.id === o.category);
  return `• ${o.allDay ? 'tutto il giorno' : o.time}${o.endTime ? `–${o.endTime}` : ''} ${c?.icon ?? ''} ${o.title}${o.game ? ` (${o.game})` : ''}`.replace(/\s+/g, ' ');
};
const durText = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`; };

/** Il buongiorno: impegni di oggi, cose da fare, prossima live e com'è andata l'ultima. */
export function buildBriefing({ events, tasks, categories }, { day, recap } = {}) {
  const list = occurrences(events, day, day);
  const late = tasks.filter((t) => !t.done && t.due && t.due < day);
  const due = tasks.filter((t) => !t.done && t.due === day);
  const nextLive = occurrences(events.filter((e) => e.category === 'live'), day, addDays(day, 14)).find((o) => o.day >= day);
  const date = parseDate(day).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const parts = [];
  parts.push(list.length ? `📅 Oggi (${list.length}):\n${list.map((o) => line(o, categories)).join('\n')}` : '📅 Oggi nessun impegno: giornata libera.');
  if (late.length || due.length) {
    parts.push(`✅ Da fare:\n${[...late.map((t) => `• ${t.title} (in ritardo)`), ...due.map((t) => `• ${t.title}`)].join('\n')}`);
  }
  if (nextLive && nextLive.day !== day) {
    const when = parseDate(nextLive.day).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    parts.push(`🔴 Prossima live: ${when} alle ${nextLive.time}${nextLive.title ? ` – ${nextLive.title}` : ''}`);
  }
  if (recap?.startedAt && Date.now() - recap.startedAt < 36 * 3600000) {
    const bits = [`durata ${durText(recap.durationMs)}`, `${recap.viewers?.average ?? 0} spettatori in media (massimo ${recap.viewers?.peak ?? 0})`];
    if (Number.isFinite(recap.followers?.gained)) bits.push(`${recap.followers.gained >= 0 ? '+' : ''}${recap.followers.gained} follower`);
    if (recap.subscribers?.newSubs?.length) bits.push(`${recap.subscribers.newSubs.length} nuovi abbonati`);
    if (recap.chat?.messages) bits.push(`${recap.chat.messages} messaggi in chat`);
    parts.push(`📈 L'ultima live: ${bits.join(', ')}.`);
  }
  return { title: `🐺 Buongiorno! ${date[0].toUpperCase()}${date.slice(1)}`, text: parts.join('\n\n') };
}

/** Il riepilogo della settimana che arriva: impegni giorno per giorno e cose da fare. */
export function buildWeekly({ events, tasks, categories }, { day }) {
  const from = addDays(day, 1);
  const list = occurrences(events, from, addDays(from, 6));
  const byDay = new Map();
  for (const o of list) byDay.set(o.day, [...(byDay.get(o.day) ?? []), o]);
  const days = [...byDay].map(([d, items]) => `${parseDate(d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric' })}:\n${items.map((o) => line(o, categories)).join('\n')}`);
  const open = tasks.filter((t) => !t.done && t.due && t.due <= addDays(from, 6));
  const lives = list.filter((o) => o.category === 'live').length;
  return {
    title: '🗓️ La tua settimana',
    text: [days.length ? days.join('\n\n') : 'Nessun impegno nei prossimi 7 giorni.',
      lives ? `🔴 ${lives} ${lives === 1 ? 'live' : 'live'} in programma.` : '',
      open.length ? `✅ Da fare entro la settimana: ${open.length}` : ''].filter(Boolean).join('\n\n'),
  };
}

export class Notifier {
  constructor({ getSettings, getData, getExtra = () => ({}), send, store, now = () => Date.now(), log = () => {} } = {}) {
    Object.assign(this, { getSettings, getData, getExtra, send, store, now, log });
    this.state = { briefing: '', weekly: '', reminded: [], pending: [] };
    try { Object.assign(this.state, store?.load?.() ?? {}); } catch { /* prima volta */ }
  }

  get settings() { return cleanSettings(this.getSettings?.()); }

  /** Le notifiche ancora da confermare (per la pagina). */
  pending() { return this.state.pending.filter((p) => !p.ackAt); }

  /** "✅ Ho visto": conferma una notifica (o tutte). */
  ack(id) {
    let n = 0;
    for (const p of this.state.pending) if (!p.ackAt && (!id || p.id === id)) { p.ackAt = this.now(); n += 1; }
    if (n) this.#save();
    return n;
  }

  async #deliver(msg, { repeatOf } = {}) {
    try {
      await this.send?.({ ...msg, repeat: repeatOf ?? 0 });
    } catch (err) {
      this.log(`Notifica non inviata: ${err.message}`);
    }
  }

  async #notify(kind, key, msg) {
    const id = `${kind}-${key}`.replace(/[^\w-]/g, '-').slice(0, 80);
    if (this.state.pending.some((p) => p.id === id)) return;
    const p = { id, kind, title: msg.title, text: msg.text, firstAt: this.now(), lastAt: this.now(), count: 1, ackAt: null };
    this.state.pending = [...this.state.pending, p].slice(-60);
    this.#save();
    await this.#deliver(p);
  }

  /** Da chiamare ogni minuto. */
  async tick() {
    const s = this.settings;
    const now = new Date(this.now());
    const day = today(this.now());
    const nowHm = hm(now);
    const data = this.getData();

    if (s.briefing.enabled && s.briefing.days.includes(weekday(day)) && nowHm >= s.briefing.time && this.state.briefing !== day) {
      this.state.briefing = day;
      this.#save();
      await this.#notify('buongiorno', day, buildBriefing(data, { day, recap: this.getExtra()?.recap }));
    }
    if (s.weekly.enabled && weekday(day) === s.weekly.day && nowHm >= s.weekly.time && this.state.weekly !== day) {
      this.state.weekly = day;
      this.#save();
      await this.#notify('settimana', day, buildWeekly(data, { day }));
    }
    if (s.reminders.enabled) {
      for (const o of occurrences(data.events, day, addDays(day, 1))) {
        if (o.remindMin == null || o.allDay) continue;
        const start = new Date(`${o.day}T${o.time}:00`).getTime();
        const at = start - o.remindMin * 60000;
        const key = `${o.id}@${o.day}`;
        if (this.now() < at || this.now() > start + 15 * 60000 || this.state.reminded.includes(key)) continue;
        this.state.reminded = [...this.state.reminded, key].slice(-300);
        const c = data.categories.find((x) => x.id === o.category);
        const mins = Math.round((start - this.now()) / 60000);
        await this.#notify('promemoria', key, {
          title: `⏰ ${mins > 0 ? `Tra ${mins} min` : 'Adesso'}: ${o.title}`,
          text: `${c?.icon ?? ''} ${o.title} alle ${o.time}${o.endTime ? `–${o.endTime}` : ''}${o.game ? `\n🎮 ${o.game}` : ''}${o.notes ? `\n📝 ${o.notes}` : ''}`.trim(),
        });
      }
    }
    // ripetizioni di quelle non ancora confermate
    if (s.repeat.enabled && !isQuiet(now, s.repeat.quietFrom, s.repeat.quietTo)) {
      for (const p of this.pending()) {
        if (p.count >= s.repeat.maxTimes || this.now() - p.lastAt < s.repeat.everyMin * 60000) continue;
        if (this.now() - p.firstAt > 20 * 3600000) continue; // dopo quasi un giorno non ha più senso
        p.count += 1;
        p.lastAt = this.now();
        this.#save();
        await this.#deliver({ ...p, title: `🔁 ${p.title}` }, { repeatOf: p.count });
      }
    }
    // pulizia: le confermate o vecchie di 2 giorni si tolgono
    const before = this.state.pending.length;
    this.state.pending = this.state.pending.filter((p) => this.now() - p.firstAt < 48 * 3600000);
    if (this.state.pending.length !== before) this.#save();
  }

  /** Prova dalla pagina: manda subito il buongiorno di oggi (da confermare come gli altri). */
  async test() {
    const day = today(this.now());
    const msg = buildBriefing(this.getData(), { day, recap: this.getExtra()?.recap });
    await this.#notify('prova', String(this.now()), { ...msg, title: `🧪 Prova – ${msg.title}` });
  }

  #save() {
    try { this.store?.save?.(this.state); } catch { /* non importante */ }
  }
}
