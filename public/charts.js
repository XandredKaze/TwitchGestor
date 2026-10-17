// Grafici semplici in SVG per Statistiche e Riepiloghi (nessuna libreria esterna).
// Colori dal tema (--series-1, --series-2), linee sottili, griglia leggera, valori al passaggio del mouse.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    return n;
  };
  const compact = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}K`.replace('.0K', 'K') : `${Math.round(v * 10) / 10}`);

  /** Valori "tondi" per l'asse verticale (da min, di solito 0, a max). */
  function ticks(max, min = 0, count = 4) {
    if (max <= min) return [min, min + 1];
    const raw = (max - min) / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const start = Math.floor(min / step) * step;
    const out = [];
    for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 100) / 100);
    if (out.at(-1) < max) out.push(Math.round((out.at(-1) + step) * 100) / 100);
    return out;
  }

  function frame(container, height) {
    const width = Math.max(260, container.clientWidth || 600);
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, class: 'tg-chart', role: 'img' });
    const tip = document.createElement('div');
    tip.className = 'tg-tip';
    tip.hidden = true;
    const wrap = document.createElement('div');
    wrap.className = 'tg-chart-wrap';
    wrap.append(svg, tip);
    container.replaceChildren(wrap);
    const showTip = (x, y, html) => {
      tip.innerHTML = html;
      tip.hidden = false;
      const w = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(x - w / 2, 0), width - w)}px`;
      tip.style.top = `${Math.max(y - tip.offsetHeight - 10, 0)}px`;
    };
    svg.addEventListener('pointerleave', () => { tip.hidden = true; svg.querySelectorAll('.hover').forEach((n) => n.classList.remove('hover')); });
    return { svg, width, showTip, hideTip: () => { tip.hidden = true; } };
  }

  function axes(svg, { width, height, pad, max, min = 0, format = compact }) {
    const ys = ticks(max, min);
    const [bottom, top] = [ys[0], ys.at(-1)];
    const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - (v - bottom) / (top - bottom));
    y.bottom = bottom;
    for (const v of ys) {
      svg.append(svgEl('line', { x1: pad.l, x2: width - pad.r, y1: y(v), y2: y(v), class: 'tg-grid' }));
      const label = svgEl('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tg-axis' });
      label.textContent = format(v);
      svg.append(label);
    }
    return y;
  }
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');

  /**
   * Linea nel tempo. points: [{ x: numero (es. ms), y, label }]. xLabel(x) per le date sotto.
   * opts.marker: indice del punto da evidenziare (es. il massimo).
   */
  // zero: false = l'asse non parte da 0 (utile per totali che cambiano poco, es. i follower)
  function line(container, points, { height = 220, xLabel = String, format = compact, unit = '', marker, zero = true } = {}) {
    if (!points.length) { container.replaceChildren(); return; }
    const pad = { t: 14, r: 14, b: 26, l: 42 };
    const { svg, width, showTip } = frame(container, height);
    const xs = points.map((p) => p.x);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const x = (v) => pad.l + (width - pad.l - pad.r) * (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0));
    const ysAll = points.map((p) => p.y);
    const lo = Math.min(...ysAll);
    const hi = Math.max(...ysAll, 1);
    const y = axes(svg, { width, height, pad, max: hi, min: zero ? 0 : Math.max(0, lo - Math.max(1, (hi - lo) * 0.15)), format });
    // date sotto: inizio, metà, fine
    const idx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    for (const i of idx) {
      const t = svgEl('text', { x: x(points[i].x), y: height - 6, 'text-anchor': i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle', class: 'tg-axis' });
      t.textContent = xLabel(points[i].x);
      svg.append(t);
    }
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
    svg.append(svgEl('path', { d: `${d}L${x(x1)},${y(y.bottom)}L${x(x0)},${y(y.bottom)}Z`, class: 'tg-area' }));
    svg.append(svgEl('path', { d, class: 'tg-line' }));
    if (Number.isInteger(marker) && points[marker]) {
      svg.append(svgEl('circle', { cx: x(points[marker].x), cy: y(points[marker].y), r: 5, class: 'tg-dot' }));
    }
    // mirino: il punto più vicino al mouse
    const cross = svgEl('line', { y1: pad.t, y2: height - pad.b, class: 'tg-cross', visibility: 'hidden' });
    const dot = svgEl('circle', { r: 5, class: 'tg-dot', visibility: 'hidden' });
    svg.append(cross, dot);
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * width;
      let best = 0;
      for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].x) - mx) < Math.abs(x(points[best].x) - mx)) best = i;
      const p = points[best];
      cross.setAttribute('x1', x(p.x)); cross.setAttribute('x2', x(p.x)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(p.x)); dot.setAttribute('cy', y(p.y)); dot.setAttribute('visibility', 'visible');
      showTip((x(p.x) / width) * r.width, (y(p.y) / height) * r.height, `<b>${esc(format(p.y))}${unit}</b><span>${esc(p.label ?? xLabel(p.x))}</span>`);
    });
    svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
  }

  /**
   * Colonne. items: [{ label, value, value2?, tip }]. value2 (facoltativo) è un pallino sopra (es. il massimo).
   */
  function bars(container, items, { height = 220, format = compact, unit = '', labelEvery = 1 } = {}) {
    if (!items.length) { container.replaceChildren(); return; }
    const pad = { t: 14, r: 10, b: 26, l: 42 };
    const { svg, width, showTip } = frame(container, height);
    const max = Math.max(...items.map((i) => Math.max(i.value, i.value2 ?? 0)), 1);
    const y = axes(svg, { width, height, pad, max, format });
    const band = (width - pad.l - pad.r) / items.length;
    const bw = Math.max(4, Math.min(24, band - 4));
    items.forEach((it, i) => {
      const cx = pad.l + band * i + band / 2;
      const top = y(it.value);
      const h = Math.max(0, y(0) - top);
      const r = Math.min(4, bw / 2, h);
      // colonna con l'estremità arrotondata e la base dritta
      const d = `M${cx - bw / 2},${y(0)}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${y(0)}Z`;
      const g = svgEl('g', { class: 'tg-bar-g' });
      g.append(svgEl('rect', { x: pad.l + band * i, y: pad.t, width: band, height: height - pad.t - pad.b, class: 'tg-hit' }));
      g.append(svgEl('path', { d: h > 0 ? d : `M${cx - bw / 2},${y(0)}h${bw}`, class: 'tg-bar' }));
      if (Number.isFinite(it.value2)) g.append(svgEl('circle', { cx, cy: y(it.value2), r: 4.5, class: 'tg-dot2' }));
      g.addEventListener('pointerenter', () => {
        const rect = svg.getBoundingClientRect();
        g.classList.add('hover');
        showTip((cx / width) * rect.width, (Math.min(top, Number.isFinite(it.value2) ? y(it.value2) : top) / height) * rect.height, it.tip ?? `<b>${esc(format(it.value))}${unit}</b><span>${esc(it.label)}</span>`);
      });
      g.addEventListener('pointerleave', () => g.classList.remove('hover'));
      svg.append(g);
      if (i % labelEvery === 0) {
        const t = svgEl('text', { x: cx, y: height - 6, 'text-anchor': 'middle', class: 'tg-axis' });
        t.textContent = it.short ?? it.label;
        svg.append(t);
      }
    });
  }

  window.TGCharts = { line, bars, compact };
})();
