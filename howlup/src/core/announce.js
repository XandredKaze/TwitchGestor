/**
 * Howl-UP – annunci per la community: quando una live viene aggiunta, spostata, annullata o cambiata
 * (da Howl-UP o da TwitchGestor) si prepara un annuncio con il testo per Telegram e Discord e la storia Instagram.
 * Lo controlli e lo invii con un tocco; se vuoi, parte da solo dopo qualche minuto (lo puoi fermare).
 * Non dipende da Node: lo usano il programma sul Raspberry e la demo.
 */

import { parseDate, occurrences, today, addDays } from './agenda.js';

const pad = (n) => String(n).padStart(2, '0');
const ms = (start) => new Date(`${start}:00`).getTime();
const dayText = (start, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => parseDate(start.slice(0, 10)).toLocaleDateString('it-IT', opts);
const when = (start) => `${dayText(start)} alle ${start.slice(11)}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const DEFAULT_ANNOUNCE = { auto: { enabled: false, delayMin: 10 }, telegram: true, discord: true, discordWebhook: '' };

export function cleanAnnounceSettings(s = {}) {
  const o = (v) => (v && typeof v === 'object' ? v : {});
  const delay = Number(o(s.auto).delayMin);
  const hook = String(s.discordWebhook ?? '').trim();
  return {
    auto: { enabled: o(s.auto).enabled === true, delayMin: Number.isFinite(delay) ? Math.min(Math.max(Math.round(delay), 1), 180) : 10 },
    telegram: s.telegram !== false,
    discord: s.discord !== false,
    discordWebhook: /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(hook) ? hook : '',
  };
}

/**
 * Cosa è cambiato tra due elenchi di live (solo quelle future e nei prossimi 60 giorni).
 * Ritorna [{ type: 'new'|'moved'|'cancelled'|'changed', live, before }]
 */
export function diffLives(before = [], after = [], now = Date.now()) {
  const future = (e) => e && ms(e.start) > now && ms(e.start) < now + 60 * 86400000;
  const old = new Map(before.map((e) => [e.id, e]));
  const out = [];
  for (const e of after) {
    const b = old.get(e.id);
    if (!b) { if (future(e)) out.push({ type: 'new', live: e }); continue; }
    old.delete(e.id);
    if (!future(e) && !future(b)) continue;
    if (b.start !== e.start) out.push({ type: 'moved', live: e, before: b });
    else if ((b.title ?? '') !== (e.title ?? '') || (b.game ?? '') !== (e.game ?? '')) out.push({ type: 'changed', live: e, before: b });
  }
  for (const b of old.values()) if (future(b)) out.push({ type: 'cancelled', live: b });
  return out.sort((a, b) => a.live.start.localeCompare(b.live.start));
}

const liveLine = (e) => `• ${cap(dayText(e.start, { weekday: 'short', day: 'numeric', month: 'short' }))}, ${e.start.slice(11)}${e.title ? ` — ${e.title}` : ''}${e.game ? ` (${e.game})` : ''}`;

/**
 * L'annuncio pronto per un gruppo di cambiamenti (fatti insieme).
 * ctx: { login, next } — next = prossima live dopo quella annullata
 */
export function buildAnnouncement(changes, { login = '', next = null } = {}) {
  const link = login ? `\n\n👉 twitch.tv/${login}` : '';
  const t = (e) => `${e.title ? `\n${e.title}` : ''}${e.game ? `\n🎮 ${e.game}` : ''}`;
  const news = changes.filter((c) => c.type === 'new');
  if (changes.length === 1 || news.length === changes.length) {
    if (news.length > 1) {
      return { kind: 'new-many', headline: 'NUOVE LIVE', title: `📅 ${news.length} nuove live in programma`, text: `📅 Nuove live in programma!\n\n${news.map((c) => liveLine(c.live)).join('\n')}${link}`, lives: news.map((c) => c.live) };
    }
    const c = changes[0];
    if (c.type === 'new') return { kind: 'new', headline: 'NUOVA LIVE', title: `📅 Nuova live: ${when(c.live.start)}`, text: `📅 Nuova live!\n${cap(when(c.live.start))}${t(c.live)}${link}`, lives: [c.live] };
    if (c.type === 'moved') {
      return {
        kind: 'moved', headline: 'CAMBIO DI PROGRAMMA', title: `🔁 Live spostata a ${when(c.live.start)}`,
        text: `🔁 Cambio di programma!\nLa live di ${when(c.before.start)} si sposta a ${when(c.live.start)}.${t(c.live)}${link}`, lives: [c.live], before: c.before,
      };
    }
    if (c.type === 'cancelled') {
      return {
        kind: 'cancelled', headline: 'LIVE ANNULLATA', title: `❌ Live annullata: ${when(c.live.start)}`,
        text: `❌ Live annullata\nLa live di ${when(c.live.start)}${c.live.title ? ` (${c.live.title})` : ''} non ci sarà, mi dispiace!${next ? `\nCi vediamo ${when(next.start)}.` : '\nCi vediamo alla prossima!'}${link}`, lives: [c.live], next,
      };
    }
    return { kind: 'changed', headline: 'AGGIORNAMENTO', title: `✏️ Live di ${when(c.live.start)} aggiornata`, text: `✏️ Novità sulla live di ${when(c.live.start)}:${t(c.live)}${link}`, lives: [c.live] };
  }
  // cambiamenti misti fatti insieme: un riepilogo unico
  const label = { new: '📅 Nuova', moved: '🔁 Spostata', cancelled: '❌ Annullata', changed: '✏️ Aggiornata' };
  return {
    kind: 'mixed', headline: 'PROGRAMMA AGGIORNATO', title: `📣 Programma delle live aggiornato (${changes.length} cambiamenti)`,
    text: `📣 Programma delle live aggiornato!\n\n${changes.map((c) => `${label[c.type]}: ${liveLine(c.live).slice(2)}${c.type === 'moved' ? ` (era ${dayText(c.before.start, { weekday: 'short', day: 'numeric' })} ${c.before.start.slice(11)})` : ''}`).join('\n')}${link}`,
    lives: changes.filter((c) => c.type !== 'cancelled').map((c) => c.live),
    items: changes.map((c) => ({ type: c.type, live: c.live, before: c.before ?? null })),
  };
}

/**
 * Cosa può generare un annuncio: SOLO le live. Cioè la Programmazione di TwitchGestor (sono tutte live)
 * più gli impegni di Howl-UP con la categoria "Live" (per esempio quelli che si ripetono ogni mese).
 * Gli impegni delle altre categorie non generano mai annunci.
 */
export function announceSource(entries = [], events = [], { now = Date.now() } = {}) {
  const t = today(now);
  const local = occurrences(events.filter((e) => e.category === 'live' && !e.allDay && e.time && e.source !== 'twitchgestor'), t, addDays(t, 60))
    .map((o) => ({ id: `h-${o.id}@${o.day}`, start: `${o.day}T${o.time}`, title: o.title ?? '', game: '' }));
  return [...entries, ...local];
}

/** Annuncio fatto a mano per una live (pulsante "📣 Crea annuncio"): la ricorda alla community. */
export function buildPromo(live, { login = '' } = {}) {
  const link = login ? `\n\n👉 twitch.tv/${login}` : '';
  const t = `${live.title ? `\n${live.title}` : ''}${live.game ? `\n🎮 ${live.game}` : ''}`;
  return { kind: 'promo', headline: 'PROSSIMA LIVE', title: `📣 Live di ${when(live.start)}`, text: `🔴 Prossima live!\n${cap(when(live.start))}${t}${link}`, lives: [live] };
}

let counter = 0;
const newId = () => `a${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Gli annunci preparati. store: { load(), save(data) }; send(draft, { text, image }) manda dove è attivo.
 * Il primo elenco di live visto serve solo come punto di partenza (nessun annuncio).
 */
export class Announcements {
  constructor({ store, getSettings, getContext = () => ({}), send, now = () => Date.now(), onChange, log = () => {} } = {}) {
    Object.assign(this, { store, getSettings, getContext, send, now, onChange, log });
    this.state = { last: null, drafts: [] };
    try { Object.assign(this.state, store?.load?.() ?? {}); } catch { /* prima volta */ }
  }

  get settings() { return cleanAnnounceSettings(this.getSettings?.()); }
  get drafts() { return this.state.drafts; }

  /** Nuovo elenco di live da TwitchGestor: se è cambiato qualcosa, prepara l'annuncio. */
  observe(entries) {
    const list = (entries ?? []).map((e) => ({ id: e.id, start: e.start, title: e.title ?? '', game: e.game ?? '' }));
    // primo elenco (o elenco calcolato in modo nuovo dopo un aggiornamento): solo punto di partenza, nessun annuncio
    if (!this.state.last || this.state.v !== 2) { this.state.last = list; this.state.v = 2; this.#save(); return null; }
    const changes = diffLives(this.state.last, list, this.now());
    this.state.last = list;
    if (!changes.length) { this.#save(); return null; }
    const ctx = this.getContext() ?? {};
    const next = list.filter((e) => ms(e.start) > this.now()).sort((a, b) => a.start.localeCompare(b.start))[0] ?? null;
    const a = buildAnnouncement(changes, { login: ctx.login, next });
    const s = this.settings;
    const draft = { id: newId(), createdAt: this.now(), status: 'draft', ...a, edited: false, sendAt: s.auto.enabled ? this.now() + s.auto.delayMin * 60000 : null, results: {} };
    this.state.drafts = [draft, ...this.state.drafts].slice(0, 40);
    this.#save();
    return draft;
  }

  /** Annuncio creato a mano per una live, in qualunque momento (non parte da solo: lo invii tu). */
  create(input) {
    const live = { id: String(input?.id ?? '').slice(0, 80), start: String(input?.start ?? ''), title: String(input?.title ?? '').slice(0, 140), game: String(input?.game ?? '').slice(0, 100) };
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(live.start)) throw Object.assign(new Error('Servono giorno e ora della live'), { status: 400 });
    const a = buildPromo(live, { login: (this.getContext() ?? {}).login });
    const draft = { id: newId(), createdAt: this.now(), status: 'draft', ...a, edited: false, sendAt: null, results: {}, manual: true };
    this.state.drafts = [draft, ...this.state.drafts].slice(0, 40);
    this.#save();
    return draft;
  }

  update(id, { text }) {
    const d = this.state.drafts.find((x) => x.id === id);
    if (!d || d.status !== 'draft') return null;
    if (typeof text === 'string') { d.text = text.slice(0, 3500); d.edited = true; }
    this.#save();
    return d;
  }

  /** Ferma l'invio automatico (l'annuncio resta da inviare a mano). */
  hold(id) {
    const d = this.state.drafts.find((x) => x.id === id);
    if (d) { d.sendAt = null; this.#save(); }
    return d;
  }

  dismiss(id) {
    const d = this.state.drafts.find((x) => x.id === id);
    if (d && d.status === 'draft') { d.status = 'dismissed'; d.sendAt = null; this.#save(); }
    return d;
  }

  /** Invia adesso (a mano: con l'immagine della storia, se c'è). */
  async sendNow(id, { image = null, targets } = {}) {
    const d = this.state.drafts.find((x) => x.id === id);
    if (!d) throw Object.assign(new Error('Annuncio non trovato'), { status: 404 });
    const results = await this.send(d, { text: d.text, image, targets });
    d.results = { ...d.results, ...results };
    if (Object.values(results).some((r) => r === 'ok')) { d.status = 'sent'; d.sentAt = this.now(); d.sendAt = null; }
    this.#save();
    return d;
  }

  /** Ogni minuto: invia quelli automatici arrivati all'ora (solo testo). */
  async tick() {
    for (const d of this.state.drafts.filter((x) => x.status === 'draft' && x.sendAt && x.sendAt <= this.now())) {
      d.sendAt = null;
      try { await this.sendNow(d.id); } catch (err) { this.log(`Annuncio automatico: ${err.message}`); }
    }
  }

  #save() {
    try { this.store?.save?.(this.state); } catch { /* non importante */ }
    this.onChange?.();
  }
}
