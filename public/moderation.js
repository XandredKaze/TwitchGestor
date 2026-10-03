// Scheda "Comandi" → riquadro "Parole bannate": il bot modera la chat.
// Le modifiche si salvano da sole (dopo mezzo secondo).
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => window.TG.api(path, opts);
  const ACTION_LABEL = { delete: 'cancella', timeout: 'timeout', ban: 'ban' };

  let settings = null;
  let state = null;
  let history = [];
  let loaded = false;
  let saveT = 0;

  const fmtDuration = (s) => (s >= 86400 ? `${Math.round(s / 86400)} g` : s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
  const describe = (w) => (w.action === 'timeout' ? `timeout ${fmtDuration(w.duration ?? 600)}` : ACTION_LABEL[w.action] ?? 'cancella');

  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      const res = await api('/api/moderation', { method: 'PUT', body: { moderation: settings } });
      if (res) { settings = res.moderation; renderWords(); }
    }, 500);
  }

  function renderStatus() {
    if (!settings) return;
    const m = state?.moderation ?? {};
    const box = $('mod-status');
    if (!state?.twitch?.user && !state?.demo) {
      box.replaceChildren(el('p', { className: 'cmd-warn' }, 'Collega il tuo account Twitch per usare la moderazione.'));
    } else if (!settings.enabled) {
      box.replaceChildren(el('p', { className: 'muted small' }, 'La moderazione è spenta: attivala con l\'interruttore qui sopra.'));
    } else if (m.missingScope) {
      box.replaceChildren(el('p', { className: 'cmd-warn' }, el('b', {}, 'Serve un nuovo accesso. '),
        m.byBot ? `Per moderare, ${m.by} ha bisogno di nuovi permessi: in "Personalizza alert → Impostazioni generali → Chat" scollega e ricollega il bot.`
          : 'Clicca "Esci" in alto a destra e poi "Accedi con Twitch".'));
    } else {
      box.replaceChildren(el('p', { className: 'cmd-ok' }, '✓ Modera ', el('b', {}, m.by ?? 'il bot'),
        m.byBot ? `. Deve essere moderatore del canale: se non lo è, scrivi /mod ${m.by} nella tua chat.` : ' (il tuo account: collega un bot per farlo moderare a lui).'));
    }
  }

  function renderWords() {
    $('mod-enabled').checked = Boolean(settings.enabled);
    $('mod-exempt-vip').checked = Boolean(settings.exemptVip);
    $('mod-exempt-subs').checked = Boolean(settings.exemptSubs);
    if (document.activeElement !== $('mod-warning')) $('mod-warning').value = settings.warning ?? '';
    const words = settings.words ?? [];
    $('mod-words').replaceChildren(...(words.length ? words.map((w, i) => el('span', { className: `mod-word act-${w.action}` },
      el('b', {}, w.text),
      el('small', {}, describe(w) + (w.inside ? ' · anche dentro' : '')),
      el('button', {
        type: 'button', className: 'mod-x', title: `Togli "${w.text}"`, 'aria-label': `Togli ${w.text}`,
        onclick: () => { settings.words.splice(i, 1); renderWords(); save(); },
      }, '✕'))) : [el('p', { className: 'muted small' }, 'Nessuna parola nell\'elenco.')]));
  }

  function renderLog() {
    const box = $('mod-log');
    if (!history.length) { box.replaceChildren(el('p', { className: 'muted small' }, 'Ancora nessun intervento del bot.')); return; }
    box.replaceChildren(...history.map((r, i) => el('div', { className: `mod-entry ${r.error ? 'err' : ''}` },
      el('span', { className: 'mod-time' }, new Date(r.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })),
      el('span', { className: 'mod-what' }, el('b', {}, r.user ?? '?'), ` → ${r.label}`, el('small', {}, ` · "${r.word}"`),
        r.error ? el('span', { className: 'mod-error' }, ` · non riuscito: ${r.error}`) : null,
        el('span', { className: 'mod-text' }, r.text)),
      !r.error && r.action !== 'delete'
        ? (r.undone ? el('span', { className: 'muted small' }, 'annullato')
          : el('button', { type: 'button', className: 'small-btn', onclick: async () => { const res = await api('/api/moderation/undo', { body: { index: i } }); if (res) { history = res.history; renderLog(); } } }, 'Annulla'))
        : null)));
  }

  async function load() {
    const [cfg, log] = await Promise.all([api('/api/config', { method: 'GET' }), api('/api/moderation/log', { method: 'GET', quiet: true })]);
    if (!cfg) return;
    settings = cfg.config.moderation ?? { enabled: false, words: [], warning: '', exemptVip: false, exemptSubs: false };
    history = log?.history ?? [];
    loaded = true;
    renderWords();
    renderStatus();
    renderLog();
  }

  // ---------- azioni ----------
  $('mod-action').onchange = () => { $('mod-duration').hidden = $('mod-action').value !== 'timeout'; };
  $('mod-duration').hidden = true;
  $('mod-add').onsubmit = (e) => {
    e.preventDefault();
    const texts = $('mod-word').value.split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
    if (!texts.length) return;
    const action = $('mod-action').value;
    for (const text of texts) {
      if (settings.words.some((w) => w.text.toLowerCase() === text.toLowerCase())) continue;
      settings.words.push({ text, action, duration: Number($('mod-duration').value), inside: $('mod-inside').checked });
    }
    $('mod-word').value = '';
    renderWords();
    save();
  };
  $('mod-enabled').onchange = (e) => { settings.enabled = e.target.checked; renderStatus(); save(); };
  $('mod-exempt-vip').onchange = (e) => { settings.exemptVip = e.target.checked; save(); };
  $('mod-exempt-subs').onchange = (e) => { settings.exemptSubs = e.target.checked; save(); };
  $('mod-warning').oninput = (e) => { settings.warning = e.target.value; save(); };
  $('mod-test').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('mod-test-text').value;
    if (!text.trim()) return;
    const res = await api('/api/moderation/test', { body: { text, moderation: settings } });
    const r = res?.result;
    const out = $('mod-test-out');
    out.classList.toggle('muted', !r);
    out.replaceChildren(!r ? '✓ Messaggio permesso.' : r.exempt ? 'Esente.' : el('span', {}, '✕ Bloccato da ', el('b', {}, `"${r.word}"`), ` → ${r.label}`));
  };

  window.addEventListener('tg:state', (e) => { state = e.detail; renderStatus(); });
  window.addEventListener('tg:moderation', (e) => { history = e.detail; if (loaded) renderLog(); });
  window.addEventListener('commands:open', () => { if (!loaded) load(); else renderStatus(); });
  if (!$('tab-commands').hidden) load();
})();
