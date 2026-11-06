// Scheda "Musica", in tre parti:
//   🎵 Lettore: cosa sta suonando, comandi, playlist e libreria
//   ➕ Aggiungi brani: caricamento, Musicante e cartella condivisa
//   ⚙ Impostazioni: collegamento a OBS e volume più basso durante gli alert
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => window.TG.api(path, opts);
  let data = null; // { playlists, tracks, player, pages, settings, share }
  let open = false;
  let search = '';
  let uploadFolder = '';
  let view = 'player';
  let shown = null; // playlist che stai guardando nella libreria (null = quella che suona)
  // ✏ Organizza: selezione di più brani, spostare, rinominare, eliminare, riordinare per artista
  let organizing = false;
  const selected = new Set();
  let moveTo = '';
  let newPlaylist = '';
  let renaming = false;
  let plan = null; // anteprima del riordino per artista
  let working = false;

  const info = (name) => {
    const base = String(name).replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').trim();
    const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(base);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
  };
  const fill = (node, ...children) => node.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  const time = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

  // "🎧 Ascolta qui": per controllare la musica dalla dashboard senza OBS. Suona lo stesso brano, allo stesso
  // punto, solo su questo dispositivo (non va in live e non cambia niente nel lettore di OBS).
  let monitor = false;
  let monitorError = '';
  const monitorAudio = new Audio();
  monitorAudio.preload = 'auto';
  monitorAudio.onerror = () => { if (monitor) { monitorError = 'Il brano non si apre: il file potrebbe essere rovinato o in un formato che il browser non legge.'; renderNow(); } };
  const mediaUrl = (u) => (window.TG.token() ? `${u}${u.includes('?') ? '&' : '?'}token=${encodeURIComponent(window.TG.token())}` : u);
  function syncMonitor() {
    const p = data?.player ?? {};
    const track = p.track && data.tracks.find((x) => x.id === p.track.id);
    if (!monitor || !track) { monitorAudio.pause(); return; }
    // indirizzo del file (come lo usa il lettore in OBS): /media/music/<cartella>/<brano>
    const url = track.url || `/media/music/${String(track.id).split('/').map(encodeURIComponent).join('/')}`;
    const src = new URL(mediaUrl(url), location.href).href;
    if (monitorAudio.src !== src) { monitorError = ''; monitorAudio.src = src; monitorAudio.currentTime = p.position || 0; }
    else if (Math.abs((monitorAudio.currentTime || 0) - (p.position || 0)) > 3) monitorAudio.currentTime = p.position || 0;
    monitorAudio.volume = Math.min(1, Math.max(0, p.volume ?? 0.6));
    if (p.playing && monitorAudio.paused) monitorAudio.play().catch((err) => {
      if (err.name === 'AbortError') return; // cambio di brano mentre partiva
      monitorError = err.name === 'NotAllowedError' ? 'Il browser ha bloccato l\'audio: premi di nuovo 🎧.' : 'Il brano non si apre: il file manca, è rovinato o è in un formato che il browser non legge.';
      renderNow();
    });
    else if (!p.playing && !monitorAudio.paused) monitorAudio.pause();
  }

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

  // ---------- sottoschede ----------
  function showView(v) {
    view = ['player', 'add', 'settings'].includes(v) ? v : 'player';
    for (const b of document.querySelectorAll('#mu-subtabs button')) {
      b.classList.toggle('active', b.dataset.view === view);
      b.setAttribute('aria-selected', b.dataset.view === view ? 'true' : 'false');
    }
    for (const sec of document.querySelectorAll('#tab-music .mu-view')) sec.hidden = sec.dataset.view !== view;
    try { localStorage.setItem('muView', view); } catch { /* ignora */ }
  }
  for (const b of document.querySelectorAll('#mu-subtabs button')) b.onclick = () => showView(b.dataset.view);
  try { showView(localStorage.getItem('muView') || 'player'); } catch { showView('player'); }

  // ---------- lettore ----------
  function renderNow() {
    const p = data.player ?? {};
    const t = p.track;
    const progress = p.duration ? Math.min(100, (p.position / p.duration) * 100) : 0;
    const vol = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round((p.volume ?? 0.6) * 100)), 'aria-label': 'Volume' });
    const volLabel = el('span', { className: 'mu-vol-val' }, `${vol.value}%`);
    let vt = 0;
    vol.oninput = () => {
      volLabel.textContent = `${vol.value}%`;
      clearTimeout(vt);
      vt = setTimeout(() => cmd('volume', { volume: Number(vol.value) / 100 }), 150);
    };
    const shuffle = el('input', { type: 'checkbox', checked: p.shuffle !== false, onchange: () => cmd('shuffle', { on: shuffle.checked }) });
    const playlist = data.playlists.find((x) => x.id === (p.playlist ?? '*'));

    fill($('mu-now'),
      !data.pages ? el('div', { className: 'mu-warn mu-warn-row' },
        el('span', {}, el('b', {}, '⚠ Nessun lettore collegato: '), 'in live non si sente niente finché non aggiungi il lettore in OBS.'),
        el('button', { type: 'button', className: 'small-btn', onclick: () => showView('settings') }, 'Come si fa')) : null,
      el('div', { className: 'mu-player' },
        el('div', { className: 'mu-track' },
          el('div', { className: `mu-cover${p.playing ? ' on' : ''}`, 'aria-hidden': 'true' }, el('i'), el('i'), el('i'), el('i')),
          el('div', { className: 'mu-track-text' },
            el('span', { className: 'mu-label' }, t ? (p.playing ? 'In riproduzione' : 'In pausa') : 'Niente in riproduzione'),
            el('b', { className: 'mu-title' }, t ? t.title : data.tracks.length ? 'Premi ▶ per iniziare' : 'La libreria è vuota'),
            el('span', { className: 'mu-artist' }, [t?.artist, playlist ? `Playlist: ${playlist.name}` : null].filter(Boolean).join(' · ')))),
        el('div', { className: 'mu-controls' },
          el('button', { type: 'button', className: 'mu-btn', title: 'Brano precedente', 'aria-label': 'Brano precedente', onclick: () => cmd('prev') }, '⏮'),
          el('button', { type: 'button', className: 'mu-btn mu-play', title: p.playing ? 'Pausa' : 'Suona', 'aria-label': p.playing ? 'Pausa' : 'Suona', onclick: () => cmd('toggle') }, p.playing ? '⏸' : '▶'),
          el('button', { type: 'button', className: 'mu-btn', title: 'Brano successivo', 'aria-label': 'Brano successivo', onclick: () => cmd('next') }, '⏭'),
          el('button', {
            type: 'button', className: `mu-btn mu-listen${monitor ? ' on' : ''}`,
            title: monitor ? 'Smetti di ascoltare qui' : 'Ascolta qui la musica, per controllare che funzioni (solo su questo dispositivo, non va in live)',
            'aria-label': monitor ? 'Smetti di ascoltare qui' : 'Ascolta qui', 'aria-pressed': monitor ? 'true' : 'false',
            onclick: () => {
              monitor = !monitor;
              monitorError = '';
              // se non sta suonando, "Ascolta qui" fa anche partire la musica
              if (monitor && !p.playing && data.tracks.length) cmd('toggle');
              renderNow();
            },
          }, '🎧')),
        el('div', { className: 'mu-side-opts' },
          el('div', { className: 'mu-vol' }, el('span', { 'aria-hidden': 'true' }, '🔊'), vol, volLabel),
          el('label', { className: 'check' }, shuffle, ' Ordine casuale'))),
      el('div', { className: 'mu-progress' },
        el('span', {}, time(p.position)),
        el('div', { className: 'mu-bar' }, el('div', { style: { width: `${progress}%` } })),
        el('span', {}, time(p.duration))),
      monitor ? el('p', { className: `small ${monitorError ? 'mu-warn' : 'muted'}` }, monitorError
        || (t ? `🎧 Stai ascoltando qui "${t.title}": se lo senti, il file va bene. Solo su questo dispositivo, non va in live. ${data.pages ? 'In live la suona il lettore in OBS (collegato ✓).' : 'Attenzione: in OBS il lettore non è collegato, quindi in live non si sente.'}` : '🎧 Pronto: premi ▶ per sentire qui.')) : null,
      p.upNext?.length ? el('p', { className: 'mu-next small' },
        el('span', { className: 'muted' }, 'Dopo: '),
        ...p.upNext.slice(0, 3).flatMap((x, i) => [i ? el('span', { className: 'muted' }, ' · ') : null, el('b', {}, x.title)])) : null,
    );
    syncMonitor();
  }

  // ---------- playlist e libreria ----------
  function renderLibrary() {
    const playing = data.player?.playlist ?? '*';
    const sel = shown ?? playing;
    const pl = data.playlists.find((x) => x.id === sel) ?? data.playlists[0];
    fill($('mu-playlists'),
      el('h2', {}, 'Playlist'),
      el('div', { className: 'mu-pl-list' }, ...data.playlists.map((x) => el('button', {
        type: 'button', className: `mu-pl${x.id === pl?.id ? ' active' : ''}`,
        'aria-pressed': x.id === pl?.id ? 'true' : 'false', title: `${x.name} (doppio clic per suonarla)`,
        onclick: () => { shown = x.id; renderLibrary(); },
        ondblclick: () => { shown = null; cmd('play', { playlist: x.id }); }, // doppio clic: la suona subito
      },
      el('span', { className: 'mu-pl-name' }, x.id === playing ? el('span', { className: 'mu-pl-on', title: 'In riproduzione' }, '♪ ') : null, x.name),
      el('span', { className: 'mu-pl-count' }, String(x.count))))),
      el('button', { type: 'button', className: 'small-btn mu-pl-new', onclick: () => showView('add') }, '➕ Nuova playlist'));

    if (sorting) { renderSort(); return; }
    if (dups) { renderDups(); return; }
    const q = search.trim().toLowerCase();
    const current = data.player?.track?.id;
    const inList = data.tracks.filter((t) => !pl || pl.id === '*' || t.folder === pl.id);
    const list = inList.filter((t) => !q || `${t.name} ${t.folder}`.toLowerCase().includes(q));
    fill($('mu-lib-title'),
      renaming && pl && pl.id !== '*'
        ? renameForm(pl)
        : el('h2', {}, pl?.name ?? 'Libreria'),
      !organizing && pl && pl.id !== playing && pl.count ? el('button', { type: 'button', className: 'small-btn primary', onclick: () => { shown = null; cmd('play', { playlist: pl.id }); } }, '▶ Suona questa playlist') : null,
      !organizing && pl && pl.count ? el('button', { type: 'button', className: 'small-btn', title: 'Ascolta i brani uno alla volta e decidi dove metterli', onclick: () => startSort(pl) }, '🎧 Smista') : null,
      !organizing && data.tracks.length > 1 ? el('button', { type: 'button', className: 'small-btn', title: 'Cerca i brani doppi in tutta la musica', onclick: startDups }, '🔍 Doppioni') : null,
      data.tracks.length ? el('button', {
        type: 'button', className: `small-btn${organizing ? ' primary' : ''}`, 'aria-pressed': organizing ? 'true' : 'false',
        onclick: () => { organizing = !organizing; selected.clear(); plan = null; renaming = false; renderLibrary(); },
      }, organizing ? '✓ Fine' : '✏ Organizza') : null);
    if (!data.tracks.length) {
      fill($('mu-library'), el('div', { className: 'mu-empty' },
        el('p', {}, 'Ancora nessun brano.'),
        el('button', { type: 'button', className: 'primary', onclick: () => showView('add') }, '➕ Aggiungi brani')));
      return;
    }
    const shownIds = list.slice(0, 300).map((t) => t.id);
    for (const id of [...selected]) if (!data.tracks.some((t) => t.id === id)) selected.delete(id);
    fill($('mu-library'),
      organizing ? organizeBar(pl, shownIds) : null,
      organizing && plan ? planBox(pl) : null,
      el('p', { className: 'muted small' }, `${list.length} ${list.length === 1 ? 'brano' : 'brani'}${q ? ` trovati su ${inList.length}` : ''} · ${organizing ? 'clicca i brani per selezionarli' : 'clicca un brano per farlo partire'}`),
      ...list.slice(0, 300).map((t) => {
        const i = { ...info(t.name), ...(t.title ? { title: t.title } : {}), ...(t.artist ? { artist: t.artist } : {}) };
        const badge = pl?.id === '*' && t.folder ? el('span', { className: 'sc-badge' }, t.folder) : null;
        const text = el('span', { className: 'mu-item-text' }, el('b', {}, i.title), i.artist ? el('small', {}, i.artist) : null);
        if (organizing) {
          const box = el('input', { type: 'checkbox', checked: selected.has(t.id), onchange: () => { if (box.checked) selected.add(t.id); else selected.delete(t.id); renderLibrary(); } });
          return el('label', { className: `mu-item mu-pick${selected.has(t.id) ? ' picked' : ''}${t.id === current ? ' current' : ''}` }, box, text, badge);
        }
        return el('button', {
          type: 'button', className: `mu-item${t.id === current ? ' current' : ''}`,
          // il brano parte dentro la playlist che stai guardando (poi continua con i suoi brani, non con tutta la musica)
          onclick: () => { shown = null; cmd('play', { playlist: pl?.id ?? '*', trackId: t.id }); },
        },
        el('span', { className: 'mu-item-icon', 'aria-hidden': 'true' }, t.id === current ? '♪' : '▶'),
        text, badge);
      }),
      list.length > 300 ? el('p', { className: 'muted small' }, 'Ne mostro 300: usa la ricerca per trovare gli altri.') : null,
    );
  }

  // ---------- 🎧 smistamento: un brano alla volta, scegli dove va ----------
  // Si ascolta solo qui (non in live), partendo da circa un terzo del brano; tasti 1-9 = playlist,
  // Canc = elimina (nel cestino), → = salta, ↓/Invio = tieni qui, Z = annulla, F = +15 s, spazio = pausa.
  let sorting = null; // { from, name, queue: [id], i, history: [], note, newName, busy }
  const sortAudio = new Audio();
  sortAudio.preload = 'auto';
  sortAudio.onloadedmetadata = () => { if (sortAudio.duration > 60) sortAudio.currentTime = sortAudio.duration / 3; };
  sortAudio.ontimeupdate = () => { const t = document.getElementById('mu-sort-time'); if (t) t.textContent = `${time(sortAudio.currentTime)} / ${time(sortAudio.duration)}`; };
  sortAudio.onerror = () => { if (sorting) { sorting.note = 'Questo brano non si apre (file rovinato o formato non letto dal browser): eliminalo o saltalo.'; renderSort(); } };
  const sortTrack = () => (sorting ? data.tracks.find((t) => t.id === sorting.queue[sorting.i]) : null);
  const sortTargets = () => data.playlists.filter((x) => x.id !== '*' && x.id !== sorting.from);

  function startSort(pl) {
    const queue = data.tracks.filter((t) => pl.id === '*' || t.folder === pl.id).map((t) => t.id);
    sorting = { from: pl.id, name: pl.name, queue, i: 0, history: [], note: '', newName: '', busy: false };
    organizing = false;
    monitorAudio.pause();
    renderLibrary();
    sortPlay();
  }
  function stopSort() {
    sortAudio.pause();
    sortAudio.removeAttribute('src');
    sorting = null;
    load();
  }
  function sortPlay() {
    const t = sortTrack();
    if (!t) { sortAudio.pause(); renderSort(); return; }
    const url = t.url || `/media/music/${String(t.id).split('/').map(encodeURIComponent).join('/')}`;
    sortAudio.src = new URL(mediaUrl(url), location.href).href;
    sortAudio.play().catch((err) => { if (err.name === 'NotAllowedError' && sorting) { sorting.note = 'Il browser ha bloccato l\'audio: premi ▶.'; renderSort(); } });
    renderSort();
  }
  function sortNext() {
    sorting.i += 1;
    sorting.note = '';
    sortPlay();
    load(); // conteggi delle playlist aggiornati (lo smistamento resta dov'è)
  }
  async function sortCall(action, ids, folder) {
    sorting.busy = true;
    const r = await api(`/api/music/${action}`, { body: { ids, folder } });
    if (sorting) sorting.busy = false;
    if (r?.skipped?.length) { sorting.note = 'Questo brano sta suonando in live: resta dov\'è, spostalo quando è finito.'; renderSort(); return null; }
    return r;
  }
  async function sortTo(folder) {
    const t = sortTrack();
    if (!t || sorting.busy) return;
    if (folder === t.folder) { sortKeep(); return; }
    const r = await sortCall('move', [t.id], folder);
    if (!r) return;
    sorting.history.push({ id: t.id, at: r.to?.[t.id], from: t.folder, label: `→ ${folder || 'cartella principale'}` });
    sortNext();
  }
  async function sortTrash() {
    const t = sortTrack();
    if (!t || sorting.busy) return;
    const r = await sortCall('trash', [t.id]);
    if (!r) return;
    sorting.history.push({ id: t.id, at: r.to?.[t.id], from: t.folder, label: '🗑 eliminato' });
    sortNext();
  }
  function sortKeep() { if (sortTrack()) { sorting.history.push({ id: sorting.queue[sorting.i], label: '✓ tenuto' }); sortNext(); } }
  function sortSkip() { if (sortTrack()) { sorting.queue.push(sorting.queue[sorting.i]); sorting.queue.splice(sorting.i, 1); sorting.i -= 1; sortNext(); } }
  async function sortUndo() {
    const h = sorting?.history.pop();
    if (!h || sorting.busy) return;
    if (h.at) {
      const r = await sortCall('move', [h.at], h.from);
      if (!r) { sorting.history.push(h); return; }
      await load();
      sorting.queue[sorting.i - 1] = r.to?.[h.at] ?? h.id;
    }
    sorting.i -= 1;
    sorting.note = `Annullato (${h.label}).`;
    sortPlay();
  }
  async function sortNew(name) {
    const n = name.trim();
    if (!n) return;
    sorting.newName = '';
    await sortTo(n);
  }

  function renderSort() {
    if (!sorting || !data) return;
    const t = sortTrack();
    const done = sorting.i >= sorting.queue.length;
    fill($('mu-lib-title'),
      el('h2', {}, `🎧 Smisto: ${sorting.name}`),
      el('button', { type: 'button', className: 'small-btn primary', onclick: stopSort }, '✓ Fine'));
    if (done || !t) {
      const moved = sorting.history.filter((h) => h.at).length;
      fill($('mu-library'), el('div', { className: 'mu-sort' },
        el('p', {}, el('b', {}, 'Finito! '), `${sorting.queue.length} brani ascoltati, ${moved} spostati o eliminati.`),
        el('p', { className: 'muted small' }, 'I brani eliminati restano nel cestino per 30 giorni, poi spariscono da soli.'),
        el('div', { className: 'mu-sort-row' },
          sorting.history.length ? el('button', { type: 'button', className: 'small-btn', onclick: sortUndo }, '↩ Annulla l\'ultimo') : null,
          el('button', { type: 'button', className: 'small-btn primary', onclick: stopSort }, '✓ Fine'))));
      return;
    }
    const i = { ...info(t.name), ...(t.title ? { title: t.title } : {}), ...(t.artist ? { artist: t.artist } : {}) };
    const targets = sortTargets();
    const newInput = el('input', { type: 'text', maxlength: '60', placeholder: 'Nuova playlist…', value: sorting.newName, 'aria-label': 'Nome della nuova playlist',
      oninput: (e) => { sorting.newName = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); sortNew(e.target.value); } } });
    fill($('mu-library'), el('div', { className: 'mu-sort' },
      el('div', { className: 'mu-sort-head' },
        el('span', { className: 'muted small' }, `${sorting.i + 1} / ${sorting.queue.length}`),
        el('div', { className: 'mu-bar' }, el('div', { style: { width: `${Math.round((sorting.i / sorting.queue.length) * 100)}%` } }))),
      el('div', { className: 'mu-sort-track' },
        el('b', {}, i.title), i.artist ? el('span', { className: 'muted' }, i.artist) : null,
        el('span', { className: 'muted small', id: 'mu-sort-time' }, `${time(sortAudio.currentTime)} / ${time(sortAudio.duration)}`)),
      el('div', { className: 'mu-sort-row' },
        el('button', { type: 'button', className: 'small-btn', title: 'Pausa / suona (spazio)', onclick: () => (sortAudio.paused ? sortAudio.play().catch(() => {}) : sortAudio.pause()) }, '⏯'),
        el('button', { type: 'button', className: 'small-btn', title: 'Avanti di 15 secondi (F)', onclick: () => { sortAudio.currentTime = Math.min((sortAudio.duration || 0) - 1, sortAudio.currentTime + 15); } }, '⏩ +15 s'),
        el('button', { type: 'button', className: 'small-btn', title: 'Lascialo dov\'è (↓ o Invio)', onclick: sortKeep }, '✓ Tieni qui'),
        el('button', { type: 'button', className: 'small-btn', title: 'Decidi dopo: torna alla fine (→)', onclick: sortSkip }, '⏭ Salta'),
        el('button', { type: 'button', className: 'small-btn danger', title: 'Nel cestino (Canc)', onclick: sortTrash }, '🗑 Elimina'),
        el('button', { type: 'button', className: 'small-btn', title: 'Annulla l\'ultima scelta (Z)', disabled: !sorting.history.length, onclick: sortUndo }, '↩ Annulla')),
      el('p', { className: 'muted small' }, 'Dove va? Clicca una playlist (o premi il suo numero):'),
      el('div', { className: 'mu-sort-targets' },
        ...targets.map((x, n) => el('button', { type: 'button', className: 'mu-sort-target', title: x.name, disabled: sorting.busy, onclick: () => sortTo(x.id) },
          n < 9 ? el('kbd', {}, String(n + 1)) : null, el('span', {}, x.name), el('small', {}, String(x.count))))),
      el('div', { className: 'mu-sort-row' }, newInput, el('button', { type: 'button', className: 'small-btn primary', onclick: () => sortNew(newInput.value) }, '＋ Crea e sposta')),
      sorting.note ? el('p', { className: `small${sorting.note.startsWith('Annullato') ? ' muted' : ' mu-warn'}` }, sorting.note) : null,
      el('p', { className: 'muted small' }, 'Tasti: 1-9 playlist · ↓/Invio tieni · → salta · Canc elimina · Z annulla · F +15 s · spazio pausa')));
  }
  document.addEventListener('keydown', (e) => {
    if (!sorting || !open || view !== 'player' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const k = e.key;
    let used = true;
    if (/^[1-9]$/.test(k)) { const x = sortTargets()[Number(k) - 1]; if (x) sortTo(x.id); }
    else if (k === 'Delete' || k === 'Backspace') sortTrash();
    else if (k === 'ArrowRight') sortSkip();
    else if (k === 'ArrowDown' || k === 'Enter') sortKeep();
    else if (k === 'z' || k === 'Z') sortUndo();
    else if (k === 'f' || k === 'F') sortAudio.currentTime = Math.min((sortAudio.duration || 0) - 1, sortAudio.currentTime + 15);
    else if (k === ' ') { if (sortAudio.paused) sortAudio.play().catch(() => {}); else sortAudio.pause(); }
    else used = false;
    if (used) e.preventDefault();
  });

  // ---------- 🔍 doppioni ----------
  // identici = stesso file (copia); stesso brano = stesso artista e titolo (versioni diverse: decidi tu)
  let dups = null; // { groups, loading, playing, note }
  const dupAudio = new Audio();
  dupAudio.onended = () => { if (dups) { dups.playing = ''; renderDups(); } };
  async function startDups() {
    dups = { groups: [], loading: true, playing: '', note: '' };
    sortAudio.pause();
    renderLibrary();
    const r = await api('/api/music/duplicates', { method: 'GET' });
    if (!dups) return;
    dups.loading = false;
    dups.groups = r?.groups ?? [];
    renderDups();
  }
  function stopDups() { dupAudio.pause(); dups = null; load(); }
  function dupPlay(t) {
    if (dups.playing === t.id) { dupAudio.pause(); dups.playing = ''; renderDups(); return; }
    const url = t.url || `/media/music/${String(t.id).split('/').map(encodeURIComponent).join('/')}`;
    dupAudio.src = new URL(mediaUrl(url), location.href).href;
    dupAudio.onloadedmetadata = () => { if (dupAudio.duration > 60) dupAudio.currentTime = dupAudio.duration / 3; };
    dupAudio.play().catch(() => {});
    dups.playing = t.id;
    renderDups();
  }
  async function dupTrash(ids) {
    const r = await api('/api/music/trash', { body: { ids } });
    if (!r || !dups) return;
    const gone = new Set(Object.keys(r.to ?? {}));
    if (gone.has(dups.playing)) { dupAudio.pause(); dups.playing = ''; }
    for (const g of dups.groups) g.tracks = g.tracks.filter((t) => !gone.has(t.id));
    dups.groups = dups.groups.filter((g) => g.tracks.length > 1);
    dups.note = `${gone.size} ${gone.size === 1 ? 'brano spostato' : 'brani spostati'} nel cestino (si svuota da solo dopo 30 giorni).${r.skipped?.length ? ' Quello che suona in live è rimasto.' : ''}`;
    renderDups();
  }
  const mb = (n) => (n ? `${(n / 1048576).toFixed(1)} MB` : '');
  function renderDups() {
    if (!dups || !data) return;
    fill($('mu-lib-title'), el('h2', {}, '🔍 Doppioni'), el('button', { type: 'button', className: 'small-btn primary', onclick: stopDups }, '✓ Fine'));
    if (dups.loading) { fill($('mu-library'), el('p', { className: 'muted' }, 'Controllo tutta la musica…')); return; }
    const exact = dups.groups.filter((g) => g.kind === 'identici');
    const extra = exact.flatMap((g) => g.tracks.slice(1).map((t) => t.id));
    fill($('mu-library'), el('div', { className: 'mu-sort' },
      dups.groups.length
        ? el('p', {}, el('b', {}, `${dups.groups.length} ${dups.groups.length === 1 ? 'gruppo' : 'gruppi'} di doppioni. `),
          el('span', { className: 'muted small' }, '"Identici" sono copie dello stesso file; "stesso brano" ha artista e titolo uguali ma può essere una versione diversa: ascolta e decidi.'))
        : el('p', {}, '✓ Nessun doppione trovato.'),
      extra.length ? el('div', { className: 'mu-sort-row' },
        el('button', { type: 'button', className: 'small-btn danger', onclick: () => { if (confirm(`Spostare nel cestino ${extra.length} copie identiche (ne resta una per gruppo)?`)) dupTrash(extra); } },
          `🗑 Togli tutte le copie identiche (${extra.length})`)) : null,
      dups.note ? el('p', { className: 'small muted' }, dups.note) : null,
      ...dups.groups.slice(0, 200).map((g) => el('div', { className: 'mu-dup' },
        el('span', { className: `sc-badge${g.kind === 'identici' ? '' : ' mu-dup-maybe'}` }, g.kind),
        ...g.tracks.map((t) => {
          const i = { ...info(t.name), ...(t.title ? { title: t.title } : {}), ...(t.artist ? { artist: t.artist } : {}) };
          return el('div', { className: 'mu-dup-row' },
            el('button', { type: 'button', className: 'small-btn', title: 'Ascolta (solo qui)', onclick: () => dupPlay(t) }, dups.playing === t.id ? '⏸' : '▶'),
            el('span', { className: 'mu-item-text' }, el('b', {}, i.title), el('small', {}, [i.artist, `📁 ${t.folder || 'principale'}`, mb(t.size)].filter(Boolean).join(' · '))),
            el('button', { type: 'button', className: 'small-btn danger', title: 'Nel cestino', onclick: () => dupTrash([t.id]) }, '🗑'));
        }))),
      dups.groups.length > 200 ? el('p', { className: 'muted small' }, 'Ne mostro 200: togli questi e ricontrolla.') : null));
  }

  // ---------- organizza ----------
  async function organizeCall(action, body) {
    working = true;
    renderLibrary();
    const r = await api(`/api/music/${action}`, { body });
    working = false;
    if (r?.skipped?.length) alert(`Il brano che sta suonando è rimasto dov'era (OBS lo sta leggendo): spostalo quando è finito.`);
    return r;
  }
  function renameForm(pl) {
    const input = el('input', { type: 'text', maxlength: '60', value: pl.name, 'aria-label': 'Nuovo nome della playlist' });
    setTimeout(() => { input.focus(); input.select(); }, 0);
    return el('form', {
      className: 'mu-inline',
      onsubmit: async (e) => {
        e.preventDefault();
        const to = input.value.trim();
        if (!to || to === pl.name) { renaming = false; renderLibrary(); return; }
        const r = await organizeCall('rename-playlist', { from: pl.id, to });
        renaming = false;
        if (r) { shown = to; await load(); } else renderLibrary();
      },
    }, input,
    el('button', { type: 'submit', className: 'small-btn primary' }, 'Rinomina'),
    el('button', { type: 'button', className: 'small-btn', 'aria-label': 'Annulla', onclick: () => { renaming = false; renderLibrary(); } }, '✕'));
  }
  function organizeBar(pl, shownIds) {
    const folders = data.playlists.filter((p) => p.id !== '*').map((p) => p.id);
    const all = shownIds.length && shownIds.every((id) => selected.has(id));
    const allBox = el('input', { type: 'checkbox', checked: all, onchange: () => { for (const id of shownIds) { if (allBox.checked) selected.add(id); else selected.delete(id); } renderLibrary(); } });
    const target = el('select', { 'aria-label': 'Sposta nella playlist' },
      el('option', { value: '' }, 'Sposta in…'),
      ...folders.filter((f) => f !== pl?.id).map((f) => el('option', { value: f, selected: f === moveTo }, f)),
      el('option', { value: '__new', selected: moveTo === '__new' }, '➕ Nuova playlist…'));
    target.onchange = () => { moveTo = target.value; renderLibrary(); if (moveTo === '__new') $('mu-library').querySelector('.mu-org input[type=text]')?.focus(); };
    const n = selected.size;
    const canMove = () => !working && n && moveTo && (moveTo !== '__new' || newPlaylist.trim());
    const newName = moveTo === '__new' ? el('input', { type: 'text', maxlength: '60', placeholder: 'Nome (es. Chill)', value: newPlaylist, oninput: (e) => { newPlaylist = e.target.value; moveBtn.disabled = !canMove(); }, 'aria-label': 'Nome della nuova playlist' }) : null;
    const moveBtn = el('button', {
      type: 'button', className: 'small-btn primary', disabled: !canMove(),
      onclick: async () => {
        const folder = moveTo === '__new' ? newPlaylist.trim() : moveTo;
        const r = await organizeCall('move', { ids: [...selected], folder });
        if (r) { selected.clear(); moveTo = ''; newPlaylist = ''; await load(); }
      },
    }, 'Sposta');
    return el('div', { className: 'mu-org' },
      el('div', { className: 'mu-org-row' },
        el('label', { className: 'check' }, allBox, ` Seleziona tutti (${shownIds.length})`),
        el('b', { className: 'small' }, n ? `${n} ${n === 1 ? 'selezionato' : 'selezionati'}` : 'Nessuno selezionato')),
      el('div', { className: 'mu-org-row' },
        target, newName, moveBtn,
        el('button', {
          type: 'button', className: 'small-btn danger', disabled: working || !n,
          onclick: async () => {
            if (!confirm(`Eliminare ${n === 1 ? 'il brano selezionato' : `${n} brani`}? I file vengono cancellati dal Raspberry.`)) return;
            const r = await organizeCall('delete', { ids: [...selected] });
            if (r) { selected.clear(); await load(); }
          },
        }, '🗑 Elimina')),
      el('div', { className: 'mu-org-row' },
        el('button', {
          type: 'button', className: 'small-btn', disabled: working,
          onclick: async () => { plan = await organizeCall('organize-preview', { folder: pl?.id ?? '*' }); renderLibrary(); },
        }, `🪄 Riordina per artista${pl && pl.id !== '*' ? ` (solo "${pl.name}")` : ''}`),
        pl && pl.id !== '*' ? el('button', { type: 'button', className: 'small-btn', disabled: working, onclick: () => { renaming = true; renderLibrary(); } }, '✏ Rinomina playlist') : null));
  }
  function planBox(pl) {
    const moving = plan.groups.reduce((s, g) => s + g.count, 0);
    if (!moving) {
      return el('div', { className: 'mu-plan' }, el('p', { className: 'small' }, '✓ Già in ordine: ogni brano è nella playlist del suo artista.'),
        el('button', { type: 'button', className: 'small-btn', onclick: () => { plan = null; renderLibrary(); } }, 'OK'));
    }
    return el('div', { className: 'mu-plan' },
      el('p', { className: 'small' }, el('b', {}, `Sposto ${moving} ${moving === 1 ? 'brano' : 'brani'} in ${plan.groups.length} ${plan.groups.length === 1 ? 'playlist' : 'playlist'}:`),
        ' ogni artista con almeno 2 brani ha la sua playlist, gli altri vanno in "Varie". L\'artista si legge dai dati del file o dal nome "Artista - Titolo".'),
      el('div', { className: 'mu-plan-groups' }, ...plan.groups.map((g) => el('span', { className: 'sc-badge' }, `${g.folder} · ${g.count}`))),
      el('div', { className: 'mu-org-row' },
        el('button', {
          type: 'button', className: 'small-btn primary', disabled: working,
          onclick: async () => {
            const r = await organizeCall('organize', { folder: pl?.id ?? '*' });
            plan = null;
            if (r) { shown = '*'; await load(); alert(`Fatto: ${r.moved} ${r.moved === 1 ? 'brano spostato' : 'brani spostati'}. Ora puoi spostare a mano quelli che vuoi in altre playlist.`); }
          },
        }, 'Riordina'),
        el('button', { type: 'button', className: 'small-btn', onclick: () => { plan = null; renderLibrary(); } }, 'Annulla')));
  }

  // ---------- aggiungi brani ----------
  function renderAdd() {
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
      el('h2', {}, 'Carica dal computer'),
      el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'Nella playlist'), folderSel, newName),
      el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'File audio (mp3, ogg, m4a, flac, wav – massimo 30 MB l\'uno)'), file),
      status,
      el('p', { className: 'muted small' }, 'Il nome del file diventa il titolo: chiamalo "Artista - Titolo.mp3" e vedrai artista e titolo separati.'),
      el('div', { className: 'mu-rescan' },
        el('button', { type: 'button', className: 'small-btn', onclick: async () => { await cmd('rescan'); load(); } }, '🔄 Aggiorna la libreria'),
        el('span', { className: 'muted small' }, 'I file copiati nella cartella compaiono da soli entro un minuto.')),
      el('p', { className: 'muted small' }, 'Usa musica di cui hai i diritti (per esempio "DMCA free" o della Libreria audio di YouTube): la musica protetta può farti silenziare i VOD su Twitch.'),
    );

    // Musicante (sul Raspberry, porta 3200): scarica in MP3 da un link direttamente in queste playlist
    const managed = window.TG.managed?.();
    $('mu-musicante').hidden = !managed;
    if (managed) {
      fill($('mu-musicante'),
        el('h2', {}, 'Scarica da un link'),
        el('p', { className: 'small' }, 'Con Musicante incolli un link (YouTube e altri siti, anche playlist intere) e i brani arrivano in MP3 direttamente in queste playlist.'),
        el('a', { className: 'btn primary', href: `http://${location.hostname}:3200/${window.TG.token() ? `?token=${encodeURIComponent(window.TG.token())}` : ''}`, target: '_blank', rel: 'noopener' }, '⬇ Apri Musicante ↗'));
    }

    const s = data.share;
    fill($('mu-share'),
      el('h2', {}, 'Cartella condivisa'),
      s ? el('div', { className: 'mu-share' },
        el('p', { className: 'small' }, 'Per copiare tanti brani insieme: dal PC apri Esplora file, scrivi questo indirizzo nella barra in alto e premi Invio.'),
        copyRow('Indirizzo', s.path),
        copyRow('Nome utente', s.user),
        copyRow('Password', s.password || '(quella del Raspberry)'),
        window.TG.shareCheck(s.check),
        el('p', { className: 'muted small' }, 'Spunta "Memorizza credenziali". La musica va nella cartella music: ogni sottocartella è una playlist.'))
        : el('p', { className: 'muted small' }, 'La cartella condivisa in rete c\'è solo sul Raspberry (si attiva da sola con l\'aggiornamento). Su questo PC la cartella è data/media/music dentro la cartella di TwitchGestor.'),
    );
  }

  // ---------- impostazioni ----------
  function renderSettings() {
    fill($('mu-obs'),
      el('h2', {}, 'Lettore in OBS'),
      el('p', { className: data.pages ? 'small share-ok' : 'small mu-warn' }, data.pages ? '✓ Il lettore è collegato: la musica va in live.' : '⚠ Nessun lettore collegato: in live non si sente niente.'),
      el('ol', { className: 'mu-steps small' },
        el('li', {}, 'In OBS: ➕ Sorgente → Browser.'),
        el('li', {}, 'Incolla l\'indirizzo del lettore qui sotto (la dimensione non conta, anche 1×1).'),
        el('li', {}, 'Spunta "Controlla l\'audio tramite OBS": così la senti nel mixer e va in live.')),
      copyRow('🎵 Lettore (audio)', window.TG.obsUrl('music')),
      el('details', { className: 'mu-extra' },
        el('summary', {}, 'Riquadro "in riproduzione" da mostrare in live (facoltativo)'),
        el('p', { className: 'muted small' }, 'Si vede solo mentre la musica suona: in pausa o a musica ferma sparisce da solo.'),
        copyRow('🖼 Riquadro (500×120)', window.TG.obsUrl('music?widget')),
        copyRow('🖼 Riquadro in stile brutalista', window.TG.obsUrl('music?widget&style=brutal'))),
      el('p', { className: 'muted small' }, 'Gli spettatori possono scrivere ', el('code', {}, '!song'), ' se crei un comando con la variabile ', el('code', {}, '{song}'), ' (scheda Comandi).'),
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

  // Musicante Player: ascoltare la musica del Raspberry sul PC (programma per Windows o pagina nel browser)
  function renderPc() {
    const host = location.hostname;
    fill($('mu-pc'),
      el('h2', {}, '💻 Ascolta sul PC'),
      el('p', { className: 'small' }, 'Musicante Player: un programma per Windows per ascoltare (solo tu, non va in live) la musica del Raspberry, con le stesse playlist. I brani nuovi compaiono da soli; funzionano i tasti multimediali della tastiera.'),
      el('div', { className: 'row' },
        el('a', { className: 'btn primary', href: '/scarica/MusicantePlayer.exe', download: 'MusicantePlayer.exe' }, '⬇ Scarica per Windows'),
        el('a', { className: 'btn', href: `/player${window.TG.token() ? `?token=${encodeURIComponent(window.TG.token())}` : ''}`, target: '_blank', rel: 'noopener' }, 'Apri nel browser ↗')),
      el('ol', { className: 'mu-steps small' },
        el('li', {}, 'Apri il file scaricato. La prima volta Windows avvisa che è un programma "non riconosciuto" (non è firmato da un\'azienda): clicca ', el('b', {}, 'Ulteriori informazioni → Esegui comunque'), '.'),
        el('li', {}, 'Trova da solo il Raspberry sulla rete di casa e chiede la password della dashboard una volta sola.'),
        el('li', {}, 'Consiglio: spostalo in Documenti, poi clic destro → "Aggiungi a Start" o "Aggiungi alla barra delle applicazioni".')),
      el('p', { className: 'muted small' }, `Se non trova il Raspberry da solo, scrivi l'indirizzo: ${host}`));
  }

  function render() {
    if (!data || !open) return;
    renderNow();
    renderLibrary();
    renderAdd();
    renderSettings();
    renderPc();
  }

  $('mu-search').oninput = (e) => { search = e.target.value; if (data) renderLibrary(); };
  window.addEventListener('tab:music', () => { open = true; load(); });
  document.addEventListener('click', (e) => { if (e.target.closest?.('.tab') && !e.target.closest('[data-tab="music"]')) { open = false; sortAudio.pause(); dupAudio.pause(); } });
  window.addEventListener('tg:music', (e) => {
    if (!open || !data) return;
    if (e.detail.library) return load(); // brani aggiunti o tolti dalla cartella
    const changed = data.player?.track?.id !== e.detail.music?.track?.id || data.player?.playlist !== e.detail.music?.playlist;
    data.player = e.detail.music;
    // non ridisegnare mentre stai spostando il volume
    const busy = $('mu-now').contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (!busy) renderNow();
    else syncMonitor();
    if (changed) renderLibrary();
  });
  window.addEventListener('tg:state', (e) => {
    if (!open || !data || e.detail?.musicPages === undefined || e.detail.musicPages === data.pages) return;
    data.pages = e.detail.musicPages;
    renderNow();
    renderSettings();
  });
})();
