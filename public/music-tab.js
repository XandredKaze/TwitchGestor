// Scheda "Musica": cosa sta suonando, comandi, libreria, playlist, caricamento dei brani,
// cartella condivisa e volume più basso durante gli alert.
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => window.TG.api(path, opts);
  let data = null; // { playlists, tracks, player, pages, settings, share }
  let open = false;
  let search = '';
  let uploadFolder = '';

  const info = (name) => {
    const base = String(name).replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').trim();
    const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(base);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
  };
  const fill = (node, ...children) => node.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  const time = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

  async function load() {
    const r = await api('/api/music', { method: 'GET', quiet: true });
    if (r) { data = r; render(); }
  }

  async function cmd(action, body = {}) {
    const r = await api(`/api/music/${action}`, { body });
    if (r && data) {
      data.player = r.player;
      data.pages = r.pages;
      if (r.settings) data.settings = r.settings;
      render();
    }
  }

  function copyRow(label, url) {
    const btn = el('button', {
      type: 'button', className: 'small-btn',
      onclick: async () => {
        try { await navigator.clipboard.writeText(url); btn.textContent = 'Copiato!'; } catch { btn.textContent = 'Selezionalo e copialo'; }
        setTimeout(() => { btn.textContent = 'Copia'; }, 1500);
      },
    }, 'Copia');
    return el('div', { className: 'mu-url' }, el('span', { className: 'field-label' }, label), el('div', { className: 'mu-url-row' }, el('code', {}, url), btn));
  }

  // ---------- in riproduzione ----------
  function renderNow() {
    const p = data.player ?? {};
    const t = p.track;
    const progress = p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
    const select = el('select', {
      onchange: () => cmd('play', { playlist: select.value }),
      'aria-label': 'Playlist',
    }, ...data.playlists.map((pl) => el('option', { value: pl.id }, `${pl.name} (${pl.count})`)));
    select.value = p.playlist ?? '*';
    const vol = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round((p.volume ?? 0.6) * 100)), 'aria-label': 'Volume' });
    const volLabel = el('span', { className: 'mu-vol-val' }, `${vol.value}%`);
    let vt = 0;
    vol.oninput = () => {
      volLabel.textContent = `${vol.value}%`;
      clearTimeout(vt);
      vt = setTimeout(() => cmd('volume', { volume: Number(vol.value) / 100 }), 150);
    };
    const shuffle = el('input', { type: 'checkbox', checked: p.shuffle !== false, onchange: () => cmd('shuffle', { on: shuffle.checked }) });

    fill($('mu-now'), 
      !data.pages ? el('div', { className: 'mu-warn' },
        el('b', {}, '⚠ Nessun lettore collegato. '),
        'La musica la suona OBS: aggiungi la pagina /music come "Sorgente browser" (vedi "Aggiungi in OBS" qui accanto) e tieni OBS aperto.') : null,
      el('div', { className: 'mu-track' },
        el('div', { className: `mu-cover${p.playing ? ' on' : ''}`, 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i')),
        el('div', { className: 'mu-track-text' },
          el('span', { className: 'mu-label' }, t ? (p.playing ? 'In riproduzione' : 'In pausa') : 'Niente in riproduzione'),
          el('b', { className: 'mu-title' }, t ? t.title : data.tracks.length ? 'Premi ▶ per iniziare' : 'La libreria è vuota'),
          t?.artist ? el('span', { className: 'mu-artist' }, t.artist) : null,
          t?.folder ? el('span', { className: 'mu-folder' }, `Playlist: ${t.folder}`) : null)),
      el('div', { className: 'mu-progress' },
        el('span', {}, time(p.position)),
        el('div', { className: 'mu-bar' }, el('div', { style: { width: `${progress}%` } })),
        el('span', {}, time(p.duration))),
      el('div', { className: 'mu-controls' },
        el('button', { type: 'button', className: 'mu-btn', title: 'Brano precedente', 'aria-label': 'Brano precedente', onclick: () => cmd('prev') }, '⏮'),
        el('button', { type: 'button', className: 'mu-btn mu-play', title: p.playing ? 'Pausa' : 'Suona', 'aria-label': p.playing ? 'Pausa' : 'Suona', onclick: () => cmd('toggle') }, p.playing ? '⏸' : '▶'),
        el('button', { type: 'button', className: 'mu-btn', title: 'Brano successivo', 'aria-label': 'Brano successivo', onclick: () => cmd('next') }, '⏭')),
      el('div', { className: 'mu-options' },
        el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'Playlist'), select),
        el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'Volume'), el('div', { className: 'mu-vol' }, vol, volLabel)),
        el('label', { className: 'check' }, shuffle, ' Ordine casuale')),
      p.upNext?.length ? el('div', { className: 'mu-next' },
        el('span', { className: 'field-label' }, 'Prossimi brani'),
        el('ol', {}, ...p.upNext.map((x) => el('li', {}, el('b', {}, x.title), x.artist ? ` – ${x.artist}` : '')))) : null,
      el('p', { className: 'muted small' }, 'Gli spettatori possono scrivere ', el('code', {}, '!song'), ' se crei un comando con la variabile ', el('code', {}, '{song}'), ' (scheda Comandi).'),
    );
  }

  // ---------- libreria ----------
  function renderLibrary() {
    const q = search.trim().toLowerCase();
    const current = data.player?.track?.id;
    const list = data.tracks.filter((t) => !q || `${t.name} ${t.folder}`.toLowerCase().includes(q));
    if (!data.tracks.length) {
      fill($('mu-library'), el('p', { className: 'muted' },
        'Ancora nessun brano. Caricali con "Aggiungi brani" qui accanto oppure copiali nella cartella "music" (sul Raspberry: la cartella condivisa).'));
      return;
    }
    fill($('mu-library'), 
      el('p', { className: 'muted small' }, `${list.length} di ${data.tracks.length} brani · clicca un brano per farlo partire`),
      ...list.slice(0, 300).map((t) => {
        const i = info(t.name);
        return el('button', {
          type: 'button', className: `mu-item${t.id === current ? ' current' : ''}`,
          onclick: () => cmd('play', { trackId: t.id }),
        },
        el('span', { className: 'mu-item-icon', 'aria-hidden': 'true' }, t.id === current ? '♪' : '▶'),
        el('span', { className: 'mu-item-text' }, el('b', {}, i.title), i.artist ? el('small', {}, i.artist) : null),
        t.folder ? el('span', { className: 'sc-badge' }, t.folder) : null);
      }),
      list.length > 300 ? el('p', { className: 'muted small' }, 'Ne mostro 300: usa la ricerca per trovare gli altri.') : null,
    );
  }

  // ---------- OBS, caricamento, cartella condivisa, alert ----------
  function renderSide() {
    fill($('mu-obs'), 
      el('h2', {}, 'Aggiungi in OBS'),
      el('p', { className: 'muted small' }, 'In OBS: ➕ Sorgente → Browser. Per la musica spunta "Controlla l\'audio tramite OBS": così la senti nel mixer e va in live. La dimensione non conta (anche 1×1).'),
      copyRow('🎵 Lettore (audio)', window.TG.obsUrl('music')),
      copyRow('🖼 Riquadro "in riproduzione" (facoltativo, 500×120)', window.TG.obsUrl('music?widget')),
      copyRow('🖼 Riquadro in stile brutalista', window.TG.obsUrl('music?widget&style=brutal')),
      el('p', { className: 'muted small' }, 'Musica di cui hai i diritti, per esempio quella "DMCA free" o della Libreria audio di YouTube: la musica protetta può farti silenziare i VOD su Twitch.'),
    );

    const folders = data.playlists.filter((p) => p.id !== '*').map((p) => p.id);
    const folderSel = el('select', {}, el('option', { value: '' }, 'Nessuna (cartella principale)'), ...folders.map((f) => el('option', { value: f }, f)), el('option', { value: '__new' }, '➕ Nuova playlist…'));
    folderSel.value = folders.includes(uploadFolder) || uploadFolder === '' ? uploadFolder : '__new';
    const newName = el('input', { type: 'text', maxlength: '60', placeholder: 'Nome della nuova playlist (es. Chill)', value: folders.includes(uploadFolder) ? '' : uploadFolder, hidden: folderSel.value !== '__new' });
    folderSel.onchange = () => { newName.hidden = folderSel.value !== '__new'; uploadFolder = folderSel.value === '__new' ? newName.value : folderSel.value; };
    newName.oninput = () => { uploadFolder = newName.value; };
    const status = el('p', { className: 'muted small', 'aria-live': 'polite' });
    const file = el('input', {
      type: 'file', multiple: true, accept: '.mp3,.ogg,.wav,.m4a,.flac,.opus,audio/*',
      onchange: async () => {
        const files = [...file.files];
        const folder = folderSel.value === '__new' ? newName.value.trim() : folderSel.value;
        let ok = 0;
        for (const [n, f] of files.entries()) {
          status.textContent = `Carico ${n + 1} di ${files.length}: ${f.name}…`;
          const r = await api(`/api/music/upload?folder=${encodeURIComponent(folder)}`, { body: f, headers: { 'x-filename': encodeURIComponent(f.name) } });
          if (r) ok += 1;
        }
        status.textContent = `${ok} ${ok === 1 ? 'brano caricato' : 'brani caricati'}.`;
        file.value = '';
        load();
      },
    });
    fill($('mu-upload'), 
      el('h2', {}, 'Aggiungi brani'),
      el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'Nella playlist'), folderSel, newName),
      el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'File audio (mp3, ogg, m4a, flac, wav – massimo 30 MB l\'uno)'), file),
      status,
      el('p', { className: 'muted small' }, 'Il nome del file diventa il titolo: chiamalo "Artista - Titolo.mp3" e vedrai artista e titolo separati. Un brano mp3 occupa circa 3–5 MB: 500 brani stanno in 2–3 GB.'),
      el('button', { type: 'button', className: 'small-btn', onclick: async () => { await cmd('rescan'); load(); } }, '🔄 Aggiorna la libreria'),
      el('p', { className: 'muted small' }, 'I file copiati nella cartella compaiono da soli entro un minuto; il pulsante li cerca subito.'),
    );

    const s = data.share;
    fill($('mu-share'), 
      el('h2', {}, 'Cartella condivisa'),
      s ? el('div', { className: 'mu-share' },
        el('p', { className: 'small' }, 'Dal PC con Windows apri Esplora file, scrivi questo indirizzo nella barra in alto e premi Invio:'),
        copyRow('Indirizzo', s.path),
        el('p', { className: 'small' }, 'Se chiede le credenziali:'),
        copyRow('Nome utente', s.user),
        copyRow('Password', s.password || '(quella del Raspberry)'),
        el('p', { className: 'muted small' }, 'Spunta "Memorizza credenziali". Dentro trovi le cartelle music (musica, una sottocartella per playlist), images (immagini e video degli alert) e sounds (suoni). Consiglio: clic destro su "TwitchGestor" → "Connetti unità di rete" per averla sempre in Esplora file.'))
        : el('p', { className: 'muted small' }, 'La cartella condivisa in rete c\'è solo sul Raspberry (si attiva da sola con l\'aggiornamento). Su questo PC la cartella è data/media/music dentro la cartella di TwitchGestor.'),
    );

    const st = data.settings ?? {};
    const duck = el('input', { type: 'checkbox', checked: st.duck !== false });
    const level = el('input', { type: 'range', min: '0', max: '80', step: '5', value: String(Math.round((st.duckLevel ?? 0.3) * 100)) });
    const levelLabel = el('span', { className: 'mu-vol-val' }, `${level.value}%`);
    level.oninput = () => { levelLabel.textContent = `${level.value}%`; };
    level.onchange = () => cmd('settings', { duckLevel: Number(level.value) / 100 });
    duck.onchange = () => cmd('settings', { duck: duck.checked });
    fill($('mu-duck'), 
      el('h2', {}, 'Durante gli alert'),
      el('label', { className: 'check' }, duck, ' Abbassa la musica mentre è sullo schermo un alert (follow, sub, donazioni…)'),
      el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'Volume della musica durante l\'alert'), el('div', { className: 'mu-vol' }, level, levelLabel)),
      el('p', { className: 'muted small' }, '0% = la musica si ferma del tutto, 30% = si sente piano sotto il suono dell\'alert.'),
    );
  }

  function render() {
    if (!data || !open) return;
    renderNow();
    renderLibrary();
    renderSide();
  }

  $('mu-search').oninput = (e) => { search = e.target.value; if (data) renderLibrary(); };
  window.addEventListener('tab:music', () => { open = true; load(); });
  document.addEventListener('click', (e) => { if (e.target.closest?.('.tab') && !e.target.closest('[data-tab="music"]')) open = false; });
  window.addEventListener('tg:music', (e) => {
    if (!open || !data) return;
    if (e.detail.library) return load(); // brani aggiunti o tolti dalla cartella
    const changed = data.player?.track?.id !== e.detail.music?.track?.id;
    data.player = e.detail.music;
    // non ridisegnare mentre stai spostando il volume o scegliendo la playlist
    const busy = $('mu-now').contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
    if (!busy) renderNow();
    if (changed) renderLibrary();
  });
  window.addEventListener('tg:state', (e) => {
    if (!open || !data || e.detail?.musicPages === undefined || e.detail.musicPages === data.pages) return;
    data.pages = e.detail.musicPages;
    renderNow();
  });
})();
