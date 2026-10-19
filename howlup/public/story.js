// Storia Instagram (1080×1920) per un annuncio: disegnata nel browser, pronta da scaricare o da inviare.
const W = 1080;
const H = 1920;
const FONT = "'Nunito Local', 'Nunito', system-ui, sans-serif";
const C = { bg: '#121016', panel: '#1c1922', text: '#ece8f2', muted: '#a79fb6', lilac: '#b39bd3', pink: '#e36dc9' };

function wrap(g, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function pill(g, text, x, y, { font = `800 44px ${FONT}`, bg = C.panel, fg = C.text, pad = 34, h = 92, align = 'center' } = {}) {
  g.font = font;
  const w = g.measureText(text).width + pad * 2;
  const left = align === 'center' ? x - w / 2 : x;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(left, y, w, h, h / 2);
  g.fill();
  g.fillStyle = fg;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillText(text, left + w / 2, y + h / 2 + 2);
  g.textBaseline = 'alphabetic';
  return w;
}

const dayParts = (start) => {
  const d = new Date(`${start}:00`);
  return {
    weekday: d.toLocaleDateString('it-IT', { weekday: 'long' }).toUpperCase(),
    date: d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }).toUpperCase(),
    short: d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }),
    time: start.slice(11),
  };
};

export async function drawStory(canvas, draft, { login = '', icon } = {}) {
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  try { await Promise.all(['400', '700', '800'].map((w) => document.fonts.load(`${w} 60px 'Nunito Local'`))); } catch { /* si usa il font di riserva */ }

  // sfondo: notte con due bagliori (lilla e rosa)
  g.fillStyle = C.bg;
  g.fillRect(0, 0, W, H);
  for (const [x, y, r, col] of [[180, 260, 760, 'rgba(179,155,211,0.30)'], [940, 1500, 900, 'rgba(227,109,201,0.28)']]) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, col);
    grad.addColorStop(1, 'rgba(18,16,22,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
  // luna
  g.fillStyle = C.text;
  g.beginPath(); g.arc(880, 230, 70, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.bg;
  g.beginPath(); g.arc(912, 205, 62, 0, Math.PI * 2); g.fill();

  // canale
  g.textAlign = 'left';
  if (icon) { try { g.drawImage(icon, 90, 150, 120, 120); } catch { /* niente icona */ } }
  g.fillStyle = C.text;
  g.font = `800 52px ${FONT}`;
  g.fillText((login || 'la mia live').toUpperCase(), icon ? 236 : 90, 200);
  g.fillStyle = C.muted;
  g.font = `700 36px ${FONT}`;
  g.fillText('su Twitch', icon ? 236 : 90, 252);

  // titolo dell'annuncio
  const grad = g.createLinearGradient(90, 0, 990, 0);
  grad.addColorStop(0, C.lilac);
  grad.addColorStop(1, C.pink);
  g.fillStyle = grad;
  g.font = `800 112px ${FONT}`;
  let y = 520;
  for (const l of wrap(g, draft.headline ?? 'LIVE', 900)) { g.fillText(l, 90, y); y += 118; }
  y += 40;

  const lives = draft.lives ?? [];
  if (draft.kind === 'new-many' || draft.kind === 'mixed') {
    const items = draft.items ?? lives.map((live) => ({ type: 'new', live }));
    const TAG = { new: ['NUOVA', C.lilac], moved: ['SPOSTATA', C.pink], cancelled: ['ANNULLATA', C.muted], changed: ['AGGIORNATA', C.lilac] };
    for (const it of items.slice(0, 6)) {
      const e = it.live;
      const p = dayParts(e.start);
      const off = it.type === 'cancelled';
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.beginPath(); g.roundRect(90, y, 900, 170, 30); g.fill();
      g.fillStyle = off ? C.muted : C.pink;
      g.font = `800 56px ${FONT}`;
      g.fillText(p.time, 130, y + 102);
      if (off) g.fillRect(126, y + 84, g.measureText(p.time).width + 8, 6);
      g.fillStyle = C.text;
      g.font = `800 44px ${FONT}`;
      g.fillText(p.short, 330, y + 70);
      if (draft.kind === 'mixed') {
        const [label, col] = TAG[it.type] ?? TAG.new;
        g.font = `800 26px ${FONT}`;
        const lw = g.measureText(label).width + 28;
        g.fillStyle = col;
        g.beginPath(); g.roundRect(960 - lw, y + 28, lw, 44, 22); g.fill();
        g.fillStyle = '#121016';
        g.textAlign = 'center';
        g.fillText(label, 960 - lw / 2, y + 59);
        g.textAlign = 'left';
      }
      g.fillStyle = C.muted;
      g.font = `700 34px ${FONT}`;
      const sub = it.type === 'moved' && it.before ? `prima: ${dayParts(it.before.start).short} ${it.before.start.slice(11)}` : `${e.title || 'Live'}${e.game ? ` · ${e.game}` : ''}`;
      g.fillText(wrap(g, sub, 620)[0], 330, y + 124);
      y += 196;
    }
    if (items.length > 6) { g.fillStyle = C.muted; g.font = `700 40px ${FONT}`; g.fillText(`…e altre ${items.length - 6}`, 90, y + 40); }
  } else {
    const e = lives[0] ?? {};
    const p = dayParts(e.start ?? '2026-01-01T21:00');
    const cancelled = draft.kind === 'cancelled';
    g.fillStyle = C.text;
    g.font = `800 92px ${FONT}`;
    g.fillText(p.weekday, 90, y + 70);
    g.fillStyle = C.muted;
    g.font = `800 64px ${FONT}`;
    g.fillText(p.date, 90, y + 160);
    g.fillStyle = cancelled ? C.muted : C.pink;
    g.font = `800 240px ${FONT}`;
    g.fillText(p.time, 80, y + 400);
    if (cancelled) { g.fillStyle = C.pink; g.fillRect(70, y + 300, 640, 16); }
    y += 470;
    if (draft.kind === 'moved' && draft.before) {
      const b = dayParts(draft.before.start);
      g.fillStyle = C.muted;
      g.font = `700 44px ${FONT}`;
      const was = `invece di ${b.short} alle ${b.time}`;
      g.fillText(was, 90, y);
      g.fillRect(90, y - 14, g.measureText(was).width, 4);
      y += 80;
    }
    if (e.title) {
      g.fillStyle = C.text;
      g.font = `800 64px ${FONT}`;
      for (const l of wrap(g, e.title, 900).slice(0, 3)) { g.fillText(l, 90, y + 40); y += 78; }
      y += 30;
    }
    if (e.game) { pill(g, `🎮 ${e.game}`, 90, y, { align: 'left', bg: 'rgba(179,155,211,0.22)' }); y += 130; }
    if (cancelled && draft.next) {
      const n = dayParts(draft.next.start);
      g.fillStyle = C.text;
      g.font = `700 50px ${FONT}`;
      g.fillText(`Ci vediamo ${n.short} alle ${n.time}!`, 90, y + 50);
    }
  }

  // link in fondo
  pill(g, `twitch.tv/${login || '…'}`, W / 2, H - 230, { font: `800 52px ${FONT}`, bg: C.pink, fg: '#fff', h: 112, pad: 54 });
  return canvas;
}
