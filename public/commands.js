// Scheda "Comandi": comandi della chat (!discord, !uptime...) e messaggi a tempo.
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => window.TG.api(path, opts);

  const PERMISSIONS = [
    ['everyone', 'Tutti'], ['subscriber', 'Abbonati'], ['vip', 'VIP'], ['moderator', 'Moderatori'], ['broadcaster', 'Solo tu'],
  ];
  const ACTIONS = [
    ['reply', 'Risponde con un testo'],
    ['list', 'Elenca i comandi ({result})'],
    ['scene', 'Cambia scena di OBS ({scene})'],
    ['credits', 'Fa ripartire i titoli di coda'],
  ];
  const VARIABLES = [
    ['{user}', 'chi scrive'],
    ['{target}', 'il nome dopo il comando (es. !so @nome), altrimenti chi scrive'],
    ['{args}', 'tutto il testo dopo il comando'],
    ['{1}', 'prima parola dopo il comando ({2}, {3}…)'],
    ['{channel}', 'il tuo canale'],
    ['{uptime}', 'da quanto sei in live'],
    ['{followage}', 'da quanto chi scrive ti segue'],
    ['{game}', 'categoria della live'],
    ['{title}', 'titolo della live'],
    ['{lastfollow}', 'ultimo follower'],
    ['{count}', 'quante volte è stato usato il comando'],
    ['{random:1-100}', 'numero a caso'],
    ['{scene}', 'scena di OBS attivata'],
    ['{result}', 'risultato dell\'azione (es. elenco dei comandi)'],
  ];

  let saved = null; // impostazioni salvate nel programma
  let draft = null; // modifiche in corso
  let selected = null;
  let state = null;
  let loaded = false;

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const dirty = () => saved && JSON.stringify(saved) !== JSON.stringify(draft);
  const prefix = () => draft?.prefix || '!';

  function updateSaveBar() {
    $('cmd-save-bar').hidden = !dirty();
  }
  function change(fn, { list = true, editor = false } = {}) {
    fn(draft);
    if (list) renderList();
    if (editor) renderEditor();
    updateSaveBar();
  }

  // ---------- stato: si legge la chat? chi risponde? ----------
  function renderStatus() {
    const box = $('cmd-status');
    if (!state || !draft) return;
    const c = state.commands ?? {};
    const who = state.chatAccount?.kind === 'bot' ? state.chatAccount.user.login : state.twitch?.user?.login;
    const lines = [];
    if (!state.twitch?.user && !state.demo) {
      lines.push(el('p', { className: 'cmd-warn' }, 'Collega il tuo account Twitch (in alto a destra) per usare i comandi.'));
    } else if (c.missingScope) {
      lines.push(el('p', { className: 'cmd-warn' }, el('b', {}, 'Serve un nuovo accesso a Twitch. '),
        'Per leggere la chat TwitchGestor ha bisogno di un permesso in più: clicca "Esci" in alto a destra e poi "Accedi con Twitch" con il tuo account (Wolfery non serve ricollegarlo).'));
    } else if (!draft.enabled) {
      lines.push(el('p', { className: 'muted small' }, 'I comandi sono spenti: attivali con l\'interruttore qui sopra (e salva).'));
    } else if (c.reading || state.demo) {
      lines.push(el('p', { className: 'cmd-ok' }, '✓ Leggo la chat. Risponde ', el('b', {}, who || 'il tuo account'),
        state.chatAccount?.kind === 'bot' ? ' (il bot).' : ': collega un account bot in "Personalizza alert → Impostazioni generali → Chat" per rispondere con Wolfery.'));
    } else {
      lines.push(el('p', { className: 'cmd-warn' }, 'Non riesco ancora a leggere la chat: controlla il registro del programma (scheda Live).'));
    }
    box.replaceChildren(...lines);
  }

  // ---------- elenco ----------
  function renderList() {
    $('cmd-enabled').checked = Boolean(draft.enabled);
    $('cmd-prefix').value = prefix();
    const list = draft.list ?? [];
    if (!list.some((c) => c.id === selected)) selected = list[0]?.id ?? null;
    $('cmd-list').replaceChildren(...(list.length ? list.map((c) => {
      const perm = PERMISSIONS.find(([k]) => k === c.permission)?.[1] ?? 'Tutti';
      const toggle = el('input', {
        type: 'checkbox', checked: c.enabled !== false, title: 'Attivo', 'aria-label': `Attiva ${prefix()}${c.name}`,
        onclick: (e) => e.stopPropagation(),
        onchange: (e) => change((d) => { d.list.find((x) => x.id === c.id).enabled = e.target.checked; }),
      });
      return el('div', {
        className: `cmd-item ${c.id === selected ? 'active' : ''} ${c.enabled === false ? 'off' : ''}`,
        role: 'button', tabindex: '0',
        onclick: () => { selected = c.id; renderList(); renderEditor(); },
        onkeydown: (e) => { if (e.key === 'Enter') { selected = c.id; renderList(); renderEditor(); } },
      },
      el('span', { className: 'cmd-name' }, prefix() + c.name, (c.aliases ?? []).length ? el('small', {}, ` ${c.aliases.map((a) => prefix() + a).join(' ')}`) : null),
      el('span', { className: 'cmd-perm' }, perm),
      toggle);
    }) : [el('p', { className: 'muted small' }, 'Nessun comando: creane uno con "Nuovo comando".')]));
  }

  // ---------- modifica del comando scelto ----------
  function field(label, input, hint) {
    return el('label', { className: 'field' }, el('span', { className: 'field-label' }, label), input, hint ? el('span', { className: 'hint' }, hint) : null);
  }
  function insertAt(textarea, text) {
    const { selectionStart: a = textarea.value.length, selectionEnd: b = a } = textarea;
    textarea.value = textarea.value.slice(0, a) + text + textarea.value.slice(b);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = a + text.length;
    textarea.dispatchEvent(new Event('input'));
  }

  function renderEditor() {
    const box = $('cmd-editor');
    const c = draft.list?.find((x) => x.id === selected);
    if (!c) {
      box.replaceChildren(el('p', { className: 'muted small' }, 'Scegli un comando dall\'elenco.'));
      return;
    }
    const set = (key, opts) => (e) => change((d) => {
      const cmd = d.list.find((x) => x.id === c.id);
      cmd[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
    }, opts);

    const name = el('input', { type: 'text', value: c.name, maxlength: '30', spellcheck: 'false', oninput: (e) => {
      e.target.value = e.target.value.replace(/^[!?#$%&*+.~-]+/, '').replace(/\s+/g, '').toLowerCase();
      set('name')(e);
      box.querySelector('.cmd-editor-head h3').textContent = prefix() + (e.target.value || '…');
    } });
    const aliases = el('input', { type: 'text', value: (c.aliases ?? []).join(', '), spellcheck: 'false', placeholder: 'es. dc, server', oninput: (e) => change((d) => {
      d.list.find((x) => x.id === c.id).aliases = e.target.value.split(/[,\s]+/).map((a) => a.replace(/^[!?#$%&*+.~-]+/, '').toLowerCase()).filter(Boolean);
    }) });
    const action = el('select', { onchange: set('action', { editor: true }) }, ...ACTIONS.map(([k, l]) => el('option', { value: k }, l)));
    action.value = c.action ?? 'reply';
    const response = el('textarea', { rows: '3', maxlength: '450', oninput: set('response', { list: false }) });
    response.value = c.response ?? '';
    const perm = el('select', { onchange: set('permission') }, ...PERMISSIONS.map(([k, l]) => el('option', { value: k }, l)));
    perm.value = c.permission ?? 'everyone';
    const actionHint = {
      scene: `Scrivi ${prefix()}${c.name} seguito dal nome della scena (basta l'inizio, es. ${prefix()}${c.name} gio). Serve OBS collegato (scheda Live → Scene OBS).`,
      credits: 'Fa ripartire da capo la sorgente dei titoli di coda in OBS.',
      list: 'Elenca i comandi attivi che possono usare tutti.',
    }[c.action];

    box.replaceChildren(
      el('div', { className: 'cmd-editor-head' },
        el('h3', {}, `${prefix()}${c.name || '…'}`),
        el('button', {
          type: 'button', className: 'small-btn danger',
          onclick: (e) => {
            const b = e.currentTarget;
            if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Sicuro? Clicca ancora'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '🗑 Elimina'; } }, 4000); return; }
            change((d) => { d.list = d.list.filter((x) => x.id !== c.id); }, { editor: true });
          },
        }, '🗑 Elimina')),
      el('div', { className: 'grid-2' },
        field('Nome', name, 'Senza simbolo, una parola sola'),
        field('Nomi alternativi', aliases, 'Separati da virgola')),
      el('div', { className: 'grid-2' },
        field('Cosa fa', action, actionHint),
        field('Chi può usarlo', perm)),
      field('Risposta in chat', response, 'Lascia vuoto per non rispondere (utile con le azioni).'),
      el('div', { className: 'chips' }, el('span', { className: 'hint' }, 'Inserisci:'),
        ...VARIABLES.map(([v, d]) => el('button', { type: 'button', className: 'chip', title: d, onclick: () => insertAt(response, v) }, v))),
      el('div', { className: 'grid-2' },
        field('Attesa tra un uso e l\'altro (secondi)', el('input', { type: 'number', min: '0', max: '3600', value: String(c.cooldown ?? 0), oninput: set('cooldown', { list: false }) })),
        field('Attesa per lo stesso spettatore (secondi)', el('input', { type: 'number', min: '0', max: '3600', value: String(c.userCooldown ?? 0), oninput: set('userCooldown', { list: false }) }))),
    );
  }

  // ---------- messaggi a tempo ----------
  function renderTimers() {
    const timers = draft.timers ?? [];
    $('timer-list').replaceChildren(...(timers.length ? timers.map((t) => {
      const set = (key) => (e) => change((d) => {
        const x = d.timers.find((y) => y.id === t.id);
        x[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value;
      }, { list: false });
      const msg = el('textarea', { rows: '2', maxlength: '450', placeholder: 'es. Seguimi su Instagram @…', oninput: set('message') });
      msg.value = t.message ?? '';
      return el('div', { className: `timer-item ${t.enabled === false ? 'off' : ''}` },
        msg,
        el('div', { className: 'timer-opts' },
          el('label', { className: 'inline small' }, 'ogni', el('input', { type: 'number', min: '1', max: '240', value: String(t.interval ?? 15), oninput: set('interval') }), 'minuti'),
          el('label', { className: 'inline small' }, 'se ci sono almeno', el('input', { type: 'number', min: '0', max: '200', value: String(t.minLines ?? 5), oninput: set('minLines') }), 'messaggi in chat'),
          el('label', { className: 'inline small' }, el('input', { type: 'checkbox', checked: t.enabled !== false, onchange: (e) => { set('enabled')(e); renderTimers(); } }), 'attivo'),
          el('button', { type: 'button', className: 'small-btn danger', onclick: () => { change((d) => { d.timers = d.timers.filter((x) => x.id !== t.id); }, { list: false }); renderTimers(); } }, '🗑')));
    }) : [el('p', { className: 'muted small' }, 'Nessun messaggio a tempo.')]));
  }

  function renderAll() {
    renderList();
    renderEditor();
    renderTimers();
    renderStatus();
    updateSaveBar();
  }

  async function load() {
    const data = await api('/api/config', { method: 'GET' });
    if (!data) return;
    saved = clone(data.config.commands ?? { enabled: false, prefix: '!', list: [], timers: [] });
    draft = clone(saved);
    loaded = true;
    renderAll();
  }

  // ---------- azioni ----------
  $('cmd-enabled').onchange = (e) => { change((d) => { d.enabled = e.target.checked; }); renderStatus(); };
  $('cmd-prefix').onchange = (e) => change((d) => { d.prefix = e.target.value; }, { editor: true });
  $('cmd-add').onclick = () => {
    const id = `c${Date.now().toString(36)}`;
    let n = 1;
    while (draft.list.some((c) => c.name === `nuovo${n}`)) n++;
    change((d) => { d.list.push({ id, name: `nuovo${n}`, aliases: [], action: 'reply', response: '', permission: 'everyone', cooldown: 5, userCooldown: 0, enabled: true }); });
    selected = id;
    renderAll();
    $('cmd-editor').querySelector('input')?.select();
  };
  $('timer-add').onclick = () => {
    change((d) => { d.timers.push({ id: `t${Date.now().toString(36)}`, message: '', interval: 15, minLines: 5, enabled: true }); }, { list: false });
    renderTimers();
    $('timer-list').lastElementChild?.querySelector('textarea')?.focus();
  };
  $('cmd-save').onclick = async () => {
    const res = await api('/api/commands', { method: 'PUT', body: { commands: draft } });
    if (!res) return;
    saved = clone(res.commands);
    draft = clone(res.commands); // nomi ripuliti dal programma (es. doppioni tolti)
    renderAll();
    const toast = el('div', { className: 'toast' }, '✓ Comandi salvati');
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2000);
  };
  $('cmd-discard').onclick = () => { draft = clone(saved); renderAll(); };
  $('cmd-test').onsubmit = async (e) => {
    e.preventDefault();
    let text = $('cmd-test-text').value.trim();
    if (!text) return;
    if (!/^[!?#$%&*+.~-]/.test(text)) text = prefix() + text;
    const res = await api('/api/commands/test', { body: { text, role: $('cmd-test-role').value, commands: draft } });
    const out = $('cmd-test-out');
    out.classList.toggle('muted', !res?.reply);
    out.replaceChildren(res?.reply
      ? (res.reply.startsWith('(') ? res.reply : el('span', {}, el('b', {}, `${state?.chatAccount?.user?.login ?? 'bot'}: `), res.reply))
      : 'Nessuna risposta (comando inesistente, spento o senza testo).');
  };

  window.addEventListener('tg:state', (e) => { state = e.detail; renderStatus(); });
  window.addEventListener('commands:open', () => { if (!loaded) load(); else renderStatus(); });
  window.addEventListener('beforeunload', (e) => { if (dirty()) e.preventDefault(); });
  if (!$('tab-commands').hidden) load();
})();
