/**
 * "Azioni rapide" come nel Gestore stream di Twitch: titolo e categoria, segnalibro, clip,
 * pubblicità, raid, shoutout, annuncio, sondaggi, pronostici e impostazioni della chat.
 * Tutto con le API ufficiali di Twitch (Helix) e l'account del canale.
 */

const AD_LENGTHS = [30, 60, 90, 120, 150, 180];
const ANNOUNCE_COLORS = ['primary', 'blue', 'green', 'orange', 'purple'];
const CHAT_MODES = {
  emote: 'emote_mode',
  followers: 'follower_mode',
  subscribers: 'subscriber_mode',
  slow: 'slow_mode',
  unique: 'unique_chat_mode',
};

// errori nostri (dati mancanti o sbagliati): il messaggio è già chiaro
const bad = (message) => Object.assign(new Error(message), { status: 400, local: true });
const str = (v, max, what) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw bad(`Manca ${what}`);
  return s.slice(0, max);
};
const int = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};
const login = (v) => {
  const s = str(v, 30, 'il nome del canale').replace(/^@/, '').toLowerCase();
  if (!/^\w{2,25}$/.test(s)) throw bad('Nome del canale non valido');
  return s;
};

/** Messaggi d'errore di Twitch tradotti in qualcosa di comprensibile. */
export function explainTwitchError(err) {
  const m = String(err?.message ?? '');
  if (err?.status === 401 || /scope|token/i.test(m)) return 'Manca un permesso Twitch: in alto a destra clicca "Esci" e poi "Accedi con Twitch".';
  if (/partner|affiliate/i.test(m)) return 'Twitch lo permette solo ai canali affiliate o partner.';
  if (/not live|offline|isn't live|is not streaming/i.test(m)) return 'Funziona solo mentre sei in live.';
  if (err?.status === 429) return 'Troppe richieste: aspetta qualche secondo e riprova.';
  return m || 'Errore di Twitch';
}

export function createQuickActions({ helix, getUser }) {
  const me = () => {
    const user = getUser();
    if (!user) throw Object.assign(new Error('Collega prima il tuo account Twitch'), { status: 409, local: true });
    return user.id;
  };
  const req = (method, url, body) => helix.request(method, url, body);
  const q = (params) => new URLSearchParams(params).toString();

  async function userIdOf(name) {
    const u = (await req('GET', `/users?${q({ login: name })}`)).data?.[0];
    if (!u) throw bad(`Il canale "${name}" non esiste`);
    return u;
  }

  /** Stato attuale: titolo/categoria, impostazioni della chat, scudo, sondaggio e pronostico in corso. */
  async function state() {
    const id = me();
    const part = async (fn) => {
      try { return { ok: true, value: await fn() }; } catch (err) { return { ok: false, error: explainTwitchError(err) }; }
    };
    const [channel, chat, shield, poll, prediction] = await Promise.all([
      part(async () => {
        const c = (await req('GET', `/channels?${q({ broadcaster_id: id })}`)).data?.[0] ?? {};
        return { title: c.title ?? '', gameId: c.game_id ?? '', gameName: c.game_name ?? '' };
      }),
      part(async () => {
        const s = (await req('GET', `/chat/settings?${q({ broadcaster_id: id, moderator_id: id })}`)).data?.[0] ?? {};
        return {
          emote: Boolean(s.emote_mode),
          followers: Boolean(s.follower_mode), followersMinutes: s.follower_mode_duration ?? 0,
          subscribers: Boolean(s.subscriber_mode),
          slow: Boolean(s.slow_mode), slowSeconds: s.slow_mode_wait_time ?? 30,
          unique: Boolean(s.unique_chat_mode),
        };
      }),
      part(async () => Boolean((await req('GET', `/moderation/shield_mode?${q({ broadcaster_id: id, moderator_id: id })}`)).data?.[0]?.is_active)),
      part(async () => {
        const p = (await req('GET', `/polls?${q({ broadcaster_id: id, first: 1 })}`)).data?.[0];
        if (!p || p.status !== 'ACTIVE') return null;
        return { id: p.id, title: p.title, endsAt: Date.parse(p.started_at) + p.duration * 1000, choices: p.choices.map((c) => ({ title: c.title, votes: c.votes })) };
      }),
      part(async () => {
        const p = (await req('GET', `/predictions?${q({ broadcaster_id: id, first: 1 })}`)).data?.[0];
        if (!p || !['ACTIVE', 'LOCKED'].includes(p.status)) return null;
        return {
          id: p.id, title: p.title, status: p.status, locksAt: Date.parse(p.created_at) + p.prediction_window * 1000,
          outcomes: p.outcomes.map((o) => ({ id: o.id, title: o.title, users: o.users, points: o.channel_points })),
        };
      }),
    ]);
    return { channel, chat, shield, poll, prediction };
  }

  const actions = {
    async categories({ query }) {
      const text = String(query ?? '').trim().slice(0, 60);
      if (!text) return { categories: [] };
      const data = (await req('GET', `/search/categories?${q({ query: text, first: 8 })}`)).data ?? [];
      return { categories: data.map((c) => ({ id: c.id, name: c.name, art: c.box_art_url?.replace('{width}x{height}', '52x72') })) };
    },
    async info({ title, gameId }) {
      const body = {};
      if (title !== undefined) body.title = str(title, 140, 'il titolo');
      if (gameId !== undefined) body.game_id = String(gameId).replace(/\D/g, '');
      if (!Object.keys(body).length) throw bad('Niente da cambiare');
      await req('PATCH', `/channels?${q({ broadcaster_id: me() })}`, body);
      return { message: 'Titolo e categoria aggiornati' };
    },
    async marker({ description }) {
      const desc = typeof description === 'string' ? description.trim().slice(0, 140) : '';
      await req('POST', '/streams/markers', { user_id: me(), ...(desc ? { description: desc } : {}) });
      return { message: 'Segnalibro aggiunto alla live' };
    },
    async clip() {
      const c = (await req('POST', `/clips?${q({ broadcaster_id: me() })}`)).data?.[0];
      return { message: 'Clip creata', url: c?.edit_url };
    },
    async ad({ length }) {
      const len = AD_LENGTHS.includes(Number(length)) ? Number(length) : 30;
      const r = (await req('POST', '/channels/commercial', { broadcaster_id: me(), length: len })).data?.[0];
      return { message: r?.message || `Pubblicità di ${r?.length ?? len} secondi avviata` };
    },
    async raid({ channel }) {
      const target = await userIdOf(login(channel));
      await req('POST', `/raids?${q({ from_broadcaster_id: me(), to_broadcaster_id: target.id })}`);
      return { message: `Raid verso ${target.display_name} in preparazione: parte da solo tra poco (o da Twitch con "Raid ora")`, raiding: target.display_name };
    },
    async cancelRaid() {
      await req('DELETE', `/raids?${q({ broadcaster_id: me() })}`);
      return { message: 'Raid annullato' };
    },
    async shoutout({ channel }) {
      const id = me();
      const target = await userIdOf(login(channel));
      await req('POST', `/chat/shoutouts?${q({ from_broadcaster_id: id, to_broadcaster_id: target.id, moderator_id: id })}`);
      return { message: `Shoutout a ${target.display_name} inviato` };
    },
    async announce({ message, color }) {
      const id = me();
      await req('POST', `/chat/announcements?${q({ broadcaster_id: id, moderator_id: id })}`, {
        message: str(message, 500, 'il testo dell\'annuncio'),
        color: ANNOUNCE_COLORS.includes(color) ? color : 'primary',
      });
      return { message: 'Annuncio pubblicato in chat' };
    },
    async poll({ title, choices, duration }) {
      const list = (Array.isArray(choices) ? choices : []).map((c) => String(c ?? '').trim().slice(0, 25)).filter(Boolean).slice(0, 5);
      if (list.length < 2) throw bad('Servono almeno 2 risposte');
      await req('POST', '/polls', {
        broadcaster_id: me(), title: str(title, 60, 'la domanda'),
        choices: list.map((t) => ({ title: t })), duration: int(duration, 15, 1800, 120),
      });
      return { message: 'Sondaggio avviato' };
    },
    async endPoll({ id }) {
      await req('PATCH', '/polls', { broadcaster_id: me(), id: str(id, 64, 'il sondaggio'), status: 'TERMINATED' });
      return { message: 'Sondaggio terminato' };
    },
    async prediction({ title, outcomes, window }) {
      const list = (Array.isArray(outcomes) ? outcomes : []).map((c) => String(c ?? '').trim().slice(0, 25)).filter(Boolean).slice(0, 10);
      if (list.length < 2) throw bad('Servono almeno 2 risultati');
      await req('POST', '/predictions', {
        broadcaster_id: me(), title: str(title, 45, 'la domanda'),
        outcomes: list.map((t) => ({ title: t })), prediction_window: int(window, 30, 1800, 120),
      });
      return { message: 'Pronostico avviato' };
    },
    async endPrediction({ id, status, winner }) {
      const s = ['LOCKED', 'RESOLVED', 'CANCELED'].includes(status) ? status : 'CANCELED';
      await req('PATCH', '/predictions', {
        broadcaster_id: me(), id: str(id, 64, 'il pronostico'), status: s,
        ...(s === 'RESOLVED' ? { winning_outcome_id: str(winner, 64, 'il risultato vincente') } : {}),
      });
      return { message: { LOCKED: 'Pronostico bloccato: niente più puntate', RESOLVED: 'Pronostico concluso: punti distribuiti', CANCELED: 'Pronostico annullato: punti restituiti' }[s] };
    },
    async chatMode({ mode, on, value }) {
      const key = CHAT_MODES[mode];
      if (!key) throw bad('Impostazione della chat sconosciuta');
      const id = me();
      const body = { [key]: Boolean(on) };
      if (on && mode === 'slow') body.slow_mode_wait_time = int(value, 3, 120, 30);
      if (on && mode === 'followers') body.follower_mode_duration = int(value, 0, 129600, 0);
      await req('PATCH', `/chat/settings?${q({ broadcaster_id: id, moderator_id: id })}`, body);
      return { message: 'Chat aggiornata' };
    },
    async shield({ on }) {
      const id = me();
      await req('PUT', `/moderation/shield_mode?${q({ broadcaster_id: id, moderator_id: id })}`, { is_active: Boolean(on) });
      return { message: on ? 'Modalità scudo attivata' : 'Modalità scudo disattivata' };
    },
    async clearChat() {
      const id = me();
      await req('DELETE', `/moderation/chat?${q({ broadcaster_id: id, moderator_id: id })}`);
      return { message: 'Chat svuotata' };
    },
  };

  async function run(name, params = {}) {
    const fn = Object.hasOwn(actions, name) ? actions[name] : null;
    if (!fn) throw Object.assign(new Error(`Azione sconosciuta: ${name}`), { status: 404 });
    try {
      return await fn(params ?? {});
    } catch (err) {
      if (err.local) throw err;
      throw Object.assign(new Error(explainTwitchError(err)), { status: err.status && err.status < 500 ? 400 : 502 });
    }
  }

  return { state, run };
}

/** Permessi Twitch necessari per le azioni rapide. */
export const QUICK_ACTION_SCOPES = [
  'channel:manage:broadcast', // titolo, categoria, segnalibri
  'clips:edit', // clip
  'channel:edit:commercial', // pubblicità
  'channel:manage:raids', // raid
  'moderator:manage:shoutouts', // shoutout
  'moderator:manage:announcements', // annunci
  'channel:manage:polls', // sondaggi
  'channel:manage:predictions', // pronostici
  'moderator:manage:chat_settings', // solo emote, solo follower, modalità lenta...
  'moderator:manage:shield_mode', // modalità scudo
  'moderator:manage:chat_messages', // svuota chat
];
