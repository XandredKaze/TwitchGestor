// Scheda "Chat": aspetto e filtri della chat da mettere in OBS (pagina /chat).
// Le modifiche si salvano da sole (dopo mezzo secondo) e l'anteprima si aggiorna subito.
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  let settings = null;
  let state = null;
  let saveT = 0;
  let loaded = false;

  const STYLES = [
    ['classic', 'Classico', 'Nome colorato e testo, come su Twitch.'],
    ['boxes', 'Riquadri', 'Ogni messaggio nel suo riquadro, nome sopra.'],
    ['brutal', 'Brutalism', 'Come il tema: monospazio, linee bianche, lilla.'],
  ];
  const LIFETIMES = [[0, 'Restano sempre'], [15, 'Spariscono dopo 15 s'], [30, 'Dopo 30 s'], [60, 'Dopo 1 minuto'], [120, 'Dopo 2 minuti'], [300, 'Dopo 5 minuti']];

  function preview() {
    $('chat-preview').contentWindow?.postMessage({ type: 'settings', settings }, location.origin);
  }
  function change(fn, { rerender = false } = {}) {
    fn(settings);
    preview();
    if (rerender) render();
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      const res = await window.TG.api('/api/chat-overlay', { method: 'PUT', body: { chatOverlay: settings } });
      if (res) settings = { ...settings, hiddenUsers: res.chatOverlay.hiddenUsers };
    }, 500);
  }

  // piccoli costruttori di campi
  const field = (label, control, hint) => el('label', { className: 'field' }, el('span', { className: 'field-label' }, label), control, hint ? el('span', { className: 'hint' }, hint) : null);
  const check = (label, key) => el('label', { className: 'check' },
    el('input', { type: 'checkbox', checked: settings[key] !== false && Boolean(settings[key] ?? true), onchange: (e) => change((s) => { s[key] = e.target.checked; }) }), label);
  const select = (key, options, numeric = false, rerender = false) => {
    const sel = el('select', { onchange: (e) => change((s) => { s[key] = numeric ? Number(e.target.value) : e.target.value; }, { rerender }) },
      ...options.map(([v, l]) => el('option', { value: String(v) }, l)));
    sel.value = String(settings[key]);
    return sel;
  };
  const colorInput = (key) => el('input', { type: 'color', value: settings[key], oninput: (e) => change((s) => { s[key] = e.target.value; }) });
  function range(key, min, max, step, fmt) {
    const out = el('output', {}, fmt(settings[key]));
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(settings[key]), oninput: (e) => {
      out.textContent = fmt(Number(e.target.value));
      change((s) => { s[key] = Number(e.target.value); });
    } });
    return el('div', { className: 'range' }, input, out);
  }
  const card = (title, ...children) => el('section', { className: 'panel chat-card' }, el('h2', {}, title), ...children);

  function render() {
    const fonts = [...new Set(['Poppins', ...(window.FONT_CATALOG ?? []).map((f) => f.name), ...(window.SYSTEM_FONTS ?? [])])];
    const fontSel = el('select', { onchange: (e) => change((s) => { s.font = e.target.value; }) }, ...fonts.map((f) => el('option', { value: f }, f)));
    fontSel.value = settings.font;
    fontSel.disabled = settings.style === 'brutal';

    const botName = state?.chatAccount?.kind === 'bot' ? state.chatAccount.user.login : 'Wolfery';
    const userInput = el('input', { type: 'text', placeholder: 'nome dell\'account', maxlength: '25' });
    const users = el('div', { className: 'chips' }, ...(settings.hiddenUsers ?? []).map((u) => el('span', { className: 'mod-word' }, el('b', {}, u),
      el('button', { type: 'button', className: 'mod-x', title: `Mostra di nuovo ${u}`, onclick: () => change((s) => { s.hiddenUsers = s.hiddenUsers.filter((x) => x !== u); }, { rerender: true }) }, '✕'))));

    $('chat-settings').replaceChildren(
      card('Stile',
        el('div', { className: 'chat-styles' }, ...STYLES.map(([id, name, desc]) => el('button', {
          type: 'button', className: `chat-style ${settings.style === id ? 'active' : ''}`, 'aria-pressed': String(settings.style === id),
          onclick: () => change((s) => { s.style = id; }, { rerender: true }),
        }, el('b', {}, name), el('span', {}, desc)))),
        el('div', { className: 'grid-2' },
          field('Entrata dei messaggi', select('animation', [['slide', 'Scivolano dentro'], ['fade', 'Dissolvenza'], ['none', 'Nessuna']])),
          field('Allineamento', select('align', [['left', 'A sinistra'], ['right', 'A destra']]))),
        check('Messaggi nuovi in alto (invece che in basso)', 'newestOnTop')),
      card('Testo',
        field('Font', fontSel, settings.style === 'brutal' ? 'Con Brutalism il font è quello del tema.' : null),
        field('Dimensione', range('fontSize', 12, 48, 1, (v) => `${v}px`)),
        el('div', { className: 'grid-2' },
          field('Colore del testo', colorInput('textColor')),
          field('Nomi', select('nameColorMode', [['twitch', 'Colore scelto su Twitch'], ['fixed', 'Tutti dello stesso colore']], false, true))),
        settings.nameColorMode === 'fixed' ? field('Colore dei nomi', colorInput('nameColor')) : null,
        check('Ombra dietro al testo (si legge su ogni sfondo)', 'textShadow'),
        check('Mostra i badge (abbonato, moderatore, VIP…)', 'showBadges')),
      card('Sfondo e durata',
        el('div', { className: 'grid-2' },
          field('Sfondo dei messaggi', colorInput('background')),
          field('Opacità dello sfondo', range('backgroundOpacity', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`))),
        el('div', { className: 'grid-2' },
          field('Messaggi a schermo (massimo)', el('input', { type: 'number', min: '1', max: '100', value: String(settings.maxMessages), oninput: (e) => { const n = Number(e.target.value); if (n >= 1) change((s) => { s.maxMessages = Math.min(100, n); }); } })),
          field('Quanto restano', select('lifetime', LIFETIMES, true)))),
      card('Cosa non mostrare',
        el('label', { className: 'check' }, el('input', { type: 'checkbox', checked: settings.hideBot !== false, onchange: (e) => change((s) => { s.hideBot = e.target.checked; }) }),
          el('span', {}, 'Nascondi i messaggi del bot ', el('b', {}, botName), ' (ringraziamenti, risposte ai comandi, avvisi)')),
        check('Nascondi i comandi (messaggi che iniziano con "!")', 'hideCommands'),
        el('p', { className: 'muted small' }, 'I messaggi con parole bannate, cancellati dai moderatori o di chi riceve timeout/ban spariscono anche da qui.'),
        field('Nascondi anche questi account (es. altri bot)', el('form', {
          className: 'chat-add-user',
          onsubmit: (e) => {
            e.preventDefault();
            const u = userInput.value.trim().replace(/^@/, '').toLowerCase();
            if (!/^\w{2,25}$/.test(u)) return;
            userInput.value = '';
            change((s) => { s.hiddenUsers = [...new Set([...(s.hiddenUsers ?? []), u])]; }, { rerender: true });
          },
        }, userInput, el('button', { type: 'submit', className: 'small-btn' }, '＋ Aggiungi'))),
        users),
    );
  }

  async function load() {
    const data = await window.TG.api('/api/config', { method: 'GET' });
    if (!data) return;
    settings = { ...data.defaults.chatOverlay, ...data.config.chatOverlay };
    loaded = true;
    render();
    preview();
  }

  $('chat-preview').addEventListener('load', () => { if (settings) preview(); });
  window.addEventListener('tg:state', (e) => { const first = !state; state = e.detail; if (loaded && first) render(); });
  window.addEventListener('chat:open', () => { if (!loaded) load(); else preview(); });
  if (!$('tab-chat').hidden) load();
})();
