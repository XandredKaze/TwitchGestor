// Overlay per OBS: aggiungi http://localhost:3000/overlay come "Sorgente browser" (es. 1920x1080)
// e spunta "Controlla l'audio tramite OBS" per gestire il volume dal mixer.
(function () {
  const stage = document.getElementById('stage');
  let current = null;
  let hideTimer = null;

  function isVideo(src) {
    return /\.(webm|mp4)$/i.test(src);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function mediaSrc(src) {
    return src.startsWith('http') || src.startsWith('/') ? src : `/${src}`;
  }

  function hide(node) {
    if (!node) return;
    node.classList.add('leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }

  function show(alert) {
    clearTimeout(hideTimer);
    hide(current);
    const box = el('div', 'alert');
    box.style.setProperty('--accent', alert.color);
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
    window.playSound(alert.sound, alert.volume);
    hideTimer = setTimeout(() => {
      hide(box);
      if (current === box) current = null;
    }, alert.duration);
  }

  function applySettings(o = {}) {
    stage.className = `pos-${o.position || 'top-center'}`;
    const root = document.documentElement.style;
    if (o.fontFamily) root.setProperty('--font', o.fontFamily);
    if (o.textColor) root.setProperty('--text', o.textColor);
    if (o.background) root.setProperty('--bg', o.background);
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
