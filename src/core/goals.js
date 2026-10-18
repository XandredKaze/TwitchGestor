/**
 * Goal (obiettivi) da mostrare in OBS con la barra: follower, abbonati, bits o donazioni.
 * Follower e abbonati: il totale del canale (da Twitch) oppure solo i nuovi da quando azzeri.
 * Bits e donazioni: la somma da quando azzeri. Ogni goal si può correggere a mano (+/-).
 * Non dipende da Node: lo usa anche la versione demo nel browser.
 *
 * Chi usa questo modulo fornisce:
 *   getConfig()   elenco dei goal dalle impostazioni: [{ id, type, title, target, mode, showPercent }]
 *   store         { load(), save(data) } per i conteggi (data/goals.json)
 *   onChange()    i numeri sono cambiati (per la pagina in OBS e la dashboard)
 */

export const GOAL_TYPES = ['subs', 'followers', 'bits', 'donations'];
export const GOAL_TITLES = { subs: 'SUB GOAL', followers: 'FOLLOWER GOAL', bits: 'BITS GOAL', donations: 'DONATION GOAL' };

export class Goals {
  constructor({ getConfig, store, onChange, now = () => Date.now() } = {}) {
    Object.assign(this, { getConfig, store, onChange, now });
    this.totals = { followers: null, subs: null };
    this.state = {}; // id → { base, sum, adjust, resetAt }
    try { Object.assign(this.state, store?.load?.()?.goals ?? {}); } catch { /* prima volta */ }
  }

  get list() {
    return (this.getConfig?.() ?? []).filter((g) => g && GOAL_TYPES.includes(g.type));
  }

  #st(id) {
    this.state[id] ??= { base: null, sum: 0, adjust: 0, resetAt: this.now() };
    return this.state[id];
  }

  /** Valore attuale di un goal. */
  current(g) {
    const s = this.#st(g.id);
    if (g.type === 'followers' || g.type === 'subs') {
      const total = this.totals[g.type];
      if (total === null) return Math.max(0, s.adjust);
      if (g.mode === 'new') {
        if (s.base === null) { s.base = total; this.#save(); }
        return Math.max(0, total - s.base + s.adjust);
      }
      return Math.max(0, total + s.adjust);
    }
    return Math.max(0, Math.round((s.sum + s.adjust) * 100) / 100);
  }

  /** Quello che serve alla pagina in OBS e alla dashboard. */
  snapshot() {
    return this.list.map((g) => {
      const current = this.current(g);
      const target = Math.max(1, Number(g.target) || 1);
      return {
        id: g.id, type: g.type, title: g.title || GOAL_TITLES[g.type], target, current,
        percent: Math.min(100, Math.floor((current / target) * 100)),
        showPercent: g.showPercent !== false, mode: g.mode === 'new' ? 'new' : 'total',
        resetAt: this.state[g.id]?.resetAt ?? null, ready: g.type === 'bits' || g.type === 'donations' || this.totals[g.type] !== null,
      };
    });
  }

  /** Totali del canale letti da Twitch. */
  setTotals({ followers, subs } = {}) {
    let changed = false;
    for (const [k, v] of [['followers', followers], ['subs', subs]]) {
      if (Number.isFinite(v) && v !== this.totals[k]) { this.totals[k] = v; changed = true; }
    }
    if (changed) this.onChange?.();
  }

  /** Notifica arrivata: aggiorna subito i conteggi (i totali di Twitch li correggono poco dopo). */
  notification(n) {
    if (!n || n.test) return;
    let changed = false;
    const add = (type, amount) => {
      for (const g of this.list.filter((x) => x.type === type)) { this.#st(g.id).sum += amount; changed = true; }
    };
    if (n.type === 'cheer') add('bits', Number(n.amount) || 0);
    else if (n.type === 'donation') add('donations', Number(n.amount) || 0);
    else if (n.type === 'follow' && this.totals.followers !== null) { this.totals.followers += 1; changed = true; }
    else if ((n.type === 'sub' || n.type === 'giftsub') && this.totals.subs !== null) {
      this.totals.subs += n.type === 'giftsub' ? Math.max(1, Number(n.amount) || 1) : 1;
      changed = true;
    }
    if (changed) { this.#save(); this.onChange?.(); }
  }

  /** Ricomincia da zero (follower/abbonati "nuovi": da adesso; bits e donazioni: somma azzerata). */
  reset(id) {
    const g = this.list.find((x) => x.id === id);
    if (!g) return false;
    this.state[id] = { base: g.type === 'followers' || g.type === 'subs' ? this.totals[g.type] : null, sum: 0, adjust: 0, resetAt: this.now() };
    this.#save();
    this.onChange?.();
    return true;
  }

  /** Correzione a mano (es. +1 per un abbonamento fatto altrove). */
  adjust(id, delta) {
    const g = this.list.find((x) => x.id === id);
    const d = Number(delta);
    if (!g || !Number.isFinite(d)) return false;
    this.#st(id).adjust += d;
    this.#save();
    this.onChange?.();
    return true;
  }

  /** Toglie i conteggi dei goal che non esistono più. */
  prune() {
    const ids = new Set(this.list.map((g) => g.id));
    for (const id of Object.keys(this.state)) if (!ids.has(id)) delete this.state[id];
    this.#save();
  }

  #save() {
    try { this.store?.save?.({ goals: this.state }); } catch { /* non importante */ }
  }
}
