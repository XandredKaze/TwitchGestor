// Goal per OBS: aggiungi http://localhost:3000/goal?id=sub come "Sorgente browser" (es. 1800×260, oppure 900×130).
// L'id è quello del goal nella scheda 🎯 Goal della dashboard (senza id: il primo goal).
(function () {
  const params = new URLSearchParams(location.search);
  const wanted = params.get('id');
  const stage = document.getElementById('stage');
  const missing = document.getElementById('missing');
  const layers = [...document.querySelectorAll('.goal')];
  let build = null;

  const W = 1798;
  const H = 255;
  const KNOB = 32;
  const BAR = 1710;
  function fit() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H) || 1;
    stage.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', fit);
  fit();

  const fmt = (n, money) => (money
    ? n.toLocaleString('it-IT', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })
    : Math.round(n).toLocaleString('it-IT'));

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // struttura (uguale per il livello nitido e per quello sfocato del glow)
  for (const layer of layers) {
    const count = el('div', 'g-count');
    count.append(el('b'), el('span'));
    const bar = el('div', 'g-bar');
    bar.append(el('div', 'g-track'), el('div', 'g-fill'), el('div', 'g-knob'));
    const bottom = el('div', 'g-bottom');
    bottom.append(el('span', 'g-pct'), el('span', 'g-line'));
    const main = el('div', 'g-main');
    main.append(el('div', 'g-title'), count, bar, bottom);
    layer.append(el('div', 'g-side'), main);
  }

  function render(goals) {
    const g = (goals ?? []).find((x) => x.id === wanted) ?? (wanted ? null : goals?.[0]);
    stage.hidden = !g;
    missing.hidden = Boolean(g) || !params.has('preview');
    if (!g) { missing.textContent = 'Goal non trovato'; return; }
    const pct = Math.min(1, Math.max(0, g.current / g.target));
    const fill = pct * BAR;
    const money = g.type === 'donations';
    for (const layer of layers) {
      layer.querySelector('.g-title').textContent = g.title;
      layer.querySelector('.g-count b').textContent = `${fmt(g.current, money)} / `;
      layer.querySelector('.g-count span').textContent = `${fmt(g.target, money)}${money ? ' €' : ''}`;
      layer.querySelector('.g-fill').style.width = `${fill}px`;
      layer.querySelector('.g-knob').style.left = `${Math.min(BAR - KNOB, Math.max(0, fill - 25))}px`;
      layer.querySelector('.g-pct').textContent = `${g.percent}%`;
      layer.querySelector('.g-bottom').classList.toggle('no-pct', !g.showPercent);
    }
  }

  // anteprima nella dashboard: i dati arrivano dalla pagina che la contiene (mentre modifichi, prima di salvare)
  window.addEventListener('message', (e) => {
    if (e.origin === location.origin && e.data?.type === 'goal-preview') render([e.data.goal]);
  });
  if (params.has('preview') && params.has('static')) return;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?role=goal`);
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'hello') {
        if (build && msg.build && msg.build !== build) { location.reload(); return; }
        build = msg.build;
      }
      if (msg.type === 'hello' || msg.type === 'goals') render(msg.goals);
    };
    ws.onclose = () => setTimeout(connect, 2000);
  }
  connect();
})();
