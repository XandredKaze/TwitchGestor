(function () {
  const { el, money, token: getToken } = window.TG;
  const token = getToken();
  const api = (path) => window.TG.api(path);
  const $ = (id) => document.getElementById(id);
  let state = null;
  let filter = 'all';
  let search = '';
  let shuttingDown = false;

  const SOURCE_LABELS = {
    twitch: 'Twitch', 'twitch-charity': 'Twitch Beneficenza', streamelements: 'StreamElements',
    kofi: 'Ko-fi', webhook: 'Webhook', test: 'Test',
  };

  function describe(n) {
    const who = n.user?.name ?? 'Anonimo';
    switch (n.type) {
      case 'follow': return `${who} ti segue`;
      case 'sub': return `${who} si è abbonato (Tier ${n.tier})${n.isGift ? ' — regalo' : ''}`;
      case 'resub': return `${who}: ${n.months} mesi (Tier ${n.tier})${n.streak ? `, serie ${n.streak}` : ''}`;
      case 'giftsub': return `${who} ha regalato ${n.amount} sub (Tier ${n.tier})`;
      case 'cheer': return `${who}: ${n.amount} bits`;
      case 'raid': return `Raid di ${who} con ${n.amount} spettatori`;
      case 'redemption': return `${who} ha riscattato "${n.reward?.title}" (${n.reward?.cost} punti)`;
      case 'donation': return `${who} ha donato ${money(n.amount, n.currency)}`;
      default: return who;
    }
  }

  // ---------- Rendering ----------

  function pill(label, status) {
    const cls = /^(connesso|attivo)$/.test(status) ? 'ok' : /disattivato/.test(status) ? '' : /connessione/.test(status) ? 'warn' : 'err';
    return el('span', { className: `pill ${cls}`, title: status }, `${label}: ${status}`);
  }

  function renderHeader() {
    const { twitch, sources, overlays } = state;
    $('statuses').replaceChildren(
      pill('Twitch', twitch.user ? twitch.status : 'non collegato'),
      pill('StreamElements', sources.streamelements),
      pill('Ko-fi', sources.kofi),
      pill('Webhook', sources.webhook),
      pill('Overlay aperti', overlays > 0 ? 'attivo' : 'nessuno'),
    );
    const account = $('account');
    if (twitch.user) {
      account.replaceChildren(
        el('span', {}, `👤 ${twitch.user.login}`),
        el('button', { className: 'small-btn', onclick: () => confirm('Scollegare l\'account Twitch?') && api('/api/auth/logout') }, 'Esci'),
      );
    } else if (twitch.configured) {
      account.replaceChildren(el('a', { className: 'btn primary', href: '/auth/login' }, 'Accedi con Twitch'));
    } else {
      account.replaceChildren();
    }

    const banners = [];
    if (!twitch.configured) banners.push('Imposta TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET nel file .env e riavvia il programma.');
    else if (!twitch.user) banners.push('Collega il tuo account Twitch con il pulsante "Accedi con Twitch" in alto a destra.');
    if (twitch.missingScopes.length) banners.push(`Mancano dei permessi Twitch (${twitch.missingScopes.join(', ')}): esci e accedi di nuovo.`);
    for (const f of twitch.failedSubscriptions) banners.push(`Evento Twitch non attivo: ${f.type} — ${f.error}`);
    $('banners').replaceChildren(...banners.map((b) => el('div', { className: 'banner' }, b)));
  }

  function renderQueue(queue) {
    const now = $('now-playing');
    if (queue.current) {
      now.style.borderLeftColor = queue.current.color;
      now.replaceChildren(el('strong', {}, queue.current.title), el('div', {}, queue.current.text));
    } else {
      now.style.borderLeftColor = '';
      now.textContent = queue.paused ? 'Coda in pausa' : 'Nessun alert in corso';
    }
    $('pending').textContent = queue.pending.length ? `${queue.pending.length} in attesa` : '';
    $('btn-pause').textContent = queue.paused ? '▶ Riprendi' : '⏸ Pausa';
  }

  function renderStats() {
    const { stats, types } = state;
    const c = stats.counts;
    const donations = Object.entries(stats.donations).map(([cur, v]) => money(v, cur)).join(' + ') || money(0, 'EUR');
    const cards = [
      ['follow', c.follow ?? 0, 'Follow'],
      ['sub', c.sub ?? 0, 'Nuovi abbonati'],
      ['resub', c.resub ?? 0, 'Rinnovi'],
      ['giftsub', stats.giftedSubs, 'Sub regalate'],
      ['cheer', stats.bits, 'Bits'],
      ['raid', c.raid ?? 0, 'Raid'],
      ['redemption', c.redemption ?? 0, 'Riscatti punti'],
      ['donation', donations, 'Donazioni'],
    ];
    $('stats').replaceChildren(...cards.map(([type, value, label]) => el('div', { className: 'stat', style: { '--c': types[type]?.color } },
      el('div', { className: 'value' }, String(value)),
      el('div', { className: 'label' }, label))));

    const donors = stats.topDonors;
    $('top-donors').replaceChildren(...(donors.length
      ? donors.map((d) => el('li', {}, `${d.name} — ${money(d.amount, d.currency)}`))
      : [el('li', { className: 'muted', style: { listStyle: 'none', marginLeft: '-22px' } }, 'Ancora nessuna donazione')]));
  }

  function renderFilters() {
    const entries = [['all', 'Tutte'], ...Object.entries(state.types).map(([k, v]) => [k, v.label])];
    $('filters').replaceChildren(...entries.map(([key, label]) => el('button', {
      className: `chip ${filter === key ? 'active' : ''}`,
      onclick: () => {
        filter = key;
        renderFilters();
        renderFeed();
      },
    }, label)));
  }

  function renderFeed() {
    const q = search.toLowerCase();
    const items = state.history.filter((n) => (filter === 'all' || n.type === filter)
      && (!q || `${n.user?.name ?? ''} ${n.message ?? ''} ${n.reward?.title ?? ''}`.toLowerCase().includes(q)));
    if (!items.length) {
      $('feed').replaceChildren(el('li', { className: 'empty', style: { display: 'block' } }, 'Nessuna notifica'));
      return;
    }
    $('feed').replaceChildren(...items.map((n) => {
      const type = state.types[n.type] ?? { label: n.type };
      const li = el('li', { className: n.alerted ? '' : 'skipped', style: { '--c': type.color } },
        el('div', { className: 'what' }, el('span', { className: 'tag' }, type.label), describe(n)),
        el('div', { className: 'actions' }, el('button', { className: 'small-btn', title: 'Mostra di nuovo sull\'overlay', onclick: () => api(`/api/replay/${encodeURIComponent(n.id)}`) }, '↻')),
        el('div', { className: 'meta' },
          `${new Date(n.timestamp).toLocaleString('it-IT')} · ${SOURCE_LABELS[n.source] ?? n.source}${n.skipReason ? ` · non mostrato: ${n.skipReason}` : ''}`),
        n.message ? el('div', { className: 'msg' }, n.message) : null);
      return li;
    }));
  }

  // ---------- Anteprima live e chat (embed ufficiali di Twitch) ----------

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignora */ } },
  };
  let embeddedChannel = { stream: null, chat: null };

  function channelLogin() {
    return state?.twitch.user?.login || store.get('channel') || '';
  }

  function channelForm() {
    const input = el('input', { type: 'text', placeholder: 'nome del canale', value: store.get('channel') ?? '' });
    return el('form', {
      className: 'channel-form',
      onsubmit: (e) => {
        e.preventDefault();
        store.set('channel', input.value.trim().toLowerCase());
        renderEmbeds();
      },
    }, input, el('button', { type: 'submit' }, 'Mostra'));
  }

  function embedBlocked() {
    // Twitch accetta gli embed solo se la pagina è aperta da "localhost" o da un sito https.
    const host = location.hostname;
    if (host === 'localhost' || location.protocol === 'https:') return null;
    const url = `${location.protocol}//localhost:${location.port}${location.pathname}`;
    return el('div', { className: 'embed-off' }, 'Twitch mostra l\'anteprima solo se apri la dashboard da ',
      el('a', { href: url }, url), '.');
  }

  function renderEmbed(kind) {
    const login = channelLogin();
    const hidden = store.get(`hide-${kind}`) === '1';
    const body = $(`${kind}-body`);
    $(`btn-${kind}-toggle`).textContent = hidden ? 'Mostra' : 'Nascondi';
    const key = hidden ? 'hidden' : login;
    if (embeddedChannel[kind] === key) return;
    embeddedChannel[kind] = key;

    if (hidden) {
      body.replaceChildren(el('div', { className: 'embed-off' }, kind === 'stream' ? 'Anteprima nascosta.' : 'Chat nascosta.'));
      return;
    }
    if (!login) {
      body.replaceChildren(el('div', { className: 'embed-off' },
        'Collega il tuo account Twitch, oppure scrivi il nome del canale:', channelForm()));
      return;
    }
    const blocked = embedBlocked();
    if (blocked) {
      body.replaceChildren(blocked);
      return;
    }
    const parent = encodeURIComponent(location.hostname);
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches ? '&darkpopout' : '';
    const src = kind === 'stream'
      ? `https://player.twitch.tv/?channel=${encodeURIComponent(login)}&parent=${parent}&muted=true&autoplay=true`
      : `https://www.twitch.tv/embed/${encodeURIComponent(login)}/chat?parent=${parent}${dark}`;
    body.replaceChildren(
      el('div', { className: kind === 'stream' ? 'stream-frame' : 'chat-frame' },
        el('iframe', { src, title: kind === 'stream' ? 'Anteprima della live' : 'Chat di Twitch', allowfullscreen: true, allow: 'autoplay; fullscreen' })),
      kind === 'stream'
        ? el('p', { className: 'muted small' }, 'Audio disattivato per non sentire l\'eco: attivalo dal player se ti serve. La live arriva con qualche secondo di ritardo.')
        : el('p', { className: 'muted small' }, 'Se non riesci a scrivere qui, usa "Finestra ↗".'));
  }

  function renderEmbeds() {
    const login = channelLogin();
    $('stream-channel').textContent = login ? `twitch.tv/${login}` : '';
    for (const [id, url] of [['stream-open', `https://www.twitch.tv/${login}`], ['chat-popout', `https://www.twitch.tv/popout/${login}/chat?popout=`]]) {
      $(id).hidden = !login;
      $(id).href = url;
    }
    renderEmbed('stream');
    renderEmbed('chat');
  }

  for (const kind of ['stream', 'chat']) {
    $(`btn-${kind}-toggle`).onclick = () => {
      store.set(`hide-${kind}`, store.get(`hide-${kind}`) === '1' ? '0' : '1');
      renderEmbed(kind);
    };
  }

  function renderAll() {
    renderHeader();
    renderQueue(state.queue);
    renderStats();
    renderFilters();
    renderFeed();
    $('overlay-url').textContent = state.overlayUrl;
    renderEmbeds();
  }

  function renderTestButtons() {
    $('test-buttons').replaceChildren(...Object.entries(state.types).map(([type, t]) =>
      el('button', { className: 'small-btn', onclick: () => api(`/api/test/${type}`) }, t.label)));
  }

  // ---------- Azioni ----------

  $('btn-pause').onclick = () => api(state?.queue.paused ? '/api/queue/resume' : '/api/queue/pause');
  $('btn-skip').onclick = () => api('/api/queue/skip');
  $('btn-clear').onclick = () => api('/api/queue/clear');
  $('btn-reset-stats').onclick = () => confirm('Azzerare le statistiche della sessione?') && api('/api/stats/reset');
  $('btn-copy').onclick = async () => {
    await navigator.clipboard.writeText(state.overlayUrl);
    $('btn-copy').textContent = 'Copiato!';
    setTimeout(() => { $('btn-copy').textContent = 'Copia'; }, 1500);
  };
  $('btn-shutdown').onclick = async () => {
    if (!confirm('Spegnere TwitchGestor? Gli alert smetteranno di arrivare finché non lo riavvii (o riapri OBS).')) return;
    if (await api('/api/shutdown')) {
      shuttingDown = true;
      document.body.replaceChildren(el('div', { className: 'bye' },
        el('h1', {}, '⏻ TwitchGestor è spento'),
        el('p', {}, 'Per riaccenderlo riapri OBS oppure fai doppio clic su "Avvia TwitchGestor".')));
    }
  };

  // ---------- Schede ----------
  function showTab(name) {
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
    $('tab-live').hidden = name !== 'live';
    $('tab-editor').hidden = name !== 'editor';
    if (name === 'editor') window.dispatchEvent(new Event('editor:open'));
    try { sessionStorage.setItem('tab', name); } catch { /* ignora */ }
  }
  for (const t of document.querySelectorAll('.tab')) t.onclick = () => showTab(t.dataset.tab);
  try {
    if (location.hash === '#chat' || sessionStorage.getItem('tab') === 'editor') showTab('editor');
  } catch { /* ignora */ }

  // ---------- Registro ----------
  async function refreshLogs() {
    if (!$('logs-panel').open || $('tab-live').hidden) return;
    const data = await window.TG.api('/api/logs', { method: 'GET', quiet: true });
    if (!data) return;
    const box = $('logs');
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20;
    box.replaceChildren(...data.logs.map((l) => el('div', { className: `log-${l.level}` }, l.line)));
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  $('logs-panel').addEventListener('toggle', refreshLogs);
  setInterval(refreshLogs, 4000);

  $('search').oninput = (e) => {
    search = e.target.value;
    if (state) renderFeed();
  };

  // ---------- Tempo reale ----------

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?role=dashboard${token ? `&token=${encodeURIComponent(token)}` : ''}`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') {
        const first = !state;
        state = msg.state;
        renderAll();
        if (first) renderTestButtons();
      }
      if (msg.type === 'queue' && state) {
        state.queue = msg.queue;
        renderQueue(msg.queue);
      }
    };
    ws.onclose = () => {
      if (shuttingDown) return;
      $('statuses').replaceChildren(pill('Programma', 'non raggiungibile'));
      setTimeout(connect, 2000);
    };
  }

  connect();
})();
