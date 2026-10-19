// Howl-UP: la pagina (telefono e PC). I dati stanno sul Raspberry; qui si mostrano e si modificano.
import { occurrences, repeatText, today, addDays, parseDate, dateKey, weekday, WEEKDAYS, FREQS } from './core/agenda.js';

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style') for (const [p, val] of Object.entries(v)) n.style.setProperty(p.startsWith('--') ? p : p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), val);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'className') n.className = v;
    else if (k === 'value' || k === 'checked') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
  return n;
}

// ---------- password e chiamate al Raspberry ----------
const params = new URLSearchParams(location.search);
let token = params.get('token');
try { if (token) localStorage.setItem('howlupToken', token); else token = localStorage.getItem('howlupToken'); } catch { /* niente */ }
if (params.has('token')) history.replaceState(null, '', location.pathname + location.hash);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'x-howlup': '1', ...(token ? { 'x-dashboard-token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (res?.status === 401) { showLogin(Boolean(token)); return null; }
  const data = res ? await res.json().catch(() => ({})) : null;
  if (!res?.ok) { toast(data?.error ?? 'Howl-UP non raggiungibile'); return null; }
  return data;
}

function showLogin(wrong) {
  const input = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'password' });
  const msg = el('p', { className: 'muted small' }, wrong ? 'La password salvata non è più valida.' : '');
  document.body.replaceChildren(el('div', { className: 'login' }, el('form', {
    className: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      const res = await fetch('/api/state', { headers: { 'x-dashboard-token': input.value.trim() } }).catch(() => null);
      if (res?.ok) { try { localStorage.setItem('howlupToken', input.value.trim()); } catch { /* niente */ } location.reload(); } else msg.textContent = res ? 'Password sbagliata.' : 'Howl-UP non raggiungibile.';
    },
  }, el('div', { className: 'brand' }, el('img', { src: 'icon.svg', alt: '', width: '40', height: '40' }), el('b', {}, 'Howl', el('span', {}, '-UP'))),
  el('span', {}, 'Scrivi la password (la stessa della dashboard di TwitchGestor). Su questo dispositivo serve una volta sola.'),
  el('div', { className: 'field' }, input), msg,
  el('button', { type: 'submit', className: 'btn primary' }, 'Entra'))));
  input.focus();
}

let toastTimer = 0;
function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = el('div', { className: 'toast', role: 'status' }, text);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}

// ---------- dati ----------
let data = { rev: 0, categories: [], events: [], tasks: [], calendarPath: '' };
let view = location.hash.slice(1) || 'today';
let calMonth = today().slice(0, 7);
let calDay = today();

async function load(force = false) {
  const r = await api(`/api/state${force ? '' : `?rev=${data.rev}`}`);
  if (!r || r.unchanged) return;
  data = r;
  render();
}
const cat = (id) => data.categories.find((c) => c.id === id);
const colorOf = (id) => cat(id)?.color ?? 'var(--accent)';

// ---------- formati ----------
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const longDate = (d) => parseDate(d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (d) => parseDate(d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
function relDay(d) {
  const t = today();
  if (d === t) return 'oggi';
  if (d === addDays(t, 1)) return 'domani';
  if (d === addDays(t, -1)) return 'ieri';
  return shortDate(d);
}
function untilText(o) {
  const t = today();
  if (o.day !== t || o.allDay) return '';
  const diff = toMin(o.time) - nowMin();
  if (diff <= 0) return o.endTime && toMin(o.endTime) > nowMin() ? 'adesso' : '';
  return diff < 60 ? `tra ${diff} min` : `tra ${Math.floor(diff / 60)} h ${diff % 60 ? `${diff % 60} min` : ''}`.trim();
}
const greeting = () => { const h = new Date().getHours(); return h < 6 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera'; };

// ---------- pezzi ----------
function itemRow(o) {
  const c = cat(o.category);
  const past = o.day === today() && !o.allDay && toMin(o.endTime || o.time) < nowMin();
  return el('button', { type: 'button', className: `item${past ? ' past' : ''}`, style: { '--c': colorOf(o.category) }, onclick: () => eventSheet(o) },
    el('span', { className: 't' }, o.allDay ? 'tutto il giorno' : o.time, o.endTime ? el('small', {}, o.endTime) : null),
    el('span', { className: 'bar' }),
    el('span', { className: 'what' }, el('b', {}, o.title),
      el('span', {}, [c ? `${c.icon} ${c.name}` : '', o.repeat?.freq !== 'none' ? `↻ ${repeatText(o)}` : ''].filter(Boolean).join(' · '))));
}

function taskRow(t) {
  const d = t.due;
  const late = d && !t.done && d < today();
  return el('div', { className: `task${t.done ? ' done' : ''}`, style: { '--c': t.category ? colorOf(t.category) : 'var(--muted)' } },
    el('button', { type: 'button', className: 'check', 'aria-label': t.done ? 'Segna da fare' : 'Segna come fatta', onclick: () => toggleTask(t) }, t.done ? '✓' : ''),
    el('button', { type: 'button', className: 'ttl', onclick: () => taskSheet(t) }, t.title),
    d ? el('span', { className: `due${late ? ' late' : d === today() ? ' today' : ''}` }, late ? `in ritardo · ${relDay(d)}` : relDay(d)) : el('span'));
}

async function toggleTask(t) {
  const r = await api('/api/tasks', { method: 'PUT', body: { task: { ...t, done: !t.done, doneAt: Date.now() } } });
  if (r) { if (!t.done) toast('Fatto! 🐺'); load(true); }
}

function quickTask(due = '') {
  const input = el('input', { type: 'text', placeholder: 'Aggiungi una cosa da fare…', maxlength: '200' });
  return el('form', {
    className: 'quick',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!input.value.trim()) return;
      if (await api('/api/tasks', { method: 'PUT', body: { task: { title: input.value.trim(), due } } })) { input.value = ''; load(true); }
    },
  }, input, el('button', { type: 'submit' }, 'Aggiungi'));
}

// ---------- viste ----------
function viewToday() {
  const t = today();
  const list = occurrences(data.events, t, addDays(t, 7));
  const todayList = list.filter((o) => o.day === t);
  const next = todayList.find((o) => o.allDay ? false : toMin(o.endTime || o.time) >= nowMin()) ?? list.find((o) => o.day > t);
  const open = data.tasks.filter((x) => !x.done);
  const urgent = open.filter((x) => x.due && x.due <= t).sort((a, b) => a.due.localeCompare(b.due));
  const tomorrow = list.filter((o) => o.day === addDays(t, 1));
  const later = list.filter((o) => o.day > addDays(t, 1));

  const left = el('div', { className: 'col' },
    el('div', {}, el('h1', {}, `${greeting()} 🐺`), el('div', { className: 'muted' }, `${todayList.length ? `${todayList.length} ${todayList.length === 1 ? 'impegno' : 'impegni'} oggi` : 'Nessun impegno oggi'}${urgent.length ? ` · ${urgent.length} da fare` : ''}`)),
    next
      ? el('button', { type: 'button', className: 'card next', style: { '--c': colorOf(next.category), textAlign: 'left' }, onclick: () => eventSheet(next) },
        el('div', { className: 'label' }, next.day === t ? 'Prossimo' : 'Prossimo impegno'),
        el('div', { className: 'title' }, `${cat(next.category)?.icon ?? ''} ${next.title}`),
        el('div', { className: 'when' }, `${relDay(next.day)}${next.allDay ? ', tutto il giorno' : ` alle ${next.time}`}`),
        untilText(next) ? el('div', { className: 'count' }, untilText(next)) : null)
      : null,
    el('section', { className: 'card' }, el('h2', {}, 'Oggi'),
      todayList.length ? el('div', { className: 'items' }, todayList.map(itemRow)) : el('div', { className: 'empty' }, 'Giornata libera. Premi ＋ per aggiungere un impegno.')),
    el('section', { className: 'card' }, el('h2', {}, 'Domani'),
      tomorrow.length ? el('div', { className: 'items' }, tomorrow.map(itemRow)) : el('div', { className: 'empty' }, 'Niente in programma.')));
  const right = el('div', { className: 'col' },
    el('section', { className: 'card' }, el('h2', {}, 'Da fare'),
      urgent.length ? el('div', { className: 'tasks' }, urgent.map(taskRow)) : el('div', { className: 'muted small' }, 'Niente in scadenza oggi.'),
      quickTask(t)),
    el('section', { className: 'card' }, el('h2', {}, 'Prossimi giorni'),
      later.length ? el('div', { className: 'items' }, groupByDay(later)) : el('div', { className: 'empty' }, 'Settimana libera.')));
  return [left, right];
}

function groupByDay(list) {
  const out = [];
  let last = '';
  for (const o of list) {
    if (o.day !== last) { out.push(el('div', { className: 'day-head' }, longDate(o.day))); last = o.day; }
    out.push(itemRow(o));
  }
  return out;
}

function viewCalendar() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`;
  const start = addDays(first, -(weekday(first) - 1));
  const end = addDays(start, 41);
  const occ = occurrences(data.events, start, end);
  const byDay = new Map();
  for (const o of occ) byDay.set(o.day, [...(byDay.get(o.day) ?? []), o]);
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1, 12); calMonth = dateKey(d).slice(0, 7); render(); };
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const items = byDay.get(d) ?? [];
    cells.push(el('button', {
      type: 'button',
      className: [d.slice(0, 7) !== calMonth ? 'other' : '', d === today() ? 'today' : '', d === calDay ? 'sel' : ''].filter(Boolean).join(' '),
      onclick: () => { calDay = d; if (d.slice(0, 7) !== calMonth) calMonth = d.slice(0, 7); render(); },
      'aria-label': `${longDate(d)}: ${items.length} impegni`,
    }, String(parseDate(d).getDate()),
    el('span', { className: 'dots' }, items.slice(0, 4).map((o) => el('i', { style: { '--c': colorOf(o.category) } })))));
  }
  const dayList = byDay.get(calDay) ?? occurrences(data.events, calDay, calDay);
  const dayTasks = data.tasks.filter((x) => x.due === calDay);
  return [
    el('section', { className: 'card' },
      el('div', { className: 'cal-head' },
        el('button', { type: 'button', className: 'btn small', onclick: () => shift(-1), 'aria-label': 'Mese prima' }, '‹'),
        el('b', {}, new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })),
        el('div', { className: 'row' },
          el('button', { type: 'button', className: 'btn small', onclick: () => { calMonth = today().slice(0, 7); calDay = today(); render(); } }, 'Oggi'),
          el('button', { type: 'button', className: 'btn small', onclick: () => shift(1), 'aria-label': 'Mese dopo' }, '›'))),
      el('div', { className: 'month' }, ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((w) => el('span', { className: 'wd' }, w)), cells)),
    el('section', { className: 'card' }, el('h2', {}, longDate(calDay)),
      dayList.length ? el('div', { className: 'items' }, dayList.map(itemRow)) : el('div', { className: 'empty' }, 'Niente in programma.'),
      dayTasks.length ? el('div', { className: 'tasks', style: { marginTop: '12px' } }, dayTasks.map(taskRow)) : null,
      el('div', { className: 'row', style: { marginTop: '12px' } },
        el('button', { type: 'button', className: 'btn small', onclick: () => eventSheet({ date: calDay }) }, '＋ Impegno'),
        el('button', { type: 'button', className: 'btn small', onclick: () => taskSheet({ due: calDay }) }, '＋ Da fare'))),
  ];
}

function viewTasks() {
  const t = today();
  const open = data.tasks.filter((x) => !x.done);
  const done = data.tasks.filter((x) => x.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const groups = [
    ['In ritardo', open.filter((x) => x.due && x.due < t)],
    ['Oggi', open.filter((x) => x.due === t)],
    ['Prossimi giorni', open.filter((x) => x.due > t).sort((a, b) => a.due.localeCompare(b.due))],
    ['Senza scadenza', open.filter((x) => !x.due)],
  ].filter(([, l]) => l.length);
  return [el('div', { className: 'col' },
    el('h1', {}, 'Da fare'),
    el('section', { className: 'card' }, quickTask(''), open.length ? null : el('p', { className: 'muted small' }, 'Tutto fatto! Aggiungi qualcosa qui sopra.')),
    ...groups.map(([title, list]) => el('section', { className: 'card' }, el('h2', {}, title), el('div', { className: 'tasks' }, list.map(taskRow)))),
    done.length ? el('details', { className: 'card done-list' }, el('summary', {}, `Fatte (${done.length})`), el('div', { className: 'tasks' }, done.map(taskRow)),
      el('p', { className: 'muted small' }, 'Le cose fatte si tolgono da sole dopo 30 giorni.')) : null)];
}

function viewMore() {
  const cats = data.categories.map((c) => ({ ...c }));
  const rows = el('div', { className: 'items' });
  const drawCats = () => rows.replaceChildren(...cats.map((c, i) => el('div', { className: 'cat-row' },
    el('input', { type: 'text', value: c.icon, maxlength: '4', 'aria-label': 'Icona', oninput: (e) => { c.icon = e.target.value; } }),
    el('input', { type: 'color', value: c.color, 'aria-label': 'Colore', oninput: (e) => { c.color = e.target.value; } }),
    el('input', { type: 'text', value: c.name, maxlength: '30', 'aria-label': 'Nome', oninput: (e) => { c.name = e.target.value; } }),
    el('button', { type: 'button', className: 'btn small danger', onclick: () => { if (cats.length > 1) { cats.splice(i, 1); drawCats(); } }, 'aria-label': 'Togli' }, '✕'))));
  drawCats();
  const calUrl = `${location.origin}${data.calendarPath}`;
  const copyBtn = el('button', { type: 'button', className: 'btn small', onclick: async () => { try { await navigator.clipboard.writeText(calUrl); toast('Link copiato'); } catch { toast('Selezionalo e copialo'); } } }, 'Copia');
  return [el('div', { className: 'col' },
    el('section', { className: 'card' }, el('h2', {}, 'Categorie'),
      el('p', { className: 'muted small', style: { marginTop: '0' } }, 'Ogni impegno ha un tipo, con il suo colore e la sua icona.'),
      rows,
      el('div', { className: 'row', style: { marginTop: '12px' } },
        el('button', { type: 'button', className: 'btn small', onclick: () => { cats.push({ id: `c${Date.now().toString(36)}`, name: 'Nuova', color: '#9a8fb0', icon: '⭐' }); drawCats(); } }, '＋ Categoria'),
        el('button', { type: 'button', className: 'btn primary small', onclick: async () => { if (await api('/api/categories', { method: 'PUT', body: { categories: cats } })) { toast('Salvate'); load(true); } } }, 'Salva'))),
    el('section', { className: 'card' }, el('h2', {}, 'Sull\'app Calendario del telefono'),
      el('p', { className: 'small', style: { marginTop: '0' } }, 'Con questo link gli impegni compaiono anche nel calendario del telefono, con i promemoria, e si aggiornano da soli.'),
      el('div', { className: 'copy' }, el('code', {}, calUrl), copyBtn),
      el('ol', { className: 'steps small' },
        el('li', {}, el('b', {}, 'Android: '), 'installa l\'app ', el('b', {}, 'ICSx⁵'), ' (gratis da F-Droid, a pagamento su Google Play), premi ＋ e incolla il link. Gli impegni compaiono in Google Calendar.'),
        el('li', {}, el('b', {}, 'iPhone: '), 'Impostazioni → Calendario → Account → Aggiungi account → Altro → ', el('b', {}, 'Aggiungi calendario sottoscritto'), ' e incolla il link.')),
      el('p', { className: 'muted small' }, 'È facoltativo: Howl-UP funziona anche senza. Fuori casa il calendario si aggiorna quando Tailscale è attivo. Chi ha il link vede i tuoi impegni: non condividerlo.')),
    el('section', { className: 'card' }, el('h2', {}, 'Come un\'app sul telefono'),
      el('ol', { className: 'steps small' },
        el('li', {}, el('b', {}, 'Android (Chrome): '), 'menu ⋮ → ', el('b', {}, 'Aggiungi a schermata Home'), '.'),
        el('li', {}, el('b', {}, 'iPhone (Safari): '), 'tasto Condividi → ', el('b', {}, 'Aggiungi alla schermata Home'), '.')),
      el('p', { className: 'muted small' }, 'Compare l\'icona del lupo: un tocco e sei in Howl-UP.')),
    el('section', { className: 'card' }, el('h2', {}, 'In arrivo'),
      el('ul', { className: 'steps small' },
        el('li', {}, '🔗 Le live di TwitchGestor qui dentro, modificabili da tutte e due le parti.'),
        el('li', {}, '🌅 Buongiorno ogni mattina con impegni, cose da fare e com\'è andata la live.'),
        el('li', {}, '📣 Messaggi pronti per Telegram, Discord e storie Instagram quando cambi una live.'))),
    el('div', { className: 'row' }, el('button', { type: 'button', className: 'btn small', onclick: () => { try { localStorage.removeItem('howlupToken'); } catch { /* niente */ } location.reload(); } }, 'Esci da questo dispositivo')))];
}

// ---------- fogli: impegno e cosa da fare ----------
function openSheet(...content) {
  const root = $('sheet-root');
  const close = () => { root.replaceChildren(); document.body.style.overflow = ''; };
  const sheet = el('div', { className: 'sheet', role: 'dialog', 'aria-modal': 'true' }, el('div', { className: 'grip' }), ...content);
  const bg = el('div', { className: 'sheet-bg', onclick: (e) => { if (e.target === bg) close(); } }, sheet);
  root.replaceChildren(bg);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  return close;
}

function chooseScope(title) {
  return new Promise((resolve) => {
    const close = openSheet(el('h3', {}, title), el('p', { className: 'muted', style: { margin: '0' } }, 'È un impegno che si ripete.'),
      el('div', { className: 'sheet-actions' },
        el('button', { type: 'button', className: 'btn grow', onclick: () => { close(); resolve('one'); } }, 'Solo questo giorno'),
        el('button', { type: 'button', className: 'btn primary grow', onclick: () => { close(); resolve('all'); } }, 'Tutta la serie')),
      el('button', { type: 'button', className: 'btn', onclick: () => { close(); resolve(null); } }, 'Annulla'));
  });
}

function eventSheet(o = {}) {
  const existing = data.events.find((e) => e.id === o.id);
  const e = existing ? { ...existing } : { title: '', category: data.categories[0]?.id, date: o.date ?? today(), time: '21:00', endTime: '', allDay: false, notes: '', remindMin: 30, repeat: { freq: 'none' } };
  const day = o.day ?? e.date; // il giorno toccato (per gli impegni che si ripetono)
  const title = el('input', { type: 'text', className: 'title-input', placeholder: 'Cosa devi fare?', value: e.title, maxlength: '140' });
  let category = e.category;
  const catChips = el('div', { className: 'chips' });
  const drawCats = () => catChips.replaceChildren(...data.categories.map((c) => el('button', {
    type: 'button', className: `chip${c.id === category ? ' on' : ''}`, style: { '--c': c.color }, onclick: () => { category = c.id; drawCats(); },
  }, `${c.icon} ${c.name}`)));
  drawCats();
  const date = el('input', { type: 'date', value: existing && e.repeat.freq !== 'none' ? day : e.date });
  const allDay = el('input', { type: 'checkbox', checked: e.allDay });
  const time = el('input', { type: 'time', value: e.time || '21:00' });
  const endTime = el('input', { type: 'time', value: e.endTime });
  const times = el('div', { className: 'grid2' }, el('label', { className: 'field' }, el('span', {}, 'Inizio'), time), el('label', { className: 'field' }, el('span', {}, 'Fine (facoltativa)'), endTime));
  const freq = el('select', {}, ...[['none', 'Mai'], ['daily', 'Ogni giorno'], ['weekly', 'Ogni settimana'], ['monthly', 'Ogni mese'], ['yearly', 'Ogni anno']].map(([v, l]) => el('option', { value: v }, l)));
  freq.value = FREQS.includes(e.repeat.freq) ? e.repeat.freq : 'none';
  const interval = el('input', { type: 'number', min: '1', max: '52', value: String(e.repeat.interval ?? 1) });
  let days = [...(e.repeat.days?.length ? e.repeat.days : [weekday(e.date)])];
  const dayChips = el('div', { className: 'chips' });
  const drawDays = () => dayChips.replaceChildren(...WEEKDAYS.map((w, i) => el('button', {
    type: 'button', className: `chip${days.includes(i + 1) ? ' on' : ''}`,
    onclick: () => { days = days.includes(i + 1) ? days.filter((x) => x !== i + 1) : [...days, i + 1]; drawDays(); },
  }, w.slice(0, 3))));
  drawDays();
  const until = el('input', { type: 'date', value: e.repeat.until ?? '' });
  const repeatBox = el('div', { className: 'field' },
    el('div', { className: 'grid2' }, el('label', { className: 'field' }, el('span', {}, 'Ogni quanto'), interval), el('label', { className: 'field' }, el('span', {}, 'Fino al (facoltativo)'), until)),
    dayChips);
  const remind = el('select', {}, ...[['', 'Nessun promemoria'], ['0', 'All\'ora dell\'impegno'], ['10', '10 minuti prima'], ['30', '30 minuti prima'], ['60', '1 ora prima'], ['1440', '1 giorno prima']].map(([v, l]) => el('option', { value: v }, l)));
  remind.value = e.remindMin == null ? '' : String(e.remindMin);
  const notes = el('textarea', { placeholder: 'Note (facoltative)', maxlength: '2000' });
  notes.value = e.notes ?? '';
  const sync = () => {
    times.hidden = allDay.checked;
    repeatBox.hidden = freq.value === 'none';
    dayChips.hidden = freq.value !== 'weekly';
  };
  allDay.onchange = sync;
  freq.onchange = sync;
  sync();

  const collect = () => ({
    ...e, title: title.value, category, date: date.value, allDay: allDay.checked, time: time.value, endTime: endTime.value,
    notes: notes.value, remindMin: remind.value === '' ? null : Number(remind.value),
    repeat: { freq: freq.value, interval: Number(interval.value) || 1, days, until: until.value },
  });
  const close = openSheet(
    el('h3', {}, existing ? 'Modifica impegno' : 'Nuovo impegno'),
    title,
    el('div', { className: 'field' }, el('span', {}, 'Tipo'), catChips),
    el('label', { className: 'field' }, el('span', {}, 'Giorno'), date),
    el('label', { className: 'switch' }, 'Tutto il giorno', allDay),
    times,
    el('label', { className: 'field' }, el('span', {}, 'Si ripete'), freq),
    repeatBox,
    el('label', { className: 'field' }, el('span', {}, 'Promemoria'), remind),
    notes,
    el('div', { className: 'sheet-actions' },
      existing ? el('button', {
        type: 'button', className: 'btn danger',
        onclick: async () => {
          let scope = 'all';
          if (existing.repeat.freq !== 'none') scope = await chooseScope('Eliminare…');
          else if (!confirm(`Eliminare "${existing.title}"?`)) return;
          if (!scope) return;
          if (await api(`/api/events/${existing.id}${scope === 'one' ? `?only=${day}` : ''}`, { method: 'DELETE' })) { close(); toast('Eliminato'); load(true); }
        },
      }, 'Elimina') : null,
      el('span', { className: 'grow' }),
      el('button', { type: 'button', className: 'btn', onclick: () => close() }, 'Annulla'),
      el('button', {
        type: 'button', className: 'btn primary',
        onclick: async () => {
          const next = collect();
          if (!next.title.trim()) { title.focus(); toast('Scrivi cosa devi fare'); return; }
          let r;
          if (existing && existing.repeat.freq !== 'none') {
            const scope = await chooseScope('Salvare le modifiche per…');
            if (!scope) return;
            if (scope === 'one') r = await api(`/api/events/${existing.id}/occurrence`, { method: 'POST', body: { day, event: { ...next, repeat: { freq: 'none' } } } });
            else r = await api('/api/events', { method: 'PUT', body: { event: { ...next, date: date.value === day ? existing.date : date.value } } });
          } else r = await api('/api/events', { method: 'PUT', body: { event: next } });
          if (r) { close(); toast('Salvato'); load(true); }
        },
      }, 'Salva')));
  if (!existing) setTimeout(() => title.focus(), 50);
}

function taskSheet(t = {}) {
  const existing = data.tasks.find((x) => x.id === t.id);
  const task = existing ? { ...existing } : { title: '', due: t.due ?? '', category: '', notes: '' };
  const title = el('input', { type: 'text', className: 'title-input', placeholder: 'Cosa devi fare?', value: task.title, maxlength: '200' });
  const due = el('input', { type: 'date', value: task.due });
  let category = task.category;
  const chips = el('div', { className: 'chips' });
  const draw = () => chips.replaceChildren(
    el('button', { type: 'button', className: `chip${!category ? ' on' : ''}`, onclick: () => { category = ''; draw(); } }, 'Nessuno'),
    ...data.categories.map((c) => el('button', { type: 'button', className: `chip${c.id === category ? ' on' : ''}`, style: { '--c': c.color }, onclick: () => { category = c.id; draw(); } }, `${c.icon} ${c.name}`)));
  draw();
  const quickDue = el('div', { className: 'chips' },
    ...[['Oggi', today()], ['Domani', addDays(today(), 1)], ['Tra una settimana', addDays(today(), 7)], ['Nessuna', '']].map(([l, v]) => el('button', { type: 'button', className: 'chip', onclick: () => { due.value = v; } }, l)));
  const notes = el('textarea', { placeholder: 'Note (facoltative)', maxlength: '2000' });
  notes.value = task.notes ?? '';
  const close = openSheet(
    el('h3', {}, existing ? 'Modifica' : 'Nuova cosa da fare'),
    title,
    el('label', { className: 'field' }, el('span', {}, 'Entro il'), due), quickDue,
    el('div', { className: 'field' }, el('span', {}, 'Tipo'), chips),
    notes,
    el('div', { className: 'sheet-actions' },
      existing ? el('button', { type: 'button', className: 'btn danger', onclick: async () => { if (await api(`/api/tasks/${existing.id}`, { method: 'DELETE' })) { close(); load(true); } } }, 'Elimina') : null,
      el('span', { className: 'grow' }),
      el('button', { type: 'button', className: 'btn', onclick: () => close() }, 'Annulla'),
      el('button', {
        type: 'button', className: 'btn primary',
        onclick: async () => {
          if (!title.value.trim()) { title.focus(); return; }
          if (await api('/api/tasks', { method: 'PUT', body: { task: { ...task, title: title.value, due: due.value, category, notes: notes.value } } })) { close(); toast('Salvato'); load(true); }
        },
      }, 'Salva')));
  if (!existing) setTimeout(() => title.focus(), 50);
}

// ---------- disegno ----------
function render() {
  $('top-date').textContent = longDate(today());
  for (const b of $('nav').querySelectorAll('button')) b.classList.toggle('active', b.dataset.view === view);
  const parts = { today: viewToday, calendar: viewCalendar, tasks: viewTasks, more: viewMore }[view]?.() ?? viewToday();
  const v = $('view');
  v.className = `view${view === 'today' || view === 'calendar' ? ' two' : ''}`;
  v.replaceChildren(...parts);
}

$('nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  view = b.dataset.view;
  history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo({ top: 0 });
});
$('fab').onclick = () => {
  if (view === 'tasks') return taskSheet({});
  const close = openSheet(el('h3', {}, 'Aggiungi'),
    el('div', { className: 'sheet-actions' },
      el('button', { type: 'button', className: 'btn primary grow', onclick: () => { close(); eventSheet({ date: view === 'calendar' ? calDay : today() }); } }, '📅 Impegno'),
      el('button', { type: 'button', className: 'btn grow', onclick: () => { close(); taskSheet({ due: view === 'calendar' ? calDay : '' }); } }, '✅ Cosa da fare')));
};

// altri dispositivi possono cambiare i dati: si ricontrolla spesso e quando torni sulla pagina
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
setInterval(() => { if (!document.hidden) load(); }, 15000);
setInterval(() => { if (!document.hidden && !$('sheet-root').children.length) render(); }, 60000); // "tra 10 min" si aggiorna
load(true);
