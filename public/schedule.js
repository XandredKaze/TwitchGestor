// Scheda "Programmazione": live in programma, creazione di più settimane, titolo automatico,
// calendario di Twitch e immagine della settimana da condividere.
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => window.TG.api(path, opts);
  let state = null;
  let titles = [];
  let editing = null; // id della live che stai modificando
  let loaded = false;
  let channelLogin = '';
  window.addEventListener('tg:state', (e) => { channelLogin = e.detail?.twitch?.user?.login ?? ''; });

  const pad = (n) => String(n).padStart(2, '0');
  const toLocal = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const ms = (local) => new Date(local).getTime();
  const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  const weekday = (local) => (new Date(local).getDay() + 6) % 7;
  const dayLabel = (local) => new Date(local).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
  const durLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
  const endTime = (e) => toLocal(ms(e.start) + e.durationMin * 60000).slice(11);
  const mondayOf = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const DURATIONS = [60, 90, 120, 150, 180, 240, 300, 360];

  async function save(entries) {
    const r = await api('/api/schedule', { method: 'PUT', body: { entries } });
    if (r) { state = r; render(); }
  }

  /** Campo categoria con ricerca su Twitch. */
  function categoryField(initial = { id: '', name: '' }) {
    let game = { ...initial };
    const input = el('input', { type: 'text', value: game.name ?? '', placeholder: 'Cerca una categoria…', autocomplete: 'off' });
    const results = el('div', { className: 'qa-results' });
    let t = 0;
    input.oninput = () => {
      clearTimeout(t);
      game = { id: '', name: input.value };
      t = setTimeout(async () => {
        const q = input.value.trim();
        if (!q) { results.replaceChildren(); return; }
        const r = await api(`/api/actions/categories?q=${encodeURIComponent(q)}`, { method: 'GET', quiet: true });
        results.replaceChildren(...(r?.categories ?? []).map((c) => el('button', {
          type: 'button', className: 'qa-cat',
          onclick: () => { game = { id: c.id, name: c.name }; input.value = c.name; results.replaceChildren(); },
        }, c.art ? el('img', { src: c.art, alt: '', width: '26', height: '36' }) : null, c.name)));
      }, 300);
    };
    return { node: el('div', { className: 'sc-cat' }, input, results), get: () => game, set: (g) => { game = { ...g }; input.value = g.name ?? ''; } };
  }

  /** Titoli già usati: un clic li mette nel modulo. */
  const titleChips = (onPick) => (titles.length ? el('div', { className: 'qa-used' },
    el('span', { className: 'qa-used-head' }, 'Titoli usati nelle live'),
    ...titles.slice(0, 6).map((t) => el('button', { type: 'button', className: 'qa-used-title', onclick: () => onPick(t) }, el('b', {}, t.title), t.game ? el('small', {}, t.game) : null))) : null);

  const field = (label, control, hint) => el('label', { className: 'field' }, el('span', { className: 'field-label' }, label), control, hint ? el('span', { className: 'hint' }, hint) : null);
  const durSelect = (value = 120) => {
    const s = el('select', {}, ...DURATIONS.map((m) => el('option', { value: String(m) }, durLabel(m))));
    s.value = String(DURATIONS.includes(value) ? value : 120);
    return s;
  };

  // ---------- modulo: una live ----------
  function entryForm() {
    const e = state.entries.find((x) => x.id === editing);
    const startDefault = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(21, 0, 0, 0); return toLocal(d.getTime()); })();
    const date = el('input', { type: 'date', value: (e?.start ?? startDefault).slice(0, 10) });
    const time = el('input', { type: 'time', value: (e?.start ?? startDefault).slice(11) });
    const dur = durSelect(e?.durationMin);
    const title = el('input', { type: 'text', maxlength: '140', value: e?.title ?? '', placeholder: 'Titolo della live' });
    const cat = categoryField({ id: e?.gameId ?? '', name: e?.game ?? '' });
    const notes = el('input', { type: 'text', maxlength: '300', value: e?.notes ?? '', placeholder: 'Facoltative, solo per te (es. "con ospite")' });
    const auto = el('input', { type: 'checkbox', checked: e ? e.autoTitle !== false : true });
    return el('form', {
      className: 'sc-form',
      onsubmit: (ev) => {
        ev.preventDefault();
        if (!date.value || !time.value) return;
        const g = cat.get();
        const entry = { ...(e ?? {}), start: `${date.value}T${time.value}`, durationMin: Number(dur.value), title: title.value.trim(), game: g.id ? g.name : '', gameId: g.id || '', notes: notes.value.trim(), autoTitle: auto.checked };
        editing = null;
        save(e ? state.entries.map((x) => (x.id === e.id ? entry : x)) : [...state.entries, entry]);
      },
    },
    el('div', { className: 'grid-3' }, field('Giorno', date), field('Ora di inizio', time), field('Durata prevista', dur)),
    field('Titolo', title),
    titleChips((t) => { title.value = t.title; if (t.gameId) cat.set({ id: t.gameId, name: t.game }); }),
    field('Categoria', cat.node),
    field('Note', notes),
    el('label', { className: 'check' }, auto, `Imposta da solo titolo e categoria su Twitch 10 minuti prima dell'inizio`),
    el('div', { className: 'row' },
      el('button', { type: 'submit', className: 'primary' }, e ? '💾 Salva modifiche' : '＋ Aggiungi alla programmazione'),
      e ? el('button', { type: 'button', onclick: () => { editing = null; render(); } }, 'Annulla') : null));
  }

  // ---------- modulo: più settimane ----------
  function weeksForm() {
    const days = DAYS.map((d, i) => el('label', { className: 'sc-day' }, el('input', { type: 'checkbox', value: String(i + 1) }), d.slice(0, 3)));
    const time = el('input', { type: 'time', value: '21:00' });
    const dur = durSelect(120);
    const weeks = el('select', {}, ...[1, 2, 3, 4, 6, 8].map((n) => el('option', { value: String(n) }, n === 1 ? '1 settimana' : `${n} settimane`)));
    weeks.value = '4';
    const title = el('input', { type: 'text', maxlength: '140', placeholder: 'Titolo (si può cambiare live per live)' });
    const cat = categoryField();
    const out = el('p', { className: 'muted small' });
    return el('form', {
      className: 'sc-form',
      onsubmit: (ev) => {
        ev.preventDefault();
        const chosen = days.map((d) => d.querySelector('input')).filter((i) => i.checked).map((i) => Number(i.value));
        if (!chosen.length) { out.textContent = 'Scegli almeno un giorno.'; return; }
        const [hh, mm] = time.value.split(':').map(Number);
        const g = cat.get();
        const list = [];
        const start = new Date(); start.setHours(0, 0, 0, 0);
        for (let i = 0; i < Number(weeks.value) * 7; i++) {
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, hh, mm);
          if (d.getTime() <= Date.now() || !chosen.includes(((d.getDay() + 6) % 7) + 1)) continue;
          const local = toLocal(d.getTime());
          if (state.entries.some((x) => x.start === local)) continue;
          list.push({ start: local, durationMin: Number(dur.value), title: title.value.trim(), game: g.id ? g.name : '', gameId: g.id || '', autoTitle: true });
        }
        out.textContent = list.length ? `✓ Aggiunte ${list.length} live.` : 'Nessuna live nuova da aggiungere (ci sono già).';
        if (list.length) save([...state.entries, ...list]);
      },
    },
    field('Giorni della settimana', el('div', { className: 'sc-days' }, ...days)),
    el('div', { className: 'grid-3' }, field('Ora di inizio', time), field('Durata prevista', dur), field('Per quante settimane', weeks)),
    field('Titolo', title),
    titleChips((t) => { title.value = t.title; if (t.gameId) cat.set({ id: t.gameId, name: t.game }); }),
    field('Categoria', cat.node),
    el('div', { className: 'row' }, el('button', { type: 'submit', className: 'primary' }, '📅 Crea le live'), out));
  }

  // ---------- elenco ----------
  function entryRow(e) {
    const past = ms(e.start) + e.durationMin * 60000 < Date.now();
    const now = ms(e.start) <= Date.now() && !past;
    return el('div', { className: `sc-item ${now ? 'now' : ''} ${past ? 'past' : ''} ${editing === e.id ? 'editing' : ''}` },
      el('div', { className: 'sc-when' }, el('b', {}, e.start.slice(11)), el('span', {}, `fino alle ${endTime(e)}`)),
      el('div', { className: 'sc-what' },
        el('b', {}, e.title || '(titolo da decidere)'),
        el('span', { className: 'muted small' }, [e.game || 'categoria da decidere', durLabel(e.durationMin), e.notes].filter(Boolean).join(' · ')),
        el('span', { className: 'sc-badges' },
          now ? el('span', { className: 'sc-badge live' }, '🔴 adesso') : null,
          e.autoTitle && (e.title || e.gameId) ? el('span', { className: 'sc-badge' }, e.applied ? '✓ titolo impostato' : '🕒 titolo automatico') : null,
          e.twitchId ? el('span', { className: 'sc-badge' }, '✓ sul calendario di Twitch') : null)),
      el('div', { className: 'sc-actions' },
        el('button', { type: 'button', className: 'small-btn', title: 'Modifica', onclick: () => { editing = e.id; render(); $('sc-form-box').scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, '✎'),
        el('button', { type: 'button', className: 'small-btn', title: 'Duplica la settimana dopo', onclick: () => save([...state.entries, { ...e, id: undefined, twitchId: '', applied: false, start: toLocal(ms(e.start) + 7 * 86400000) }]) }, '⧉'),
        el('button', { type: 'button', className: 'mod-x', title: 'Togli', onclick: () => confirm('Togliere questa live dalla programmazione?') && save(state.entries.filter((x) => x.id !== e.id)) }, '✕')));
  }

  function renderList() {
    const upcoming = state.entries.filter((e) => ms(e.start) + e.durationMin * 60000 > Date.now());
    const box = $('sc-list');
    if (!upcoming.length) {
      box.replaceChildren(el('p', { className: 'muted' }, 'Nessuna live in programma. Aggiungine una qui accanto, oppure creane più settimane in un colpo.'));
      return;
    }
    const weeks = new Map();
    for (const e of upcoming) {
      const w = mondayOf(ms(e.start));
      if (!weeks.has(w)) weeks.set(w, []);
      weeks.get(w).push(e);
    }
    const thisWeek = mondayOf(Date.now());
    box.replaceChildren(...[...weeks].map(([w, list]) => el('div', { className: 'sc-week' },
      el('h3', {}, w === thisWeek ? 'Questa settimana' : w === thisWeek + 7 * 86400000 ? 'Settimana prossima' : `Settimana dal ${new Date(w).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}`),
      ...[...new Set(list.map((e) => e.start.slice(0, 10)))].map((day) => el('div', { className: 'sc-day-group' },
        el('span', { className: 'sc-day-name' }, dayLabel(`${day}T12:00`)),
        ...list.filter((e) => e.start.startsWith(day)).map(entryRow))))));
  }

  function renderNext() {
    const n = state.next;
    const box = $('sc-next');
    if (!n) { box.replaceChildren(el('span', { className: 'muted' }, 'Nessuna prossima live in programma.')); return; }
    const diff = ms(n.start) - Date.now();
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.max(0, Math.floor((diff % 3600000) / 60000));
    box.replaceChildren(
      el('span', { className: 'sc-next-label' }, 'Prossima live'),
      el('b', {}, `${dayLabel(n.start)} alle ${n.start.slice(11)}`),
      el('span', {}, n.title || '(titolo da decidere)', n.game ? el('span', { className: 'muted' }, ` · ${n.game}`) : null),
      el('span', { className: 'sc-countdown' }, `tra ${days ? `${days} g ` : ''}${hours} h ${mins} min`),
      el('span', { className: 'muted small' }, 'In chat gli spettatori possono saperlo con un comando che usa {nextlive} (scheda Comandi).'));
  }

  function renderTwitch() {
    const box = $('sc-twitch');
    const toPublish = state.entries.filter((e) => ms(e.start) > Date.now());
    const out = el('p', { className: 'muted small' });
    box.replaceChildren(
      el('p', { className: 'muted small' }, 'Le live in programma compaiono anche nella pagina del tuo canale su Twitch ("Programmazione"), così gli spettatori sanno quando tornare. Funziona per gli affiliati e i partner.'),
      state.canPublish
        ? el('button', {
          type: 'button', className: 'primary', disabled: !toPublish.length || undefined,
          onclick: async () => {
            out.textContent = 'Pubblico…';
            const r = await api('/api/schedule/publish', { body: { ids: toPublish.map((e) => e.id) } });
            if (!r) { out.textContent = ''; return; }
            state = r;
            const bad = r.results.filter((x) => !x.ok);
            render();
            $('sc-twitch').querySelector('p:last-child').textContent = bad.length ? `Non pubblicate ${bad.length}: ${bad[0].error}` : `✓ ${r.results.length} live sul calendario di Twitch.`;
          },
        }, `📤 Pubblica su Twitch (${toPublish.length})`)
        : el('p', { className: 'cmd-warn' }, 'Per pubblicare sul calendario di Twitch serve un permesso in più: clicca "Esci" in alto a destra e poi "Accedi con Twitch".'),
      out);
  }

  // ---------- immagine della settimana ----------
  async function drawWeek(canvas, { weekStart, style, format }) {
    const W = 1920;
    const H = format === 'square' ? 1920 : format === 'portrait' ? 2400 : 1080;
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const brutal = style === 'brutal';
    const fonts = brutal ? ['400 60px Bungee', '400 30px "Share Tech Mono"', '500 30px Outfit'] : ['800 60px Poppins', '600 30px Poppins'];
    await Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => {})));
    const title = brutal ? "'Bungee', Impact, sans-serif" : "'Poppins', 'Segoe UI', sans-serif";
    const mono = brutal ? "'Share Tech Mono', monospace" : "'Poppins', 'Segoe UI', sans-serif";
    const body = brutal ? "'Outfit', 'Segoe UI', sans-serif" : "'Poppins', 'Segoe UI', sans-serif";
    const lilac = '#b39bd3';
    // sfondo
    if (brutal) {
      g.fillStyle = '#141414'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    } else {
      const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, '#2a1650'); grad.addColorStop(0.6, '#5b21b6'); grad.addColorStop(1, '#7c3aed');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
    }
    const M = 90;
    const login = channelLogin;
    // intestazione
    g.fillStyle = '#ffffff';
    g.textBaseline = 'alphabetic';
    if (brutal) {
      g.strokeStyle = '#e6e6e6'; g.lineWidth = 4; g.strokeRect(M - 30, M - 30, W - 2 * M + 60, H - 2 * M + 60);
      g.font = `400 34px ${mono}`; g.fillStyle = '#e6e6e6';
      g.fillText('// PROGRAMMAZIONE', M, M + 20); g.fillStyle = lilac; g.textAlign = 'right'; g.fillText('_ ▢ ✕', W - M, M + 20); g.textAlign = 'left';
      g.fillRect(M - 30, M + 46, W - 2 * M + 60, 4);
    }
    const end = weekStart + 6 * 86400000;
    g.font = `${brutal ? 400 : 800} ${brutal ? 92 : 100}px ${title}`;
    g.fillStyle = '#ffffff';
    const head = brutal ? 'LIVE DELLA SETTIMANA' : 'Live della settimana';
    g.fillText(head, M, M + (brutal ? 160 : 110));
    g.font = `500 40px ${body}`; g.fillStyle = brutal ? lilac : '#e9ddff';
    g.fillText(`${new Date(weekStart).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })} – ${new Date(end).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}${login ? `  ·  twitch.tv/${login}` : ''}`, M, M + (brutal ? 225 : 175));
    // giorni
    const entries = state.entries.filter((e) => ms(e.start) >= weekStart && ms(e.start) < weekStart + 7 * 86400000);
    const top = M + (brutal ? 290 : 240);
    const rowH = (H - top - M) / 7;
    for (let i = 0; i < 7; i++) {
      const y = top + i * rowH;
      const list = entries.filter((e) => weekday(e.start) === i);
      const on = list.length > 0;
      if (brutal) {
        g.fillStyle = on ? 'rgba(179,155,211,.12)' : 'rgba(255,255,255,.02)'; g.fillRect(M, y + 8, W - 2 * M, rowH - 16);
        g.strokeStyle = on ? '#e6e6e6' : '#4a4a4a'; g.lineWidth = 2; g.strokeRect(M, y + 8, W - 2 * M, rowH - 16);
      } else {
        g.fillStyle = on ? 'rgba(255,255,255,.16)' : 'rgba(255,255,255,.05)';
        g.beginPath(); g.roundRect(M, y + 8, W - 2 * M, rowH - 16, 22); g.fill();
      }
      const cy = y + rowH / 2;
      g.textBaseline = 'middle';
      g.font = `${brutal ? 400 : 700} ${Math.min(46, rowH * 0.36)}px ${brutal ? mono : body}`;
      g.fillStyle = on ? (brutal ? lilac : '#ffffff') : 'rgba(255,255,255,.4)';
      g.fillText(brutal ? DAYS[i].toUpperCase() : DAYS[i], M + 40, cy);
      if (on) {
        const e = list[0];
        g.font = `${brutal ? 400 : 800} ${Math.min(52, rowH * 0.4)}px ${brutal ? title : body}`;
        g.fillStyle = '#ffffff';
        const timeText = list.map((x) => x.start.slice(11)).join(' + ');
        g.fillText(timeText, M + 420, cy);
        g.font = `500 ${Math.min(40, rowH * 0.33)}px ${body}`;
        g.fillStyle = brutal ? '#e6e6e6' : '#f1ebff';
        const text = [e.title, e.game].filter(Boolean).join('  ·  ') || 'in live!';
        const maxW = W - 2 * M - 420 - 340 - 40;
        let t = text;
        while (g.measureText(t).width > maxW && t.length > 4) t = `${t.slice(0, -2)}…`;
        g.fillText(t, M + 420 + 300, cy);
      } else {
        g.font = `500 ${Math.min(34, rowH * 0.26)}px ${body}`; g.fillStyle = 'rgba(255,255,255,.35)';
        g.fillText('riposo', M + 420, cy);
      }
    }
    g.textBaseline = 'alphabetic';
  }

  function renderImage() {
    const box = $('sc-image');
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    const week = el('select', {}, el('option', { value: '0' }, 'Questa settimana'), el('option', { value: '1' }, 'Settimana prossima'), el('option', { value: '2' }, 'Tra due settimane'));
    const style = el('select', {}, el('option', { value: 'classic' }, 'Classico (viola)'), el('option', { value: 'brutal' }, 'Brutalism'));
    style.value = document.documentElement.dataset.ui === 'brutal' ? 'brutal' : 'classic';
    const format = el('select', {}, el('option', { value: 'wide' }, '16:9 (Discord, X, YouTube)'), el('option', { value: 'square' }, 'Quadrato (Instagram)'), el('option', { value: 'portrait' }, 'Verticale 4:5 (Instagram)'));
    const canvas = el('canvas', { className: 'sc-canvas' });
    const draw = () => drawWeek(canvas, { weekStart: mondayOf(Date.now()) + Number(week.value) * 7 * 86400000, style: style.value, format: format.value });
    for (const s of [week, style, format]) s.onchange = draw;
    box.replaceChildren(
      el('p', { className: 'muted small' }, 'Un\'immagine con le live della settimana, pronta da pubblicare su Discord, Instagram o X.'),
      el('div', { className: 'grid-3' }, field('Settimana', week), field('Stile', style), field('Formato', format)),
      canvas,
      el('div', { className: 'row' },
        el('button', {
          type: 'button', className: 'primary',
          onclick: () => canvas.toBlob((b) => {
            const a = el('a', { href: URL.createObjectURL(b), download: `programmazione-${toLocal(mondayOf(Date.now()) + Number(week.value) * 7 * 86400000).slice(0, 10)}.png` });
            document.body.append(a); a.click(); a.remove();
          }, 'image/png'),
        }, '⬇ Scarica l\'immagine'),
        el('button', {
          type: 'button',
          onclick: (ev) => canvas.toBlob(async (b) => {
            const btn = ev.target;
            btn.disabled = true;
            const r = await api('/api/telegram/photo', { body: b, headers: { 'Content-Type': 'image/png' } });
            btn.disabled = false;
            if (r) { btn.textContent = '✓ Inviata al canale'; setTimeout(() => { btn.textContent = '📣 Manda al canale Telegram'; }, 2500); }
          }, 'image/png'),
        }, '📣 Manda al canale Telegram')));
    box.redraw = draw;
  }

  function render() {
    if (!state) return;
    renderNext();
    renderList();
    const form = $('sc-form-box');
    form.replaceChildren(
      el('h2', {}, editing ? 'Modifica la live' : 'Aggiungi una live'),
      entryForm());
    if (!$('sc-weeks').dataset.ready) { $('sc-weeks').dataset.ready = '1'; $('sc-weeks').replaceChildren(weeksForm()); }
    renderTwitch();
    renderImage();
    $('sc-image').redraw?.();
  }

  async function load({ fresh = false } = {}) {
    loaded = true;
    const [s, t] = await Promise.all([api('/api/schedule', { method: 'GET', quiet: true }), api('/api/titles', { method: 'GET', quiet: true })]);
    state = s ?? { entries: [] };
    titles = t?.titles ?? [];
    if (fresh) $('sc-weeks').dataset.ready = '';
    render();
  }

  window.addEventListener('tg:schedule', () => { if (loaded && !$('tab-schedule').hidden && !editing) load(); });
  window.addEventListener('tab:schedule', () => load({ fresh: true }));
  setInterval(() => { if (state && !$('tab-schedule').hidden) renderNext(); }, 30000);
  if (!$('tab-schedule').hidden) load({ fresh: true });
})();
