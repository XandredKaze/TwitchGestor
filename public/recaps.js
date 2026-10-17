// Scheda "Riepiloghi": il resoconto di ogni live finita, spiegato in modo semplice, e l'invio su Telegram.
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const C = window.TGCharts;
  let recaps = [];
  let selected = 0;
  let loaded = false;
  let liveNow = false;

  const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('it-IT', { maximumFractionDigits: d }) : '—');
  const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
  const time = (ms) => new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const dateLong = (ms) => new Date(ms).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dateShort = (ms) => new Date(ms).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

  /** Freccia del confronto con le live precedenti. */
  function trend(p, { unit = '%', invert = false } = {}) {
    if (p === null || p === undefined) return null;
    const up = p > 0;
    const good = invert ? !up : up;
    return el('span', { className: `rc-trend ${p === 0 ? '' : good ? 'up' : 'down'}`, title: 'Rispetto alla media delle live precedenti' },
      p === 0 ? '= come al solito' : `${up ? '▲ +' : '▼ '}${fmt(p, 1)}${unit} rispetto al solito`);
  }

  function metric(label, value, help, extra) {
    return el('div', { className: 'rc-metric' }, el('span', { className: 'rc-label' }, label), el('b', {}, value), extra, help ? el('span', { className: 'rc-help' }, help) : null);
  }
  const section = (title, ...children) => el('section', { className: 'rc-section' }, el('h3', {}, title), ...children);
  const names = (list, empty) => (list.length ? el('p', { className: 'rc-names' }, list.join(', ')) : el('p', { className: 'muted small' }, empty));

  /** La frase "in breve" all'inizio del riepilogo. */
  function summary(r) {
    const parts = [`Sei stato in live per ${dur(r.durationMs)}${r.games.length ? ` con ${r.games.join(' e ')}` : ''}.`];
    parts.push(`In media ti guardavano ${plural(r.viewers.average, 'persona', 'persone')}, con un massimo di ${fmt(r.viewers.peak)}${r.viewers.peakAt ? ` alle ${time(r.viewers.peakAt)}` : ''}.`);
    const growth = [];
    const f = r.followers.gained ?? r.followers.names.length;
    if (f) growth.push(plural(f, 'nuovo follower', 'nuovi follower'));
    const subs = r.subscribers.newSubs.length + r.subscribers.resubs.length + r.subscribers.gifted;
    if (subs) growth.push(plural(subs, 'abbonamento', 'abbonamenti'));
    if (r.bits.total) growth.push(`${fmt(r.bits.total)} bits`);
    for (const [cur, v] of Object.entries(r.donations.totals)) growth.push(`${fmt(v, 2)} ${cur} di donazioni`);
    if (growth.length) parts.push(`Hai ricevuto ${growth.join(', ').replace(/, ([^,]*)$/, ' e $1')}.`);
    if (r.raids.length) parts.push(`${plural(r.raids.length, 'canale ti ha', 'canali ti hanno')} mandato un raid.`);
    parts.push(`In chat sono stati scritti ${plural(r.chat.messages, 'messaggio', 'messaggi')} da ${plural(r.chat.people, 'persona', 'persone')}.`);
    return parts.join(' ');
  }

  function renderDetail() {
    const box = $('recap-detail');
    const r = recaps[selected];
    if (!r) { box.replaceChildren(); return; }
    const chartBox = el('div', { className: 'rc-chart' });
    const cmp = r.compare;
    box.replaceChildren(
      el('div', { className: 'rc-head' },
        el('h2', {}, dateLong(r.startedAt).replace(/^./, (c) => c.toUpperCase())),
        el('p', { className: 'muted' }, `dalle ${time(r.startedAt)} alle ${time(r.endedAt)} · ${dur(r.durationMs)}`)),
      el('p', { className: 'rc-summary' }, summary(r)),

      section('👀 Pubblico',
        el('div', { className: 'rc-metrics' },
          metric('Spettatori in media', fmt(r.viewers.average, 1), 'Quante persone avevano la live aperta in ogni momento, in media.', trend(cmp?.averageViewers)),
          metric('Massimo insieme', fmt(r.viewers.peak), r.viewers.peakAt ? `Raggiunto alle ${time(r.viewers.peakAt)}.` : null, trend(cmp?.peakViewers)),
          metric('Ore guardate', fmt(r.viewers.hoursWatched, 1), 'Il tempo totale passato da tutti a guardarti.'),
          metric('Durata', dur(r.durationMs), null, trend(cmp?.duration))),
        r.viewers.chart.length > 1 ? el('div', {}, el('p', { className: 'rc-label' }, 'Spettatori durante la live (il pallino è il massimo)'), chartBox) : null),

      section('❤️ Crescita',
        el('div', { className: 'rc-metrics' },
          metric('Nuovi follower', fmt(r.followers.gained ?? r.followers.names.length), 'Chi ha iniziato a seguire il canale durante la live.',
            cmp?.followersGained !== null && cmp?.followersGained !== undefined ? trend(cmp.followersGained, { unit: '' }) : null),
          metric('Follower totali', fmt(r.followers.total), 'Quanti follower ha il canale a fine live.'),
          metric('Abbonati totali', fmt(r.subscribers.total), 'Gli abbonamenti attivi a fine live.')),
        names(r.followers.names, 'I nomi dei nuovi follower di questa live non sono disponibili.')),

      section('⭐ Abbonamenti e supporto',
        el('div', { className: 'rc-metrics' },
          metric('Nuovi abbonati', fmt(r.subscribers.newSubs.length), 'Chi si è abbonato per la prima volta.'),
          metric('Rinnovi', fmt(r.subscribers.resubs.length), 'Chi ha rinnovato l\'abbonamento e lo ha annunciato in chat.'),
          metric('Abbonamenti regalati', fmt(r.subscribers.gifted), 'Abbonamenti comprati da qualcuno per altri spettatori.'),
          metric('Bits', fmt(r.bits.total), 'Piccole donazioni fatte con i "bits" di Twitch (100 bits ≈ 1 €).'),
          ...Object.entries(r.donations.totals).map(([cur, v]) => metric('Donazioni', `${fmt(v, 2)} ${cur}`, 'Arrivate da Ko-fi, StreamElements o altri servizi.')),
          metric('Premi riscattati', fmt(r.redemptions), 'Ricompense comprate con i punti canale.')),
        r.subscribers.newSubs.length ? el('p', { className: 'rc-names' }, el('b', {}, 'Nuovi abbonati: '), r.subscribers.newSubs.join(', ')) : null,
        r.subscribers.gifters.length ? el('p', { className: 'rc-names' }, el('b', {}, 'Hanno regalato: '), r.subscribers.gifters.map((g) => `${g.name} (${g.value})`).join(', ')) : null,
        r.bits.from.length ? el('p', { className: 'rc-names' }, el('b', {}, 'Bits da: '), r.bits.from.map((g) => `${g.name} (${fmt(g.value)})`).join(', ')) : null,
        r.donations.from.length ? el('p', { className: 'rc-names' }, el('b', {}, 'Donazioni da: '), r.donations.from.map((g) => `${g.name} (${fmt(g.value, 2)} ${g.currency ?? ''})`).join(', ')) : null),

      section('🚀 Raid ricevuti',
        r.raids.length
          ? el('ul', { className: 'rc-list' }, ...r.raids.map((x) => el('li', {}, el('b', {}, x.name), ` è arrivato con ${plural(x.value, 'spettatore', 'spettatori')}`)))
          : el('p', { className: 'muted small' }, 'Nessun raid: un raid è quando un altro streamer, a fine live, manda i suoi spettatori da te.')),

      section('💬 Chat',
        el('div', { className: 'rc-metrics' },
          metric('Messaggi', fmt(r.chat.messages), 'Quanti messaggi sono stati scritti (escluso il bot).', trend(cmp?.messages)),
          metric('Persone che hanno scritto', fmt(r.chat.people), 'Quanti spettatori diversi hanno scritto almeno un messaggio.')),
        r.chat.top.length ? el('ol', { className: 'rc-list' }, ...r.chat.top.map((c) => el('li', {}, el('b', {}, c.name), ` — ${plural(c.count, 'messaggio', 'messaggi')}`))) : null),

      section('🎮 Titoli e categorie',
        r.titles.length
          ? el('ul', { className: 'rc-list' }, ...r.titles.map((t, i) => el('li', {}, i ? el('span', { className: 'muted' }, `alle ${time(t.at)}: `) : null, t.title || '(senza titolo)', t.game ? el('span', { className: 'muted' }, ` · ${t.game}`) : null)))
          : el('p', { className: 'muted small' }, '—')),

      cmp ? el('p', { className: 'muted small' }, `Le frecce confrontano questa live con la media delle ${plural(cmp.lives, 'live precedente', 'live precedenti')}.`) : null);

    if (r.viewers.chart.length > 1) {
      const pts = r.viewers.chart.map(([t, v]) => ({ x: t, y: v, label: time(t) }));
      const peakIdx = pts.reduce((b, p, i) => (p.y > pts[b].y ? i : b), 0);
      requestAnimationFrame(() => C.line(chartBox, pts, { height: 180, xLabel: time, unit: ' spettatori', marker: peakIdx }));
    }
  }

  function renderList() {
    const list = $('recap-list');
    if (!recaps.length) {
      list.replaceChildren(el('p', { className: 'muted small' }, liveNow
        ? 'Sei in live adesso: il riepilogo sarà pronto qui appena finisci.'
        : 'Ancora nessun riepilogo. Alla fine di ogni live TwitchGestor prepara qui un resoconto completo.'));
      $('recap-detail').replaceChildren();
      return;
    }
    list.replaceChildren(
      ...(liveNow ? [el('p', { className: 'muted small rc-live' }, '🔴 In live adesso: il riepilogo arriva a fine diretta.')] : []),
      ...recaps.map((r, i) => el('button', {
        type: 'button', className: `rc-item ${i === selected ? 'active' : ''}`,
        onclick: () => { selected = i; renderList(); renderDetail(); },
      },
      el('b', {}, dateShort(r.startedAt)),
      el('span', {}, r.games.join(', ') || '—'),
      el('small', {}, `${dur(r.durationMs)} · ${fmt(r.viewers.average, 1)} spettatori in media`))));
    renderDetail();
  }

  // ---------- Telegram ----------
  let tg = null;
  function renderTelegram() {
    const box = $('recap-telegram');
    if (!tg) return;
    const token = el('input', { type: 'password', value: tg.token ?? '', placeholder: '123456789:ABC-def…', autocomplete: 'off' });
    const out = el('p', { className: 'muted small' });
    const save = async (patch) => {
      const r = await window.TG.api('/api/telegram', { method: 'PUT', body: { telegram: patch } });
      if (r) { tg = r.telegram; renderTelegram(); }
    };
    box.replaceChildren(
      el('label', { className: 'switch' }, el('input', { type: 'checkbox', checked: Boolean(tg.enabled), onchange: (e) => save({ enabled: e.target.checked }) }), 'Invia su Telegram'),
      el('details', { open: !tg.chatId || undefined },
        el('summary', {}, tg.chatId ? `Collegato a: ${tg.chatName || tg.chatId}` : 'Come si collega (una volta, gratis)'),
        el('ol', { className: 'rc-steps' },
          el('li', {}, 'Su Telegram scrivi a ', el('b', {}, '@BotFather'), ', invia ', el('code', {}, '/newbot'), ' e scegli un nome: ti dà un ', el('b', {}, 'token'), '.'),
          el('li', {}, 'Incolla qui il token: ', token, ' ', el('button', { type: 'button', className: 'small-btn', onclick: () => save({ token: token.value.trim() }) }, 'Salva')),
          el('li', {}, 'Apri il tuo nuovo bot su Telegram e scrivigli ', el('code', {}, '/start'), ' (o aggiungilo a un gruppo e scrivi lì).'),
          el('li', {}, el('button', {
            type: 'button', className: 'small-btn',
            onclick: async () => {
              out.textContent = 'Cerco…';
              const r = await window.TG.api('/api/telegram/find', { body: { token: token.value.trim() || tg.token } });
              if (r) { await save({ token: token.value.trim() || tg.token, chatId: r.chatId, chatName: r.name, enabled: true }); out.textContent = `✓ Trovata la chat "${r.name}".`; } else out.textContent = '';
            },
          }, '🔎 Trova la chat'), ' e poi ', el('button', {
            type: 'button', className: 'small-btn',
            onclick: async () => { if (await window.TG.api('/api/telegram/test', { body: {} })) out.textContent = '✓ Messaggio inviato: controlla Telegram.'; },
          }, '✉ Prova')))),
      el('label', { className: 'check' }, el('input', { type: 'checkbox', checked: tg.sendRecap !== false, onchange: (e) => save({ sendRecap: e.target.checked }) }), 'Riepilogo a fine live'),
      el('label', { className: 'check' }, el('input', { type: 'checkbox', checked: Boolean(tg.sendLiveStart), onchange: (e) => save({ sendLiveStart: e.target.checked }) }), 'Avviso quando inizi la live (titolo, categoria e link)'),
      out);
  }

  async function load() {
    loaded = true;
    const [r, cfg] = await Promise.all([
      window.TG.api('/api/recaps', { method: 'GET', quiet: true }),
      window.TG.api('/api/config', { method: 'GET', quiet: true }),
    ]);
    recaps = r?.recaps ?? [];
    liveNow = Boolean(r?.live);
    selected = Math.min(selected, Math.max(0, recaps.length - 1));
    tg = cfg?.config?.telegram ?? { enabled: false };
    renderList();
    renderTelegram();
  }

  window.addEventListener('tg:stats', () => { if (loaded && !$('tab-recaps').hidden) load(); });
  window.addEventListener('tab:recaps', () => load());
  if (!$('tab-recaps').hidden) load();
})();
