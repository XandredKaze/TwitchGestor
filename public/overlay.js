// Overlay per OBS: aggiungi http://localhost:3000/overlay come "Sorgente browser" (1920x1080)
// e spunta "Controlla l'audio tramite OBS" per gestire il volume dal mixer.
// Con ?preview la pagina non si collega al programma e mostra gli alert inviati dalla dashboard (anteprima).
(function () {
  const stage = document.getElementById('stage');
  const preview = new URLSearchParams(location.search).has('preview');
  let current = null;
  let hideTimer = null;
  let stopVoice = () => {};

  const isVideo = (src) => /\.(webm|mp4)$/i.test(src);
  const mediaSrc = (src) => (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') ? src : `/${src}`);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return `rgba(18, 18, 24, ${alpha})`;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  // font dello stile Brutalism (gli stessi del tema di TwitchGestor)
  let brutalFonts = false;
  function loadBrutalFonts() {
    if (brutalFonts) return;
    brutalFonts = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Bungee&family=Share+Tech+Mono&family=Outfit:wght@400;500;700&display=swap';
    document.head.append(link);
  }

  /** Testo con l'ultima (o la prima) parola in lilla, come le finestre del tema Brutalism. */
  function highlighted(className, value, which) {
    const node = el('div', className);
    const words = String(value).trim().split(/\s+/);
    const i = which === 'first' ? 0 : words.length - 1;
    words.forEach((w, k) => {
      if (k) node.append(' ');
      if (k === i && words.length > 1) node.append(el('span', 'hl', w));
      else node.append(w);
    });
    return node;
  }

  function brutalBox(alert, box) {
    loadBrutalFonts();
    box.classList.add('style-brutal');
    const bar = el('div', 'b-bar');
    bar.append(highlighted('b-name', `// ${String(alert.label || alert.type || 'alert').toUpperCase()}`, 'last'), el('div', 'b-tools', '_ ▢ ✕'));
    const body = el('div', 'b-body');
    if (alert.title) body.append(highlighted('title', alert.title, 'first'));
    if (alert.text) body.append(el('div', 'text', alert.text));
    if (alert.message) {
      const msg = el('div', 'b-msg');
      msg.append(el('div', 'b-rule', '▢'), el('div', 'message', alert.message));
      body.append(msg);
    }
    box.append(bar);
    if (alert.image) box.append(mediaNode(alert.image, 'b-media'));
    box.append(body);
  }

  function mediaNode(src, className) {
    const media = el(isVideo(src) ? 'video' : 'img', className);
    media.src = mediaSrc(src);
    if (media.tagName === 'VIDEO') Object.assign(media, { autoplay: true, muted: true, loop: true });
    return media;
  }

  function hide(node) {
    if (!node) return;
    node.classList.add('leaving');
    node.addEventListener('animationend', (e) => {
      if (e.target === node && node.classList.contains('leaving')) node.remove();
    });
    setTimeout(() => node.remove(), 1500);
  }

  function show(alert, { silent = false } = {}) {
    clearTimeout(hideTimer);
    stopVoice();
    hide(current);

    const brutal = alert.alertStyle === 'brutal';
    if (!brutal) window.loadFont(alert.font);
    // con Brutalism "Pop" (il predefinito) diventa la finestra che si apre dall'alto
    const animation = brutal && (alert.animation || 'pop') === 'pop' ? 'window' : alert.animation || 'pop';
    const box = el('div', `alert anim-${animation}`);
    const opacity = alert.backgroundOpacity ?? 0.88;
    box.style.setProperty('--accent', alert.color);
    box.style.setProperty('--text', alert.textColor || '#fff');
    box.style.setProperty('--bg', hexToRgba(alert.background, opacity));
    box.style.setProperty('--size', `${alert.fontSize || 26}px`);
    if (alert.titleSize) box.style.setProperty('--title-size', `${alert.titleSize}px`);
    if (alert.messageSize) box.style.setProperty('--msg-size', `${alert.messageSize}px`);
    if (brutal) {
      brutalBox(alert, box);
    } else {
      box.style.fontFamily = window.fontStack(alert.font);
      if (opacity === 0) box.classList.add('no-box');
      if (alert.image) box.append(mediaNode(alert.image));
      if (alert.title) box.append(el('div', 'title', alert.title));
      if (alert.text) box.append(el('div', 'text', alert.text));
      if (alert.message) box.append(el('div', 'message', alert.message));
    }
    box.dataset.id = alert.id;
    stage.append(box);
    // l'animazione "Finestra" parte dalla barra in alto: serve la sua altezza
    const bar = box.querySelector('.b-bar');
    if (bar) box.style.setProperty('--bar-h', `${bar.offsetHeight + 2}px`);
    current = box;
    if (!silent) {
      window.playSound(alert.sound, alert.volume);
      stopVoice = window.speak(alert.tts, { delay: alert.tts?.delay ?? (alert.sound ? 1200 : 300) });
    }
    hideTimer = setTimeout(() => {
      hide(box);
      if (current === box) current = null;
    }, alert.duration);
  }

  function applySettings(o = {}) {
    stage.className = `pos-${o.position || 'top-center'}`;
  }

  if (preview) {
    // Messaggi dalla dashboard: { type: 'alert', alert, overlay, silent }
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.data?.type !== 'alert') return;
      applySettings(e.data.overlay);
      show(e.data.alert, { silent: e.data.silent });
    });
    return;
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?role=overlay`);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'hello') applySettings(msg.overlay);
      if (msg.type === 'alert') show(msg.alert);
      if (msg.type === 'skip' && current?.dataset.id === msg.id) {
        clearTimeout(hideTimer);
        stopVoice();
        hide(current);
        current = null;
      }
    };
    ws.onclose = () => setTimeout(connect, 2000);
  }

  connect();
})();
