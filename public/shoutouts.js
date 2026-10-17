// Scheda "Comandi" → riquadro "Shoutout": il bot presenta le persone scelte al loro primo messaggio della live.
// Le modifiche si salvano da sole (dopo mezzo secondo).
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => window.TG.api(path, opts);

  let settings = null;
  let state = null;
  let history = [];
  let seen = [];
  let loaded = false;
  let saveT = 0;
  const editing = new Set(); // persone con il messaggio personalizzato aperto

  const cleanLogin = (v) => {
    const s = String(v ?? '').trim().replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?twitch\.tv\//i, '').replace(/\/.*$/, '').toLowerCase();
    return /^\w{2,25}$/.test(s) ? s : '';
  };

  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      const res = await api('/api/shoutouts', { method: 'PUT', body: { shoutouts: settings } });
      if (res) settings = res.shoutouts;
    }, 500);
  }

  function renderStatus() {
    if (!settings) return;
    const s = state?.shoutouts ?? {};
    const box = $('so-status');
    if (!state?.twitch?.user && !state?.demo) {
      box.replaceChildren(el('p', { className: 'cmd-warn' }, 'Collega il tuo account Twitch per usare gli shoutout.'));
    } else if (!settings.enabled) {
      box.replaceChildren(el('p', { className: 'muted small' }, 'Gli shoutout automatici sono spenti: attivali con l\'interruttore qui sopra.'));
    } else if (s.botMissingScope && settings.official !== false) {
      box.replaceChildren(el('p', { className: 'cmd-warn' }, el('b', {}, 'Ricollega il bot. '),
        'Per fare lo shoutout di Twitch il bot ha bisogno di un permesso nuovo: in "Personalizza alert → Impostazioni generali → Chat" scollega e ricollega il bot. Intanto lo shoutout lo fa il tuo account.'));
    } else if (state?.commands && !state.commands.reading && !state.demo) {
      box.replaceChildren(el('p', { className: 'cmd-warn' }, 'Non riesco ancora a leggere la chat: guarda lo stato nella sottoscheda "Comandi".'));
    } else {
      box.replaceChildren(el('p', { className: 'cmd-ok' }, '✓ Attivi. Lo shoutout lo fa ', el('b', {}, s.by ?? 'il bot'),
        s.byBot ? `: deve essere moderatore del canale (se non lo è, scrivi /mod ${s.by} nella tua chat).` : ' (il tuo account).'));
    }
  }

  async function test(login) {
    const out = $('so-test-out');
    out.classList.add('muted');
    out.textContent = `Cerco ${login} su Twitch…`;
    const res = await api('/api/shoutouts/test', { body: { login, shoutouts: settings }, quiet: true });
    out.classList.toggle('muted', !res);
    out.replaceChildren(res ? el('span', {}, el('b', {}, `${res.name}: `), res.text) : `Non riesco a trovare "${login}" su Twitch: controlla il nome.`);
  }

  function renderUsers() {
    $('so-enabled').checked = Boolean(settings.enabled);
    $('so-chat').checked = settings.chatMessage !== false;
    $('so-official').checked = settings.official !== false;
    $('so-card').checked = settings.obsCard !== false;
    $('so-only-live').checked = settings.onlyLive !== false;
    if (document.activeElement !== $('so-message')) $('so-message').value = settings.message ?? '';
    const users = settings.users ?? [];
    $('so-users').replaceChildren(...(users.length ? users.map((u, i) => {
      const open = editing.has(u.login);
      const done = seen.includes(u.login);
      return el('div', { className: `so-user ${u.message ? 'custom' : ''}` },
        el('span', { className: 'so-name' }, el('b', {}, u.login),
          done ? el('small', { className: 'so-done' }, '✓ già fatto in questa live') : null,
          u.message && !open ? el('small', {}, 'messaggio personalizzato') : null),
        el('span', { className: 'so-btns' },
          el('button', { type: 'button', className: 'small-btn', title: 'Vedi il messaggio che scriverebbe il bot', onclick: () => test(u.login) }, '▶'),
          el('button', {
            type: 'button', className: 'small-btn', title: 'Messaggio solo per questa persona', 'aria-pressed': String(open),
            onclick: () => { if (open) editing.delete(u.login); else editing.add(u.login); renderUsers(); },
          }, '✎'),
          el('button', {
            type: 'button', className: 'mod-x', title: `Togli ${u.login}`, 'aria-label': `Togli ${u.login}`,
            onclick: () => { settings.users.splice(i, 1); editing.delete(u.login); renderUsers(); save(); },
          }, '✕')),
        open ? el('textarea', {
          rows: 2, maxlength: 400, value: u.message ?? '', placeholder: `Vuoto = messaggio di tutti. Es. Seguite ${u.login}, fa le live più belle di {game}! {link}`,
          oninput: (e) => { if (e.target.value.trim()) u.message = e.target.value; else delete u.message; save(); },
        }) : null);
    }) : [el('p', { className: 'muted small' }, 'Nessuna persona nell\'elenco: aggiungi il nome del suo canale Twitch.')]));
  }

  function renderLog() {
    const box = $('so-log');
    if (!history.length) { box.replaceChildren(el('p', { className: 'muted small' }, 'Ancora nessuno shoutout.')); return; }
    const status = (label, v) => (v == null ? null : el('span', { className: v === 'ok' || v === 'in coda' ? '' : 'mod-error' }, ` · ${label}: ${v === 'ok' ? '✓' : v}`));
    box.replaceChildren(...history.map((r) => el('div', { className: `mod-entry ${/non riuscito/.test(`${r.chat} ${r.official}`) ? 'err' : ''}` },
      el('span', { className: 'mod-time' }, new Date(r.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })),
      el('span', { className: 'mod-what' }, el('b', {}, r.name), status('messaggio', r.chat), status('shoutout', r.official)),
      el('span'))));
  }

  async function load() {
    const [cfg, log] = await Promise.all([api('/api/config', { method: 'GET' }), api('/api/shoutouts/log', { method: 'GET', quiet: true })]);
    if (!cfg) return;
    settings = cfg.config.shoutouts ?? { enabled: false, users: [], message: '' };
    history = log?.history ?? [];
    seen = log?.seen ?? [];
    loaded = true;
    renderUsers();
    renderStatus();
    renderLog();
  }

  // ---------- azioni ----------
  $('so-add').onsubmit = (e) => {
    e.preventDefault();
    const raw = $('so-login').value.split(/[,;\n]+/).map((r) => r.trim()).filter(Boolean);
    const logins = raw.map(cleanLogin).filter(Boolean);
    const bad = raw.filter((r) => !cleanLogin(r));
    for (const login of logins) if (!settings.users.some((u) => u.login === login)) settings.users.push({ login });
    $('so-login').value = bad.join(', ');
    if (bad.length) $('so-test-out').textContent = `Nomi non validi: ${bad.join(', ')}`;
    renderUsers();
    save();
    if (logins.length === 1) test(logins[0]); // controlla subito che il canale esista
  };
  $('so-enabled').onchange = (e) => { settings.enabled = e.target.checked; renderStatus(); save(); };
  $('so-chat').onchange = (e) => { settings.chatMessage = e.target.checked; save(); };
  $('so-official').onchange = (e) => { settings.official = e.target.checked; renderStatus(); save(); };
  $('so-card').onchange = (e) => { settings.obsCard = e.target.checked; save(); };
  $('so-only-live').onchange = (e) => { settings.onlyLive = e.target.checked; save(); };
  $('so-message').oninput = (e) => { settings.message = e.target.value; save(); };
  $('so-reset').onclick = async () => {
    if (!confirm('Rifare gli shoutout? Ogni persona dell\'elenco riceverà di nuovo lo shoutout al prossimo messaggio.')) return;
    const res = await api('/api/shoutouts/reset', { body: {} });
    if (res) { seen = res.seen; renderUsers(); }
  };

  window.addEventListener('tg:state', (e) => { state = e.detail; renderStatus(); });
  window.addEventListener('tg:shoutouts', (e) => {
    history = e.detail.history ?? history;
    seen = e.detail.seen ?? seen;
    if (loaded) { renderLog(); if (!document.activeElement?.closest?.('.so-user')) renderUsers(); }
  });
  window.addEventListener('commands:open', () => { if (!loaded) load(); else renderStatus(); });
  if (!$('tab-commands').hidden) load();
})();
