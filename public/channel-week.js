// Immagine della settimana nello "stile del canale" (lo stesso delle storie degli annunci di Howl-UP):
// nero con linee topografiche, titolo a blocchi lilla e bianco, "■ STAY CONNECTED ■", righe come la chat
// dell'overlay con la linea bianca e i quadratini, colonna di ×, ストリーマー in verticale, nome nella cornice
// con i cerchi intrecciati. Se in Howl-UP hai caricato il lupo, compare accanto al titolo.
(function () {
  const C = { bg: '#121212', line: '#ececec', text: '#f2f2f2', muted: '#9c9c9c', lilac: '#c9a8e0', topo: 'rgba(255,255,255,0.075)' };
  const F = {
    block: "'CW Bungee', 'Bungee', 'Arial Black', sans-serif",
    mono: "'CW Share Tech Mono', 'Share Tech Mono', ui-monospace, monospace",
    body: "'CW Outfit', 'Outfit', 'Nunito', system-ui, sans-serif",
  };
  const DAYS = ['LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB', 'DOM'];

  let fontsReady = null;
  function loadFonts() {
    fontsReady ??= Promise.all([
      ['CW Bungee', 'fonts/bungee.woff2', '400'], ['CW Share Tech Mono', 'fonts/share-tech-mono.woff2', '400'],
      ['CW Outfit', 'fonts/outfit-400.woff2', '400'], ['CW Outfit', 'fonts/outfit-600.woff2', '600'], ['CW Outfit', 'fonts/outfit-800.woff2', '800'],
    ].map(async ([family, url, weight]) => {
      try { const f = new FontFace(family, `url(${url})`, { weight }); await f.load(); document.fonts.add(f); } catch { /* font di riserva */ }
    }));
    return fontsReady;
  }

  // il lupo caricato in Howl-UP (Annunci → Il tuo lupo), se c'è
  let mascot;
  function loadMascot() {
    if (mascot !== undefined) return Promise.resolve(mascot);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { mascot = img; resolve(img); };
      img.onerror = () => { mascot = null; resolve(null); };
      img.src = `howlup-mascot.png?t=${Date.now()}`;
    });
  }

  function rng(seed) {
    let s = 0;
    for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /** Linee topografiche: curve di livello di colline morbide (come le grafiche del canale). */
  function topo(g, W, H, seed) {
    const r = rng(seed);
    const hills = Array.from({ length: 9 }, () => ({ x: r() * W, y: r() * H, s: 200 + r() * 420, h: (r() < 0.5 ? -1 : 1) * (0.6 + r()) }));
    const field = (x, y) => hills.reduce((v, k) => v + k.h * Math.exp(-((x - k.x) ** 2 + (y - k.y) ** 2) / (2 * k.s * k.s)), 0)
      + 0.15 * Math.sin(x / 140 + y / 210) + 0.12 * Math.cos(y / 120 - x / 260);
    const step = 14;
    const cols = Math.ceil(W / step) + 1;
    const rows = Math.ceil(H / step) + 1;
    const v = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) v[j * cols + i] = field(i * step, j * step);
    g.strokeStyle = C.topo;
    g.lineWidth = 2;
    g.beginPath();
    for (let lv = -1.6; lv <= 1.8; lv += 0.16) {
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = v[j * cols + i]; const b = v[j * cols + i + 1]; const c = v[(j + 1) * cols + i + 1]; const d = v[(j + 1) * cols + i];
          const x = i * step; const y = j * step;
          const pts = [];
          const edge = (p, q, x1, y1, x2, y2) => { if ((p < lv) !== (q < lv)) { const t = (lv - p) / (q - p); pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]); } };
          edge(a, b, x, y, x + step, y); edge(b, c, x + step, y, x + step, y + step); edge(d, c, x, y + step, x + step, y + step); edge(a, d, x, y, x, y + step);
          if (pts.length >= 2) { g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); }
          if (pts.length === 4) { g.moveTo(pts[2][0], pts[2][1]); g.lineTo(pts[3][0], pts[3][1]); }
        }
      }
    }
    g.stroke();
  }

  // nel codice i caratteri speciali sono scritti come \\u…: così si vedono giusti anche se il file arriva senza codifica
  const square = (g, x, y, s, fill = true) => { g.lineWidth = 3; if (fill) g.fillRect(x - s / 2, y - s / 2, s, s); else g.strokeRect(x - s / 2, y - s / 2, s, s); };
  const ellipsis = (g, text, maxW) => { let t = String(text); while (g.measureText(t).width > maxW && t.length > 2) t = `${t.slice(0, -2)}\u2026`; return t; };
  const spaced = (t) => t.split('').join(String.fromCharCode(8202));

  /** Nome nella cornice con i due cerchi intrecciati (come "XANDRED" nell'overlay) e il link sotto. */
  function nameBox(g, cx, y, w, h, login, linkSize) {
    const name = (login || 'live').replace(/_.*$/, '').toUpperCase();
    g.strokeStyle = C.line;
    g.lineWidth = 4;
    g.beginPath(); g.roundRect(cx - w / 2, y, w, h, 6); g.stroke();
    g.lineWidth = 3;
    const r = h * 0.78;
    for (const dx of [-h * 0.19, h * 0.19]) { g.beginPath(); g.arc(cx + dx, y + h / 2, r, 0, Math.PI * 2); g.stroke(); }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let s = h * 0.55;
    do { g.font = `400 ${s}px ${F.block}`; s -= 2; } while (g.measureText(name).width > w - 40 && s > 20);
    g.fillStyle = C.text;
    g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowOffsetX = 4; g.shadowOffsetY = 5;
    g.fillText(name, cx, y + h / 2 + 4);
    g.shadowColor = 'transparent';
    g.font = `400 ${linkSize}px ${F.mono}`;
    g.fillStyle = C.lilac;
    g.fillText(`twitch.tv/${login || '\u2026'}`, cx, y + h + r - h / 2 + linkSize * 0.9);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
  }

  /**
   * entries: live { start: "2026-10-20T21:00", title, game } della settimana; weekStart: lunedì (ms);
   * format: 'wide' (1920×1080), 'square' (1920×1920) o 'portrait' (1920×2400).
   */
  async function drawChannelWeek(canvas, { weekStart, format = 'wide', entries = [], login = '' }) {
    const W = 1920;
    const H = format === 'square' ? 1920 : format === 'portrait' ? 2400 : 1080;
    const wide = H === 1080;
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    await Promise.all([loadFonts(), loadMascot()]);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    topo(g, W, H, `${weekStart}-${format}`);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';

    // a destra: linea verticale con i quadratini e ストリーマー; a sinistra la colonna di ×
    const vx = W - 50;
    const kana = wide ? 44 : 64;
    const kanaTop = H - 6 * kana * 1.15 - (wide ? 60 : 120);
    g.fillStyle = C.line;
    g.fillRect(vx - 2, 0, 4, kanaTop - 110);
    square(g, vx, kanaTop - 80, 14); square(g, vx, kanaTop - 50, 14, false);
    g.font = `900 ${kana}px 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', ${F.body}`;
    [...'\u30b9\u30c8\u30ea\u30fc\u30de\u30fc'].forEach((ch, i) => { g.save(); g.translate(vx, kanaTop + i * kana * 1.15); if (ch === '\u30fc') g.rotate(Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 0, 0); g.restore(); });
    g.font = `800 ${wide ? 30 : 40}px ${F.body}`;
    for (let i = 0; i < 4; i++) g.fillText('\u00d7', 24, H * 0.5 + i * (wide ? 40 : 54));

    // intestazione: lupo (se c'è), "LIVE DELLA" lilla e "SETTIMANA" bianco, ■ STAY CONNECTED ■
    const M = 90;
    let x0 = M + 10;
    const head = wide ? 84 : 128;
    const y1 = M + head * 0.85;
    const y2 = y1 + head * 1.0;
    if (mascot) {
      const s = head * 2.1;
      try { g.drawImage(mascot, M - 10, M - 10, s, s * (mascot.height / mascot.width || 1)); x0 = M - 10 + s + 30; g.fillStyle = C.line; g.fillRect(x0 - 16, M + 10, 5, head * 1.8); } catch { /* niente */ }
    }
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowOffsetX = 4; g.shadowOffsetY = 6;
    g.font = `400 ${head}px ${F.block}`;
    g.fillStyle = C.lilac; g.fillText('LIVE DELLA', x0, y1);
    g.fillStyle = C.text; g.fillText('SETTIMANA', x0, y2);
    g.shadowColor = 'transparent';
    let y = y2 + (wide ? 62 : 90);
    const sc = wide ? 30 : 42;
    g.font = `800 ${sc}px ${F.body}`;
    g.fillStyle = C.text;
    square(g, x0 + 8, y - sc * 0.33, sc * 0.4);
    g.fillText('STAY', x0 + 28, y);
    const w1 = g.measureText('STAY ').width;
    g.fillStyle = C.lilac; g.fillText('CONNECTED', x0 + 28 + w1, y);
    const w2 = g.measureText('CONNECTED').width;
    g.fillStyle = C.text; square(g, x0 + 28 + w1 + w2 + 20, y - sc * 0.33, sc * 0.4);
    const end = weekStart + 6 * 86400000;
    const range = `${new Date(weekStart).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} \u2013 ${new Date(end).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}`.toUpperCase();
    g.font = `400 ${sc}px ${F.mono}`;
    const rw = g.measureText(spaced(range)).width;
    const lineEnd = vx - 60 - rw - 30;
    const lineStart = x0 + 28 + w1 + w2 + 46;
    if (lineEnd > lineStart) { g.fillStyle = C.text; g.fillRect(lineStart, y - sc * 0.38, lineEnd - lineStart, 4); }
    g.fillStyle = C.lilac;
    g.fillText(spaced(range), vx - 60 - rw, y);

    // nome nella cornice: in alto a destra (16:9) oppure in fondo (formati alti)
    if (wide) nameBox(g, W - 420, M + 10, 520, 110, login, 26);
    else nameBox(g, W / 2, H - 330, 760, 160, login, 44);

    // i giorni: righe come la chat dell'overlay, con la linea bianca e i quadratini
    const top = y + (wide ? 40 : 70);
    const bottom = wide ? H - 60 : H - 470;
    const rowH = (bottom - top) / 7;
    const rx = 150;
    const rw2 = vx - 90 - rx;
    g.fillStyle = C.line;
    g.fillRect(108, top, 4, bottom - top);
    square(g, 110, top - 14, 16, false);
    square(g, 110, bottom + 12, 16);
    const ms = (s) => new Date(s).getTime();
    const week = entries.filter((e) => ms(e.start) >= weekStart && ms(e.start) < weekStart + 7 * 86400000)
      .sort((a, b) => a.start.localeCompare(b.start));
    for (let i = 0; i < 7; i++) {
      const dayMs = weekStart + i * 86400000;
      const list = week.filter((e) => (new Date(e.start).getDay() + 6) % 7 === i);
      const on = list.length > 0;
      const ry = top + i * rowH + 6;
      const rh = rowH - 12;
      g.fillStyle = on ? 'rgba(201,168,224,0.10)' : 'rgba(0,0,0,0.35)';
      g.fillRect(rx, ry, rw2, rh);
      if (on) { g.fillStyle = C.lilac; g.fillRect(rx, ry, 6, rh); }
      const cy = ry + rh / 2;
      g.textBaseline = 'middle';
      // giorno in monospazio lilla, come i nomi nella chat
      const ds = Math.min(wide ? 34 : 46, rh * 0.36);
      g.font = `400 ${ds}px ${F.mono}`;
      g.fillStyle = on ? C.lilac : C.muted;
      g.fillText(spaced(`${DAYS[i]} ${new Date(dayMs).getDate()}`), rx + 34, cy);
      const tx = rx + (wide ? 250 : 330);
      if (!on) {
        g.font = `600 ${Math.min(wide ? 28 : 38, rh * 0.3)}px ${F.body}`;
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillText('riposo', tx, cy);
        continue;
      }
      // orario a blocchi lilla
      const ts = Math.min(wide ? 56 : 80, rh * 0.55);
      g.font = `400 ${ts}px ${F.block}`;
      g.fillStyle = C.lilac;
      const timeText = list.map((x) => x.start.slice(11)).join(' + ');
      g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowOffsetX = 3; g.shadowOffsetY = 4;
      g.fillText(timeText, tx, cy + 2);
      g.shadowColor = 'transparent';
      const after = tx + Math.max(g.measureText(timeText).width + 40, wide ? 230 : 330);
      const maxW = rx + rw2 - 30 - after;
      const e = list[0];
      const title = e.title || 'In live!';
      const two = rh > 120 && e.game; // righe alte: titolo sopra e gioco sotto
      g.font = `800 ${Math.min(wide ? 36 : 50, rh * (two ? 0.3 : 0.36))}px ${F.body}`;
      g.fillStyle = C.text;
      if (two) {
        g.fillText(ellipsis(g, title, maxW), after, cy - rh * 0.17);
        g.font = `400 ${Math.min(38, rh * 0.24)}px ${F.mono}`;
        g.fillStyle = C.lilac;
        square(g, after + 8, cy + rh * 0.2, 12);
        g.fillText(ellipsis(g, e.game.toUpperCase(), maxW - 30), after + 26, cy + rh * 0.2);
      } else {
        const t = ellipsis(g, title, e.game ? maxW * 0.62 : maxW);
        g.fillText(t, after, cy);
        if (e.game) {
          const gx = after + g.measureText(t).width + 30;
          g.font = `400 ${Math.min(wide ? 28 : 38, rh * 0.28)}px ${F.mono}`;
          g.fillStyle = C.lilac;
          square(g, gx + 6, cy, 10);
          g.fillText(ellipsis(g, e.game.toUpperCase(), rx + rw2 - 30 - gx - 22), gx + 22, cy);
        }
      }
    }
    g.textBaseline = 'alphabetic';
    return canvas;
  }

  window.drawChannelWeek = drawChannelWeek;
})();
