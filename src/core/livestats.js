/**
 * Statistiche delle live e riepiloghi di fine live.
 *   - durante la live: spettatori (un campione al minuto) e messaggi in chat
 *   - ogni giorno: follower e abbonati totali del canale
 *   - a fine live: il riepilogo, con il confronto con le live precedenti
 * Non dipende da Node: lo usa anche la versione demo nel browser.
 */

const MAX_LIVES = 400;
const MAX_DAYS = 800;
export const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export class LiveStats {
  constructor({ store, now = () => Date.now(), onChange } = {}) {
    Object.assign(this, { store, now, onChange });
    this.lives = []; // la più recente per prima
    this.daily = {}; // "2026-10-18": { followers, subscribers }
    try {
      const saved = store?.load?.();
      if (Array.isArray(saved?.lives)) this.lives = saved.lives;
      if (saved?.daily) this.daily = saved.daily;
    } catch { /* ancora niente */ }
    this.saveTimer = null;
  }

  get current() {
    return this.lives.find((l) => !l.endedAt) ?? null;
  }

  /** Inizio live (o la stessa live ritrovata, es. dopo un riavvio del programma). */
  start(startedAt) {
    const start = Date.parse(startedAt) || Number(startedAt) || this.now();
    let live = this.lives.find((l) => Math.abs(l.startedAt - start) < 60000);
    if (!live) {
      live = { startedAt: start, endedAt: null, samples: [], messages: 0, chatters: {} };
      this.lives.unshift(live);
      this.lives.length = Math.min(this.lives.length, MAX_LIVES);
    }
    live.endedAt = null;
    this.save();
    return live;
  }

  /** Spettatori in questo momento. */
  sample(viewers, at = this.now()) {
    const live = this.current;
    if (!live || !Number.isFinite(viewers)) return;
    live.samples.push([at, viewers]);
    this.save(false);
  }

  /** Un messaggio in chat durante la live. */
  chat(login, name) {
    const live = this.current;
    if (!live || !login) return;
    live.messages += 1;
    const c = live.chatters[login] ?? (live.chatters[login] = { name: name || login, count: 0 });
    c.count += 1;
    this.save(false);
  }

  /** Follower e abbonati totali del canale in questo momento (per il giorno e per la live in corso). */
  totals({ followers, subscribers }) {
    const at = this.now();
    const day = this.daily[dayKey(at)] ?? {};
    if (Number.isFinite(followers)) day.followers = followers;
    if (Number.isFinite(subscribers)) day.subscribers = subscribers;
    this.daily[dayKey(at)] = day;
    const keys = Object.keys(this.daily).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete this.daily[k];
    const live = this.current;
    if (live && Number.isFinite(followers)) {
      live.followersStart ??= followers;
      live.followersEnd = followers;
    }
    if (live && Number.isFinite(subscribers)) {
      live.subscribersStart ??= subscribers;
      live.subscribersEnd = subscribers;
    }
    this.save(false);
  }

  /** Fine live: la chiude e ritorna la live (il riepilogo lo prepara computeRecap). */
  end(at = this.now()) {
    const live = this.current;
    if (!live) return null;
    live.endedAt = at;
    this.save();
    return live;
  }

  /** Riepiloghi delle live finite, il più recente per primo. */
  get recaps() {
    return this.lives.filter((l) => l.recap).map((l) => l.recap);
  }

  /** Dati per la sezione Statistiche, degli ultimi "days" giorni. */
  overview(days = 90) {
    const since = this.now() - days * 86400000;
    const lives = this.lives.filter((l) => l.recap && l.startedAt >= since).map((l) => ({
      startedAt: l.startedAt,
      durationMs: l.recap.durationMs,
      title: l.recap.titles[0]?.title ?? '',
      game: l.recap.games[0] ?? '',
      averageViewers: l.recap.viewers.average,
      peakViewers: l.recap.viewers.peak,
      followersGained: l.recap.followers.gained,
      messages: l.recap.chat.messages,
    })).reverse();
    const daily = Object.entries(this.daily).filter(([k]) => Date.parse(`${k}T12:00:00`) >= since)
      .sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
    return { days, lives, daily };
  }

  save(notify = true) {
    // durante la live i dati cambiano spesso: si scrivono su disco al massimo ogni 30 secondi
    if (!notify) {
      if (!this.saveTimer) {
        this.saveTimer = setTimeout(() => { this.saveTimer = null; this.#write(); }, 30000);
        this.saveTimer.unref?.();
      }
      return;
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.#write();
    this.onChange?.();
  }

  #write() {
    try { this.store?.save?.({ lives: this.lives, daily: this.daily }); } catch { /* non importante */ }
  }
}

const round = (n, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const sum = (list, f) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const pct = (now, before) => (before > 0 && Number.isFinite(now) ? round(((now - before) / before) * 100) : null);

/**
 * Riepilogo di una live finita.
 * @param live     la live (da LiveStats)
 * @param session  eventi della live (liveSession dello storico delle notifiche: follow, sub, bits...)
 * @param titles   cambi di titolo e categoria della live ([{ at, title, game }])
 * @param previous riepiloghi delle live precedenti (per il confronto)
 */
export function computeRecap(live, { session = {}, titles = [], previous = [] } = {}) {
  const end = live.endedAt ?? Date.now();
  const durationMs = Math.max(0, end - live.startedAt);
  const samples = live.samples ?? [];
  const values = samples.map(([, v]) => v);
  const peak = values.length ? Math.max(...values) : 0;
  const peakAt = values.length ? samples[values.indexOf(peak)][0] : null;
  const average = values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 1) : 0;
  // per il grafico bastano al massimo 120 punti
  const step = Math.max(1, Math.ceil(samples.length / 120));
  const chart = samples.filter((_, i) => i % step === 0);
  const chatters = Object.values(live.chatters ?? {});
  const followersGained = Number.isFinite(live.followersEnd) && Number.isFinite(live.followersStart) ? live.followersEnd - live.followersStart : null;
  const donations = {};
  for (const d of session.donations ?? []) donations[d.currency || '€'] = round((donations[d.currency || '€'] ?? 0) + d.value, 2);

  const recap = {
    startedAt: live.startedAt,
    endedAt: end,
    durationMs,
    titles: titles.map((t) => ({ at: t.at, title: t.title, game: t.game })),
    games: [...new Set(titles.map((t) => t.game).filter(Boolean))],
    viewers: { peak, peakAt, average, hoursWatched: round((average * durationMs) / 3600000, 1), chart },
    followers: {
      gained: followersGained,
      names: session.follows ?? [],
      total: live.followersEnd ?? null,
    },
    subscribers: {
      newSubs: session.subs ?? [],
      resubs: session.resubs ?? [],
      gifted: sum(session.gifters ?? [], (g) => g.value),
      gifters: session.gifters ?? [],
      total: live.subscribersEnd ?? null,
    },
    bits: { total: sum(session.cheers ?? [], (c) => c.value), from: session.cheers ?? [] },
    donations: { totals: donations, from: session.donations ?? [] },
    raids: session.raids ?? [],
    redemptions: (session.redemptions ?? []).length,
    chat: {
      messages: live.messages ?? 0,
      people: chatters.length,
      top: chatters.sort((a, b) => b.count - a.count).slice(0, 5).map((c) => ({ name: c.name, count: c.count })),
    },
  };

  // confronto con la media delle (fino a) 5 live precedenti
  const prev = previous.slice(0, 5);
  if (prev.length) {
    const avg = (f) => sum(prev, f) / prev.length;
    recap.compare = {
      lives: prev.length,
      averageViewers: pct(recap.viewers.average, avg((r) => r.viewers.average)),
      peakViewers: pct(recap.viewers.peak, avg((r) => r.viewers.peak)),
      duration: pct(recap.durationMs, avg((r) => r.durationMs)),
      messages: pct(recap.chat.messages, avg((r) => r.chat.messages)),
      followersGained: prev.every((r) => Number.isFinite(r.followers.gained)) && Number.isFinite(followersGained)
        ? round(followersGained - avg((r) => r.followers.gained), 1) : null,
    };
  }
  return recap;
}

/** Testo del riepilogo per Telegram (HTML semplice). */
export function recapText(r) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  const date = new Date(r.startedAt).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const trend = (p) => (p === null || p === undefined ? '' : ` (${p >= 0 ? '▲ +' : '▼ '}${p}% rispetto alle ultime live)`);
  const lines = [
    `📋 <b>Riepilogo della live</b> — ${esc(date)}`,
    r.titles[0] ? `🎮 ${esc(r.games.join(', ') || '—')} · <i>${esc(r.titles.at(-1).title)}</i>` : '',
    `⏱ Durata: <b>${dur(r.durationMs)}</b>`,
    '',
    `👀 Spettatori in media: <b>${r.viewers.average}</b>${trend(r.compare?.averageViewers)}`,
    `📈 Massimo spettatori insieme: <b>${r.viewers.peak}</b>`,
    `⌛ Ore guardate in totale: <b>${r.viewers.hoursWatched}</b>`,
    '',
    `❤️ Nuovi follower: <b>${r.followers.gained ?? r.followers.names.length}</b>`,
    `⭐ Nuovi abbonati: <b>${r.subscribers.newSubs.length}</b> · rinnovi: <b>${r.subscribers.resubs.length}</b> · regalati: <b>${r.subscribers.gifted}</b>`,
    r.bits.total ? `💎 Bits: <b>${r.bits.total}</b>` : '',
    ...Object.entries(r.donations.totals).map(([cur, v]) => `💶 Donazioni: <b>${v} ${esc(cur)}</b>`),
    r.raids.length ? `🚀 Raid ricevuti: ${r.raids.map((x) => `${esc(x.name)} (${x.value})`).join(', ')}` : '',
    '',
    `💬 Messaggi in chat: <b>${r.chat.messages}</b> da <b>${r.chat.people}</b> persone`,
    r.chat.top.length ? `🏆 Più attivi: ${r.chat.top.slice(0, 3).map((c) => `${esc(c.name)} (${c.count})`).join(', ')}` : '',
  ];
  return lines.filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0)).join('\n').trim();
}
