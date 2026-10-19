/**
 * Collegamento con TwitchGestor (sullo stesso Raspberry): le live in programma stanno nella Programmazione
 * di TwitchGestor e Howl-UP le legge e le modifica da lì, così le due app non possono mai andare in disaccordo.
 * Howl-UP ricontrolla ogni 15 secondi; ogni modifica fatta da qui passa da TwitchGestor (che le mostra subito).
 */

import { cleanEntry, generateWeeks } from '../../src/core/schedule.js';

export function createTwitchLink({ port = 3000, token = '', onChange, log = () => {}, fetchFn = fetch } = {}) {
  const base = `http://127.0.0.1:${port}`;
  let state = { ok: false, entries: [], canPublish: false, error: 'Collegamento con TwitchGestor in corso…' };
  let sig = '';

  async function call(path, { method = 'GET', body } = {}) {
    const res = await fetchFn(base + path, {
      method,
      headers: { 'x-twitchgestor': '1', ...(token ? { 'x-dashboard-token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error ?? `TwitchGestor ha risposto ${res.status}`), { status: res.status === 401 ? 502 : res.status });
    return data;
  }

  function set(next) {
    const s = JSON.stringify([next.ok, next.entries, next.canPublish, next.error]);
    state = next;
    if (s !== sig) { sig = s; onChange?.(); }
  }

  async function refresh() {
    try {
      const r = await call('/api/schedule');
      set({ ok: true, entries: r.entries ?? [], canPublish: Boolean(r.canPublish), error: '' });
    } catch (err) {
      if (state.ok) log(`TwitchGestor non risponde: ${err.message}`);
      set({ ok: false, entries: state.entries, canPublish: false, error: 'TwitchGestor non risponde: le live mostrate potrebbero non essere aggiornate.' });
    }
    return state;
  }

  async function save(entries, touched = []) {
    const r = await call('/api/schedule', { method: 'PUT', body: { entries } });
    // le live già pubblicate sul calendario di Twitch si aggiornano anche lì
    const republish = (r.entries ?? []).filter((e) => touched.includes(e.id) && e.twitchId).map((e) => e.id);
    if (republish.length && r.canPublish) await call('/api/schedule/publish', { method: 'POST', body: { ids: republish } }).catch((err) => log(`Calendario di Twitch: ${err.message}`));
    set({ ok: true, entries: r.entries ?? [], canPublish: Boolean(r.canPublish), error: '' });
    return state;
  }

  return {
    get state() { return state; },
    refresh,

    /** Aggiunge o modifica una live (stesso id = modifica). */
    async saveLive(input) {
      const fresh = (await refresh()).ok ? state.entries : null;
      if (!fresh) throw Object.assign(new Error('TwitchGestor non risponde: riprova tra poco'), { status: 502 });
      const entry = cleanEntry(input);
      if (!entry) throw Object.assign(new Error('Servono giorno e ora della live'), { status: 400 });
      const old = fresh.find((e) => e.id === entry.id);
      const merged = old ? { ...old, ...entry, applied: old.applied, twitchId: old.twitchId } : entry;
      const list = old ? fresh.map((e) => (e.id === entry.id ? merged : e)) : [...fresh, merged];
      await save(list, [merged.id]);
      return merged;
    },

    async deleteLive(id) {
      if (!(await refresh()).ok) throw Object.assign(new Error('TwitchGestor non risponde: riprova tra poco'), { status: 502 });
      if (!state.entries.some((e) => e.id === id)) return false;
      await save(state.entries.filter((e) => e.id !== id));
      return true;
    },

    /** Più settimane in un colpo (giorni 1 = lunedì … 7 = domenica). */
    async addWeeks(opts) {
      if (!(await refresh()).ok) throw Object.assign(new Error('TwitchGestor non risponde: riprova tra poco'), { status: 502 });
      const added = generateWeeks(opts).filter(Boolean);
      if (!added.length) throw Object.assign(new Error('Nessuna live da creare con questi giorni'), { status: 400 });
      await save([...state.entries, ...added]);
      return added;
    },

    /** Categorie di Twitch (giochi) per il campo di ricerca. */
    categories: (q) => call(`/api/actions/categories?q=${encodeURIComponent(q)}`),
  };
}
