// Musicante Player: ascolta sul PC (programma per Windows o browser) la musica del Raspberry.
// Solo su questo dispositivo: non tocca la musica della live in OBS.
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const fill = (node, ...children) => node.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  // Dentro il programma per Windows la musica la suona il programma (così Windows e Wave Link la vedono come
  // "Musicante Player"): NativeAudio si comporta come un <audio> e passa i comandi al programma.
  class NativeAudio extends EventTarget {
    constructor() {
      super();
      this._src = '';
      this._t = 0;
      this._d = NaN;
      this._v = 1;
      this._ready = false;
      this._failed = '';
      this.paused = true;
      setInterval(() => this._poll(), 250);
    }
    _emit(type) { this.dispatchEvent(new Event(type)); }
    get src() { return this._src; }
    set src(u) {
      this._src = u ? new URL(u, location.href).href : '';
      this._t = 0; this._d = NaN; this._ready = false; this._failed = '';
      if (this._src) window.musicanteAudioLoad(this._src);
    }
    get currentTime() { return this._t; }
    set currentTime(sec) { this._t = Number(sec) || 0; window.musicanteAudioSeek(this._t); }
    get duration() { return this._d; }
    get volume() { return this._v; }
    set volume(v) { this._v = v; window.musicanteAudioVolume(v); }
    play() {
      this.paused = false;
      window.musicanteAudioPlay();
      this._emit('play');
      return Promise.resolve();
    }
    pause() {
      if (this.paused) return;
      this.paused = true;
      window.musicanteAudioPause();
      this._emit('pause');
    }
    async _poll() {
      if (!this._src) return;
      let st;
      try { st = await window.musicanteAudioState(); } catch { return; }
      if (st.error && st.error !== this._failed) { this._failed = st.error; this.lastError = st.error; this._emit('error'); return; }
      if (st.ready && !this._ready) { this._ready = true; this._d = st.duration; this._emit('loadedmetadata'); if (!this.paused) this._emit('playing'); }
      if (!st.ready) return;
      if (Math.abs(st.position - this._t) > 0.01) { this._t = st.position; this._emit('timeupdate'); }
      if (st.ended && !this.paused) { this.paused = true; this._emit('ended'); }
    }
  }
  const native = typeof window.musicanteAudioLoad === 'function';
  const audio = native ? new NativeAudio() : $('mp-audio');
  const ALL = '*';
  const KEY = 'musicante-player';

  let tracks = [];
  let shown = ALL; // playlist che stai guardando
  let search = '';
  let queue = []; // id dei brani in ordine di ascolto
  let index = -1;
  let playlistOfQueue = ALL;
  let error = '';
  const prefs = { volume: 0.8, shuffle: false, repeat: false, last: '', position: 0, playlist: ALL };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* prima volta */ }
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* niente */ } };

  // dentro il programma per Windows c'è "Cambia indirizzo del Raspberry"
  if (typeof window.musicanteSettings === 'function') {
    $('mp-settings').hidden = false;
    $('mp-settings').onclick = () => window.musicanteSettings();
  }

  const nameInfo = (name) => {
    const base = String(name).replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').trim();
    const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(base);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
  };
  const infoOf = (t) => { const n = nameInfo(t.name); return { title: t.title || n.title, artist: t.artist || n.artist }; };
  const time = (s) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
  const byId = (id) => tracks.find((t) => t.id === id);
  const current = () => byId(queue[index]);
  const inPlaylist = (pl) => tracks.filter((t) => pl === ALL || t.folder === pl);
  const shuffled = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const playlists = () => {
    const m = new Map();
    for (const t of tracks) if (t.folder) m.set(t.folder, (m.get(t.folder) ?? 0) + 1);
    return [{ id: ALL, name: 'Tutta la musica', count: tracks.length }, ...[...m].sort(([a], [b]) => a.localeCompare(b, 'it')).map(([id, count]) => ({ id, name: id, count }))];
  };
  const visible = () => {
    const q = search.trim().toLowerCase();
    return inPlaylist(shown).filter((t) => {
      if (!q) return true;
      const i = infoOf(t);
      return `${i.title} ${i.artist} ${t.folder} ${t.name}`.toLowerCase().includes(q);
    });
  };

  // ---------- riproduzione ----------
  function buildQueue(pl, startId) {
    let ids = inPlaylist(pl).map((t) => t.id);
    if (prefs.shuffle) ids = shuffled(ids);
    if (startId) ids = [startId, ...ids.filter((id) => id !== startId)];
    queue = ids;
    index = ids.length ? 0 : -1;
    playlistOfQueue = pl;
    prefs.playlist = pl;
  }
  function load(t, { autoplay = true, at = 0 } = {}) {
    if (!t) return;
    audio.src = t.url || `/media/music/${t.id.split('/').map(encodeURIComponent).join('/')}`;
    audio.currentTime = at;
    prefs.last = t.id;
    savePrefs();
    if (autoplay) audio.play().catch(() => {});
    renderNow();
    renderList();
  }
  function playTrack(id) {
    // un brano della lista: si ascolta la playlist che stai guardando, a partire da lì
    buildQueue(shown, id);
    if (!prefs.shuffle) { const ids = inPlaylist(shown).map((t) => t.id); const i = ids.indexOf(id); queue = [...ids.slice(i), ...ids.slice(0, i)]; index = 0; }
    load(current());
  }
  function playPlaylist(pl) {
    buildQueue(pl);
    load(current());
  }
  function next(auto = false) {
    if (!queue.length) return playPlaylist(shown);
    if (auto && prefs.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    index += 1;
    if (index >= queue.length) {
      if (auto && !prefs.repeat) { index = queue.length - 1; audio.pause(); renderNow(); return; }
      buildQueue(playlistOfQueue); // si ricomincia (mescolata di nuovo se è attivo il casuale)
    }
    load(current());
  }
  function prev() {
    if (audio.currentTime > 4 || index <= 0) { audio.currentTime = 0; return; }
    index -= 1;
    load(current());
  }
  function toggle() {
    if (!current()) return playPlaylist(shown);
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }

  audio.addEventListener('ended', () => next(true));
  // file che non si apre: si passa al successivo (ma se non se ne apre nessuno ci si ferma)
  let failures = 0;
  audio.addEventListener('error', () => {
    if (!audio.src || !current()) return;
    failures += 1;
    const why = audio.lastError ? ` (${audio.lastError})` : '';
    error = `Non riesco ad aprire "${infoOf(current()).title}"${why}${failures < queue.length ? ': passo al successivo.' : '. Nessun brano di questa playlist si apre: controlla che il Raspberry sia acceso.'}`;
    renderList();
    if (failures < queue.length) setTimeout(() => next(false), 1200);
  });
  audio.addEventListener('playing', () => { failures = 0; if (error) { error = ''; renderList(); } });
  audio.addEventListener('play', renderNow);
  audio.addEventListener('pause', renderNow);
  audio.addEventListener('loadedmetadata', renderNow);
  let lastSave = 0;
  audio.addEventListener('timeupdate', () => {
    if (!seeking) $('mp-progress').value = audio.duration ? String(Math.round((audio.currentTime / audio.duration) * 1000)) : '0';
    $('mp-pos').textContent = time(audio.currentTime);
    if (Date.now() - lastSave > 5000) { prefs.position = audio.currentTime; savePrefs(); lastSave = Date.now(); }
    if ('mediaSession' in navigator && audio.duration) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch { /* niente */ }
    }
  });
  let seeking = false;
  $('mp-progress').addEventListener('input', () => { seeking = true; $('mp-pos').textContent = time((Number($('mp-progress').value) / 1000) * (audio.duration || 0)); });
  $('mp-progress').addEventListener('change', () => { if (audio.duration) audio.currentTime = (Number($('mp-progress').value) / 1000) * audio.duration; seeking = false; });
  $('mp-volume').value = String(Math.round(prefs.volume * 100));
  audio.volume = prefs.volume;
  $('mp-volume').addEventListener('input', () => { prefs.volume = Number($('mp-volume').value) / 100; audio.volume = prefs.volume; savePrefs(); });
  $('mp-play').onclick = toggle;
  $('mp-next').onclick = () => next(false);
  $('mp-prev').onclick = prev;
  $('mp-shuffle').onclick = () => {
    prefs.shuffle = !prefs.shuffle;
    const id = current()?.id;
    if (queue.length) buildQueue(playlistOfQueue, id);
    savePrefs();
    renderNow();
  };
  // ripeti: no → tutta la playlist → il brano
  $('mp-repeat').onclick = () => { prefs.repeat = !prefs.repeat ? 'all' : prefs.repeat === 'all' ? 'one' : false; savePrefs(); renderNow(); };

  // tasti multimediali della tastiera e controlli di Windows (anche a finestra ridotta)
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play().catch(() => {}));
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', () => next(false));
    try { ms.setActionHandler('seekto', (d) => { audio.currentTime = d.seekTime; }); } catch { /* niente */ }
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.code === 'ArrowRight' && e.ctrlKey) next(false);
    else if (e.code === 'ArrowLeft' && e.ctrlKey) prev();
  });

  // ---------- disegno ----------
  function renderNow() {
    const t = current();
    const i = t ? infoOf(t) : null;
    $('mp-title').textContent = i ? i.title : 'Scegli un brano';
    $('mp-artist').textContent = i ? [i.artist, t.folder].filter(Boolean).join(' · ') : (tracks.length ? `${tracks.length} brani sul Raspberry` : '');
    $('mp-cover').classList.toggle('on', Boolean(t) && !audio.paused);
    $('mp-play').textContent = audio.paused ? '▶' : '⏸';
    $('mp-play').title = audio.paused ? 'Suona' : 'Pausa';
    $('mp-dur').textContent = time(audio.duration);
    $('mp-shuffle').setAttribute('aria-pressed', String(prefs.shuffle));
    $('mp-repeat').setAttribute('aria-pressed', String(Boolean(prefs.repeat)));
    $('mp-repeat').textContent = prefs.repeat === 'one' ? '↻1' : '↻';
    $('mp-repeat').title = prefs.repeat === 'one' ? 'Ripete il brano' : prefs.repeat ? 'Ripete la playlist' : 'Ripeti';
    document.title = t && !audio.paused ? `${i.title} · Musicante Player` : 'Musicante Player';
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = t ? new MediaMetadata({ title: i.title, artist: i.artist, album: t.folder || 'Musicante', artwork: [{ src: '/images/musicante-player.png', sizes: '256x256', type: 'image/png' }] }) : null;
      navigator.mediaSession.playbackState = t ? (audio.paused ? 'paused' : 'playing') : 'none';
    }
  }
  function renderPlaylists() {
    fill($('mp-playlists'), el('h2', {}, 'Playlist'), ...playlists().map((p) => el('button', {
      type: 'button', className: `mp-pl${p.id === shown ? ' active' : ''}`, 'aria-pressed': p.id === shown ? 'true' : 'false',
      onclick: () => { shown = p.id; renderPlaylists(); renderList(); $('mp-list').parentElement.scrollTop = 0; },
    }, el('span', {}, current() && p.id === playlistOfQueue ? el('span', { className: 'on' }, '♪ ') : null, p.name), el('small', {}, String(p.count)))));
  }
  function renderList() {
    const list = visible();
    const pl = playlists().find((p) => p.id === shown);
    const cur = current()?.id;
    fill($('mp-list-head'), 
      el('div', {}, el('h1', {}, pl?.name ?? 'Musica'), el('p', {}, `${list.length} ${list.length === 1 ? 'brano' : 'brani'}${search ? ' trovati' : ''}`)),
      list.length ? el('button', { type: 'button', className: 'mp-big', onclick: () => playPlaylist(shown) }, prefs.shuffle ? '⇄ Ascolta in ordine casuale' : '▶ Ascolta tutta') : null);
    if (!tracks.length) {
      fill($('mp-list'), error ? el('div', { className: 'mp-error' }, error) : null, el('p', { className: 'mp-empty' }, error ? '' : 'Carico la musica…'));
      return;
    }
    fill($('mp-list'), 
      error ? el('div', { className: 'mp-error' }, error) : null,
      ...(list.length ? list.slice(0, 1000).map((t, n) => {
        const i = infoOf(t);
        return el('button', {
          type: 'button', role: 'listitem', className: `mp-row${t.id === cur ? ' current' : ''}`,
          onclick: () => { error = ''; playTrack(t.id); },
        },
        el('span', { className: 'n' }, t.id === cur ? (audio.paused ? '❚❚' : '♪') : String(n + 1)),
        el('b', {}, i.title),
        el('span', { className: 'a' }, i.artist),
        shown === ALL && t.folder ? el('span', { className: 'pl' }, t.folder) : el('span'));
      }) : [el('p', { className: 'mp-empty' }, 'Nessun brano trovato.')]));
  }

  // ---------- dati dal Raspberry ----------
  async function fetchLibrary(first = false) {
    const token = window.TG.token();
    const res = await fetch('/api/music', { headers: token ? { 'x-dashboard-token': token } : {} }).catch(() => null);
    if (res?.status === 401) { window.TG.askPassword(Boolean(token)); return; }
    if (!res?.ok) { error = 'Il Raspberry non risponde: controlla che sia acceso e che il PC sia sulla rete di casa.'; renderList(); return; }
    const data = await res.json();
    const before = tracks.map((t) => t.id).join('|');
    tracks = data.tracks ?? [];
    error = '';
    if (!playlists().some((p) => p.id === shown)) shown = ALL;
    // la coda perde i brani spostati o cancellati
    if (queue.length) { const cur = current()?.id; queue = queue.filter((id) => byId(id)); index = cur && byId(cur) ? queue.indexOf(cur) : Math.min(index, queue.length - 1); }
    if (first) {
      shown = playlists().some((p) => p.id === prefs.playlist) ? prefs.playlist : ALL;
      // si riparte da dove eri rimasto (in pausa)
      const last = byId(prefs.last);
      if (last) { buildQueue(shown, last.id); load(last, { autoplay: false, at: prefs.position || 0 }); }
    }
    if (first || before !== tracks.map((t) => t.id).join('|')) { renderPlaylists(); renderList(); }
    renderNow();
  }
  $('mp-search').addEventListener('input', (e) => { search = e.target.value; renderList(); });
  fetchLibrary(true);
  setInterval(() => fetchLibrary(false), 60000); // i brani nuovi di Musicante compaiono da soli
})();
