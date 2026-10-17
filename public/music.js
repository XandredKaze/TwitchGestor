// Musica per OBS: aggiungi http://localhost:3000/music come "Sorgente browser" (anche 1×1: serve solo l'audio)
// e spunta "Controlla l'audio tramite OBS", così la musica va in live e si regola dal mixer.
// http://localhost:3000/music?widget mostra invece il riquadro "in riproduzione" (senza audio);
// ?widget&style=brutal per lo stile brutalista. Si comanda tutto dalla dashboard, scheda 🎵 Musica.
(function () {
  const params = new URLSearchParams(location.search);
  const widget = params.has('widget');
  const audio = document.getElementById('audio');
  const box = document.getElementById('widget');
  const unlock = document.getElementById('unlock');
  let build = null;
  let ws = null;
  let track = null;
  let volume = 0.6;
  let duckUntil = 0;
  let duckLevel = 1;
  let duckTimer = null;
  let fade = null;

  function sendMsg(m) {
    if (ws?.readyState === 1) ws.send(JSON.stringify({ ...m, id: track?.id }));
  }

  // volume reale = volume scelto × abbassamento durante gli alert, cambiato con dolcezza
  function applyVolume(smooth) {
    const target = volume * (Date.now() < duckUntil ? duckLevel : 1);
    clearInterval(fade);
    if (!smooth) { audio.volume = target; return; }
    const from = audio.volume;
    let i = 0;
    fade = setInterval(() => {
      i += 1;
      audio.volume = Math.min(1, Math.max(0, from + (target - from) * (i / 10)));
      if (i >= 10) clearInterval(fade);
    }, 40);
  }

  function tryPlay() {
    audio.play().then(() => { unlock.hidden = true; }).catch((e) => {
      // un browser normale (non OBS) blocca l'audio finché non clicchi nella pagina
      if (e?.name === 'NotAllowedError') unlock.hidden = false;
    });
  }

  function showWidget(state) {
    box.hidden = false;
    box.classList.toggle('brutal', params.get('style') === 'brutal');
    box.classList.toggle('off', !state.track);
    box.classList.toggle('paused', !state.playing);
    if (state.track) {
      document.getElementById('np-title').textContent = state.track.title;
      document.getElementById('np-artist').textContent = state.track.artist || '';
    }
  }

  function onState(state) {
    if (widget) return showWidget(state);
    volume = Number.isFinite(state.volume) ? state.volume : volume;
    const changed = (state.track?.id ?? null) !== (track?.id ?? null);
    track = state.track ?? null;
    if (!track) { audio.pause(); audio.removeAttribute('src'); return; }
    if (changed) { audio.src = track.url; audio.currentTime = 0; }
    applyVolume(!changed);
    if (state.playing) tryPlay(); else audio.pause();
  }

  if (!widget) {
    audio.addEventListener('ended', () => sendMsg({ type: 'ended' }));
    audio.addEventListener('error', () => { if (track) sendMsg({ type: 'error' }); });
    let lastProgress = 0;
    audio.addEventListener('timeupdate', () => {
      if (Date.now() - lastProgress < 5000) return;
      lastProgress = Date.now();
      sendMsg({ type: 'progress', position: Math.round(audio.currentTime), duration: Math.round(audio.duration || 0) });
    });
    unlock.addEventListener('click', tryPlay);
  }

  function onMessage(msg) {
    if (msg.type === 'hello') {
      if (build && msg.build && msg.build !== build) { location.reload(); return; }
      build = msg.build;
      onState(msg);
    } else if (msg.type === 'music') {
      onState(msg);
    } else if (msg.type === 'duck' && !widget) {
      // durante un alert la musica si abbassa, poi torna su
      duckLevel = Math.min(1, Math.max(0, Number(msg.level) || 0.3));
      duckUntil = Math.max(duckUntil, Date.now() + (Number(msg.ms) || 5000));
      applyVolume(true);
      clearTimeout(duckTimer);
      duckTimer = setTimeout(() => applyVolume(true), duckUntil - Date.now() + 50);
    }
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?role=music${widget ? '&widget' : ''}`);
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* messaggio non valido */ } };
    ws.onclose = () => setTimeout(connect, 2000);
  }
  connect();
})();
