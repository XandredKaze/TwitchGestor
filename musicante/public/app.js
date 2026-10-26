// Musicante: la pagina (telefono e PC). Il download lo fa yt-dlp sul Raspberry; qui si sceglie cosa e dove.
import { cleanUrl, formatDuration } from './core/ytdlp.js';

const $ = (id) => document.getElementById(id);
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style') Object.assign(n.style, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'className') n.className = v;
    else if (k === 'value' || k === 'checked') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
  return n;
}
let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- password e chiamate al Raspberry ----------
const params = new URLSearchParams(location.search);
let token = params.get('token') || '';
try { if (token) localStorage.setItem('musicanteToken', token); else token = localStorage.getItem('musicanteToken') || ''; } catch { /* niente */ }
if (params.has('token')) history.replaceState(null, '', location.pathname);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'x-musicante': '1', ...(token ? { 'x-dashboard-token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (res?.status === 401) { showLogin(Boolean(token)); return null; }
  const data = res ? await res.json().catch(() => ({})) : null;
  if (!res || !res.ok) { toast(data?.error || 'Musicante non raggiungibile'); return null; }
  return data;
}

function showLogin(wrong) {
  const input = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const msg = el('p', { className: 'hint' }, wrong ? 'La password salvata non è più valida.' : '');
  document.body.replaceChildren(el('div', { className: 'login' }, el('form', {
    className: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      const res = await fetch('/api/state', { headers: { 'x-dashboard-token': input.value.trim() } }).catch(() => null);
      if (res?.ok) { try { localStorage.setItem('musicanteToken', input.value.trim()); } catch { /* niente */ } location.reload(); } else msg.textContent = res ? 'Password sbagliata.' : 'Musicante non raggiungibile.';
    },
  }, el('div', { className: 'brand' }, el('b', {}, 'Music', el('span', {}, 'ante'))),
  el('span', {}, 'Scrivi la password (la stessa della dashboard di TwitchGestor). Su questo dispositivo serve una volta sola.'),
  input, msg, el('button', { type: 'submit', className: 'btn primary' }, 'Entra'))));
  input.focus();
}

// ---------- stato ----------
let data = null;
const form = { url: '', playlist: false, split: false, folder: 'Musicante', newFolder: '', info: null, probing: false };
const NEW = '__new__';

async function load(force = false) {
  const r = await api(`/api/state${data && !force ? `?rev=${data.rev}` : ''}`);
  if (!r || r.unchanged) return;
  data = r;
  render();
}

// ---------- pezzi ----------
function toolPill() {
  const t = data.tool;
  const pill = $('tool-pill');
  pill.className = 'pill';
  if (t.busy) { pill.textContent = `⏳ ${t.busy}`; pill.classList.add('warn'); }
  else if (!t.ytdlp) { pill.textContent = '⚠️ yt-dlp non pronto'; pill.classList.add('bad'); }
  else if (!t.ffmpeg) { pill.textContent = '⚠️ manca ffmpeg'; pill.classList.add('warn'); }
  else { pill.textContent = `✓ yt-dlp ${t.ytdlp}`; pill.classList.add('ok'); }
}

const looksLikePlaylist = (u) => /[?&]list=|\/playlist|\/sets\/|\/album\//i.test(u);

function downloadCard() {
  const url = el('input', { type: 'url', inputmode: 'url', placeholder: 'Incolla il link (YouTube, SoundCloud, Bandcamp…)', value: form.url });
  const pl = el('input', { type: 'checkbox', checked: form.playlist });
  url.oninput = () => {
    form.url = url.value.trim();
    form.info = null;
    if (looksLikePlaylist(form.url) && !form.playlist) { form.playlist = true; pl.checked = true; }
    previewBox.replaceChildren();
  };
  pl.onchange = () => { form.playlist = pl.checked; form.info = null; previewBox.replaceChildren(); };
  // capitoli: un MP3 per ogni minutaggio della descrizione (si accende da solo se l'anteprima ne trova)
  const sp = el('input', { type: 'checkbox', checked: form.split, onchange: () => { form.split = sp.checked; } });
  const paste = el('button', {
    type: 'button', className: 'btn', title: 'Incolla',
    onclick: async () => {
      try { url.value = (await navigator.clipboard.readText()).trim(); url.dispatchEvent(new Event('input')); } catch { url.focus(); toast('Tieni premuto nel campo e scegli Incolla'); }
    },
  }, '📋');

  const folders = data.folders;
  if (form.folder !== NEW && form.folder && !folders.includes(form.folder)) folders.unshift(form.folder);
  const sel = el('select', {
    onchange: () => { form.folder = sel.value; newName.hidden = sel.value !== NEW; if (sel.value === NEW) newName.focus(); },
  }, el('option', { value: '' }, '📁 Cartella principale della musica'), ...folders.map((f) => el('option', { value: f }, `📁 ${f}`)), el('option', { value: NEW }, '＋ Nuova cartella…'));
  sel.value = form.folder;
  const newName = el('input', { type: 'text', placeholder: 'Nome della nuova cartella (= playlist in TwitchGestor)', maxlength: '60', value: form.newFolder, oninput: (e) => { form.newFolder = e.target.value; } });
  newName.hidden = form.folder !== NEW;

  const previewBox = el('div');
  if (form.info) previewBox.append(previewView(form.info));
  const ready = Boolean(data.tool.ytdlp);
  const target = () => (form.folder === NEW ? form.newFolder.trim() : form.folder);

  const probeBtn = el('button', {
    type: 'button', className: 'btn', disabled: !ready,
    onclick: async () => {
      if (!cleanUrl(form.url)) { toast('Incolla un link valido'); url.focus(); return; }
      probeBtn.disabled = true;
      probeBtn.textContent = '⏳ Controllo…';
      const r = await api('/api/probe', { method: 'POST', body: { url: form.url, playlist: form.playlist } });
      probeBtn.disabled = false;
      probeBtn.textContent = '🔎 Anteprima';
      if (r) {
        form.info = r.info;
        if (r.info.chapters?.length && !form.split) { form.split = true; sp.checked = true; }
        previewBox.replaceChildren(previewView(r.info));
      }
    },
  }, '🔎 Anteprima');
  const go = el('button', {
    type: 'button', className: 'btn primary grow', disabled: !ready,
    onclick: async () => {
      if (!cleanUrl(form.url)) { toast('Incolla un link valido'); url.focus(); return; }
      if (form.folder === NEW && !target()) { toast('Scrivi il nome della cartella'); newName.focus(); return; }
      if (form.info?.isPlaylist && form.info.count > 50 && !confirm(`La playlist ha ${form.info.count} brani: scaricarli tutti?`)) return;
      const r = await api('/api/downloads', { method: 'POST', body: { url: form.url, playlist: form.playlist, split: form.split, folder: target(), title: form.info?.title ?? '', count: form.info?.count ?? 0 } });
      if (!r) return;
      toast('Download aggiunto ⬇');
      if (form.folder === NEW) form.folder = target();
      Object.assign(form, { url: '', info: null, newFolder: '', playlist: false, split: false });
      data = { ...data, ...r };
      render();
    },
  }, '⬇ Scarica MP3');

  return el('section', { className: 'card' }, el('h2', {}, 'Scarica'),
    el('div', { className: 'url-row' }, url, paste),
    el('label', { className: 'switch' }, el('span', {}, 'Playlist intera', el('span', { className: 'hint', style: { display: 'block', fontWeight: 400 } }, 'Spento: solo il brano del link')), pl),
    el('label', { className: 'switch' }, el('span', {}, 'Dividi per capitoli', el('span', { className: 'hint', style: { display: 'block', fontWeight: 400 } }, 'Un MP3 per ogni minutaggio della descrizione (per i mix lunghi)')), sp),
    el('label', { className: 'field' }, el('span', {}, 'Dove salvarla'), sel, newName),
    previewBox,
    el('div', { className: 'row' }, probeBtn, go),
    ready ? null : el('p', { className: 'hint' }, data.tool.busy || data.tool.error || 'yt-dlp si sta preparando…'));
}

function previewView(info) {
  return el('div', { className: 'preview' },
    el('b', {}, info.title || 'Senza titolo'),
    el('span', { className: 'hint' }, [info.uploader, info.isPlaylist ? `${info.count} brani` : 'brano singolo', info.duration ? formatDuration(info.duration) : ''].filter(Boolean).join(' · ')),
    info.isPlaylist && info.entries.length ? el('ol', {}, info.entries.map((e) => el('li', {}, `${e.title}${e.duration ? ` (${formatDuration(e.duration)})` : ''}`))) : null,
    info.isPlaylist && info.count > info.entries.length ? el('span', { className: 'hint' }, `…e altri ${info.count - info.entries.length}`) : null,
    info.chapters?.length
      ? [el('span', { className: 'hint' }, `✂️ ${info.chapters.length} capitoli: con "Dividi per capitoli" diventano ${info.chapters.length} MP3`),
        el('ol', {}, info.chapters.map((c) => el('li', {}, `${formatDuration(c.start)} ${c.title}`)))]
      : !info.isPlaylist ? el('span', { className: 'hint' }, 'Nessun capitolo: diventa un solo MP3') : null);
}

const STATUS = { queued: '⏳ In attesa', running: '⬇ In corso', done: '✓ Fatto', error: '⚠️ Errore', cancelled: 'Annullato' };

function jobView(j) {
  const folder = j.folder ? `📁 ${j.folder}` : '📁 cartella principale';
  const how = j.split ? ' · ✂️ per capitoli' : '';
  const progress = j.status === 'running'
    ? [j.total ? `${j.index ?? 1} di ${j.total}` : '', j.current].filter(Boolean).join(' · ')
    : '';
  const summary = j.status === 'done'
    ? `${j.files.length} ${j.files.length === 1 ? 'brano scaricato' : 'brani scaricati'}${j.skipped ? ` · ${j.skipped} già presenti` : ''}`
    : j.status === 'error' && j.files.length ? `${j.files.length} scaricati prima dell'errore` : '';
  return el('div', { className: `job ${j.status}` },
    el('div', { className: 'job-head' },
      el('div', { className: 'job-title' }, j.title || j.url, el('div', { className: 'job-meta' }, [folder + how, summary].filter(Boolean).join(' · '))),
      el('span', { className: `badge ${j.status}` }, STATUS[j.status] ?? j.status)),
    j.status === 'running' || j.status === 'queued' ? el('div', { className: 'bar' }, el('i', { style: { width: `${j.overall ?? 0}%` } })) : null,
    progress ? el('div', { className: 'job-meta' }, `${progress} · ${j.overall ?? 0}%`) : null,
    j.errors?.length ? el('ul', { className: 'errors' }, j.errors.slice(-3).map((e) => el('li', {}, e))) : null,
    j.files?.length ? el('details', {}, el('summary', {}, `File (${j.files.length})`), el('ul', {}, j.files.map((f) => el('li', {}, f)))) : null,
    el('div', { className: 'row' },
      j.status === 'running' || j.status === 'queued'
        ? el('button', { type: 'button', className: 'btn small danger', onclick: async () => { const r = await api(`/api/downloads/${j.id}/cancel`, { method: 'POST' }); if (r) { data = r; render(); } } }, 'Annulla')
        : el('button', { type: 'button', className: 'btn small', onclick: async () => { const r = await api(`/api/downloads/${j.id}`, { method: 'DELETE' }); if (r) { data = r; render(); } } }, 'Togli dall\'elenco'),
      j.status === 'error' || j.status === 'cancelled'
        ? el('button', { type: 'button', className: 'btn small', onclick: () => { Object.assign(form, { url: j.url, playlist: j.playlist, folder: j.folder, info: null }); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, '↻ Riprova')
        : null));
}

function jobsCard() {
  const jobs = data.jobs;
  const finished = jobs.some((j) => !['running', 'queued'].includes(j.status));
  return el('section', { className: 'card' },
    el('div', { className: 'row' }, el('h2', { className: 'grow' }, 'Download'),
      finished ? el('button', { type: 'button', className: 'btn small', onclick: async () => { const r = await api('/api/downloads/clear', { method: 'POST' }); if (r) { data = r; render(); } } }, 'Pulisci finiti') : null),
    jobs.length ? el('div', { className: 'jobs' }, jobs.map(jobView)) : el('div', { className: 'empty' }, 'Nessun download. Incolla un link qui sopra.'));
}

function infoCard() {
  const t = data.tool;
  return el('section', { className: `card${!t.ffmpeg || t.error ? ' warn' : ''}` }, el('h2', {}, 'Come funziona'),
    el('p', { className: 'hint' }, 'I brani diventano MP3 e finiscono nella musica di TwitchGestor: ogni cartella è una playlist del lettore della live (scheda 🎵 Musica). Si vedono anche nella cartella condivisa in rete (\\\\twitchgestor\\TwitchGestor\\music). I brani già scaricati una volta non si riscaricano.'),
    el('p', { className: 'hint' }, '⚠️ In live usa solo musica che puoi trasmettere (senza copyright o con licenza per lo streaming): Twitch può segnalare o silenziare i video con musica protetta.'),
    !t.ffmpeg ? el('p', { className: 'hint', style: { color: 'var(--warn)' } }, 'Manca ffmpeg (serve per gli MP3): si installa da solo con il prossimo aggiornamento di TwitchGestor.') : null,
    t.error ? el('p', { className: 'hint', style: { color: 'var(--danger)' } }, t.error) : null,
    el('div', { className: 'row' },
      el('span', { className: 'hint grow' }, t.ytdlp ? `yt-dlp ${t.ytdlp} (si aggiorna da solo ogni giorno)` : 'yt-dlp non ancora pronto'),
      el('button', {
        type: 'button', className: 'btn small', disabled: Boolean(t.busy),
        onclick: async (e) => { e.target.disabled = true; e.target.textContent = '⏳'; const r = await api('/api/tool/update', { method: 'POST' }); if (r) { data = r; render(); toast(r.tool.error || 'yt-dlp aggiornato'); } },
      }, '↻ Aggiorna yt-dlp')));
}

// ---------- disegno ----------
function render() {
  if (!data) return;
  toolPill();
  // non ridisegnare il modulo mentre scrivi (si perderebbe il cursore): si aggiornano solo download e stato
  const v = $('view');
  const active = document.activeElement;
  const typing = active && v.contains(active) && ['INPUT', 'SELECT'].includes(active.tagName) && active.closest('.card')?.dataset.part === 'form';
  const formNode = v.querySelector('[data-part="form"]');
  if (typing && formNode) {
    while (formNode.nextSibling) formNode.nextSibling.remove();
    v.append(jobsCard(), infoCard());
    return;
  }
  const f = downloadCard();
  f.dataset.part = 'form';
  v.replaceChildren(f, jobsCard(), infoCard());
}

load(true);
// mentre scarica si aggiorna spesso, altrimenti ogni tanto
setInterval(() => { if (!document.hidden && data?.jobs.some((j) => j.status === 'running' || j.status === 'queued')) load(); }, 1500);
setInterval(() => { if (!document.hidden) load(); }, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
