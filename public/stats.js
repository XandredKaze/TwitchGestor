// Scheda "Statistiche": l'andamento del canale nel tempo, spiegato in parole semplici.
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const C = window.TGCharts;
  let days = 90;
  let data = null;
  let loaded = false;

  const fmt = (n, d = 0) => (Number.isFinite(n) ? n.toLocaleString('it-IT', { maximumFractionDigits: d }) : '—');
  const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
  const dateShort = (ms) => new Date(ms).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const dateLong = (ms) => new Date(ms).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const WEEKDAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

  function tile(label, value, note, extra) {
    return el('div', { className: 'st-tile' },
      el('span', { className: 'st-label' }, label),
      el('b', { className: 'st-value' }, value),
      extra ? el('span', { className: 'st-extra' }, extra) : null,
      el('span', { className: 'st-note' }, note));
  }
  function card(title, explain, body) {
    return el('section', { className: 'panel st-card' }, el('h2', {}, title), el('p', { className: 'muted small st-explain' }, explain), body);
  }

  function render() {
    const box = $('trend-body');
    if (!data) { box.replaceChildren(el('p', { className: 'muted' }, 'Carico…')); return; }
    const { lives, daily } = data;
    if (!lives.length && daily.length < 2) {
      box.replaceChildren(el('section', { className: 'panel' }, el('h2', {}, 'Ancora niente da mostrare'),
        el('p', {}, 'Le statistiche si riempiono da sole: TwitchGestor segna follower e abbonati ogni giorno e, durante ogni live, quante persone ti guardano e quanto si scrive in chat. Torna qui dopo la prossima live.')));
      return;
    }
    const first = daily.find((d) => Number.isFinite(d.followers));
    const last = [...daily].reverse().find((d) => Number.isFinite(d.followers));
    const subsLast = [...daily].reverse().find((d) => Number.isFinite(d.subscribers));
    const hours = lives.reduce((s, l) => s + l.durationMs, 0) / 3600000;
    const avgViewers = avg(lives.map((l) => l.averageViewers));
    const best = [...lives].sort((a, b) => b.averageViewers - a.averageViewers)[0];

    const tiles = el('div', { className: 'st-tiles' },
      tile('Follower', fmt(last?.followers), 'Le persone che seguono il canale: ricevono un avviso quando vai in live.',
        first && last && first !== last ? `${last.followers - first.followers >= 0 ? '+' : ''}${fmt(last.followers - first.followers)} in questo periodo` : null),
      tile('Abbonati', fmt(subsLast?.subscribers), 'Chi paga un abbonamento mensile al canale (comprese le sub regalate).'),
      tile('Live fatte', fmt(lives.length), `In totale ${fmt(hours, 1)} ore in diretta.`, lives.length ? `in media ${dur((hours * 3600000) / lives.length)} l'una` : null),
      tile('Spettatori in media', fmt(avgViewers, 1), 'Quante persone, in media, guardavano la live in ogni momento. È il numero più importante per la crescita su Twitch.',
        best ? `migliore: ${fmt(best.averageViewers, 1)} il ${dateShort(best.startedAt)}` : null));

    // follower nel tempo
    const fBox = el('div');
    const fPoints = daily.filter((d) => Number.isFinite(d.followers)).map((d) => ({ x: Date.parse(`${d.date}T12:00:00`), y: d.followers, label: dateLong(Date.parse(`${d.date}T12:00:00`)) }));

    // spettatori per live: colonna = media, pallino = massimo
    const vBox = el('div');
    const vItems = lives.map((l) => ({
      label: dateLong(l.startedAt), short: dateShort(l.startedAt), value: l.averageViewers, value2: l.peakViewers,
      tip: `<b>${dateLong(l.startedAt)}</b><span>${l.game ? `${l.game} · ` : ''}${dur(l.durationMs)}</span><span>Media: <b>${fmt(l.averageViewers, 1)}</b> · Massimo: <b>${fmt(l.peakViewers)}</b></span>`,
    }));

    // giorni della settimana: media spettatori
    const byDay = WEEKDAYS.map((name, i) => {
      const ls = lives.filter((l) => (new Date(l.startedAt).getDay() + 6) % 7 === i);
      return { label: name, short: name.slice(0, 3), value: Math.round(avg(ls.map((l) => l.averageViewers)) * 10) / 10, count: ls.length };
    });
    const dBox = el('div');
    const bestDay = [...byDay].filter((d) => d.count).sort((a, b) => b.value - a.value)[0];

    // orario di inizio: fasce di 2 ore
    const SLOTS = [[6, 12, 'Mattina (6-12)'], [12, 16, 'Primo pomeriggio (12-16)'], [16, 19, 'Pomeriggio (16-19)'], [19, 22, 'Sera (19-22)'], [22, 30, 'Notte (22-6)']];
    const bySlot = SLOTS.map(([a, b, name]) => {
      const ls = lives.filter((l) => { const h = new Date(l.startedAt).getHours(); const hh = h < 6 ? h + 24 : h; return hh >= a && hh < b; });
      return { label: name, short: name.split(' (')[0], value: Math.round(avg(ls.map((l) => l.averageViewers)) * 10) / 10, count: ls.length };
    });
    const sBox = el('div');

    // categorie
    const games = new Map();
    for (const l of lives) {
      const g = games.get(l.game || '—') ?? { game: l.game || '—', lives: 0, ms: 0, viewers: [], followers: 0 };
      g.lives += 1; g.ms += l.durationMs; g.viewers.push(l.averageViewers); g.followers += Number(l.followersGained) || 0;
      games.set(g.game, g);
    }
    const gameTable = el('table', { className: 'st-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Categoria'), el('th', {}, 'Live'), el('th', {}, 'Ore'), el('th', {}, 'Spettatori in media'), el('th', {}, 'Nuovi follower'))),
      el('tbody', {}, ...[...games.values()].sort((a, b) => avg(b.viewers) - avg(a.viewers)).map((g) => el('tr', {},
        el('td', {}, g.game), el('td', {}, fmt(g.lives)), el('td', {}, fmt(g.ms / 3600000, 1)), el('td', {}, fmt(avg(g.viewers), 1)), el('td', {}, fmt(g.followers))))));

    const liveTable = el('table', { className: 'st-table' },
      el('thead', {}, el('tr', {}, ...['Data', 'Durata', 'Categoria', 'Spettatori in media', 'Massimo', 'Nuovi follower', 'Messaggi'].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...[...lives].reverse().map((l) => el('tr', {},
        el('td', {}, dateLong(l.startedAt)), el('td', {}, dur(l.durationMs)), el('td', {}, l.game || '—'),
        el('td', {}, fmt(l.averageViewers, 1)), el('td', {}, fmt(l.peakViewers)), el('td', {}, Number.isFinite(l.followersGained) ? fmt(l.followersGained) : '—'), el('td', {}, fmt(l.messages))))));

    box.replaceChildren(
      tiles,
      el('div', { className: 'st-grid' },
        card('Follower nel tempo', 'Quanti follower aveva il canale giorno per giorno. Se la linea sale, il canale sta crescendo.', fPoints.length > 1 ? fBox : el('p', { className: 'muted small' }, 'Servono almeno due giorni di dati.')),
        card('Spettatori in ogni live', 'La colonna è la media degli spettatori (quanti ti guardavano in ogni momento), il pallino è il massimo raggiunto.',
          el('div', {}, el('div', { className: 'st-legend' }, el('span', {}, el('i', { className: 'lg-bar' }), 'Media'), el('span', {}, el('i', { className: 'lg-dot' }), 'Massimo')), vBox)),
        card('Che giorno conviene?', bestDay ? `In media vai meglio di ${bestDay.label.toLowerCase()} (${fmt(bestDay.value, 1)} spettatori). I giorni senza colonna non hanno ancora live.` : 'Spettatori in media in base al giorno della settimana.', dBox),
        card('A che ora conviene?', 'Spettatori in media in base all\'ora in cui inizi la live.', sBox)),
      card('Per categoria', 'Come vanno le live in base al gioco o alla categoria scelta.', el('div', { className: 'st-scroll' }, gameTable)),
      card('Tutte le live del periodo', 'Gli stessi dati dei grafici, in tabella. Il riepilogo completo di ogni live è nella scheda 📋 Riepiloghi.', el('div', { className: 'st-scroll' }, liveTable)),
      el('details', { className: 'panel st-glossary' },
        el('summary', {}, 'Cosa vogliono dire questi numeri?'),
        el('dl', {},
          el('dt', {}, 'Spettatori in media'), el('dd', {}, 'Quante persone, in media, avevano la live aperta in ogni momento. Twitch lo usa per decidere quanto mostrare il tuo canale agli altri: è il dato più utile per capire se stai crescendo.'),
          el('dt', {}, 'Massimo spettatori'), el('dd', {}, 'Il numero più alto di persone collegate insieme durante la live (spesso dopo un raid).'),
          el('dt', {}, 'Ore guardate'), el('dd', {}, 'La somma del tempo passato da tutti a guardarti: 10 persone per 2 ore fanno 20 ore guardate.'),
          el('dt', {}, 'Follower'), el('dd', {}, 'Chi ha premuto "Segui": è gratis e riceve un avviso quando vai in live.'),
          el('dt', {}, 'Abbonati'), el('dd', {}, 'Chi sostiene il canale con un abbonamento mensile a pagamento, anche regalato da altri.'))));

    // i grafici si disegnano dopo, quando i riquadri hanno la loro larghezza
    requestAnimationFrame(() => {
      if (fPoints.length > 1) C.line(fBox, fPoints, { xLabel: dateShort, format: (v) => C.compact(v), unit: ' follower', zero: false });
      C.bars(vBox, vItems, { labelEvery: Math.ceil(vItems.length / 8) });
      C.bars(dBox, byDay.map((d) => ({ ...d, tip: `<b>${d.label}</b><span>${d.count ? `${fmt(d.value, 1)} spettatori in media · ${d.count} live` : 'nessuna live'}</span>` })));
      C.bars(sBox, bySlot.map((d) => ({ ...d, tip: `<b>${d.label}</b><span>${d.count ? `${fmt(d.value, 1)} spettatori in media · ${d.count} live` : 'nessuna live'}</span>` })));
    });
  }

  async function load() {
    loaded = true;
    data = null;
    render();
    data = await window.TG.api(`/api/stats?days=${days}`, { method: 'GET', quiet: true }) ?? { lives: [], daily: [] };
    render();
  }

  for (const b of document.querySelectorAll('#stats-range button')) {
    b.onclick = () => {
      days = Number(b.dataset.days);
      for (const x of document.querySelectorAll('#stats-range button')) x.classList.toggle('active', x === b);
      load();
    };
  }
  let resizeT = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (data && !$('tab-stats').hidden) render(); }, 250); });
  window.addEventListener('tg:stats', () => { if (loaded && !$('tab-stats').hidden) load(); });
  window.addEventListener('tab:stats', () => load());
  if (!$('tab-stats').hidden) load();
})();
