// "Azioni rapide" (scheda Live), come nel Gestore stream di Twitch.
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);

  // Come TG.api, ma restituisce anche il messaggio d'errore (da mostrare nel riquadro, non in un avviso).
  async function call(path, { method = 'POST', body } = {}) {
    const token = window.TG.token();
    const res = await fetch(path, {
      method,
      headers: { 'x-twitchgestor': '1', ...(token ? { 'x-dashboard-token': token } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: 'Programma non raggiungibile' };
    if (!res?.ok) throw new Error(data.error ?? `Errore ${res?.status}`);
    return data;
  }

  // Le azioni, nell'ordine in cui compaiono. kind: form (apre un modulo), now (subito), toggle (acceso/spento)
  const ACTIONS = [
    { id: 'info', icon: '✏️', label: 'Titolo e categoria', kind: 'form' },
    { id: 'clip', icon: '🎬', label: 'Crea clip', kind: 'now' },
    { id: 'marker', icon: '📍', label: 'Segnalibro', kind: 'now', hint: 'Segna questo momento per ritrovarlo nel video' },
    { id: 'raid', icon: '🚀', label: 'Raid', kind: 'form' },
    { id: 'shoutout', icon: '📣', label: 'Shoutout', kind: 'form' },
    { id: 'announce', icon: '📢', label: 'Annuncio', kind: 'form' },
    { id: 'poll', icon: '📊', label: 'Sondaggio', kind: 'form' },
    { id: 'prediction', icon: '🔮', label: 'Pronostico', kind: 'form' },
    { id: 'ad', icon: '📺', label: 'Pubblicità', kind: 'form' },
    { id: 'emote', icon: '😀', label: 'Solo emote', kind: 'toggle' },
    { id: 'followers', icon: '❤️', label: 'Solo follower', kind: 'toggle' },
    { id: 'subscribers', icon: '⭐', label: 'Solo abbonati', kind: 'toggle' },
    { id: 'slow', icon: '🐢', label: 'Modalità lenta', kind: 'toggle' },
    { id: 'unique', icon: '🔁', label: 'Messaggi unici', kind: 'toggle' },
    { id: 'shield', icon: '🛡️', label: 'Modalità scudo', kind: 'toggle' },
    { id: 'clearChat', icon: '🧹', label: 'Svuota chat', kind: 'now', confirm: true },
  ];

  let app = null; // stato della dashboard (account, demo…)
  let qa = null; // stato da Twitch: titolo, chat, scudo, sondaggio, pronostico
  let open = null; // modulo aperto
  let busy = false;
  let lastRaid = null;

  const store = {
    get: () => { try { return JSON.parse(localStorage.getItem('qaHidden') || '[]'); } catch { return []; } },
    set: (v) => { try { localStorage.setItem('qaHidden', JSON.stringify(v)); } catch { /* ignora */ } },
  };

  function message(text, kind = 'ok', link) {
    const box = $('qa-msg');
    box.className = `qa-msg ${kind}`;
    box.replaceChildren(...[text ? el('span', {}, text) : null, link ? el('a', { href: link, target: '_blank', rel: 'noopener' }, ' Apri ↗') : null].filter(Boolean));
    clearTimeout(message.t);
    if (text && kind === 'ok') message.t = setTimeout(() => box.replaceChildren(), 6000);
  }

  const val = (part) => (part?.ok ? part.value : undefined);
  function isOn(id) {
    if (id === 'shield') return Boolean(val(qa?.shield));
    return Boolean(val(qa?.chat)?.[id]);
  }

  async function refresh() {
    if (!app || (!app.twitch?.user && !app.demo)) return;
    try {
      qa = await call('/api/actions/state', { method: 'GET' });
    } catch (err) {
      message(err.message, 'err');
    }
    renderGrid();
    if (open === 'poll' || open === 'prediction') renderForm();
  }

  async function run(name, body, { keepOpen = false } = {}) {
    if (busy) return null;
    busy = true;
    $('actions-panel').classList.add('busy');
    try {
      const r = await call(`/api/actions/${name}`, { body });
      message(r.message ?? 'Fatto', 'ok', r.url);
      if (!keepOpen) { open = null; renderForm(); }
      await refresh();
      return r;
    } catch (err) {
      message(err.message, 'err');
      return null;
    } finally {
      busy = false;
      $('actions-panel').classList.remove('busy');
    }
  }

  // ---------- griglia ----------
  function renderGrid() {
    const grid = $('qa-grid');
    if (!app?.twitch?.user && !app?.demo) {
      grid.replaceChildren(el('p', { className: 'muted small' }, 'Collega il tuo account Twitch per usare le azioni rapide.'));
      return;
    }
    const hidden = store.get();
    const visible = ACTIONS.filter((a) => !hidden.includes(a.id));
    grid.replaceChildren(...visible.map((a) => {
      const on = a.kind === 'toggle' && isOn(a.id);
      const live = (a.id === 'poll' && val(qa?.poll)) || (a.id === 'prediction' && val(qa?.prediction)) || (a.id === 'raid' && lastRaid);
      const b = el('button', {
        type: 'button',
        className: `qa-tile ${on ? 'on' : ''} ${open === a.id ? 'open' : ''} ${live ? 'live' : ''}`,
        title: a.hint ?? a.label,
        'aria-pressed': a.kind === 'toggle' ? String(on) : undefined,
        onclick: (e) => click(a, e.currentTarget),
      },
      el('span', { className: 'qa-icon', 'aria-hidden': 'true' }, a.icon),
      el('span', { className: 'qa-label' }, a.label),
      a.kind === 'toggle' ? el('span', { className: 'qa-state' }, on ? 'ATTIVO' : 'spento') : null,
      live ? el('span', { className: 'qa-state' }, a.id === 'raid' ? 'in preparazione' : 'in corso') : null);
      return b;
    }));
    if (!visible.length) grid.replaceChildren(el('p', { className: 'muted small' }, 'Nessuna azione: scegline alcune con "Personalizza".'));
  }

  function click(a, button) {
    if (a.kind === 'form') {
      open = open === a.id ? null : a.id;
      renderGrid();
      renderForm();
      return;
    }
    if (a.confirm && !button.dataset.armed) {
      button.dataset.armed = '1';
      button.querySelector('.qa-label').textContent = 'Clicca ancora';
      setTimeout(() => { if (button.isConnected) { delete button.dataset.armed; button.querySelector('.qa-label').textContent = a.label; } }, 3000);
      return;
    }
    if (a.kind === 'now') { run(a.id); return; }
    // interruttori: "solo follower" e "modalità lenta" chiedono un valore quando si accendono
    const on = isOn(a.id);
    if (!on && (a.id === 'followers' || a.id === 'slow')) {
      open = a.id;
      renderGrid();
      renderForm();
      return;
    }
    if (a.id === 'shield') run('shield', { on: !on });
    else run('chatMode', { mode: a.id, on: !on });
  }

  // ---------- moduli ----------
  const input = (attrs) => el('input', { type: 'text', autocomplete: 'off', ...attrs });
  const row = (...c) => el('div', { className: 'qa-row' }, ...c);
  const label = (text, control) => el('label', { className: 'qa-field' }, el('span', {}, text), control);
  const submit = (text) => el('button', { type: 'submit', className: 'primary' }, text);

  function form(onsubmit, ...children) {
    return el('form', { onsubmit: (e) => { e.preventDefault(); onsubmit(); } }, ...children);
  }

  function listInputs(n, max, placeholder) {
    const wrap = el('div', { className: 'qa-list' });
    const add = () => {
      if (wrap.children.length >= max) return;
      wrap.append(input({ maxlength: '25', placeholder: `${placeholder} ${wrap.children.length + 1}` }));
      more.hidden = wrap.children.length >= max;
    };
    const more = el('button', { type: 'button', className: 'small-btn', onclick: add }, '＋ Aggiungi');
    for (let i = 0; i < n; i++) add();
    return { wrap, more, values: () => [...wrap.querySelectorAll('input')].map((i) => i.value) };
  }

  const FORMS = {
    info() {
      const ch = val(qa?.channel) ?? {};
      const title = input({ maxlength: '140', value: ch.title ?? '', placeholder: 'Titolo della live' });
      let game = { id: ch.gameId, name: ch.gameName };
      const gameInput = input({ value: ch.gameName ?? '', placeholder: 'Cerca una categoria…' });
      const results = el('div', { className: 'qa-results' });
      let t = 0;
      gameInput.oninput = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const q = gameInput.value.trim();
          if (!q) { results.replaceChildren(); return; }
          try {
            const { categories } = await call(`/api/actions/categories?q=${encodeURIComponent(q)}`, { method: 'GET' });
            results.replaceChildren(...categories.map((c) => el('button', {
              type: 'button', className: 'qa-cat',
              onclick: () => { game = c; gameInput.value = c.name; results.replaceChildren(); },
            }, c.art ? el('img', { src: c.art, alt: '', width: '26', height: '36' }) : null, c.name)));
          } catch (err) { message(err.message, 'err'); }
        }, 300);
      };
      return form(() => run('info', { title: title.value, ...(game.id && game.name === gameInput.value ? { gameId: game.id } : {}) }),
        label('Titolo', title),
        label('Categoria', gameInput), results,
        row(submit('Salva'), val(qa?.channel) ? null : el('span', { className: 'muted small' }, qa?.channel?.error ?? '')));
    },
    raid() {
      const name = input({ placeholder: 'nome del canale', maxlength: '30' });
      return form(async () => { const r = await run('raid', { channel: name.value }, { keepOpen: true }); if (r) { lastRaid = r.raiding; renderGrid(); renderForm(); } },
        label('Canale da raidare', name),
        row(submit('🚀 Prepara il raid'), lastRaid ? el('button', { type: 'button', className: 'danger', onclick: async () => { if (await run('cancelRaid')) { lastRaid = null; renderGrid(); } } }, `Annulla raid verso ${lastRaid}`) : null),
        el('p', { className: 'muted small' }, 'Twitch prepara il raid e lo fa partire da solo dopo circa 90 secondi.'));
    },
    shoutout() {
      const name = input({ placeholder: 'nome del canale', maxlength: '30' });
      return form(() => run('shoutout', { channel: name.value }), label('Canale', name), row(submit('📣 Shoutout')),
        el('p', { className: 'muted small' }, 'Lo shoutout ufficiale di Twitch: in chat compare il riquadro per seguire il canale.'));
    },
    announce() {
      const text = el('textarea', { rows: '2', maxlength: '500', placeholder: 'Testo dell\'annuncio' });
      const color = el('select', {}, ...[['primary', 'Colore del canale'], ['purple', 'Viola'], ['blue', 'Blu'], ['green', 'Verde'], ['orange', 'Arancione']].map(([v, l]) => el('option', { value: v }, l)));
      return form(() => run('announce', { message: text.value, color: color.value }), label('Annuncio', text), row(color, submit('📢 Pubblica')));
    },
    ad() {
      return el('div', {}, el('p', { className: 'muted small' }, 'Durata della pubblicità:'),
        row(...[30, 60, 90, 120, 150, 180].map((s) => el('button', { type: 'button', onclick: () => run('ad', { length: s }) }, `${s} s`))));
    },
    followers() {
      const sel = el('select', {}, ...[[0, 'Tutti i follower'], [10, 'Da almeno 10 minuti'], [60, 'Da almeno 1 ora'], [1440, 'Da almeno 1 giorno'], [10080, 'Da almeno 1 settimana']].map(([v, l]) => el('option', { value: String(v) }, l)));
      return form(() => run('chatMode', { mode: 'followers', on: true, value: Number(sel.value) }), label('Chi può scrivere', sel), row(submit('❤️ Attiva')));
    },
    slow() {
      const sel = el('select', {}, ...[3, 5, 10, 20, 30, 60, 120].map((v) => el('option', { value: String(v) }, `Un messaggio ogni ${v} secondi`)));
      sel.value = '30';
      return form(() => run('chatMode', { mode: 'slow', on: true, value: Number(sel.value) }), label('Attesa', sel), row(submit('🐢 Attiva')));
    },
    poll() {
      const p = val(qa?.poll);
      if (p) {
        const total = p.choices.reduce((s, c) => s + c.votes, 0) || 1;
        return el('div', {}, el('h4', {}, `📊 ${p.title}`),
          ...p.choices.map((c) => el('div', { className: 'qa-bar' }, el('span', {}, c.title), el('b', {}, `${c.votes}`), el('i', { style: { width: `${Math.round((c.votes / total) * 100)}%` } }))),
          row(el('button', { type: 'button', className: 'danger', onclick: () => run('endPoll', { id: p.id }) }, 'Termina sondaggio')));
      }
      const title = input({ maxlength: '60', placeholder: 'Domanda' });
      const choices = listInputs(2, 5, 'Risposta');
      const dur = el('select', {}, ...[[60, '1 minuto'], [120, '2 minuti'], [300, '5 minuti'], [600, '10 minuti']].map(([v, l]) => el('option', { value: String(v) }, l)));
      dur.value = '120';
      return form(() => run('poll', { title: title.value, choices: choices.values(), duration: Number(dur.value) }),
        label('Domanda', title), el('div', { className: 'qa-field' }, el('span', {}, 'Risposte (da 2 a 5)'), choices.wrap), choices.more,
        row(dur, submit('📊 Avvia sondaggio')));
    },
    prediction() {
      const p = val(qa?.prediction);
      if (p) {
        return el('div', {}, el('h4', {}, `🔮 ${p.title}`, el('span', { className: 'muted small' }, p.status === 'LOCKED' ? ' · puntate chiuse' : ' · puntate aperte')),
          ...p.outcomes.map((o) => el('div', { className: 'qa-row' }, el('span', { className: 'qa-grow' }, `${o.title} — ${o.users} persone, ${o.points} punti`),
            el('button', { type: 'button', className: 'small-btn primary', onclick: () => run('endPrediction', { id: p.id, status: 'RESOLVED', winner: o.id }) }, 'Ha vinto'))),
          row(p.status === 'ACTIVE' ? el('button', { type: 'button', onclick: () => run('endPrediction', { id: p.id, status: 'LOCKED' }, { keepOpen: true }) }, 'Chiudi le puntate') : null,
            el('button', { type: 'button', className: 'danger', onclick: () => run('endPrediction', { id: p.id, status: 'CANCELED' }) }, 'Annulla (restituisce i punti)')));
      }
      const title = input({ maxlength: '45', placeholder: 'Domanda (es. Vinco questa partita?)' });
      const outcomes = listInputs(2, 10, 'Risultato');
      const win = el('select', {}, ...[[60, 'Puntate aperte 1 minuto'], [120, '2 minuti'], [300, '5 minuti'], [600, '10 minuti']].map(([v, l]) => el('option', { value: String(v) }, l)));
      win.value = '120';
      return form(() => run('prediction', { title: title.value, outcomes: outcomes.values(), window: Number(win.value) }),
        label('Domanda', title), el('div', { className: 'qa-field' }, el('span', {}, 'Risultati possibili'), outcomes.wrap), outcomes.more,
        row(win, submit('🔮 Avvia pronostico')));
    },
  };

  function renderForm() {
    const box = $('qa-form');
    const make = open && FORMS[open];
    box.hidden = !make;
    if (!make) { box.replaceChildren(); return; }
    const a = ACTIONS.find((x) => x.id === open);
    box.replaceChildren(
      el('div', { className: 'qa-form-head' }, el('b', {}, `${a.icon} ${a.label}`),
        el('button', { type: 'button', className: 'small-btn', onclick: () => { open = null; renderGrid(); renderForm(); } }, '✕')),
      make());
    box.querySelector('input, textarea')?.focus();
  }

  // ---------- personalizza: quali azioni mostrare ----------
  $('qa-custom').onclick = () => {
    const box = $('qa-custom-box');
    box.hidden = !box.hidden;
    if (box.hidden) return;
    const hidden = store.get();
    box.replaceChildren(el('p', { className: 'muted small' }, 'Scegli le azioni da mostrare (vale per questo browser):'),
      el('div', { className: 'qa-checks' }, ...ACTIONS.map((a) => el('label', { className: 'inline small' },
        el('input', { type: 'checkbox', checked: !hidden.includes(a.id), onchange: (e) => {
          const h = new Set(store.get());
          if (e.target.checked) h.delete(a.id); else h.add(a.id);
          store.set([...h]);
          renderGrid();
        } }), `${a.icon} ${a.label}`))));
  };
  $('qa-refresh').onclick = () => refresh();

  window.addEventListener('tg:state', (e) => {
    const first = !app || app.twitch?.user?.id !== e.detail.twitch?.user?.id;
    app = e.detail;
    if (first) refresh(); else renderGrid();
  });
  // aggiornamento periodico (sondaggi, pronostici, impostazioni cambiate da Twitch)
  setInterval(() => { if (!$('tab-live').hidden && !document.hidden) refresh(); }, 20000);
  renderGrid();
})();
