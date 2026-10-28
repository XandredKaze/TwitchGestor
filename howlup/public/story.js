// Storia Instagram (1080×1920) per un annuncio, con l'estetica del canale di Xandred Kaze:
// nero con linee topografiche, titolo a blocchi lilla e bianco, cornici bianche con l'etichetta sul bordo,
// "■ STAY CONNECTED ■", nomi in monospazio lilla, colonna di ×, ストリーマー in verticale, cerchi intrecciati.
const W = 1080;
const H = 1920;
const C = { bg: '#121212', line: '#ececec', text: '#f2f2f2', muted: '#9c9c9c', lilac: '#c9a8e0', lilacDeep: '#b39bd3', pink: '#e36dc9', topo: 'rgba(255,255,255,0.075)' };
const F = {
  block: "'HU Bungee', 'Bungee', 'Arial Black', sans-serif",
  mono: "'HU Share Tech Mono', 'Share Tech Mono', ui-monospace, monospace",
  body: "'HU Outfit', 'Outfit', 'Nunito', system-ui, sans-serif",
};

// i font del canale: inclusi in Howl-UP (se mancano, quelli di Google Fonts o di riserva)
let fontsReady = null;
function loadFonts() {
  fontsReady ??= (async () => {
    const faces = [
      ['HU Bungee', 'fonts/bungee.woff2', '400'], ['HU Share Tech Mono', 'fonts/share-tech-mono.woff2', '400'],
      ['HU Outfit', 'fonts/outfit-400.woff2', '400'], ['HU Outfit', 'fonts/outfit-600.woff2', '600'], ['HU Outfit', 'fonts/outfit-800.woff2', '800'],
    ];
    await Promise.all(faces.map(async ([family, url, weight]) => {
      try { const f = new FontFace(family, `url(${url})`, { weight }); await f.load(); document.fonts.add(f); } catch { /* si usa il font di riserva */ }
    }));
    try { await Promise.all(["400 60px 'Bungee'", "400 40px 'Share Tech Mono'", "800 40px 'Outfit'"].map((x) => document.fonts.load(x))); } catch { /* niente */ }
  })();
  return fontsReady;
}

// numeri casuali sempre uguali per la stessa storia (le linee non cambiano a ogni anteprima)
function rng(seed) {
  let s = 0;
  for (const ch of String(seed)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Linee topografiche: curve di livello di un "terreno" fatto di colline morbide. */
function topo(g, seed, W = 1080, H = 1920) {
  const r = rng(seed);
  const hills = Array.from({ length: 7 }, () => ({ x: r() * W, y: r() * H, s: 180 + r() * 360, h: (r() < 0.5 ? -1 : 1) * (0.6 + r()) }));
  const field = (x, y) => hills.reduce((v, k) => v + k.h * Math.exp(-((x - k.x) ** 2 + (y - k.y) ** 2) / (2 * k.s * k.s)), 0)
    + 0.15 * Math.sin(x / 140 + y / 210) + 0.12 * Math.cos(y / 120 - x / 260);
  const step = 12;
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

function wrap(g, text, maxW) {
  const out = [];
  let line = '';
  for (const w of String(text).split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
const square = (g, x, y, s, fill = true) => { g.lineWidth = 3; if (fill) g.fillRect(x - s / 2, y - s / 2, s, s); else g.strokeRect(x - s / 2, y - s / 2, s, s); };

/** Cornice bianca con l'etichetta che interrompe il bordo in alto (come "LATEST FOLLOWER"). */
function frame(g, x, y, w, h, label) {
  g.strokeStyle = C.line;
  g.lineWidth = 4;
  g.font = `800 34px ${F.body}`;
  const lw = label ? g.measureText(label).width + 24 : 0;
  g.beginPath();
  g.moveTo(x + 40 + lw, y); g.lineTo(x + w - 8, y); g.quadraticCurveTo(x + w, y, x + w, y + 8);
  g.lineTo(x + w, y + h - 8); g.quadraticCurveTo(x + w, y + h, x + w - 8, y + h);
  g.lineTo(x + 8, y + h); g.quadraticCurveTo(x, y + h, x, y + h - 8);
  g.lineTo(x, y + 8); g.quadraticCurveTo(x, y, x + 8, y); g.lineTo(x + 40, y);
  g.stroke();
  if (label) { g.fillStyle = C.lilac; g.fillText(label, x + 52, y + 12); }
}

const parts = (start) => {
  const d = new Date(`${start}:00`);
  return {
    weekday: d.toLocaleDateString('it-IT', { weekday: 'long' }).toUpperCase(),
    date: d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }).toUpperCase(),
    short: d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase(),
    time: start.slice(11),
  };
};

export async function drawStory(canvas, draft, { login = '', mascot = null } = {}) {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  await loadFonts();
  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  topo(g, draft.id ?? 'x', W, H);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';

  // lupo (se l'hai caricato) e titolo a blocchi: prima riga lilla, seconda bianca
  let x0 = 80;
  if (mascot) { try { const s = 230; g.drawImage(mascot, 50, 90, s, s * (mascot.height / mascot.width || 1)); x0 = 300; g.fillStyle = C.line; g.fillRect(x0 - 16, 120, 5, 190); } catch { /* niente */ } }
  const words = String(draft.headline ?? 'LIVE').split(' ');
  const l1 = words.length > 1 ? words.slice(0, Math.ceil(words.length / 2)).join(' ') : '';
  const l2 = words.length > 1 ? words.slice(Math.ceil(words.length / 2)).join(' ') : words[0];
  const maxW = W - x0 - 90;
  const fit = (t, size) => { let s = size; do { g.font = `400 ${s}px ${F.block}`; s -= 4; } while (g.measureText(t).width > maxW && s > 40); return s + 4; };
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowOffsetX = 4; g.shadowOffsetY = 6; g.shadowBlur = 0;
  if (l1) { const s = fit(l1, 110); g.font = `400 ${s}px ${F.block}`; g.fillStyle = C.lilac; g.fillText(l1, x0, 205); }
  const s2 = fit(l2, 120); g.font = `400 ${s2}px ${F.block}`; g.fillStyle = C.text; g.fillText(l2, x0, l1 ? 315 : 260);
  g.shadowColor = 'transparent';

  // ■ STAY CONNECTED ■ ———
  let y = 390;
  g.font = `800 40px ${F.body}`;
  g.fillStyle = C.text;
  square(g, x0 + 10, y - 13, 16);
  g.fillText('STAY', x0 + 34, y);
  const w1 = g.measureText('STAY ').width;
  g.fillStyle = C.lilac; g.fillText('CONNECTED', x0 + 34 + w1, y);
  const w2 = g.measureText('CONNECTED').width;
  g.fillStyle = C.text; square(g, x0 + 34 + w1 + w2 + 22, y - 13, 16);
  g.fillRect(x0 + 34 + w1 + w2 + 50, y - 15, W - 90 - (x0 + 34 + w1 + w2 + 50), 4);

  // a destra: linea verticale con i quadratini e ストリーマー
  g.fillStyle = C.line;
  g.fillRect(W - 46, 0, 4, 820);
  square(g, W - 44, 850, 14); square(g, W - 44, 880, 14, false);
  g.font = `900 54px 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', ${F.body}`;
  [...'ストリーマー'].forEach((ch, i) => { g.save(); g.translate(W - 44, 950 + i * 62); if (ch === 'ー') g.rotate(Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 0, 0); g.restore(); });
  // a sinistra: la colonna di ×
  g.font = `800 34px ${F.body}`;
  for (let i = 0; i < 4; i++) g.fillText('×', 22, 1060 + i * 46);

  // contenuto
  y = 500;
  const lives = draft.lives ?? [];
  if (draft.kind === 'new-many' || draft.kind === 'mixed') {
    const items = draft.items ?? lives.map((live) => ({ type: 'new', live }));
    const TAG = { new: 'NUOVA', moved: 'SPOSTATA', cancelled: 'ANNULLATA', changed: 'AGGIORNATA' };
    const top = y;
    for (const it of items.slice(0, 7)) {
      const p = parts(it.live.start);
      const off = it.type === 'cancelled';
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(110, y, 860, 140);
      g.fillStyle = C.lilac;
      square(g, 140, y + 42, 12);
      g.font = `400 38px ${F.mono}`;
      g.fillStyle = C.lilac;
      const head = `${p.short} · ${p.time}${draft.kind === 'mixed' ? `  [${TAG[it.type]}]` : ''}`;
      g.fillText(head.split('').join(String.fromCharCode(8202)), 162, y + 55);
      g.font = `600 44px ${F.body}`;
      g.fillStyle = off ? C.muted : C.text;
      const sub = it.type === 'moved' && it.before ? `prima: ${parts(it.before.start).short} ${it.before.start.slice(11)}` : `${it.live.title || 'Live'}${it.live.game ? ` · ${it.live.game}` : ''}`;
      const t = wrap(g, sub, 780)[0];
      g.fillText(t, 140, y + 112);
      if (off) g.fillRect(140, y + 96, g.measureText(t).width, 4);
      y += 156;
    }
    // linea della "chat" con i quadratini alle estremità
    g.fillStyle = C.line;
    g.fillRect(92, top - 10, 4, y - top);
    square(g, 94, top - 24, 16, false);
    square(g, 94, y + 8, 16);
    if (items.length > 7) { g.font = `600 36px ${F.body}`; g.fillStyle = C.muted; g.fillText(`…e altre ${items.length - 7}`, 140, y + 60); }
  } else {
    const e = lives[0] ?? { start: '2026-01-01T21:00' };
    const p = parts(e.start);
    const cancelled = draft.kind === 'cancelled';
    frame(g, 110, y + 30, 860, 790, cancelled ? 'LIVE ANNULLATA' : draft.kind === 'moved' ? 'NUOVO ORARIO' : 'PROSSIMA LIVE');
    let yy = y + 150;
    g.font = `400 84px ${F.block}`;
    g.fillStyle = C.text;
    g.fillText(p.weekday, 160, yy);
    g.font = `400 52px ${F.mono}`;
    g.fillStyle = C.lilac;
    g.fillText(p.date, 164, yy + 76);
    g.font = `400 230px ${F.block}`;
    g.fillStyle = cancelled ? C.muted : C.lilac;
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowOffsetX = 5; g.shadowOffsetY = 8;
    g.fillText(p.time, 150, yy + 330);
    g.shadowColor = 'transparent';
    if (cancelled) { g.fillStyle = C.pink; g.fillRect(140, yy + 236, g.measureText(p.time).width + 20, 14); }
    yy += 440;
    if (draft.kind === 'moved' && draft.before) {
      const b = parts(draft.before.start);
      g.font = `400 40px ${F.mono}`;
      g.fillStyle = C.muted;
      const was = `PRIMA: ${b.short} ${b.time}`;
      g.fillText(was, 164, yy);
      g.fillRect(164, yy - 13, g.measureText(was).width, 4);
      yy += 70;
    }
    if (e.title) {
      g.font = `800 54px ${F.body}`;
      g.fillStyle = C.text;
      for (const l of wrap(g, e.title, 760).slice(0, 2)) { g.fillText(l, 160, yy); yy += 64; }
    }
    if (e.game) {
      g.fillStyle = C.lilac;
      square(g, 172, yy - 4, 14);
      g.font = `400 42px ${F.mono}`;
      g.fillText(e.game.toUpperCase(), 196, yy + 10);
    }
    if (cancelled && draft.next) {
      const n = parts(draft.next.start);
      g.font = `600 44px ${F.body}`;
      g.fillStyle = C.text;
      g.fillText(`Ci vediamo ${n.short.toLowerCase()} alle ${n.time}!`, 130, y + 870);
    }
  }

  // in fondo: il nome nella cornice con i cerchi intrecciati, e il link
  const name = (login || 'live').replace(/_.*$/, '').toUpperCase();
  const by = H - 330;
  g.strokeStyle = C.line;
  g.lineWidth = 4;
  g.beginPath(); g.roundRect(190, by, 700, 150, 6); g.stroke();
  g.lineWidth = 3;
  for (const dx of [-28, 28]) { g.beginPath(); g.arc(W / 2 + dx, by + 75, 118, 0, Math.PI * 2); g.stroke(); }
  g.font = `400 80px ${F.block}`;
  g.fillStyle = C.text;
  g.textAlign = 'center';
  g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowOffsetX = 4; g.shadowOffsetY = 5;
  g.fillText(name, W / 2, by + 104);
  g.shadowColor = 'transparent';
  g.font = `400 40px ${F.mono}`;
  g.fillStyle = C.lilac;
  g.fillText(`twitch.tv/${login || '…'}`, W / 2, by + 250);
  g.textAlign = 'left';
  return canvas;
}

/**
 * Variante orizzontale per Discord (1600×900, 16:9): stesso stile della storia, ma con il titolo a sinistra
 * e la live (o l'elenco delle live) a destra, così nell'anteprima di Discord si legge tutto senza aprirla.
 */
export async function drawBanner(canvas, draft, { login = '', mascot = null } = {}) {
  const BW = 1600;
  const BH = 900;
  canvas.width = BW;
  canvas.height = BH;
  const g = canvas.getContext('2d');
  await loadFonts();
  g.fillStyle = C.bg;
  g.fillRect(0, 0, BW, BH);
  topo(g, draft.id ?? 'x', BW, BH);
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';

  // a sinistra: lupo e titolo a blocchi (lilla e bianco), ■ STAY CONNECTED ■
  let x0 = 70;
  if (mascot) { try { const s = 170; g.drawImage(mascot, 50, 60, s, s * (mascot.height / mascot.width || 1)); x0 = 240; g.fillStyle = C.line; g.fillRect(x0 - 14, 80, 5, 140); } catch { /* niente */ } }
  const words = String(draft.headline ?? 'LIVE').split(' ');
  const l1 = words.length > 1 ? words.slice(0, Math.ceil(words.length / 2)).join(' ') : '';
  const l2 = words.length > 1 ? words.slice(Math.ceil(words.length / 2)).join(' ') : words[0];
  const maxW = 760 - x0;
  const fit = (t, size) => { let s = size; do { g.font = `400 ${s}px ${F.block}`; s -= 4; } while (g.measureText(t).width > maxW && s > 32); return s + 4; };
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowOffsetX = 4; g.shadowOffsetY = 6; g.shadowBlur = 0;
  if (l1) { const s = fit(l1, 84); g.font = `400 ${s}px ${F.block}`; g.fillStyle = C.lilac; g.fillText(l1, x0, 145); }
  const s2 = fit(l2, 92); g.font = `400 ${s2}px ${F.block}`; g.fillStyle = C.text; g.fillText(l2, x0, l1 ? 230 : 190);
  g.shadowColor = 'transparent';
  let y = 310;
  g.font = `800 32px ${F.body}`;
  g.fillStyle = C.text;
  square(g, 80, y - 11, 14);
  g.fillText('STAY', 100, y);
  const w1 = g.measureText('STAY ').width;
  g.fillStyle = C.lilac; g.fillText('CONNECTED', 100 + w1, y);
  const w2 = g.measureText('CONNECTED').width;
  g.fillStyle = C.text; square(g, 100 + w1 + w2 + 20, y - 11, 14);
  g.fillRect(100 + w1 + w2 + 44, y - 13, 760 - (100 + w1 + w2 + 44), 4);

  // colonna di × e, in fondo a sinistra, il nome nella cornice con i cerchi intrecciati e il link
  g.font = `800 30px ${F.body}`;
  for (let i = 0; i < 3; i++) g.fillText('×', 22, 420 + i * 40);
  const name = (login || 'live').replace(/_.*$/, '').toUpperCase();
  const cx = 410;
  const by = 600;
  g.strokeStyle = C.line;
  g.lineWidth = 4;
  g.beginPath(); g.roundRect(cx - 270, by, 540, 120, 6); g.stroke();
  g.lineWidth = 3;
  for (const dx of [-24, 24]) { g.beginPath(); g.arc(cx + dx, by + 60, 96, 0, Math.PI * 2); g.stroke(); }
  g.font = `400 64px ${F.block}`;
  g.fillStyle = C.text;
  g.textAlign = 'center';
  g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowOffsetX = 4; g.shadowOffsetY = 5;
  g.fillText(name, cx, by + 83);
  g.shadowColor = 'transparent';
  g.font = `400 34px ${F.mono}`;
  g.fillStyle = C.lilac;
  g.fillText(`twitch.tv/${login || '…'}`, cx, by + 205);
  g.textAlign = 'left';

  // a destra: linea verticale con i quadratini e ストリーマー
  g.fillStyle = C.line;
  g.fillRect(BW - 40, 0, 4, 380);
  square(g, BW - 38, 406, 12); square(g, BW - 38, 432, 12, false);
  g.font = `900 44px 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', ${F.body}`;
  [...'ストリーマー'].forEach((ch, i) => { g.save(); g.translate(BW - 38, 494 + i * 52); if (ch === 'ー') g.rotate(Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, 0, 0); g.restore(); });

  // contenuto a destra
  const L = 830;
  const R = BW - 90;
  const lives = draft.lives ?? [];
  if (draft.kind === 'new-many' || draft.kind === 'mixed') {
    const items = draft.items ?? lives.map((live) => ({ type: 'new', live }));
    const TAG = { new: 'NUOVA', moved: 'SPOSTATA', cancelled: 'ANNULLATA', changed: 'AGGIORNATA' };
    const max = 6;
    y = 70;
    const top = y;
    for (const it of items.slice(0, max)) {
      const p = parts(it.live.start);
      const off = it.type === 'cancelled';
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(L + 20, y, R - L - 20, 112);
      g.fillStyle = C.lilac;
      square(g, L + 46, y + 34, 10);
      g.font = `400 32px ${F.mono}`;
      const head = `${p.short} · ${p.time}${draft.kind === 'mixed' ? `  [${TAG[it.type]}]` : ''}`;
      g.fillText(head.split('').join(String.fromCharCode(8202)), L + 64, y + 45);
      g.font = `600 36px ${F.body}`;
      g.fillStyle = off ? C.muted : C.text;
      const sub = it.type === 'moved' && it.before ? `prima: ${parts(it.before.start).short} ${it.before.start.slice(11)}` : `${it.live.title || 'Live'}${it.live.game ? ` · ${it.live.game}` : ''}`;
      const t = wrap(g, sub, R - L - 80)[0];
      g.fillText(t, L + 46, y + 92);
      if (off) g.fillRect(L + 46, y + 80, g.measureText(t).width, 4);
      y += 124;
    }
    g.fillStyle = C.line;
    g.fillRect(L, top - 8, 4, y - top);
    square(g, L + 2, top - 20, 14, false);
    square(g, L + 2, y + 6, 14);
    if (items.length > max) { g.font = `600 30px ${F.body}`; g.fillStyle = C.muted; g.fillText(`…e altre ${items.length - max}`, L + 46, y + 46); }
  } else {
    const e = lives[0] ?? { start: '2026-01-01T21:00' };
    const p = parts(e.start);
    const cancelled = draft.kind === 'cancelled';
    frame(g, L, 70, R - L, 700, cancelled ? 'LIVE ANNULLATA' : draft.kind === 'moved' ? 'NUOVO ORARIO' : 'PROSSIMA LIVE');
    let yy = 170;
    g.font = `400 66px ${F.block}`;
    g.fillStyle = C.text;
    g.fillText(p.weekday, L + 46, yy);
    g.font = `400 42px ${F.mono}`;
    g.fillStyle = C.lilac;
    g.fillText(p.date, L + 50, yy + 60);
    g.font = `400 170px ${F.block}`;
    g.fillStyle = cancelled ? C.muted : C.lilac;
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowOffsetX = 5; g.shadowOffsetY = 8;
    g.fillText(p.time, L + 36, yy + 250);
    g.shadowColor = 'transparent';
    if (cancelled) { g.fillStyle = C.pink; g.fillRect(L + 30, yy + 180, g.measureText(p.time).width + 16, 12); }
    yy += 330;
    if (draft.kind === 'moved' && draft.before) {
      const b = parts(draft.before.start);
      g.font = `400 34px ${F.mono}`;
      g.fillStyle = C.muted;
      const was = `PRIMA: ${b.short} ${b.time}`;
      g.fillText(was, L + 50, yy);
      g.fillRect(L + 50, yy - 11, g.measureText(was).width, 4);
      yy += 56;
    }
    if (e.title) {
      g.font = `800 44px ${F.body}`;
      g.fillStyle = C.text;
      for (const l of wrap(g, e.title, R - L - 100).slice(0, 2)) { g.fillText(l, L + 46, yy); yy += 54; }
    }
    if (e.game && yy < 740) {
      g.fillStyle = C.lilac;
      square(g, L + 56, yy - 4, 12);
      g.font = `400 34px ${F.mono}`;
      g.fillText(e.game.toUpperCase(), L + 78, yy + 8);
    }
    if (cancelled && draft.next) {
      const n = parts(draft.next.start);
      g.font = `600 38px ${F.body}`;
      g.fillStyle = C.text;
      g.fillText(`Ci vediamo ${n.short.toLowerCase()} alle ${n.time}!`, L + 10, 830);
    }
  }
  return canvas;
}
