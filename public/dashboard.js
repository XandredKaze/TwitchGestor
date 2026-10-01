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
    const cls = /^(connesso|attivo|simulato)$/.test(status) ? 'ok' : /disattivato/.test(status) ? '' : /connessione/.test(status) ? 'warn' : 'err';
    return el('span', { className: `pill ${cls}`, title: status }, `${label}: ${status}`);
  }

  // Tema della dashboard: subito quello ricordato (niente lampo), poi quello salvato nel programma.
  function applyUi(theme) {
    const t = theme === 'brutal' ? 'brutal' : 'default';
    if (document.documentElement.dataset.ui !== t) document.documentElement.dataset.ui = t;
    try { localStorage.setItem('uiTheme', t); } catch { /* ignora */ }
  }
  try { applyUi(localStorage.getItem('uiTheme')); } catch { /* ignora */ }

  // Per il tema Brutalism: "Twitch" e l'ultima parola dei titoli dei riquadri si colorano di lilla
  // (con il tema predefinito lo <span> non cambia nulla).
  function highlightLastWord(node) {
    const text = node.lastChild;
    if (!text || text.nodeType !== Node.TEXT_NODE || node.querySelector('.hl')) return;
    const m = /^(.*\s)?(\S+)\s*$/s.exec(text.textContent);
    if (!m) return;
    text.textContent = m[1] ?? '';
    node.append(el('span', { className: 'hl' }, m[2]));
  }
  const brand = document.querySelector('header h1');
  if (brand.firstChild?.nodeType === Node.TEXT_NODE && brand.firstChild.textContent === 'TwitchGestor') {
    brand.firstChild.replaceWith(el('span', {}, el('span', { className: 'hl' }, 'Twitch'), 'Gestor'));
  }
  document.querySelectorAll('.panel h2').forEach(highlightLastWord);

  // Altezza della barra in alto (fissa mentre scorri): serve ai riquadri "appiccicosi" dell'editor.
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty('--header-h', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`);
  }).observe(document.querySelector('header'));

  // Dimensione dei testi della dashboard (ricordata in questo browser).
  const applyZoom = (z) => { document.body.style.zoom = z; };
  try { const z = localStorage.getItem('uiZoom'); if (z) { $('ui-zoom').value = z; applyZoom(z); } } catch { /* ignora */ }
  $('ui-zoom').onchange = (e) => { applyZoom(e.target.value); try { localStorage.setItem('uiZoom', e.target.value); } catch { /* ignora */ } };

  function renderHeader() {
    window.TG.version = state.version ?? '(programma precedente alla 1.5)';
    $('app-version').textContent = state.version ? `v${state.version}` : '';
    const { twitch, sources, overlays } = state;
    $('statuses').replaceChildren(
      pill('Twitch', twitch.user ? twitch.status : 'non collegato'),
      pill('StreamElements', sources.streamelements),
      pill('Ko-fi', sources.kofi),
      pill('Webhook', sources.webhook),
      pill('Overlay aperti', overlays > 0 ? 'attivo' : 'nessuno'),
      state.obs ? pill('OBS', state.obs.enabled ? state.obs.status : 'disattivato') : null,
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
    // Programma vecchio acceso con pagine nuove (o file aggiornati dopo l'avvio): va riavviato.
    if (state.apiLevel !== window.TG.API_LEVEL || state.restartNeeded) {
      banners.push(el('div', { className: 'restart-banner' }, el('b', {}, '⚠️ Serve un riavvio di TwitchGestor. '),
        state.restartNeeded && state.apiLevel === window.TG.API_LEVEL
          ? 'Hai aggiornato i file del programma: le novità saranno attive dopo il riavvio. Clicca "⏻ Spegni" in alto a destra, poi riapri OBS (oppure "Avvia TwitchGestor.vbs") e ricarica la pagina con Ctrl+F5.'
          : window.TG.RESTART_HELP));
    }
    if (!twitch.configured) banners.push('Imposta TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET nel file .env e riavvia il programma.');
    else if (!twitch.user) banners.push('Collega il tuo account Twitch con il pulsante "Accedi con Twitch" in alto a destra.');
    if (twitch.missingScopes.length) banners.push(`Mancano dei permessi Twitch (${twitch.missingScopes.join(', ')}): esci e accedi di nuovo.`);
    for (const f of twitch.failedSubscriptions) banners.push(`Evento Twitch non attivo: ${f.type} — ${f.error}`);
    if (state.demo) {
      banners.unshift(el('div', { className: 'demo-banner' },
        el('span', {}, el('b', {}, 'Versione demo. '), 'Nessun collegamento a Twitch: gli eventi sono simulati e le impostazioni restano solo in questo browser.'),
        el('button', {
          className: state.demo.simulating ? '' : 'primary',
          onclick: () => window.TG.api('/api/demo/simulate', { body: { on: !state.demo.simulating } }),
        }, state.demo.simulating ? '⏹ Ferma la simulazione' : '▶ Simula una live')));
    }
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

  // ---------- Scene OBS (tramite OBS WebSocket) ----------

  let switching = '';

  function renderObs() {
    const obs = state.obs;
    $('obs-panel').hidden = !obs;
    if (!obs) return;
    const status = $('obs-status');
    const scenes = $('obs-scenes');
    if (!obs.enabled) {
      status.replaceChildren(el('p', { className: 'muted small' },
        'Collega OBS per cambiare scena da qui con un clic. ',
        el('a', { href: '#', onclick: (e) => { e.preventDefault(); toggleObsForm(true); } }, 'Configura il collegamento')));
      scenes.replaceChildren();
      return;
    }
    if (obs.status !== 'connesso') {
      status.replaceChildren(
        pill('OBS', obs.status),
        obs.error ? el('p', { className: 'obs-error' }, obs.error) : null,
        obs.status === 'non raggiungibile'
          ? el('p', { className: 'muted small' }, 'Riprovo da solo ogni pochi secondi. Controlla che OBS sia aperto e che in "Strumenti → Impostazioni server WebSocket" sia attivo il server.')
          : null);
      scenes.replaceChildren();
      return;
    }
    status.replaceChildren(state.demo ? el('p', { className: 'muted small' }, 'Demo: scene finte, nel programma vero vedi quelle del tuo OBS.') : '');
    if (!obs.scenes.length) {
      scenes.replaceChildren(el('p', { className: 'muted small' }, 'Nessuna scena in OBS.'));
      return;
    }
    scenes.replaceChildren(...obs.scenes.map((name) => el('button', {
      type: 'button',
      className: `${name === obs.current ? 'live' : ''} ${name === switching ? 'switching' : ''}`,
      title: name === obs.current ? 'Scena in onda' : `Passa alla scena "${name}"`,
      'aria-pressed': name === obs.current ? 'true' : 'false',
      onclick: async () => {
        if (name === state.obs.current || switching) return;
        switching = name;
        renderObs();
        const result = await window.TG.api('/api/obs/scene', { body: { scene: name } });
        switching = '';
        if (result) state.obs = result;
        renderObs();
      },
    }, name)));
  }

  function toggleObsForm(open = $('obs-form').hidden) {
    const form = $('obs-form');
    form.hidden = !open;
    if (!open) return;
    const obs = state.obs;
    const field = (label, input) => el('label', {}, label, input);
    const enabled = el('input', { type: 'checkbox', checked: true });
    const host = el('input', { type: 'text', value: obs.host, spellcheck: 'false' });
    const port = el('input', { type: 'number', min: '1', max: '65535', value: String(obs.port) });
    const password = el('input', { type: 'password', placeholder: obs.hasPassword ? '•••••• (salvata, lascia vuoto per non cambiarla)' : 'password di OBS WebSocket' });
    form.replaceChildren(
      el('ol', { className: 'muted small' },
        el('li', {}, 'In OBS apri ', el('b', {}, 'Strumenti → Impostazioni server WebSocket'), '.'),
        el('li', {}, 'Spunta ', el('b', {}, 'Abilita server WebSocket'), '.'),
        el('li', {}, 'Premi ', el('b', {}, 'Mostra informazioni di connessione'), ' e copia qui porta e password.')),
      el('label', { className: 'inline' }, enabled, 'Collega TwitchGestor a OBS'),
      el('div', { className: 'fields' }, field('Indirizzo (PC con OBS)', host), field('Porta', port)),
      field('Password', password),
      el('div', { className: 'buttons' },
        el('button', { type: 'submit', className: 'primary' }, '💾 Salva e collega'),
        obs.hasPassword ? el('button', {
          type: 'button',
          title: 'Da usare se in OBS hai disattivato l\'autenticazione',
          onclick: async () => { if (await window.TG.api('/api/obs/settings', { method: 'PUT', body: { clearPassword: true } })) toggleObsForm(false); },
        }, 'Togli password') : null,
        el('button', { type: 'button', onclick: () => toggleObsForm(false) }, 'Chiudi')),
      el('p', { className: 'muted small' }, 'Se OBS è su questo PC lascia 127.0.0.1. La password resta salvata solo sul tuo PC (data/obs.json).'));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = { enabled: enabled.checked, host: host.value.trim(), port: Number(port.value) };
      if (password.value) body.password = password.value;
      const result = await window.TG.api('/api/obs/settings', { method: 'PUT', body });
      if (!result) return;
      state.obs = result;
      toggleObsForm(false);
      renderObs();
    };
  }
  $('btn-obs-settings').onclick = () => toggleObsForm();

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

  function updateChatGrip() {
    $('chat-resize').hidden = !chatBox();
    fitChat();
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

  // Versione demo: al posto di player e chat di Twitch mostra l'overlay e una chat simulata.
  function renderDemoEmbeds() {
    $('stream-panel').querySelector('h2').textContent = 'Overlay (come in OBS)';
    $('chat-panel').querySelector('h2').textContent = 'Chat (simulata)';
    for (const id of ['stream-open', 'chat-popout', 'btn-stream-toggle', 'btn-chat-toggle', 'stream-channel']) $(id).hidden = true;
    if (embeddedChannel.stream !== 'demo') {
      embeddedChannel.stream = 'demo';
      $('stream-body').replaceChildren(
        el('div', { className: 'stream-frame demo-overlay' }, el('iframe', { src: state.overlayUrl, title: 'Overlay degli alert' })),
        el('p', { className: 'muted small' }, 'Qui vedi gli alert come li vedrebbero gli spettatori. Prova i pulsanti "Prova gli alert" o avvia la simulazione.'));
      new ResizeObserver(([entry]) => {
        const frame = entry.target.querySelector('iframe');
        if (frame) frame.style.transform = `scale(${entry.contentRect.width / 1920})`;
      }).observe($('stream-body').querySelector('.stream-frame'));
    }
    const lines = state.demo.chat;
    $('chat-body').replaceChildren(el('div', { className: 'demo-chat' },
      lines.length
        ? lines.map((m) => el('div', { className: m.bot ? 'bot' : '' }, el('b', {}, `${m.user}: `), m.text))
        : el('p', { className: 'muted small' }, 'Qui compaiono i messaggi della chat e i ringraziamenti del bot (attivali in "Personalizza alert → Impostazioni generali → Chat").')));
    const box = $('chat-body').firstChild;
    box.scrollTop = box.scrollHeight;
    updateChatGrip();
  }

  function renderEmbeds() {
    if (state.demo) {
      renderDemoEmbeds();
      return;
    }
    const login = channelLogin();
    $('stream-channel').textContent = login ? `twitch.tv/${login}` : '';
    for (const [id, url] of [['stream-open', `https://www.twitch.tv/${login}`], ['chat-popout', `https://www.twitch.tv/popout/${login}/chat?popout=`]]) {
      $(id).hidden = !login;
      $(id).href = url;
    }
    renderEmbed('stream');
    renderEmbed('chat');
    updateChatGrip();
  }

  // Statistiche: si possono nascondere (ricordato in questo browser).
  function renderStatsToggle() {
    const hidden = store.get('hide-stats') === '1';
    $('stats-body').hidden = hidden;
    $('btn-reset-stats').hidden = hidden;
    $('btn-stats-toggle').textContent = hidden ? 'Mostra' : 'Nascondi';
    $('stats-panel').classList.toggle('collapsed', hidden);
  }
  $('btn-stats-toggle').onclick = () => {
    store.set('hide-stats', store.get('hide-stats') === '1' ? '0' : '1');
    renderStatsToggle();
  };
  renderStatsToggle();

  // Altezza della chat: si trascina la maniglia sotto il riquadro (ricordata in questo browser).
  // Finché non la scegli, la chat si adatta alla finestra così il fondo resta visibile.
  const chatPanel = $('chat-panel');
  const chatBox = () => chatPanel.querySelector('.chat-frame, .demo-chat');
  const uiZoom = () => Number(document.body.style.zoom) || 1;
  const setChatHeight = (h) => chatPanel.style.setProperty('--chat-h', `${Math.round(Math.min(Math.max(h, 200), 4000))}px`);
  function fitChat() {
    const saved = Number(store.get('chatHeight'));
    if (saved) return setChatHeight(saved);
    const box = chatBox();
    if (!box) return;
    const z = uiZoom();
    const rect = box.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    // Spazio occupato sotto la chat (nota, maniglia, margini del riquadro) + un piccolo margine.
    const below = chatPanel.getBoundingClientRect().bottom - rect.bottom + 16 * z;
    // Se la chat inizia in basso (telefono, finestre strette): 3/4 dello schermo.
    setChatHeight(top < innerHeight * 0.6 ? (innerHeight - top - below) / z : (innerHeight / z) * 0.75);
  }
  window.addEventListener('resize', fitChat);
  $('ui-zoom').addEventListener('change', () => requestAnimationFrame(fitChat));
  (function chatResize() {
    const grip = $('chat-resize');
    const save = () => store.set('chatHeight', String(chatBox()?.offsetHeight ?? ''));
    let start = null;
    grip.addEventListener('pointerdown', (e) => {
      if (!chatBox()) return;
      e.preventDefault();
      start = { y: e.clientY, h: chatBox().offsetHeight };
      grip.setPointerCapture(e.pointerId);
      chatPanel.classList.add('resizing');
    });
    grip.addEventListener('pointermove', (e) => {
      if (start) setChatHeight(start.h + (e.clientY - start.y) / uiZoom());
    });
    const end = () => {
      if (!start) return;
      start = null;
      chatPanel.classList.remove('resizing');
      save();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', () => {
      store.set('chatHeight', '');
      fitChat();
    });
    grip.addEventListener('keydown', (e) => {
      const step = { ArrowUp: -40, ArrowDown: 40 }[e.key];
      if (!step || !chatBox()) return;
      e.preventDefault();
      setChatHeight(chatBox().offsetHeight + step);
      save();
    });
  })();

  for (const kind of ['stream', 'chat']) {
    $(`btn-${kind}-toggle`).onclick = () => {
      store.set(`hide-${kind}`, store.get(`hide-${kind}`) === '1' ? '0' : '1');
      renderEmbed(kind);
      updateChatGrip();
    };
  }

  function renderAll() {
    applyUi(state.ui?.theme);
    if (!$('tab-theme').hidden) renderThemes();
    renderHeader();
    renderQueue(state.queue);
    renderStats();
    renderFilters();
    renderFeed();
    renderObs();
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

  // ---------- Tema ----------

  const UI_THEMES = [
    { id: 'default', name: 'Predefinito', desc: 'Viola e sfumature, segue il tema chiaro o scuro di Windows.' },
    { id: 'brutal', name: 'Brutalism', desc: 'Nero carbone con grana, linee bianche sottili e lilla: finestre "// TITOLO" in stile retro-computer.' },
  ];
  const ROLL_THEMES = [
    { id: 'classic', name: 'Classico', desc: 'Elegante: titoli con linee luminose e i colori scelti nel pannello.' },
    { id: 'brutal', name: 'Brutalism', desc: 'Titoli delle sezioni come "▢ SUBSCRIBERS ────", titolo iniziale e testo finale a blocchi in bianco e lilla.' },
  ];
  let rollTheme = null;

  function themeCard(t, current, kind, onPick) {
    const active = t.id === current;
    const mock = el('div', { className: `theme-mock ${kind}-${t.id}`, 'aria-hidden': 'true' },
      kind === 'ui'
        ? [el('i', { className: 'm-bar' }), el('i', { className: 'm-card' }, el('i', { className: 'm-line' }), el('i', { className: 'm-btn' })), el('i', { className: 'm-card' }, el('i', { className: 'm-line' }), el('i', { className: 'm-line short' }))]
        : [el('i', { className: 'm-title' }), el('i', { className: 'm-name' }), el('i', { className: 'm-name' }), el('i', { className: 'm-name' })]);
    return el('button', {
      type: 'button',
      className: `theme-card ${active ? 'active' : ''}`,
      'aria-pressed': active ? 'true' : 'false',
      onclick: () => { if (!active) onPick(t.id); },
    }, mock,
    el('span', { className: 'theme-name' }, t.name, active ? el('span', { className: 'theme-badge' }, 'In uso') : null),
    el('span', { className: 'theme-desc' }, t.desc));
  }

  function renderThemes() {
    const ui = state?.ui?.theme ?? 'default';
    $('ui-themes').replaceChildren(...UI_THEMES.map((t) => themeCard(t, ui, 'ui', async (id) => {
      applyUi(id); // subito, senza aspettare il programma
      if (state) state.ui = { ...state.ui, theme: id };
      renderThemes();
      await window.TG.api('/api/ui', { method: 'PUT', body: { theme: id } });
    })));
    $('roll-themes').replaceChildren(...ROLL_THEMES.map((t) => themeCard(t, rollTheme ?? 'classic', 'roll', setRollTheme)));
  }

  // Lo stile dei titoli di coda sta nelle loro impostazioni (le stesse del pannello Titoli di coda).
  async function loadRollTheme() {
    const data = await window.TG.api('/api/credits/state', { method: 'GET', quiet: true });
    rollTheme = data?.state?.settings?.rollTheme ?? 'classic';
    renderThemes();
  }
  async function setRollTheme(id) {
    const data = await window.TG.api('/api/credits/state', { method: 'GET', quiet: true });
    const settings = { ...(data?.state?.settings ?? {}), rollTheme: id };
    rollTheme = id;
    renderThemes();
    await window.TG.api('/api/credits/state/settings', { method: 'PUT', body: settings });
  }

  function openThemeTab() {
    renderThemes();
    loadRollTheme();
    const frame = $('theme-roll-frame');
    if (!frame.src) {
      frame.src = `/credits?anteprima${token ? `&token=${encodeURIComponent(token)}` : ''}`;
      new ResizeObserver(([entry]) => { frame.style.transform = `scale(${entry.contentRect.width / 1920})`; }).observe(frame.parentElement);
    }
  }

  // ---------- Schede ----------
  function showTab(name) {
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
    for (const main of document.querySelectorAll('main[id^="tab-"]')) main.hidden = main.id !== `tab-${name}`;
    if (name === 'editor') window.dispatchEvent(new Event('editor:open'));
    if (name === 'theme') openThemeTab();
    if (name === 'credits' && !$('credits-frame').src) {
      // Il pannello dei titoli di coda è una pagina a sé: si carica solo quando apri la scheda.
      $('credits-frame').src = `/credits?pannello${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    }
    try { sessionStorage.setItem('tab', name); } catch { /* ignora */ }
  }
  for (const t of document.querySelectorAll('.tab')) t.onclick = () => showTab(t.dataset.tab);
  const creditsUrl = `${location.protocol}//${location.host}/credits`;
  $('credits-url').textContent = creditsUrl;
  $('btn-copy-credits').onclick = async () => {
    await navigator.clipboard.writeText(creditsUrl);
    $('btn-copy-credits').textContent = 'Copiato!';
    setTimeout(() => { $('btn-copy-credits').textContent = 'Copia'; }, 1500);
  };
  try {
    const saved = sessionStorage.getItem('tab');
    if (location.hash === '#chat') showTab('editor');
    else if (saved === 'editor' || saved === 'credits' || saved === 'theme') showTab(saved);
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
      if (msg.type === 'obs' && state) {
        state.obs = msg.obs;
        renderObs();
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
