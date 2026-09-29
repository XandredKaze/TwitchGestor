// Overlay per OBS: aggiungi http://localhost:3000/overlay come "Sorgente browser" (1920x1080)
// e spunta "Controlla l'audio tramite OBS" per gestire il volume dal mixer.
// Con ?preview la pagina non si collega al programma e mostra gli alert inviati dalla dashboard (anteprima).
(function () {
  const stage = document.getElementById('stage');
  const preview = new URLSearchParams(location.search).has('preview');
  let current = null;
  let hideTimer = null;

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
    hide(current);

    window.loadFont(alert.font);
    const box = el('div', `alert anim-${alert.animation || 'pop'}`);
    const opacity = alert.backgroundOpacity ?? 0.88;
    box.style.setProperty('--accent', alert.color);
    box.style.setProperty('--text', alert.textColor || '#fff');
    box.style.setProperty('--bg', hexToRgba(alert.background, opacity));
    box.style.setProperty('--size', `${alert.fontSize || 26}px`);
    box.style.fontFamily = window.fontStack(alert.font);
    if (opacity === 0) box.classList.add('no-box');

    if (alert.image) {
      const media = el(isVideo(alert.image) ? 'video' : 'img');
      media.src = mediaSrc(alert.image);
      if (media.tagName === 'VIDEO') Object.assign(media, { autoplay: true, muted: true, loop: true });
      box.append(media);
    }
    if (alert.title) box.append(el('div', 'title', alert.title));
    if (alert.text) box.append(el('div', 'text', alert.text));
    if (alert.message) box.append(el('div', 'message', alert.message));
    box.dataset.id = alert.id;
    stage.append(box);
    current = box;
    if (!silent) window.playSound(alert.sound, alert.volume);
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
        hide(current);
        current = null;
      }
    };
    ws.onclose = () => setTimeout(connect, 2000);
  }

  connect();
})();
