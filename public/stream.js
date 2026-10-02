// "Stato della diretta": connessione, bitrate e salute dello streaming, letti da OBS ogni 2 secondi.
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const SVG = 'http://www.w3.org/2000/svg';
  let obs = null;

  const nf = new Intl.NumberFormat('it-IT');
  const pct = (v, digits = 1) => `${nf.format(Number(v.toFixed(digits)))} %`;
  function clock(ms) {
    const s = Math.floor(ms / 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }

  // tacche del segnale: sempre con l'etichetta accanto (mai solo colore)
  function bars(level, label) {
    return el('span', { className: `q-bars q-${level}`, role: 'img', 'aria-label': `Connessione ${label}` },
      ...[1, 2, 3, 4].map((i) => el('i', { className: i <= level ? 'on' : '' })));
  }

  // grafico del bitrate: una sola serie, linea di 2px, crocetta e valore al passaggio del mouse
  function sparkline(history) {
    const W = 300; const H = 64; const P = 4;
    const max = Math.max(1000, ...history) * 1.15;
    const x = (i) => (history.length < 2 ? W : P + (i / (history.length - 1)) * (W - 2 * P));
    const y = (v) => H - P - (v / max) * (H - 2 * P);
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Bitrate degli ultimi ${Math.round(history.length * 2 / 60) || 1} minuti, ultimo valore ${nf.format(history.at(-1) ?? 0)} kbps`);
    const mk = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); return n; };
    mk('line', { x1: 0, x2: W, y1: H - P, y2: H - P, class: 'spark-base' });
    if (history.length > 1) {
      const pts = history.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      mk('path', { d: `M${pts[0]} L${pts.join(' L')} L${x(history.length - 1)},${H - P} L${x(0)},${H - P} Z`, class: 'spark-area' });
      mk('path', { d: `M${pts.join(' L')}`, class: 'spark-line' });
      mk('circle', { cx: x(history.length - 1), cy: y(history.at(-1)), r: 3, class: 'spark-dot' });
    }
    const cross = mk('line', { y1: 0, y2: H, class: 'spark-cross', visibility: 'hidden' });
    const wrap = el('div', { className: 'spark-wrap' });
    const tip = el('div', { className: 'spark-tip', hidden: true });
    wrap.append(svg, tip);
    // hover: area più grande della linea, valore e "quanto tempo fa"
    wrap.addEventListener('pointermove', (e) => {
      if (history.length < 2) return;
      const r = wrap.getBoundingClientRect();
      const fx = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
      const i = Math.round(((fx * W - P) / (W - 2 * P)) * (history.length - 1));
      const k = Math.min(Math.max(i, 0), history.length - 1);
      cross.setAttribute('x1', x(k)); cross.setAttribute('x2', x(k)); cross.setAttribute('visibility', 'visible');
      const ago = (history.length - 1 - k) * 2;
      tip.hidden = false;
      tip.textContent = `${nf.format(history[k])} kbps · ${ago ? `${ago} s fa` : 'adesso'}`;
      tip.style.left = `${Math.min(Math.max((x(k) / W) * r.width, 50), r.width - 50)}px`;
    });
    wrap.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    return wrap;
  }

  function metric(label, value, note) {
    return el('div', { className: 'h-metric' }, el('span', { className: 'h-label' }, label), el('b', {}, value), note ? el('span', { className: 'h-note' }, note) : null);
  }

  function render() {
    const body = $('health-body');
    const live = $('health-live');
    const pillEl = $('stream-pill');
    const s = obs?.stream;
    if (!obs || !obs.enabled || obs.status !== 'connesso') {
      live.replaceChildren();
      pillEl.hidden = true;
      body.replaceChildren(el('p', { className: 'muted small' },
        'Collega OBS (riquadro "Scene OBS", pulsante ⚙ Collegamento) per vedere qui connessione, bitrate e fotogrammi persi della diretta.'));
      return;
    }
    if (!s) {
      body.replaceChildren(el('p', { className: 'muted small' }, 'Leggo i dati da OBS…'));
      return;
    }
    // in alto, sempre visibile durante la diretta
    pillEl.hidden = !s.active;
    if (s.active) {
      const q = s.quality ?? { level: 0, label: '…' };
      pillEl.className = `stream-pill q-${q.level}`;
      pillEl.replaceChildren(el('span', { className: 'live-dot' }), 'LIVE ', el('b', {}, `${nf.format(s.bitrateKbps)} kbps`), bars(q.level, q.label), q.label);
      pillEl.title = `Diretta da ${clock(s.durationMs)} · fotogrammi persi ${pct(s.droppedPct)} · congestione ${pct(s.congestion * 100, 0)}`;
    }
    live.className = `health-live ${s.active ? 'on' : ''}`;
    live.replaceChildren(s.active ? `● IN DIRETTA ${clock(s.durationMs)}` : '○ Non in diretta');

    if (!s.active) {
      body.replaceChildren(
        el('p', { className: 'muted small' }, 'Quando avvii la diretta in OBS qui vedi bitrate e qualità della connessione.'),
        el('div', { className: 'h-grid' }, metric('FPS', nf.format(Math.round(s.fps))), metric('CPU di OBS', pct(s.cpu))));
      return;
    }
    const q = s.quality;
    const tips = {
      0: 'OBS sta cercando di ricollegarsi a Twitch.',
      1: 'Molti fotogrammi persi: abbassa il bitrate in OBS (Impostazioni → Uscita) o controlla la rete.',
      2: 'Connessione un po\' instabile: se continua, abbassa il bitrate.',
    };
    body.replaceChildren(...[
      el('div', { className: `h-quality q-${q.level}` }, bars(q.level, q.label), el('span', {}, 'Connessione ', el('b', {}, q.label))),
      tips[q.level] ? el('p', { className: 'h-tip' }, tips[q.level]) : null,
      el('div', { className: 'h-bitrate' },
        el('div', {}, el('span', { className: 'h-label' }, 'Bitrate'), el('b', { className: 'h-big' }, nf.format(s.bitrateKbps)), el('span', { className: 'h-unit' }, ' kbps')),
        sparkline(s.history ?? [])),
      el('div', { className: 'h-grid' },
        metric('Fotogrammi persi (rete)', pct(s.droppedPct), `${nf.format(s.dropped)} in totale`),
        metric('Congestione', pct(s.congestion * 100, 0)),
        metric('FPS', nf.format(Math.round(s.fps)), s.renderMissedPct > 1 ? `${pct(s.renderMissedPct)} saltati` : null),
        metric('CPU di OBS', pct(s.cpu))),
    ].filter(Boolean));
  }

  window.addEventListener('tg:state', (e) => { obs = e.detail.obs; render(); });
  window.addEventListener('tg:stream', (e) => { if (obs) obs = { ...obs, stream: e.detail }; render(); });
})();
