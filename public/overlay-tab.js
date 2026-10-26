// Scheda "Overlay": grafiche, video e suoni delle scene di OBS nella cartella condivisa di TwitchGestor
// (sul Raspberry: \\twitchgestor\TwitchGestor\overlay) invece che sul PC. Si caricano e si organizzano qui;
// "Collega a Gestor" fa leggere a una sorgente di OBS il file di questa cartella (solo quando lo premi).
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => window.TG.api(path, opts);
  let data = null; // { files, folders, root, limit, exts, share }
  let obs = null; // { connected, error, root, sources }
  let obsLoading = false;
  let open = false;
  let folder = ''; // cartella che stai guardando
  let search = '';
  const uploads = new Map(); // caricamenti in corso: id → { name, pct }
  let editing = null; // { mode: 'mkdir' } | { mode: 'rename', path, isDir } | { mode: 'move', path }

  const fill = (node, ...children) => node.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  const size = (b) => {
    const n = Number(b) || 0;
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return n < 1024 ** 3 ? `${(n / 1024 / 1024).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB` : `${(n / 1024 ** 3).toLocaleString('it-IT', { maximumFractionDigits: 1 })} GB`;
  };
  const ICONS = { image: '🖼', video: '🎞', audio: '🔊', web: '🌐' };
  const base = (p) => String(p).split(/[\\/]/).filter(Boolean).pop() ?? '';
  const sep = () => (String(data?.root ?? '').includes('\\') ? '\\' : '/');
  const fullPath = (rel) => (data?.root ? [data.root.replace(/[\\/]+$/, ''), ...rel.split('/')].join(sep()) : '');
  const absUrl = (u) => new URL(u, location.href).href;

  async function copy(btn, text, label) {
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copiato!'; } catch { btn.textContent = 'Selezionalo e copialo'; }
    setTimeout(() => { btn.textContent = label; }, 1500);
  }
  function copyRow(label, text) {
    const btn = el('button', { type: 'button', className: 'small-btn', onclick: () => copy(btn, text, 'Copia') }, 'Copia');
    return el('div', { className: 'mu-url' }, el('span', { className: 'field-label' }, label), el('div', { className: 'mu-url-row' }, el('code', {}, text), btn));
  }

  async function load() {
    const r = await api('/api/overlay', { method: 'GET', quiet: true });
    if (r) { data = r; if (folder && !data.folders.includes(folder)) folder = ''; render(); }
  }
  async function loadObs() {
    obsLoading = true;
    renderObs();
    obs = await api('/api/overlay/obs', { method: 'GET', quiet: true }) ?? { connected: false, error: 'Non riesco a leggere le sorgenti di OBS', sources: [] };
    obsLoading = false;
    renderObs();
    renderFiles(); // "usato da" sui file
  }

  // ---------- caricamento (con avanzamento: i video possono essere grandi) ----------
  function upload(file, into) {
    const id = `${Date.now()}-${Math.random()}`;
    uploads.set(id, { name: file.name, pct: 0 });
    renderUploads();
    if (window.TG_DEMO) { // la demo risponde solo a fetch
      return api(`/api/overlay/upload?folder=${encodeURIComponent(into)}`, { body: file, headers: { 'x-filename': encodeURIComponent(file.name) } })
        .then((r) => { uploads.delete(id); renderUploads(); return r ? r.path : null; });
    }
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/overlay/upload?folder=${encodeURIComponent(into)}`);
      xhr.setRequestHeader('x-twitchgestor', '1');
      xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
      if (window.TG.token()) xhr.setRequestHeader('x-dashboard-token', window.TG.token());
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) { uploads.get(id).pct = Math.round((e.loaded / e.total) * 100); renderUploads(); } };
      const done = (ok, error) => {
        uploads.delete(id);
        renderUploads();
        if (!ok) alert(`${file.name}: ${error}`);
        resolve(ok ? JSON.parse(xhr.responseText || '{}').path ?? '' : null);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return done(true);
        let msg = `Errore ${xhr.status}`;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* niente */ }
        done(false, msg);
      };
      xhr.onerror = () => done(false, 'Programma non raggiungibile');
      xhr.send(file);
    });
  }
  async function uploadAll(items, into = folder) {
    const limit = data?.limit ?? Infinity;
    const ok = [];
    for (const { file, dir } of items) {
      if (file.size > limit) { alert(`${file.name}: troppo grande (massimo ${size(limit)})`); continue; }
      const target = [into, dir].filter(Boolean).join('/');
      const p = await upload(file, target);
      if (p) ok.push(p);
    }
    await load();
    if (obs?.connected) loadObs();
    return ok;
  }
  // trascinando una cartella intera si tengono anche le sottocartelle
  async function droppedItems(dt) {
    const entries = [...(dt.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return [...dt.files].map((file) => ({ file, dir: '' }));
    const out = [];
    const readAll = (reader) => new Promise((resolve) => {
      const all = [];
      const next = () => reader.readEntries((batch) => { if (!batch.length) resolve(all); else { all.push(...batch); next(); } }, () => resolve(all));
      next();
    });
    const walk = async (entry, dir) => {
      if (entry.isFile) out.push({ file: await new Promise((r, j) => entry.file(r, j)), dir });
      else if (entry.isDirectory) for (const e of await readAll(entry.createReader())) await walk(e, dir ? `${dir}/${entry.name}` : entry.name);
    };
    for (const e of entries) await walk(e, '');
    return out;
  }
  function renderUploads() {
    const box = $('ov-uploads');
    if (!box) return;
    fill(box, ...[...uploads.values()].map((u) => el('div', { className: 'ov-upload' },
      el('span', {}, `⬆ ${u.name}`), el('div', { className: 'mu-bar' }, el('div', { style: { width: `${u.pct}%` } })), el('span', { className: 'small' }, `${u.pct}%`))));
  }

  // ---------- azioni sui file ----------
  // nuova cartella, rinomina e sposta si fanno direttamente nella scheda (niente finestre)
  function inlineForm(control, okLabel, onOk) {
    const cancel = () => { editing = null; renderFiles(); };
    control.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancel(); });
    setTimeout(() => { control.focus(); control.select?.(); }, 0);
    return el('form', { className: 'ov-inline', onsubmit: async (e) => { e.preventDefault(); await onOk(control.value.trim()); } },
      control,
      el('button', { type: 'submit', className: 'small-btn primary' }, okLabel),
      el('button', { type: 'button', className: 'small-btn', title: 'Annulla', 'aria-label': 'Annulla', onclick: cancel }, '✕'));
  }
  const afterChange = () => { editing = null; load(); if (obs?.connected) loadObs(); };
  async function newFolder(name) {
    if (!name) return;
    const r = await api('/api/overlay/folder', { body: { path: [folder, name].filter(Boolean).join('/') } });
    if (r) { folder = r.path; afterChange(); }
  }
  async function rename(item, name, isDir) {
    if (!name || name === base(item)) { editing = null; renderFiles(); return; }
    const parent = item.split('/').slice(0, -1).join('/');
    const r = await api('/api/overlay/rename', { body: { from: item, to: [parent, name].filter(Boolean).join('/') } });
    if (r) {
      if (isDir && folder === item) folder = r.to;
      if (r.relinked) alert(`Fatto. ${r.relinked === 1 ? 'Una sorgente di OBS è stata aggiornata' : `${r.relinked} sorgenti di OBS sono state aggiornate`} con il nuovo nome.`);
      afterChange();
    }
  }
  async function move(file, dest) {
    if (dest === file.folder) { editing = null; renderFiles(); return; }
    const r = await api('/api/overlay/rename', { body: { from: file.path, to: [dest, file.name].filter(Boolean).join('/') } });
    if (r) afterChange();
  }
  async function remove(item, isDir = false) {
    const users = isDir ? (obs?.sources ?? []).filter((s) => s.rel?.toLowerCase().startsWith(`${item.toLowerCase()}/`)) : usedBy(item);
    const warn = users.length ? `\n\nATTENZIONE: in OBS lo usano ${users.map((s) => `"${s.name}"`).join(', ')}: senza il file la sorgente resta vuota.` : '';
    if (!confirm(`${isDir ? `Eliminare la cartella "${base(item)}" e tutto quello che contiene?` : `Eliminare "${base(item)}"?`}${warn}`)) return;
    const r = await api('/api/overlay/delete', { body: { path: item } });
    if (r) { if (isDir && (folder === item || folder.startsWith(`${item}/`))) folder = ''; load(); if (obs?.connected) loadObs(); }
  }
  const usedBy = (rel) => (obs?.sources ?? []).filter((s) => s.onGestor && s.rel?.toLowerCase() === rel.toLowerCase());

  // ---------- file ----------
  function thumb(f) {
    if (f.type === 'image') return el('img', { src: f.url, alt: '', loading: 'lazy' });
    if (f.type === 'video') return el('video', { src: `${f.url}#t=0.5`, muted: true, preload: 'metadata', playsinline: true, onmouseenter: (e) => e.target.play().catch(() => {}), onmouseleave: (e) => e.target.pause() });
    return el('span', { className: 'ov-icon', 'aria-hidden': 'true' }, ICONS[f.type] ?? '📄');
  }
  function renderFiles() {
    if (!data || !open) return;
    const q = search.trim().toLowerCase();
    const inFolder = (p) => (folder ? p.startsWith(`${folder}/`) : true);
    const subfolders = q ? [] : data.folders.filter((d) => d.split('/').slice(0, -1).join('/') === folder);
    const files = data.files.filter((f) => (q ? inFolder(f.path) && f.path.toLowerCase().includes(q) : f.folder === folder));
    const crumbs = ['', ...folder.split('/').filter(Boolean).map((_, i, a) => a.slice(0, i + 1).join('/'))];
    const total = data.files.reduce((s, f) => s + f.size, 0);
    const pick = el('input', { type: 'file', multiple: true, hidden: true, accept: data.exts.join(','), onchange: () => { const items = [...pick.files].map((file) => ({ file, dir: '' })); pick.value = ''; uploadAll(items); } });

    const drop = el('div', {
      className: 'ov-drop',
      ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
      ondragleave: () => drop.classList.remove('over'),
      ondrop: async (e) => { e.preventDefault(); drop.classList.remove('over'); uploadAll(await droppedItems(e.dataTransfer)); },
    },
    el('p', {}, el('b', {}, 'Trascina qui file o cartelle intere'), ' (anche la cartella delle grafiche di una scena: le sottocartelle restano uguali)'),
    el('div', { className: 'ov-drop-actions' },
      el('button', { type: 'button', className: 'primary', onclick: () => pick.click() }, '⬆ Scegli i file'),
      editing?.mode === 'mkdir'
        ? inlineForm(el('input', { type: 'text', maxlength: '80', placeholder: 'Nome della cartella (es. una scena)', 'aria-label': 'Nome della nuova cartella' }), 'Crea', newFolder)
        : el('button', { type: 'button', onclick: () => { editing = { mode: 'mkdir' }; renderFiles(); } }, '📁 Nuova cartella')),
    el('p', { className: 'muted small' }, `Immagini, video, suoni e pagine HTML · massimo ${size(data.limit)} a file · finiscono in: ${folder || 'cartella principale'}`),
    pick);

    fill($('ov-files'),
      el('nav', { className: 'ov-crumbs', 'aria-label': 'Cartella' }, ...crumbs.map((c, i) => [
        i ? el('span', { className: 'muted', 'aria-hidden': 'true' }, '›') : null,
        el('button', { type: 'button', className: `ov-crumb${c === folder ? ' active' : ''}`, onclick: () => { folder = c; renderFiles(); } }, c ? base(c) : '🏠 overlay'),
      ])),
      drop,
      el('div', { id: 'ov-uploads', className: 'ov-uploads' }),
      el('p', { className: 'muted small' }, `${data.files.length} file · ${size(total)} in tutto`),
      subfolders.length || files.length ? el('div', { className: 'ov-grid' },
        ...subfolders.map((d) => el('div', { className: 'ov-card ov-folder' },
          el('button', { type: 'button', className: 'ov-thumb', onclick: () => { folder = d; renderFiles(); }, title: `Apri ${base(d)}` }, el('span', { className: 'ov-icon', 'aria-hidden': 'true' }, '📁')),
          editing?.mode === 'rename' && editing.path === d
            ? inlineForm(el('input', { type: 'text', maxlength: '80', value: base(d), 'aria-label': 'Nuovo nome della cartella' }), 'OK', (v) => rename(d, v, true))
            : el('div', { className: 'ov-name' }, el('b', {}, base(d)), el('small', {}, `${data.files.filter((f) => f.path.startsWith(`${d}/`)).length} file`)),
          el('div', { className: 'ov-actions' },
            el('button', { type: 'button', className: 'small-btn', title: 'Rinomina', 'aria-label': `Rinomina ${base(d)}`, onclick: () => { editing = { mode: 'rename', path: d }; renderFiles(); } }, '✏'),
            el('button', { type: 'button', className: 'small-btn danger', title: 'Elimina', 'aria-label': `Elimina ${base(d)}`, onclick: () => remove(d, true) }, '🗑')))),
        ...files.map((f) => {
          const used = usedBy(f.path);
          const pathBtn = el('button', { type: 'button', className: 'small-btn', title: 'Copia il percorso da usare in OBS', onclick: () => copy(pathBtn, fullPath(f.path), '📋') }, '📋');
          const urlBtn = el('button', { type: 'button', className: 'small-btn', title: 'Copia l\'indirizzo web (per una sorgente browser)', onclick: () => copy(urlBtn, absUrl(f.url), '🔗') }, '🔗');
          return el('div', { className: 'ov-card' },
            el('a', { className: 'ov-thumb', href: f.url, target: '_blank', rel: 'noopener', title: 'Apri' }, thumb(f)),
            editing?.mode === 'rename' && editing.path === f.path
              ? inlineForm(el('input', { type: 'text', maxlength: '80', value: f.name, 'aria-label': 'Nuovo nome del file' }), 'OK', (v) => rename(f.path, v, false))
              : editing?.mode === 'move' && editing.path === f.path
                ? inlineForm(el('select', { 'aria-label': 'Sposta nella cartella' }, el('option', { value: '' }, '🏠 cartella principale'), ...data.folders.map((d) => el('option', { value: d, selected: d === f.folder }, d))), 'Sposta', (v) => move(f, v))
                : el('div', { className: 'ov-name' }, el('b', { title: f.path }, f.name), el('small', {}, `${size(f.size)}${q && f.folder ? ` · ${f.folder}` : ''}`)),
            used.length ? el('span', { className: 'sc-badge ov-used', title: used.map((s) => s.name).join(', ') }, `🎬 in OBS: ${used.length === 1 ? used[0].name : `${used.length} sorgenti`}`) : null,
            el('div', { className: 'ov-actions' },
              data.root ? pathBtn : null, urlBtn,
              el('button', { type: 'button', className: 'small-btn', title: 'Rinomina', 'aria-label': `Rinomina ${f.name}`, onclick: () => { editing = { mode: 'rename', path: f.path }; renderFiles(); } }, '✏'),
              data.folders.length ? el('button', { type: 'button', className: 'small-btn', title: 'Sposta in un\'altra cartella', 'aria-label': `Sposta ${f.name}`, onclick: () => { editing = { mode: 'move', path: f.path }; renderFiles(); } }, '📂') : null,
              el('button', { type: 'button', className: 'small-btn danger', title: 'Elimina', 'aria-label': `Elimina ${f.name}`, onclick: () => remove(f.path) }, '🗑')));
        })) : el('p', { className: 'muted' }, q ? 'Nessun file trovato.' : folder ? 'Questa cartella è vuota.' : 'Ancora nessun file: trascinali qui sopra oppure copiali nella cartella condivisa (vedi qui accanto).'),
    );
    renderUploads();
  }

  // ---------- sorgenti di OBS ----------
  async function link(s, path) {
    const r = await api('/api/overlay/link', { body: { name: s.name, path } });
    if (r) loadObs();
  }
  async function uploadAndLink(s) {
    const pick = el('input', { type: 'file', accept: data.exts.join(',') });
    pick.onchange = async () => {
      const file = pick.files[0];
      if (!file) return;
      // le grafiche di una scena vanno nella cartella con il nome della scena
      const dir = s.scenes[0] ? s.scenes[0].replace(/[\\/:*?"<>|]/g, ' ').trim() : '';
      const [p] = await uploadAll([{ file, dir: '' }], dir);
      if (p) link(s, p);
    };
    pick.click();
  }
  function sourceRow(s) {
    const pcBtn = el('button', { type: 'button', className: 'small-btn', title: 'Copia il percorso del file sul PC (incollalo nella finestra "Apri" per trovarlo subito)', onclick: () => copy(pcBtn, s.file, '📋') }, '📋');
    return el('li', { className: `ov-src${s.onGestor ? ' on' : ''}${s.missing ? ' missing' : ''}` },
      el('div', { className: 'ov-src-head' },
        el('b', {}, s.name),
        el('span', { className: 'sc-badge' }, s.label),
        ...s.scenes.slice(0, 3).map((sc) => el('span', { className: 'sc-badge ov-scene' }, sc)),
        s.scenes.length > 3 ? el('span', { className: 'muted small' }, `+${s.scenes.length - 3}`) : null),
      s.onGestor
        ? el('div', { className: 'ov-src-body' },
          el('p', { className: 'small' }, s.missing ? '⚠ Il file non c\'è più nella cartella overlay: ' : '✓ Su Gestor: ', el('code', {}, s.rel)),
          s.previous ? el('button', { type: 'button', className: 'small-btn', title: s.previous, onclick: async () => { if (await api('/api/overlay/restore', { body: { name: s.name } })) loadObs(); } }, '↩ Torna al file del PC') : null)
        : el('div', { className: 'ov-src-body' },
          el('div', { className: 'mu-url-row' }, el('code', { title: s.file }, s.file), pcBtn),
          s.match
            ? el('div', { className: 'ov-src-actions' },
              el('span', { className: 'small' }, '✓ Trovato su Gestor: ', el('code', {}, s.match)),
              el('button', { type: 'button', className: 'small-btn primary', disabled: !obs.root, onclick: () => link(s, s.match) }, '🔗 Collega a Gestor'))
            : el('div', { className: 'ov-src-actions' },
              el('span', { className: 'small muted' }, 'Non ancora su Gestor.'),
              el('button', { type: 'button', className: 'small-btn', disabled: !obs.root, onclick: () => uploadAndLink(s) }, '⬆ Carica e collega'))));
  }
  function renderObs() {
    if (!open) return;
    const box = $('ov-obs');
    if (obsLoading && !obs) return fill(box, el('h2', {}, 'Sorgenti di OBS'), el('p', { className: 'muted' }, 'Leggo le scene di OBS…'));
    if (!obs) return fill(box, el('h2', {}, 'Sorgenti di OBS'), el('button', { type: 'button', onclick: loadObs }, '🔄 Controlla OBS'));
    const refresh = el('button', { type: 'button', className: 'small-btn', disabled: obsLoading, onclick: loadObs }, obsLoading ? 'Controllo…' : '🔄 Ricontrolla');
    if (!obs.connected) {
      return fill(box, el('div', { className: 'ov-files-head' }, el('h2', {}, 'Sorgenti di OBS'), refresh),
        el('p', { className: 'mu-warn' }, `⚠ ${obs.error || 'OBS non è collegato'}`),
        el('p', { className: 'muted small' }, 'Collega OBS a TwitchGestor (scheda 📡 Live → OBS) per vedere quali grafiche delle scene sono ancora sul PC e spostarle qui con un clic. La cartella si può usare anche senza: copia il percorso di un file (📋) e incollalo nella sorgente in OBS.'));
    }
    const onPc = obs.sources.filter((s) => !s.onGestor);
    const onGestor = obs.sources.filter((s) => s.onGestor);
    const ready = onPc.filter((s) => s.match);
    fill(box,
      el('div', { className: 'ov-files-head' }, el('h2', {}, 'Sorgenti di OBS'), refresh),
      !obs.root ? el('p', { className: 'mu-warn' }, '⚠ OBS non può ancora vedere la cartella: la cartella condivisa del Raspberry si attiva da sola con il prossimo aggiornamento.') : null,
      el('div', { className: 'ov-summary' },
        el('div', {}, el('b', {}, String(onPc.length)), el('span', {}, 'sul PC')),
        el('div', {}, el('b', {}, String(onGestor.length)), el('span', {}, 'su Gestor'))),
      ready.length && obs.root ? el('button', {
        type: 'button', className: 'primary ov-link-all',
        onclick: async () => {
          if (!confirm(`Collegare a Gestor ${ready.length === 1 ? 'la sorgente che ha' : `le ${ready.length} sorgenti che hanno`} il file anche qui?\nOBS leggerà i file dalla cartella condivisa (puoi sempre tornare ai file del PC con ↩).`)) return;
          const r = await api('/api/overlay/link-all', { body: {} });
          if (r) { if (r.failed.length) alert(`Collegate: ${r.linked}. Non riuscite:\n${r.failed.join('\n')}`); loadObs(); }
        },
      }, `🔗 Collega tutte quelle trovate (${ready.length})`) : null,
      !obs.sources.length ? el('p', { className: 'muted' }, 'In OBS non ci sono sorgenti immagine, video o browser con un file.') : null,
      onPc.length ? el('h3', {}, 'Ancora sul PC') : null,
      onPc.length ? el('ul', { className: 'ov-src-list' }, ...onPc.map(sourceRow)) : null,
      onGestor.length ? el('h3', {}, 'Già su Gestor') : null,
      onGestor.length ? el('ul', { className: 'ov-src-list' }, ...onGestor.map(sourceRow)) : null,
      el('p', { className: 'muted small' }, 'Come funziona: carica qui il file (oppure copialo nella cartella condivisa) con lo stesso nome che ha sul PC, poi premi 🔗. OBS non cambia niente da solo.'));
  }

  function renderShare() {
    const s = data.share;
    fill($('ov-share'),
      el('h2', {}, 'Cartella condivisa'),
      s ? [
        el('p', { className: 'small' }, 'I file sono anche qui, da Esplora file sul PC (comodo per copiare tante grafiche insieme):'),
        copyRow('Cartella overlay', `${s.path}\\overlay`),
        copyRow('Nome utente', s.user),
        copyRow('Password', s.password || '(quella del Raspberry)'),
        window.TG.shareCheck(s.check),
        el('p', { className: 'muted small' }, 'Quando Windows la chiede, scrivi il nome utente così com\'è (con "', s.host, '\\" davanti) e spunta "Memorizza credenziali": OBS legge i file solo se Windows ricorda l\'accesso.'),
        el('p', { className: 'muted small' }, 'Se dice "accesso negato": apri "Gestione credenziali" di Windows → Credenziali di Windows, elimina quelle di ', s.host, ' e riprova.'),
      ] : data.root
        ? el('p', { className: 'muted small' }, 'La cartella è qui, sul disco di questo PC: ', el('code', {}, data.root))
        : el('p', { className: 'muted small' }, 'La cartella condivisa in rete c\'è solo sul Raspberry (si attiva da sola con l\'aggiornamento).'),
      el('div', { className: 'ov-note' },
        el('b', {}, 'Da sapere'),
        el('ul', {},
          el('li', {}, 'Le scene collegate funzionano solo con il Raspberry acceso e il PC sulla stessa rete di casa: se il Raspberry è spento, in OBS quelle immagini restano vuote.'),
          el('li', {}, 'Video e suoni: in OBS lascia "File locale" spuntato; OBS li legge dalla rete come dal disco.'),
          el('li', {}, 'Le grafiche sul PC non vengono toccate: quando tutto funziona puoi cancellarle tu.'))));
  }

  function render() {
    if (!data || !open) return;
    renderFiles();
    renderShare();
    renderObs();
  }

  $('ov-search').oninput = (e) => { search = e.target.value; renderFiles(); };
  window.addEventListener('tab:overlays', () => {
    open = true;
    load().then(() => { if (!obs && window.TG.obsScenes().length) loadObs(); else renderObs(); });
  });
  document.addEventListener('click', (e) => { if (e.target.closest?.('.tab') && !e.target.closest('[data-tab="overlays"]')) open = false; });
})();
