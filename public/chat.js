// Chat per OBS: aggiungi http://localhost:3000/chat come "Sorgente browser" (es. 450×700).
// Con ?preview la pagina non si collega al programma: mostra messaggi di prova e l'aspetto inviato dalla dashboard.
(function () {
  const box = document.getElementById('chat');
  const preview = new URLSearchParams(location.search).has('preview');
  let settings = {};
  let badges = {};
  const loadedFonts = new Set();

  // colori dei nomi per chi non ne ha scelto uno su Twitch (come fa Twitch)
  const DEFAULT_COLORS = ['#ff4a4a', '#4a6bff', '#2fbf4a', '#b22222', '#ff7f50', '#9acd32', '#ff4500', '#2e8b57', '#daa520', '#d2691e', '#5f9ea0', '#1e90ff', '#ff69b4', '#8a2be2', '#00ff7f'];
  const colorFor = (login) => DEFAULT_COLORS[[...String(login)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % DEFAULT_COLORS.length];

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function ensureFont(name) {
    if (!name || loadedFonts.has(name) || /^(sans-serif|serif|monospace|system-ui|arial|segoe ui)$/i.test(name)) return;
    loadedFonts.add(name);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@400;500;700&display=swap`;
    document.head.append(link);
  }

  function hexToRgba(hex, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    const n = m ? parseInt(m[1], 16) : 0;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function applySettings(s) {
    settings = s ?? {};
    const style = settings.style || 'classic';
    box.className = [
      'chat', `style-${style}`, `anim-${settings.animation || 'slide'}`,
      settings.newestOnTop ? 'top' : '', settings.align === 'right' ? 'right' : '', settings.textShadow !== false ? 'shadow' : '',
    ].filter(Boolean).join(' ');
    const css = box.style;
    css.setProperty('--size', `${settings.fontSize ?? 22}px`);
    css.setProperty('--text', settings.textColor || '#ffffff');
    css.setProperty('--name', settings.nameColor || '#b39bd3');
    css.setProperty('--bg', hexToRgba(settings.background, settings.backgroundOpacity ?? 0.45));
    if (style === 'brutal') {
      css.removeProperty('--font');
      ['Share Tech Mono', 'Outfit', 'Bungee'].forEach(ensureFont);
    } else {
      css.setProperty('--font', `'${settings.font || 'Poppins'}', sans-serif`);
      ensureFont(settings.font || 'Poppins');
    }
    trim();
  }

  function render(m) {
    const node = el('div', `msg${m.highlighted ? ' highlight' : ''}`);
    node.dataset.id = m.id;
    node.dataset.user = m.userId;
    node.dataset.at = m.at;
    const userColor = settings.nameColorMode === 'fixed' ? '' : (m.color || colorFor(m.login));
    if (userColor) node.style.setProperty('--user', userColor);
    const who = el('span', 'who');
    if (settings.showBadges !== false && m.badges?.length) {
      const b = el('span', 'badges');
      for (const badge of m.badges) {
        const src = badges[`${badge.set}/${badge.id}`];
        if (!src) continue;
        const img = el('img');
        img.src = src; img.alt = badge.set;
        b.append(img);
      }
      if (b.children.length) who.append(b);
    }
    who.append(el('span', 'name', m.name), el('span', 'sep', ':'));
    const text = el('span', 'text');
    for (const f of m.fragments ?? [{ type: 'text', text: m.text }]) {
      if (f.type === 'emote' && f.id) {
        const img = el('img', 'emote');
        img.src = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(f.id)}/default/dark/2.0`;
        img.alt = f.text;
        text.append(img);
      } else {
        text.append(document.createTextNode(f.text));
      }
    }
    node.append(who, ' ', text);
    return node;
  }

  /** Scheda dello shoutout: immagine del canale, nome, ultima categoria e link. */
  function renderShoutout(m) {
    const node = el('div', 'msg so-card');
    node.dataset.id = m.id;
    node.dataset.user = m.userId;
    node.dataset.at = m.at;
    const bar = el('div', 'so-bar');
    const label = el('span', 'so-bar-name', '// ');
    label.append(el('span', 'hl', 'SHOUTOUT'));
    bar.append(label, el('span', 'so-tools', '_ ▢ ✕'));
    const avatar = el('div', 'so-avatar');
    if (m.avatar) {
      const img = el('img');
      img.src = m.avatar;
      img.alt = '';
      img.onerror = () => { img.remove(); avatar.textContent = (m.name || '?')[0].toUpperCase(); };
      avatar.append(img);
    } else {
      avatar.textContent = (m.name || '?')[0].toUpperCase();
    }
    const body = el('div', 'so-body');
    body.append(el('div', 'so-label', '📣 Shoutout'), el('div', 'so-name', m.name));
    if (m.game) {
      const game = el('div', 'so-game', 'Ultima live: ');
      game.append(el('b', '', m.game));
      body.append(game);
    }
    body.append(el('div', 'so-link', `twitch.tv/${m.login}`));
    node.append(bar, avatar, body, el('div', 'so-shine'));
    return node;
  }

  function add(m) {
    // messaggi vecchi (es. quando la sorgente si ricarica) solo se non sarebbero già spariti
    const life = (settings.lifetime ?? 0) * 1000;
    if (life && Date.now() - m.at > life) return;
    box.append(m.kind === 'shoutout' ? renderShoutout(m) : render(m));
    trim();
  }

  function fadeOut(node) {
    if (node.classList.contains('out')) return;
    node.classList.add('out');
    setTimeout(() => node.remove(), 650);
  }

  function trim() {
    const max = settings.maxMessages ?? 15;
    const nodes = [...box.querySelectorAll('.msg:not(.out)')];
    nodes.slice(0, Math.max(0, nodes.length - max)).forEach((n) => n.remove());
  }

  // messaggi che spariscono dopo N secondi
  setInterval(() => {
    const life = (settings.lifetime ?? 0) * 1000;
    if (!life) return;
    for (const n of box.querySelectorAll('.msg')) if (Date.now() - Number(n.dataset.at) > life) fadeOut(n);
  }, 500);

  function handle(msg) {
    if (msg.type === 'hello') {
      badges = msg.badges ?? {};
      applySettings(msg.settings);
      box.replaceChildren();
      (msg.messages ?? []).forEach(add);
    } else if (msg.type === 'settings') applySettings(msg.settings);
    else if (msg.type === 'badges') badges = msg.badges ?? {};
    else if (msg.type === 'message') add(msg.message);
    else if (msg.type === 'remove') box.querySelectorAll(`.msg[data-id="${CSS.escape(msg.id)}"]`).forEach(fadeOut);
    else if (msg.type === 'remove-user') box.querySelectorAll(`.msg[data-user="${CSS.escape(msg.userId)}"]`).forEach(fadeOut);
    else if (msg.type === 'clear') box.replaceChildren();
  }

  if (preview) {
    // anteprima nella dashboard: aspetto inviato con postMessage e messaggi di prova
    window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.type === 'settings') applySettings(e.data.settings); });
    const PEOPLE = [['LunaRossa', '#ff69b4', [['subscriber', '12']]], ['Drago_TV', '', []], ['ModAnna', '#2fbf4a', [['moderator', '1']]], ['PixelGamer', '#1e90ff', [['vip', '1']]], ['NeveNera', '', [['subscriber', '0']]]];
    const LINES = ['ciao a tutti! 💜', 'che bella live', 'GG!!', 'quel salto era incredibile', 'da dove stai giocando?', 'LUL', 'forza!!!', 'ahahah troppo forte'];
    badges = {
      'subscriber/12': 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="#9147ff"/><path d="M5 9l3 3 5-6" stroke="#fff" stroke-width="2" fill="none"/></svg>'),
      'subscriber/0': 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="#9147ff"/></svg>'),
      'moderator/1': 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="#00ad03"/><path d="M5 13l7-8M9 5h4v4" stroke="#fff" stroke-width="2" fill="none"/></svg>'),
      'vip/1': 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="#e005b9"/><path d="M4 7l5 6 5-6-2-2H6z" fill="#fff"/></svg>'),
    };
    let i = 0;
    const AVATAR = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#c58bff"/><stop offset="1" stop-color="#5b21b6"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><text x="50" y="66" font-family="Arial,sans-serif" font-size="50" font-weight="700" fill="#fff" text-anchor="middle">S</text></svg>');
    const tick = () => {
      // ogni tanto uno shoutout, per vederne l'aspetto
      if (i % 9 === 4) {
        add({ id: `p${i}`, kind: 'shoutout', userId: 'so:demo', login: 'streamer_amico', name: 'Streamer_Amico', avatar: AVATAR, game: 'Minecraft', at: Date.now() });
        i++;
        return;
      }
      const [name, color, b] = PEOPLE[i % PEOPLE.length];
      add({ id: `p${i}`, userId: name, login: name.toLowerCase(), name, color, badges: b.map(([set, id]) => ({ set, id })), text: LINES[i % LINES.length], fragments: [{ type: 'text', text: LINES[i % LINES.length] }], at: Date.now() });
      i++;
    };
    for (let k = 0; k < 6; k++) tick();
    setInterval(tick, 1600);
    applySettings({});
    return;
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?role=chat`);
    ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch { /* messaggio non valido */ } };
    ws.onclose = () => setTimeout(connect, 2000);
  }
  connect();
})();
