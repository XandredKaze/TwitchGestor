// Howl-UP: la pagina (telefono e PC). I dati stanno sul Raspberry; qui si mostrano e si modificano.
import { drawStory } from './story.js';
import { occurrences, repeatText, today, addDays, parseDate, dateKey, weekday, WEEKDAYS, FREQS, livesToEvents, findOverlaps } from './core/agenda.js';

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
  }, el('div', { className: 'brand' }, el('b', {}, 'Howl', el('span', {}, '-UP'))),
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
let data = { rev: 0, categories: [], events: [], tasks: [], lives: { ok: false, entries: [] }, calendarPath: '' };
// gli impegni di Howl-UP più le live in programma in TwitchGestor
const allEvents = () => [...data.events, ...livesToEvents(data.lives?.entries)];
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
const colorOf = (id) => cat(id)?.color ?? (id === 'live' ? '#e36dc9' : 'var(--accent)');

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
  if (diff <= 0) return o.endTime && endMin(o) > nowMin() ? 'adesso' : '';
  return diff < 60 ? `tra ${diff} min` : `tra ${Math.floor(diff / 60)} h ${diff % 60 ? `${diff % 60} min` : ''}`.trim();
}
// fine in minuti dall'inizio del giorno: se è prima dell'inizio finisce il giorno dopo (turni di notte)
const endMin = (o) => (o.endTime ? toMin(o.endTime) + (o.endTime < o.time ? 1440 : 0) : toMin(o.time));
const greeting = () => { const h = new Date().getHours(); return h < 6 ? 'Buonanotte' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera'; };

// ---------- pezzi ----------
function itemRow(o) {
  const c = cat(o.category);
  const past = o.day === today() && !o.allDay && endMin(o) < nowMin();
  const fromTg = o.source === 'twitchgestor';
  return el('button', { type: 'button', className: `item${past ? ' past' : ''}`, style: { '--c': colorOf(o.category) }, onclick: () => (fromTg ? liveSheet(o) : eventSheet(o)) },
    el('span', { className: 't' }, o.allDay ? 'tutto il giorno' : o.time, o.endTime ? el('small', {}, o.endTime < o.time ? `${o.endTime} +1` : o.endTime) : null),
    el('span', { className: 'bar' }),
    el('span', { className: 'what' }, el('b', {}, o.title),
      el('span', {}, (fromTg
        ? [`${c?.icon ?? '🔴'} Live`, o.game ? `🎮 ${o.game}` : '', 'da TwitchGestor']
        : [c ? `${c.icon} ${c.name}` : '', o.repeat?.freq !== 'none' ? `↻ ${repeatText(o)}` : '']).filter(Boolean).join(' · '))));
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

// notifiche ancora da confermare: si ripetono finché non tocchi "Ho visto"
function pendingCard() {
  const list = data.pending ?? [];
  if (!list.length) return null;
  const ack = async (id) => { if (await api('/api/notify/ack', { method: 'POST', body: { id } })) { toast('Visto 🐺'); load(true); } };
  return el('section', { className: 'card pending' },
    el('h2', {}, `📬 Da confermare (${list.length})`),
    el('p', { className: 'hint', style: { marginTop: '-4px' } }, 'Queste notifiche si ripetono finché non le segni come viste.'),
    el('div', { className: 'items' }, list.map((p) => el('details', { className: 'pend' },
      el('summary', {}, el('span', {}, p.title), el('button', { type: 'button', className: 'btn small primary', onclick: (e) => { e.preventDefault(); ack(p.id); } }, '✅ Ho visto')),
      el('pre', {}, p.text)))),
    list.length > 1 ? el('button', { type: 'button', className: 'btn small', style: { marginTop: '10px' }, onclick: () => ack('') }, 'Ho visto tutto') : null);
}

// TwitchGestor non risponde: le live potrebbero non essere aggiornate
const tgWarning = () => (data.lives && !data.lives.ok && data.lives.error ? el('div', { className: 'card warn' }, '⚠️ ', data.lives.error) : null);

// ---------- viste ----------
let laterOpen = false; // "Prossimi giorni" in Oggi: aperto anche oltre il primo giorno
function viewToday() {
  const t = today();
  const list = occurrences(allEvents(), t, addDays(t, 7));
  const todayList = list.filter((o) => o.day === t);
  const next = todayList.find((o) => o.allDay ? false : endMin(o) >= nowMin()) ?? list.find((o) => o.day > t);
  const open = data.tasks.filter((x) => !x.done);
  const urgent = open.filter((x) => x.due && x.due <= t).sort((a, b) => a.due.localeCompare(b.due));
  // poi quelle dei prossimi 7 giorni e quelle senza scadenza (le altre stanno in "Da fare")
  const soon = open.filter((x) => x.due && x.due > t && x.due <= addDays(t, 7)).sort((a, b) => a.due.localeCompare(b.due));
  const noDue = open.filter((x) => !x.due);
  const shown = [...urgent, ...soon, ...noDue];
  const MAX_TASKS = 8;
  const later = list.filter((o) => o.day > t); // da domani in poi

  const left = el('div', { className: 'col' },
    tgWarning(),
    pendingCard(),
    el('div', { className: 'hello' },
      el('div', {}, el('h1', {}, `${greeting()} 🐺`), el('div', { className: 'muted' }, `${todayList.length ? `${todayList.length} ${todayList.length === 1 ? 'impegno' : 'impegni'} oggi` : 'Nessun impegno oggi'}${urgent.length ? ` · ${urgent.length} da fare` : ''}`)),
      notesButton()),
    next
      ? el('button', { type: 'button', className: 'card next', style: { '--c': colorOf(next.category), textAlign: 'left' }, onclick: () => (next.source === 'twitchgestor' ? liveSheet(next) : eventSheet(next)) },
        el('div', { className: 'label' }, next.day === t ? 'Prossimo' : 'Prossimo impegno'),
        el('div', { className: 'title' }, `${cat(next.category)?.icon ?? ''} ${next.title}`),
        el('div', { className: 'when' }, `${relDay(next.day)}${next.allDay ? ', tutto il giorno' : ` alle ${next.time}`}`),
        untilText(next) ? el('div', { className: 'count' }, untilText(next)) : null)
      : null,
    el('section', { className: 'card' }, el('h2', {}, 'Oggi'),
      todayList.length ? el('div', { className: 'items' }, todayList.map(itemRow)) : el('div', { className: 'empty' }, 'Giornata libera. Premi ＋ per aggiungere un impegno.')),
    el('section', { className: 'card' }, el('h2', {}, 'Da fare'),
      shown.length ? el('div', { className: 'tasks' }, shown.slice(0, MAX_TASKS).map(taskRow)) : el('div', { className: 'muted small' }, 'Niente da fare. 🎉'),
      open.length > Math.min(shown.length, MAX_TASKS)
        ? el('button', { type: 'button', className: 'btn small', style: { marginTop: '8px' }, onclick: () => { view = 'tasks'; history.replaceState(null, '', '#tasks'); render(); window.scrollTo({ top: 0 }); } }, `Vedi tutte (${open.length})`)
        : null,
      quickTask(t)));
  const right = el('div', { className: 'col' },
    el('section', { className: 'card' }, el('h2', {}, 'Prossimi giorni'),
      later.length ? el('div', { className: 'items' }, groupByDay(laterOpen ? later : later.filter((o) => o.day === later[0].day))) : el('div', { className: 'empty' }, 'Settimana libera.'),
      // di base solo il primo giorno; il pulsante mostra anche quelli dopo (fino a una settimana)
      later.some((o) => o.day !== later[0].day)
        ? el('button', { type: 'button', className: 'btn small more-days', onclick: () => { laterOpen = !laterOpen; render(); } },
          laterOpen ? '▴ Mostra meno' : `▾ Mostra i giorni successivi (${new Set(later.filter((o) => o.day !== later[0].day).map((o) => o.day)).size})`)
        : null));
  return [left, right];
}

function groupByDay(list) {
  const out = [];
  let last = '';
  for (const o of list) {
    if (o.day !== last) { out.push(el('div', { className: 'day-head' }, o.day === addDays(today(), 1) ? `Domani · ${longDate(o.day)}` : longDate(o.day))); last = o.day; }
    out.push(itemRow(o));
  }
  return out;
}

function viewCalendar() {
  const [y, m] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`;
  const start = addDays(first, -(weekday(first) - 1));
  const end = addDays(start, 41);
  const occ = occurrences(allEvents(), start, end);
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
  const dayList = byDay.get(calDay) ?? occurrences(allEvents(), calDay, calDay);
  const dayTasks = data.tasks.filter((x) => x.due === calDay);
  return [
    tgWarning(),
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
        el('button', { type: 'button', className: 'btn small', onclick: () => taskSheet({ due: calDay }) }, '＋ Da fare'),
        el('button', { type: 'button', className: 'btn small', onclick: () => shiftSheet(calDay) }, '🌙 Turni'))),
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

const REMIND_CHOICES = [['', 'Come scelgo nell\'impegno'], ['none', 'Nessun promemoria'], ['0', 'All\'ora dell\'impegno'], ['10', '10 minuti prima'], ['30', '30 minuti prima'], ['60', '1 ora prima'], ['120', '2 ore prima'], ['1440', '1 giorno prima']];
/** Caratteristiche di un'intera categoria (orario, promemoria, note fisse): si modificano in c.defaults. */
function catDefaultsForm(c) {
  const d = c.defaults = { ...(c.defaults ?? {}) };
  const setOr = (k, v) => { if (v === '' || v === undefined) delete d[k]; else d[k] = v; };
  const time = el('input', { type: 'time', value: d.time ?? '', oninput: (e) => { setOr('time', e.target.value); if (!e.target.value) { delete d.endTime; end.value = ''; } } });
  const end = el('input', { type: 'time', value: d.endTime ?? '', oninput: (e) => setOr('endTime', e.target.value) });
  const remind = el('select', { onchange: (e) => { if (e.target.value === '') delete d.remindMin; else d.remindMin = e.target.value === 'none' ? null : Number(e.target.value); } },
    ...REMIND_CHOICES.map(([v, l]) => el('option', { value: v }, l)));
  remind.value = !('remindMin' in d) ? '' : d.remindMin === null ? 'none' : String(d.remindMin);
  const notes = el('textarea', { rows: '2', maxlength: '1000', placeholder: 'Es. portare badge e pranzo', oninput: (e) => setOr('notes', e.target.value) });
  notes.value = d.notes ?? '';
  return el('div', { className: 'cat-defaults' },
    el('p', { className: 'hint', style: { margin: '0' } }, `Valgono per tutti gli impegni "${c.name}": i nuovi le prendono da soli, quelli già in calendario da oggi in poi si aggiornano (tranne quelli che hai cambiato a mano). Lascia vuoto ciò che non vuoi impostare.`),
    el('div', { className: 'grid2' },
      el('label', { className: 'field' }, el('span', {}, 'Inizio'), time),
      el('label', { className: 'field' }, el('span', {}, 'Fine (prima dell\'inizio = giorno dopo)'), end)),
    el('label', { className: 'field' }, el('span', {}, 'Promemoria'), remind),
    el('label', { className: 'field' }, el('span', {}, '📌 Note fisse (compaiono in ogni impegno di questo tipo)'), notes));
}

function viewMore() {
  const cats = data.categories.map((c) => ({ ...c }));
  const rows = el('div', { className: 'items' });
  const opened = new Set();
  const drawCats = () => rows.replaceChildren(...cats.map((c, i) => el('div', { className: 'cat-wrap' },
    el('div', { className: 'cat-row' },
      el('input', { type: 'text', value: c.icon, maxlength: '4', 'aria-label': 'Icona', oninput: (e) => { c.icon = e.target.value; } }),
      el('input', { type: 'color', value: c.color, 'aria-label': 'Colore', oninput: (e) => { c.color = e.target.value; } }),
      el('input', { type: 'text', value: c.name, maxlength: '30', 'aria-label': 'Nome', oninput: (e) => { c.name = e.target.value; } }),
      el('button', {
        type: 'button', className: `btn small${opened.has(c.id) ? ' on' : ''}`, title: 'Caratteristiche della categoria', 'aria-label': 'Caratteristiche',
        onclick: () => { if (opened.has(c.id)) opened.delete(c.id); else opened.add(c.id); drawCats(); },
      }, Object.keys(c.defaults ?? {}).length ? '⚙️•' : '⚙️'),
      el('button', { type: 'button', className: 'btn small danger', onclick: () => { if (cats.length > 1) { cats.splice(i, 1); drawCats(); } }, 'aria-label': 'Togli' }, '✕')),
    opened.has(c.id) ? catDefaultsForm(c) : null)));
  drawCats();
  const calUrl = `${location.origin}${data.calendarPath}`;
  const copyBtn = el('button', { type: 'button', className: 'btn small', onclick: async () => { try { await navigator.clipboard.writeText(calUrl); toast('Link copiato'); } catch { toast('Selezionalo e copialo'); } } }, 'Copia');
  return [el('div', { className: 'col' },
    el('section', { className: 'card' }, el('h2', {}, 'Categorie'),
      el('p', { className: 'muted small', style: { marginTop: '0' } }, 'Ogni impegno ha un tipo, con il suo colore e la sua icona. Con ⚙️ imposti orario, promemoria e note fisse per tutta la categoria. Poi premi Salva.'),
      rows,
      el('div', { className: 'row', style: { marginTop: '12px' } },
        el('button', { type: 'button', className: 'btn small', onclick: () => { cats.push({ id: `c${Date.now().toString(36)}`, name: 'Nuova', color: '#9a8fb0', icon: '⭐' }); drawCats(); } }, '＋ Categoria'),
        el('button', { type: 'button', className: 'btn primary small', onclick: async () => { if (await api('/api/categories', { method: 'PUT', body: { categories: cats } })) { toast('Salvate'); load(true); } } }, 'Salva'))),
    notifySection(),
    el('section', { className: 'card' }, el('h2', {}, 'TwitchGestor'),
      el('p', { className: 'small', style: { margin: '0' } }, data.lives?.ok
        ? `✓ Collegato: le ${data.lives.entries.length} live in programma sono anche qui. Se le cambi qui cambiano anche in TwitchGestor, e viceversa.`
        : `⚠️ ${data.lives?.error || 'Non collegato'}`)),
    el('section', { className: 'card' }, el('h2', {}, 'Sull\'app Calendario del telefono'),
      el('p', { className: 'small', style: { marginTop: '0' } }, 'Con questo link gli impegni compaiono anche nel calendario del telefono, con i promemoria, e si aggiornano da soli.'),
      el('div', { className: 'copy' }, el('code', {}, calUrl), copyBtn),
      el('ol', { className: 'steps small' },
        el('li', {}, el('b', {}, 'Android: '), 'installa l\'app ', el('b', {}, 'ICSx⁵'), ' (gratis da F-Droid, a pagamento su Google Play), premi ＋ e incolla il link. Gli impegni compaiono in Google Calendar.'),
        el('li', {}, el('b', {}, 'iPhone: '), 'Impostazioni → Calendario → Account → Aggiungi account → Altro → ', el('b', {}, 'Aggiungi calendario sottoscritto'), ' e incolla il link.')),
      el('p', { className: 'muted small' }, 'È facoltativo: Howl-UP funziona anche senza. Fuori casa il calendario si aggiorna quando Tailscale è attivo. Chi ha il link vede i tuoi impegni: non condividerlo.')),
    installSection(),
    el('div', { className: 'row' }, el('button', { type: 'button', className: 'btn small', onclick: () => { try { localStorage.removeItem('howlupToken'); } catch { /* niente */ } location.reload(); } }, 'Esci da questo dispositivo')))];
}

// ---------- installare Howl-UP come app (in Altro): serve l'indirizzo https di Tailscale ----------
let install = null;
async function loadInstall(check = false) {
  install = await api(check ? '/api/install/check' : '/api/install', check ? { method: 'POST' } : {});
  if (view === 'more') render();
}
function installSection() {
  if (!install) { loadInstall(); return el('section', { className: 'card' }, el('h2', {}, 'Come un\'app'), el('p', { className: 'muted small' }, 'Carico…')); }
  const here = location.protocol === 'https:';
  const recheck = el('button', { type: 'button', className: 'btn small', onclick: () => { install = null; render(); loadInstall(true); } }, '↻ Ricontrolla');
  const steps = el('ol', { className: 'steps small' },
    el('li', {}, el('b', {}, 'Android (Chrome): '), 'menu ⋮ → ', el('b', {}, 'Installa app'), ' (o "Aggiungi a schermata Home" → Installa).'),
    el('li', {}, el('b', {}, 'Android (Firefox): '), 'menu ⋮ → ', el('b', {}, 'Aggiungi alla schermata Home'), '.'),
    el('li', {}, el('b', {}, 'iPhone (Safari): '), 'tasto Condividi → ', el('b', {}, 'Aggiungi alla schermata Home'), '.'),
    el('li', {}, el('b', {}, 'PC (Chrome o Edge): '), 'l\'icona di installazione a destra nella barra dell\'indirizzo.'));
  let body;
  if (install.status === 'ok') {
    body = [
      here ? el('p', { className: 'small', style: { marginTop: '0' } }, '✅ Sei già sull\'indirizzo giusto: installala da qui.')
        : el('p', { className: 'small', style: { marginTop: '0' } }, 'Si installa da questo indirizzo (con Tailscale attivo sul dispositivo):'),
      here ? null : el('div', { className: 'copy' }, el('code', {}, install.url), el('a', { className: 'btn small primary', href: install.url, style: { textDecoration: 'none' } }, 'Apri')),
      steps,
      el('p', { className: 'muted small' }, 'Compare l\'icona del lupo: un tocco e sei in Howl-UP. Funziona a casa e fuori, purché Tailscale sia acceso.'),
    ];
  } else if (install.status === 'enable') {
    body = [
      el('p', { className: 'small', style: { marginTop: '0' } }, 'Per installarla serve l\'indirizzo https (i browser lo chiedono). Tailscale lo dà gratis, ma va attivato una volta per la tua rete:'),
      el('ol', { className: 'steps small' },
        el('li', {}, el('a', { href: install.enableUrl, target: '_blank', rel: 'noopener' }, 'Apri questo link di Tailscale'), ' ed entra con il tuo account.'),
        el('li', {}, 'Premi ', el('b', {}, 'Enable HTTPS'), ' (attiva i certificati https).'),
        el('li', {}, 'Torna qui e premi "Ricontrolla".')),
      el('div', { className: 'row' }, recheck),
    ];
  } else if (install.status === 'no-tailscale') {
    body = [
      el('p', { className: 'small', style: { marginTop: '0' } }, 'I browser permettono di installarla solo da un indirizzo https, e Howl-UP lo prende da Tailscale (gratis). Prima collega Tailscale: TwitchGestor → ⚙ Sistema → ', el('b', {}, 'Accesso da fuori casa'), '.'),
      el('div', { className: 'row' }, recheck),
    ];
  } else if (install.status === 'error') {
    body = [
      el('p', { className: 'small', style: { marginTop: '0' } }, `⚠️ Tailscale non ha dato l'indirizzo https: ${install.error}`),
      el('div', { className: 'row' }, recheck),
    ];
  } else body = [el('p', { className: 'muted small' }, 'Controllo Tailscale…'), el('div', { className: 'row' }, recheck)];
  return el('section', { className: 'card' }, el('h2', {}, 'Come un\'app (telefono e PC)'), ...body);
}

// ---------- notifiche (in Altro) ----------
let notify = null;
async function loadNotify() {
  notify = await api('/api/notify');
  if (view === 'more') render();
}
const CHANNEL_NAMES = { ntfy: '📱 ntfy', telegram: '✈️ Telegram' };
function lastSendBox(last) {
  if (!last) return null;
  const entries = Object.entries(last.results ?? {});
  const at = new Date(last.at).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return el('div', { className: `card${entries.some(([, v]) => v !== 'ok') || !entries.length ? ' warn' : ''}`, style: { margin: '10px 0 0' } },
    el('p', { className: 'small', style: { margin: '0 0 4px' } }, el('b', {}, 'Ultimo invio: '), `${at} – ${last.title}`),
    entries.length
      ? el('ul', { className: 'steps small', style: { margin: '0' } }, ...entries.map(([k, v]) => el('li', {}, `${CHANNEL_NAMES[k] ?? k}: ${v === 'ok' ? '✅ partita' : `❌ ${v}`}`)))
      : el('p', { className: 'small', style: { margin: '0' } }, '❌ Nessun canale acceso: accendi ntfy o Telegram qui sopra.'));
}
function notifySection() {
  if (!notify) { loadNotify(); return el('section', { className: 'card' }, el('h2', {}, 'Notifiche'), el('p', { className: 'muted small' }, 'Carico…')); }
  const s = structuredClone(notify.settings);
  const save = async () => { const r = await api('/api/notify', { method: 'PUT', body: { settings: s } }); if (r) { notify.settings = r.settings; toast('Salvato'); render(); } };
  const sw = (label, get, set) => el('label', { className: 'switch' }, label, el('input', { type: 'checkbox', checked: get(), onchange: (e) => { set(e.target.checked); save(); } }));
  const timeIn = (get, set) => el('input', { type: 'time', value: get(), onchange: (e) => { if (e.target.value) { set(e.target.value); save(); } } });
  const sel = (opts, get, set) => { const x = el('select', { onchange: (e) => { set(Number(e.target.value)); save(); } }, ...opts.map(([v, l]) => el('option', { value: String(v) }, l))); x.value = String(get()); return x; };
  const dayChips = el('div', { className: 'chips' }, ...WEEKDAYS.map((w, i) => el('button', {
    type: 'button', className: `chip${s.briefing.days.includes(i + 1) ? ' on' : ''}`,
    onclick: () => { s.briefing.days = s.briefing.days.includes(i + 1) ? s.briefing.days.filter((d) => d !== i + 1) : [...s.briefing.days, i + 1]; save(); },
  }, w.slice(0, 3))));
  const topic = s.channels.ntfy.topic;
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Copiato'); } catch { toast('Selezionalo e copialo'); } };
  const noChannel = !s.channels.ntfy.enabled && !s.channels.telegram.enabled;
  return el('section', { className: 'card notify' }, el('h2', {}, 'Notifiche'),
    noChannel ? el('p', { className: 'card warn', style: { margin: '0 0 12px' } }, '⚠️ Scegli almeno un canale qui sotto, altrimenti le notifiche non arrivano.') : null,
    el('div', { className: 'nsec' },
      sw('🌅 Buongiorno con gli impegni del giorno', () => s.briefing.enabled, (v) => { s.briefing.enabled = v; }),
      el('div', { className: 'grid2' }, el('label', { className: 'field' }, el('span', {}, 'Alle'), timeIn(() => s.briefing.time, (v) => { s.briefing.time = v; })), el('span')),
      el('div', { className: 'field' }, el('span', {}, 'Nei giorni'), dayChips)),
    el('div', { className: 'nsec' },
      sw('🗓️ Riepilogo della settimana', () => s.weekly.enabled, (v) => { s.weekly.enabled = v; }),
      el('div', { className: 'grid2' },
        el('label', { className: 'field' }, el('span', {}, 'Ogni'), sel(WEEKDAYS.map((w, i) => [i + 1, w]), () => s.weekly.day, (v) => { s.weekly.day = v; })),
        el('label', { className: 'field' }, el('span', {}, 'Alle'), timeIn(() => s.weekly.time, (v) => { s.weekly.time = v; })))),
    el('div', { className: 'nsec' },
      sw('⏰ Promemoria prima degli impegni', () => s.reminders.enabled, (v) => { s.reminders.enabled = v; }),
      el('p', { className: 'hint' }, 'Quanto prima lo scegli in ogni impegno (campo "Promemoria"). Le live hanno 30 minuti.')),
    el('div', { className: 'nsec' },
      sw('🔁 Ripeti finché non tocco "Ho visto"', () => s.repeat.enabled, (v) => { s.repeat.enabled = v; }),
      el('div', { className: 'grid2' },
        el('label', { className: 'field' }, el('span', {}, 'Ogni'), sel([[5, '5 minuti'], [10, '10 minuti'], [15, '15 minuti'], [30, '30 minuti'], [60, '1 ora'], [120, '2 ore']], () => s.repeat.everyMin, (v) => { s.repeat.everyMin = v; })),
        el('label', { className: 'field' }, el('span', {}, 'Al massimo'), sel([[2, '2 volte'], [3, '3 volte'], [6, '6 volte'], [10, '10 volte'], [20, '20 volte']], () => s.repeat.maxTimes, (v) => { s.repeat.maxTimes = v; }))),
      el('div', { className: 'grid2' },
        el('label', { className: 'field' }, el('span', {}, 'Non di notte: dalle'), timeIn(() => s.repeat.quietFrom, (v) => { s.repeat.quietFrom = v; })),
        el('label', { className: 'field' }, el('span', {}, 'alle'), timeIn(() => s.repeat.quietTo, (v) => { s.repeat.quietTo = v; })))),
    el('h2', { style: { marginTop: '18px' } }, 'Dove arrivano'),
    el('div', { className: 'nsec' },
      sw('📱 ntfy (notifiche sul telefono)', () => s.channels.ntfy.enabled, (v) => { s.channels.ntfy.enabled = v; }),
      el('ol', { className: 'steps small' },
        el('li', {}, 'Installa l\'app gratuita ', el('b', {}, 'ntfy'), ' (Google Play o App Store).'),
        el('li', {}, 'Nell\'app premi ＋ e scrivi questo nome (è segreto, non condividerlo):', el('div', { className: 'copy', style: { marginTop: '6px' } }, el('code', {}, topic), el('button', { type: 'button', className: 'btn small', onclick: () => copy(topic) }, 'Copia'))),
        el('li', {}, 'Accendi l\'interruttore qui sopra e premi "Manda una prova".')),
      el('p', { className: 'hint' }, 'Le notifiche passano dal servizio gratuito ntfy.sh. Il pulsante "✅ Ho visto" funziona quando il telefono raggiunge il Raspberry (a casa o con Tailscale attivo).')),
    el('div', { className: 'nsec' },
      sw('✈️ Telegram (chat privata)', () => s.channels.telegram.enabled, (v) => { s.channels.telegram.enabled = v; }),
      el('p', { className: 'hint' }, notify.telegram ? `Usa il bot di TwitchGestor: arriva nella chat "${notify.telegram.name || 'privata'}".` : 'Usa il bot di TwitchGestor: prima collegalo in TwitchGestor → Riepiloghi → Telegram (chat privata).')),
    el('div', { className: 'row', style: { marginTop: '8px' } },
      el('button', { type: 'button', className: 'btn primary', onclick: async () => {
        const r = await api('/api/notify/test', { method: 'POST' });
        if (!r) return;
        notify.last = r.last;
        const res = Object.values(r.last?.results ?? {});
        toast(!res.length ? 'Nessun canale acceso: la prova non è partita' : res.every((x) => x === 'ok') ? 'Prova inviata' : 'Qualcosa non è partito: guarda sotto');
        load(true);
        render();
      } }, '🧪 Manda una prova')),
    lastSendBox(notify.last),
    el('p', { className: 'hint' }, `I pulsanti delle notifiche aprono: ${notify.linkBase}`));
}

// ---------- annunci per la community ----------
let ann = null;
// il lupo del canale (caricato in Annunci → Dove inviare): compare in alto nella storia
let mascot;
const loadMascot = () => {
  if (mascot !== undefined) return Promise.resolve(mascot);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { mascot = img; resolve(img); };
    img.onerror = () => { mascot = null; resolve(null); };
    img.src = `mascot.png?v=${ann?.mascot ?? 0}`;
  });
};
async function loadAnnounce() {
  ann = await api('/api/announce');
  if (view === 'announce') render();
}
const STATUS = { draft: 'Da inviare', sent: 'Inviato', dismissed: 'Ignorato' };
function draftCard(d) {
  const canvas = el('canvas', { className: 'story', 'aria-label': 'Storia Instagram' });
  loadMascot().then((m) => drawStory(canvas, d, { login: ann?.login, mascot: m }));
  const text = el('textarea', { rows: '7', maxlength: '3500', disabled: d.status !== 'draft' });
  text.value = d.text;
  text.onchange = () => api(`/api/announce/${d.id}/text`, { method: 'POST', body: { text: text.value } });
  const mins = d.sendAt ? Math.max(0, Math.ceil((d.sendAt - Date.now()) / 60000)) : null;
  const res = Object.entries(d.results ?? {}).map(([k, v]) => `${k === 'telegram' ? 'Telegram' : 'Discord'}: ${v === 'ok' ? '✓ inviato' : `✕ ${v}`}`).join(' · ');
  const download = () => canvas.toBlob((b) => {
    const a = el('a', { href: URL.createObjectURL(b), download: `storia-${d.kind}-${(d.lives?.[0]?.start ?? '').slice(0, 10)}.png` });
    document.body.append(a); a.click(); a.remove();
  }, 'image/png');
  return el('section', { className: `card draft ${d.status}` },
    el('div', { className: 'draft-head' },
      el('b', {}, d.title),
      el('span', { className: `badge-s ${d.status}` }, STATUS[d.status] ?? d.status),
      el('span', { className: 'muted small' }, new Date(d.createdAt).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))),
    mins !== null && d.status === 'draft' ? el('div', { className: 'card warn auto' }, `⏳ Si invia da solo tra ${mins} min (solo testo).`,
      el('button', { type: 'button', className: 'btn small', onclick: async () => { if (await api(`/api/announce/${d.id}/hold`, { method: 'POST' })) loadAnnounce(); } }, 'Ferma')) : null,
    el('div', { className: 'draft-body' },
      el('div', { className: 'story-box' }, canvas),
      el('div', { className: 'col' },
        el('label', { className: 'field' }, el('span', {}, 'Messaggio per Telegram e Discord'), text),
        res ? el('p', { className: 'hint' }, res) : null,
        el('div', { className: 'row' },
          d.status === 'draft' ? el('button', {
            type: 'button', className: 'btn primary',
            onclick: async (e) => {
              e.target.disabled = true;
              const image = canvas.toDataURL('image/png');
              const r = await api(`/api/announce/${d.id}/send`, { method: 'POST', body: { text: text.value, image } });
              e.target.disabled = false;
              if (r) { toast(r.draft.status === 'sent' ? 'Inviato 📣' : 'Non inviato: guarda il messaggio sotto'); loadAnnounce(); }
            },
          }, '📤 Invia con la storia') : null,
          el('button', { type: 'button', className: 'btn', onclick: download }, '⬇ Storia Instagram'),
          el('button', { type: 'button', className: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(text.value); toast('Testo copiato'); } catch { toast('Selezionalo e copialo'); } } }, 'Copia testo'),
          d.status === 'draft' ? el('button', { type: 'button', className: 'btn danger', onclick: async () => { if (await api(`/api/announce/${d.id}/dismiss`, { method: 'POST' })) loadAnnounce(); } }, 'Ignora') : null))));
}
function viewAnnounce() {
  if (!ann) { loadAnnounce(); return [el('div', { className: 'col' }, el('h1', {}, 'Annunci'), el('p', { className: 'muted' }, 'Carico…'))]; }
  const s = structuredClone(ann.settings);
  const save = async () => { const r = await api('/api/announce', { method: 'PUT', body: { settings: s } }); if (r) { ann.settings = r.settings; toast('Salvato'); render(); } };
  const sw = (label, get, set) => el('label', { className: 'switch' }, label, el('input', { type: 'checkbox', checked: get(), onchange: (e) => { set(e.target.checked); save(); } }));
  const hook = el('input', { type: 'url', placeholder: 'https://discord.com/api/webhooks/…', value: s.discordWebhook, onchange: (e) => { s.discordWebhook = e.target.value.trim(); save(); } });
  const delay = el('select', { onchange: (e) => { s.auto.delayMin = Number(e.target.value); save(); } }, ...[[5, '5 minuti'], [10, '10 minuti'], [30, '30 minuti'], [60, '1 ora']].map(([v, l]) => el('option', { value: String(v) }, l)));
  delay.value = String(s.auto.delayMin);
  const open = ann.drafts.filter((d) => d.status === 'draft');
  const done = ann.drafts.filter((d) => d.status !== 'draft');
  return [el('div', { className: 'col' },
    el('h1', {}, 'Annunci'),
    el('p', { className: 'muted', style: { margin: '-8px 0 0' } }, 'Quando una live viene aggiunta, spostata, annullata o cambiata (da qui o da TwitchGestor), qui trovi l\'annuncio pronto per la community. Puoi crearne uno quando vuoi anche con il pulsante 📣 nella scheda di una live.'),
    open.length ? open.map(draftCard) : el('div', { className: 'empty' }, 'Nessun annuncio da inviare. Prova a spostare una live: l\'annuncio compare qui.'),
    el('details', { className: 'card' }, el('summary', { className: 'sum' }, '⚙️ Dove inviare e invio automatico'),
      el('div', { className: 'notify' },
        el('div', { className: 'nsec' },
          sw('✈️ Canale Telegram', () => s.telegram, (v) => { s.telegram = v; }),
          el('p', { className: 'hint' }, ann.telegramChannel ? `Il canale "${ann.telegramChannel}" collegato in TwitchGestor.` : 'Prima collega il canale in TwitchGestor → Riepiloghi → Telegram → Canale pubblico.')),
        el('div', { className: 'nsec' },
          sw('💬 Discord', () => s.discord, (v) => { s.discord = v; }),
          el('label', { className: 'field' }, el('span', {}, 'Webhook del canale degli annunci'), hook),
          el('ol', { className: 'steps small' },
            el('li', {}, 'Su Discord: impostazioni del canale (⚙️) → ', el('b', {}, 'Integrazioni → Webhook → Nuovo webhook'), '.'),
            el('li', {}, el('b', {}, 'Copia URL del webhook'), ' e incollalo qui sopra.'))),
        el('div', { className: 'nsec' },
          sw('⏳ Invia da solo se non lo faccio io', () => s.auto.enabled, (v) => { s.auto.enabled = v; }),
          el('label', { className: 'field' }, el('span', {}, 'Dopo'), delay),
          el('p', { className: 'hint' }, 'Parte solo il testo; la storia la invii tu dal pulsante. Fino ad allora puoi modificarlo o fermarlo.')),
        el('div', { className: 'nsec' },
          el('b', {}, '🐺 Il tuo lupo nella storia'),
          el('p', { className: 'hint' }, 'Carica l\'illustrazione del lupo del canale (PNG con lo sfondo trasparente): compare in alto accanto al titolo.'),
          el('div', { className: 'row' },
            el('label', { className: 'btn small' }, ann.mascot ? 'Cambia immagine' : 'Carica immagine', el('input', {
              type: 'file', accept: 'image/png,image/webp', hidden: true,
              onchange: (e) => {
                const f = e.target.files[0];
                if (!f) return;
                if (f.size > 3 * 1024 * 1024) { toast('Immagine troppo grande (massimo 3 MB)'); return; }
                const r = new FileReader();
                r.onload = async () => { if (await api('/api/announce/mascot', { method: 'POST', body: { image: r.result } })) { mascot = undefined; toast('Lupo caricato 🐺'); loadAnnounce(); } };
                r.readAsDataURL(f);
              },
            })),
            ann.mascot ? el('button', { type: 'button', className: 'btn small danger', onclick: async () => { if (await api('/api/announce/mascot', { method: 'DELETE' })) { mascot = undefined; loadAnnounce(); } } }, 'Togli') : null)),
        el('div', { className: 'nsec' },
          el('b', {}, '📸 Instagram'),
          el('p', { className: 'hint' }, 'Scarica la storia e pubblicala dall\'app di Instagram. La pubblicazione automatica con l\'account Business richiede un\'app di Meta: la possiamo aggiungere più avanti.')))),
    done.length ? el('details', { className: 'card' }, el('summary', { className: 'sum' }, `Già inviati o ignorati (${done.length})`), el('div', { className: 'col', style: { marginTop: '12px' } }, done.slice(0, 10).map(draftCard))) : null)];
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

/**
 * Prima di salvare: se l'impegno si sovrappone ad altri, chiede se salvare lo stesso.
 * La finestra sta sopra a quella dell'impegno, così tornando indietro le modifiche restano.
 */
function okOverlaps(candidate) {
  const list = findOverlaps(candidate, allEvents(), { today: today(), skipId: candidate.id });
  if (!list.length) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (v) => { layer.remove(); document.removeEventListener('keydown', esc, true); resolve(v); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); done(false); } };
    const many = list.length >= 5;
    const layer = el('div', { className: 'sheet-bg overlap-bg', onclick: (e) => { if (e.target === layer) done(false); } },
      el('div', { className: 'sheet overlap', role: 'alertdialog', 'aria-modal': 'true' },
        el('h3', {}, '⚠️ Impegni sovrapposti'),
        el('p', { style: { margin: '0' } }, `"${candidate.title}" si sovrappone con:`),
        el('div', { className: 'items' }, list.map((o) => {
          const c = cat(o.category);
          return el('div', { className: 'item', style: { '--c': colorOf(o.category) } },
            el('span', { className: 't' }, o.time, o.endTime ? el('small', {}, o.endTime < o.time ? `${o.endTime} +1` : o.endTime) : null),
            el('span', { className: 'bar' }),
            el('span', { className: 'what' }, el('b', {}, o.title), el('span', {}, [relDay(o.day), c ? `${c.icon} ${c.name}` : ''].filter(Boolean).join(' · '))));
        })),
        many ? el('p', { className: 'muted small', style: { margin: '0' } }, 'E forse altri ancora (l\'impegno si ripete).') : null,
        el('p', { style: { margin: '0' } }, 'Vuoi salvarlo lo stesso?'),
        el('div', { className: 'sheet-actions' },
          el('span', { className: 'grow' }),
          el('button', { type: 'button', className: 'btn', onclick: () => done(false) }, 'Torna indietro'),
          el('button', { type: 'button', className: 'btn primary', onclick: () => done(true) }, 'Salva lo stesso'))));
    document.addEventListener('keydown', esc, true);
    document.body.append(layer);
  });
}

/** "📣 Crea annuncio": prepara subito l'annuncio di una live e apre la scheda Annunci. */
async function createAnnouncement(live, close) {
  const r = await api('/api/announce/create', { method: 'POST', body: { live } });
  if (!r) return;
  close?.();
  toast('Annuncio pronto 📣');
  ann = null;
  view = 'announce';
  history.replaceState(null, '', '#announce');
  load(true);
  render();
  window.scrollTo({ top: 0 });
}
const announceBtn = (live, close) => el('button', { type: 'button', className: 'btn', title: 'Crea l\'annuncio di questa live (Telegram, Discord, storia Instagram)', 'aria-label': 'Crea annuncio', onclick: () => createAnnouncement(live, close) }, '📣');

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
  // impegno nuovo: di base non è una live (una live nuova finisce in TwitchGestor e può generare un annuncio)
  const e = existing ? { ...existing } : { title: '', category: (data.categories.find((c) => c.id !== 'live') ?? data.categories[0])?.id, date: o.date ?? today(), time: '21:00', endTime: '', allDay: false, notes: '', remindMin: 30, repeat: { freq: 'none' } };
  const day = o.day ?? e.date; // il giorno toccato (per gli impegni che si ripetono)
  const title = el('input', { type: 'text', className: 'title-input', placeholder: 'Cosa devi fare?', value: e.title, maxlength: '140' });
  let category = e.category;
  const catChips = el('div', { className: 'chips' });
  const liveHint = el('p', { className: 'hint' }, '🔴 Le live nuove si salvano nella Programmazione di TwitchGestor: lì titolo e categoria si impostano da soli prima della live.');
  const drawCats = () => {
    catChips.replaceChildren(...data.categories.map((c) => el('button', {
      type: 'button', className: `chip${c.id === category ? ' on' : ''}`, style: { '--c': c.color }, onclick: () => { category = c.id; drawCats(); applyCatDefaults(); },
    }, `${c.icon} ${c.name}`)));
    liveHint.hidden = Boolean(existing) || category !== 'live' || !data.lives?.ok;
    const fixed = cat(category)?.defaults?.notes;
    catNotes.hidden = !fixed;
    catNotes.textContent = fixed ? `📌 ${fixed}` : '';
  };
  const catNotes = el('p', { className: 'cat-notes' });
  // impegno nuovo: orario e promemoria della categoria (se impostati)
  const applyCatDefaults = () => {
    if (existing) return;
    const d = cat(category)?.defaults ?? {};
    if (d.time) { time.value = d.time; allDay.checked = false; }
    if (d.time) endTime.value = d.endTime ?? '';
    if ('remindMin' in d) remind.value = d.remindMin === null ? '' : String(d.remindMin);
    sync?.();
  };
  drawCats();
  const date = el('input', { type: 'date', value: existing && e.repeat.freq !== 'none' ? day : e.date });
  const allDay = el('input', { type: 'checkbox', checked: e.allDay });
  const time = el('input', { type: 'time', value: e.time || '21:00' });
  const endTime = el('input', { type: 'time', value: e.endTime });
  const times = el('div', { className: 'grid2' }, el('label', { className: 'field' }, el('span', {}, 'Inizio'), time), el('label', { className: 'field' }, el('span', {}, 'Fine (facoltativa; prima dell\'inizio = il giorno dopo)'), endTime));
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
  applyCatDefaults(); // impegno nuovo: parte con orario e promemoria della categoria

  const collect = () => ({
    ...e, title: title.value, category, date: date.value, allDay: allDay.checked, time: time.value, endTime: endTime.value,
    notes: notes.value, remindMin: remind.value === '' ? null : Number(remind.value),
    repeat: { freq: freq.value, interval: Number(interval.value) || 1, days, until: until.value },
  });
  const close = openSheet(
    el('h3', {}, existing ? 'Modifica impegno' : 'Nuovo impegno'),
    title,
    el('div', { className: 'field' }, el('span', {}, 'Tipo'), catChips, liveHint, catNotes),
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
      existing && existing.category === 'live' && !existing.allDay
        ? announceBtn({ id: `h-${existing.id}@${day}`, start: `${day}T${existing.time}`, title: existing.title }, () => close())
        : null,
      el('span', { className: 'grow' }),
      el('button', { type: 'button', className: 'btn', onclick: () => close() }, 'Annulla'),
      el('button', {
        type: 'button', className: 'btn primary',
        onclick: async () => {
          const next = collect();
          if (!next.title.trim()) { title.focus(); toast('Scrivi cosa devi fare'); return; }
          if (!(await okOverlaps({ ...next, id: existing?.id }))) return;
          let r;
          // una live nuova va nella Programmazione di TwitchGestor (una sola o più settimane)
          if (!existing && category === 'live' && data.lives?.ok && ['none', 'weekly'].includes(next.repeat.freq)) {
            r = await saveAsLive(next);
            if (r) { close(); toast(next.repeat.freq === 'weekly' ? `Live create: ${r.added}` : 'Live salvata in TwitchGestor'); load(true); }
            return;
          }
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

const durOf = (e) => (e.allDay || !e.endTime ? 120 : Math.max(15, endMin(e) - toMin(e.time)));
function saveAsLive(e) {
  const time = e.allDay ? '21:00' : e.time;
  if (e.repeat.freq === 'weekly') {
    const weeks = e.repeat.until ? Math.min(12, Math.ceil((parseDate(e.repeat.until) - parseDate(e.date)) / (7 * 86400000)) + 1) : 8;
    return api('/api/lives/weeks', { method: 'POST', body: { from: e.date, weeks, days: e.repeat.days, time, durationMin: durOf(e), title: e.title } });
  }
  return api('/api/lives', { method: 'PUT', body: { live: { start: `${e.date}T${time}`, durationMin: durOf(e), title: e.title, notes: e.notes } } });
}

/** Una live della Programmazione di TwitchGestor: si modifica qui e cambia anche lì. */
function liveSheet(o) {
  const entry = data.lives.entries.find((x) => x.id === o.liveId) ?? {};
  const title = el('input', { type: 'text', className: 'title-input', placeholder: 'Titolo della live', value: entry.title ?? '', maxlength: '140' });
  const date = el('input', { type: 'date', value: o.date });
  const time = el('input', { type: 'time', value: o.time });
  const DUR = [60, 90, 120, 150, 180, 240, 300, 360];
  const dur = el('select', {}, ...DUR.map((m) => el('option', { value: String(m) }, m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`)));
  dur.value = String(DUR.includes(o.durationMin) ? o.durationMin : 120);
  let game = { id: entry.gameId ?? '', name: entry.game ?? '' };
  const gameInput = el('input', { type: 'text', value: game.name, placeholder: 'Cerca un gioco o una categoria…', autocomplete: 'off' });
  const results = el('div', { className: 'chips' });
  let t = 0;
  gameInput.oninput = () => {
    clearTimeout(t);
    game = { id: '', name: gameInput.value };
    t = setTimeout(async () => {
      const q = gameInput.value.trim();
      if (!q) { results.replaceChildren(); return; }
      const r = await api(`/api/lives/categories?q=${encodeURIComponent(q)}`);
      results.replaceChildren(...(r?.categories ?? []).slice(0, 8).map((c) => el('button', {
        type: 'button', className: 'chip', onclick: () => { game = { id: c.id, name: c.name }; gameInput.value = c.name; results.replaceChildren(); },
      }, c.name)));
    }, 350);
  };
  const auto = el('input', { type: 'checkbox', checked: entry.autoTitle !== false });
  const notes = el('textarea', { placeholder: 'Note (solo per te)', maxlength: '300' });
  notes.value = entry.notes ?? '';
  const close = openSheet(
    el('h3', {}, '🔴 Live in programma'),
    el('p', { className: 'hint', style: { margin: '0' } }, `Salvata nella Programmazione di TwitchGestor${entry.twitchId ? ' e sul calendario di Twitch' : ''}: se la cambi qui, cambia anche lì.`),
    title,
    el('div', { className: 'grid2' }, el('label', { className: 'field' }, el('span', {}, 'Giorno'), date), el('label', { className: 'field' }, el('span', {}, 'Ora'), time)),
    el('label', { className: 'field' }, el('span', {}, 'Durata'), dur),
    el('label', { className: 'field' }, el('span', {}, 'Categoria su Twitch'), gameInput), results,
    el('label', { className: 'switch' }, 'Imposta da solo titolo e categoria 10 minuti prima', auto),
    notes,
    el('div', { className: 'sheet-actions' },
      el('button', {
        type: 'button', className: 'btn danger',
        onclick: async () => { if (!confirm(`Eliminare la live "${entry.title || 'Live'}" anche da TwitchGestor?`)) return; if (await api(`/api/lives/${entry.id}`, { method: 'DELETE' })) { close(); toast('Live eliminata'); load(true); } },
      }, 'Elimina'),
      announceBtn({ id: entry.id, start: entry.start, title: entry.title, game: entry.game }, () => close()),
      el('span', { className: 'grow' }),
      el('button', { type: 'button', className: 'btn', onclick: () => close() }, 'Annulla'),
      el('button', {
        type: 'button', className: 'btn primary',
        onclick: async () => {
          if (!date.value || !time.value) { toast('Scegli giorno e ora'); return; }
          const live = { ...entry, start: `${date.value}T${time.value}`, durationMin: Number(dur.value), title: title.value, game: game.name, gameId: game.id, notes: notes.value, autoTitle: auto.checked };
          if (!(await okOverlaps({ id: o.id, title: live.title || 'Live', date: date.value, time: time.value, durationMin: live.durationMin, allDay: false, repeat: { freq: 'none' } }))) return;
          if (await api('/api/lives', { method: 'PUT', body: { live } })) { close(); toast('Live aggiornata anche in TwitchGestor'); load(true); }
        },
      }, 'Salva')));
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

// ---------- turni da dipendente: si toccano i giorni di lavoro del mese, l'orario è sempre quello del turno ----------
function shiftSheet(fromDay = today()) {
  const shift = { ...(data.shift ?? { title: 'Turno al Cube', category: 'cube', time: '23:00', endTime: '07:00', remindMin: 60 }) };
  let month = fromDay.slice(0, 7);
  let picked = new Set();
  let monthLoaded = '';
  const monthRange = () => { const first = `${month}-01`; const [y, m] = month.split('-').map(Number); return [first, dateKey(new Date(y, m, 0, 12))]; };
  const loadMonth = () => {
    const [from, to] = monthRange();
    picked = new Set(data.events.filter((e) => e.source === 'shift' && e.date >= from && e.date <= to).map((e) => e.date));
    monthLoaded = month;
  };
  const head = el('div', { className: 'cal-head' });
  const grid = el('div', { className: 'month' });
  const count = el('b');
  const saveBtn = el('button', { type: 'button', className: 'btn primary' });
  const draw = () => {
    if (monthLoaded !== month) loadMonth();
    const [y, m] = month.split('-').map(Number);
    const [from, to] = monthRange();
    const go = (n) => { month = dateKey(new Date(y, m - 1 + n, 1, 12)).slice(0, 7); draw(); };
    head.replaceChildren(
      el('button', { type: 'button', className: 'btn small', onclick: () => go(-1), 'aria-label': 'Mese prima' }, '‹'),
      el('b', {}, new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })),
      el('button', { type: 'button', className: 'btn small', onclick: () => go(1), 'aria-label': 'Mese dopo' }, '›'));
    const start = addDays(from, -(weekday(from) - 1));
    const cells = [];
    const daysOfWeekday = (w) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) if (weekday(d) === w) out.push(d); return out; };
    // tocca una lettera (L, M, …) per segnare o togliere quel giorno in tutto il mese
    const wd = ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((w, i) => el('button', {
      type: 'button', className: 'wd', style: { aspectRatio: 'auto', minHeight: '0', background: 'none', padding: '2px' },
      title: `Tutti i ${WEEKDAYS[i]} del mese`,
      onclick: () => { const ds = daysOfWeekday(i + 1); const all = ds.every((d) => picked.has(d)); for (const d of ds) { if (all) picked.delete(d); else picked.add(d); } draw(); },
    }, w));
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      if (i >= 35 && d > to) break;
      const inMonth = d >= from && d <= to;
      cells.push(el('button', {
        type: 'button', disabled: !inMonth,
        className: [inMonth ? '' : 'other', d === today() ? 'today' : '', picked.has(d) ? 'sel' : ''].filter(Boolean).join(' '),
        onclick: () => { if (picked.has(d)) picked.delete(d); else picked.add(d); draw(); },
        'aria-pressed': picked.has(d) ? 'true' : 'false',
      }, String(parseDate(d).getDate()), picked.has(d) ? el('span', { className: 'dots' }, el('i', { style: { '--c': colorOf(shift.category) } })) : null));
    }
    grid.replaceChildren(...wd, ...cells);
    count.textContent = `${picked.size} turni in questo mese`;
    saveBtn.textContent = 'Salva i turni';
  };
  const time = el('input', { type: 'time', value: shift.time, onchange: (e) => { if (e.target.value) shift.time = e.target.value; } });
  const end = el('input', { type: 'time', value: shift.endTime, onchange: (e) => { if (e.target.value) shift.endTime = e.target.value; } });
  const title = el('input', { type: 'text', value: shift.title, maxlength: '140', oninput: (e) => { shift.title = e.target.value; } });
  const catSel = el('select', { onchange: (e) => { shift.category = e.target.value; draw(); } }, ...data.categories.map((c) => el('option', { value: c.id }, `${c.icon} ${c.name}`)));
  catSel.value = shift.category;
  const remind = el('select', { onchange: (e) => { shift.remindMin = e.target.value === '' ? null : Number(e.target.value); } },
    ...[['', 'Nessuno'], ['30', '30 minuti prima'], ['60', '1 ora prima'], ['120', '2 ore prima']].map(([v, l]) => el('option', { value: v }, l)));
  remind.value = shift.remindMin == null ? '' : String(shift.remindMin);
  saveBtn.onclick = async () => {
    const [from, to] = monthRange();
    const r = await api('/api/shifts', { method: 'PUT', body: { from, to, days: [...picked], shift } });
    if (r) { close(); toast(r.added || r.removed ? `Turni salvati (${r.added} nuovi, ${r.removed} tolti) 🌙` : 'Turni salvati 🌙'); load(true); }
  };
  draw();
  const close = openSheet(el('h3', {}, `🌙 ${shift.title}`),
    el('p', { className: 'muted small', style: { marginTop: '0' } }, `Tocca i giorni in cui lavori (orario ${shift.time}–${shift.endTime}). Tocca una lettera per segnare o togliere quel giorno in tutto il mese. Puoi farlo un mese o una settimana alla volta.`),
    head, grid,
    el('p', { className: 'small' }, count),
    el('details', {}, el('summary', {}, '⚙️ Orario e dettagli del turno'),
      el('label', { className: 'field' }, el('span', {}, 'Nome'), title),
      el('div', { className: 'grid2' },
        el('label', { className: 'field' }, el('span', {}, 'Inizio'), time),
        el('label', { className: 'field' }, el('span', {}, 'Fine (il giorno dopo se è prima)'), end)),
      el('div', { className: 'grid2' },
        el('label', { className: 'field' }, el('span', {}, 'Tipo'), catSel),
        el('label', { className: 'field' }, el('span', {}, 'Promemoria'), remind)),
      el('p', { className: 'hint' }, 'Vale per i turni nuovi; quelli già segnati restano come sono.')),
    el('p', { className: 'hint' }, '⏱️ Straordinario? Tocca quel turno nel calendario e cambia l\'ora di inizio o di fine: vale solo per quel giorno.'),
    el('div', { className: 'sheet-actions' }, el('span', { className: 'grow' }), el('button', { type: 'button', className: 'btn', onclick: () => close() }, 'Annulla'), saveBtn));
}

// ---------- note (pulsante col blocco note in Oggi) ----------
// icona del blocco note: fogli con la spirale in alto e le righe
const NOTEPAD_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="4" width="15" height="17.5" rx="2.5"/><path d="M8 2.5v3M12 2.5v3M16 2.5v3M8 10h8M8 13.5h8M8 17h5"/></svg>';
function notesButton() {
  const n = (data.notes ?? []).length;
  const btn = el('button', { type: 'button', className: 'notes-btn', title: 'Note', 'aria-label': `Note (${n})`, onclick: () => notesSheet() });
  btn.innerHTML = NOTEPAD_SVG; // icona fissa, nessun dato dell'utente
  if (n) btn.append(el('i', { className: 'badge' }, String(n)));
  return btn;
}

function noteWhen(n) {
  if (!n.date) return '';
  return `📅 ${longDate(n.date)}${n.time ? ` · 🕒 ${n.time}` : ''}`;
}

function notesSheet({ open = null } = {}) {
  const box = el('div', { className: 'notes' });
  const close = openSheet(box);
  const sorted = () => [...(data.notes ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);

  function list(highlight = null) {
    const notes = sorted();
    box.replaceChildren(
      el('div', { className: 'row', style: { alignItems: 'center' } },
        el('h3', { className: 'grow' }, '🗒️ Note'),
        el('button', { type: 'button', className: 'btn primary small', onclick: () => form() }, '＋ Nuova nota'),
        el('button', { type: 'button', className: 'btn small', onclick: () => close() }, 'Chiudi')),
      notes.length ? el('div', { className: 'note-list' }, notes.map((n) => noteCard(n, n.id === highlight)))
        : el('div', { className: 'empty' }, 'Nessuna nota. Premi "＋ Nuova nota" per scriverne una.'));
    if (highlight) box.querySelector('.note.hl')?.scrollIntoView({ block: 'nearest' });
  }

  function noteCard(n, hl) {
    return el('article', { className: `note card${hl ? ' hl' : ''}` },
      el('header', {},
        el('h4', {}, n.title),
        n.subtitle ? el('div', { className: 'sub' }, n.subtitle) : null,
        noteWhen(n) ? el('div', { className: 'when' }, noteWhen(n)) : null),
      n.body ? el('div', { className: 'body' }, n.body) : null,
      el('div', { className: 'row' },
        el('button', { type: 'button', className: 'btn small', onclick: () => form(n) }, '✏️ Modifica'),
        el('button', {
          type: 'button', className: 'btn small danger',
          onclick: async () => {
            if (!confirm(`Eliminare la nota "${n.title}"?`)) return;
            if (await api(`/api/notes/${encodeURIComponent(n.id)}`, { method: 'DELETE' })) {
              data.notes = (data.notes ?? []).filter((x) => x.id !== n.id);
              toast('Nota eliminata');
              list();
              load(true);
            }
          },
        }, '🗑 Elimina')));
  }

  function form(n = null) {
    const title = el('input', { type: 'text', value: n?.title ?? '', maxlength: '200', placeholder: 'Titolo' });
    const subtitle = el('input', { type: 'text', value: n?.subtitle ?? '', maxlength: '200', placeholder: 'Sottotitolo (facoltativo)' });
    const date = el('input', { type: 'date', value: n?.date ?? '' });
    const time = el('input', { type: 'time', value: n?.time ?? '' });
    const body = el('textarea', { rows: '9', maxlength: '20000', placeholder: 'Scrivi qui la nota…' });
    body.value = n?.body ?? '';
    const save = async () => {
      if (!title.value.trim()) { title.focus(); toast('Serve il titolo'); return; }
      const r = await api('/api/notes', { method: 'PUT', body: { note: { id: n?.id, title: title.value, subtitle: subtitle.value, date: date.value, time: date.value ? time.value : '', body: body.value } } });
      if (!r) return;
      data.notes = [...(data.notes ?? []).filter((x) => x.id !== r.note.id), r.note];
      toast('Nota salvata 🗒️');
      list(r.note.id);
      load(true);
    };
    box.replaceChildren(
      el('h3', {}, n ? '✏️ Modifica nota' : '🗒️ Nuova nota'),
      el('label', { className: 'field' }, el('span', {}, 'Titolo'), title),
      el('label', { className: 'field' }, el('span', {}, 'Sottotitolo'), subtitle),
      el('div', { className: 'grid2' },
        el('label', { className: 'field' }, el('span', {}, 'Giorno (facoltativo)'), date),
        el('label', { className: 'field' }, el('span', {}, 'Ora (facoltativa)'), time)),
      el('label', { className: 'field' }, el('span', {}, 'Nota'), body),
      el('div', { className: 'sheet-actions' },
        el('span', { className: 'grow' }),
        el('button', { type: 'button', className: 'btn', onclick: () => list() }, 'Annulla'),
        el('button', { type: 'button', className: 'btn primary', onclick: save }, 'Salva')));
    setTimeout(() => title.focus(), 50);
  }

  if (open) form(open); else list();
}

// ---------- disegno ----------
function render() {
  $('top-date').textContent = longDate(today());
  for (const b of $('nav').querySelectorAll('button')) b.classList.toggle('active', b.dataset.view === view);
  const parts = { today: viewToday, calendar: viewCalendar, tasks: viewTasks, announce: viewAnnounce, more: viewMore }[view]?.() ?? viewToday();
  $('fab').hidden = view === 'announce' || view === 'more';
  const badge = $('announce-badge');
  badge.hidden = !data.announce;
  badge.textContent = data.announce || '';
  const v = $('view');
  v.className = `view${view === 'today' || view === 'calendar' ? ' two' : ''}`;
  v.replaceChildren(...parts.filter(Boolean)); // senza i pezzi vuoti (altrimenti compare "null")
}

$('nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (!b) return;
  view = b.dataset.view;
  if (view === 'more') notify = null;
  if (view === 'announce') ann = null;
  history.replaceState(null, '', `#${view}`);
  render();
  window.scrollTo({ top: 0 });
});
$('fab').onclick = () => {
  if (view === 'tasks') return taskSheet({});
  const close = openSheet(el('h3', {}, 'Aggiungi'),
    el('div', { className: 'sheet-actions' },
      el('button', { type: 'button', className: 'btn primary grow', onclick: () => { close(); eventSheet({ date: view === 'calendar' ? calDay : today() }); } }, '📅 Impegno'),
      el('button', { type: 'button', className: 'btn grow', onclick: () => { close(); taskSheet({ due: view === 'calendar' ? calDay : '' }); } }, '✅ Cosa da fare')),
    el('button', { type: 'button', className: 'btn', style: { width: '100%', marginTop: '8px' }, onclick: () => { close(); shiftSheet(view === 'calendar' ? calDay : today()); } }, `🌙 Turni di lavoro (${data.shift?.title ?? 'Cube'})`));
};

// altri dispositivi possono cambiare i dati: si ricontrolla spesso e quando torni sulla pagina
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
setInterval(() => { if (!document.hidden) load(); }, 15000);
setInterval(() => { if (!document.hidden && !$('sheet-root').children.length) render(); }, 60000); // "tra 10 min" si aggiorna
load(true);
