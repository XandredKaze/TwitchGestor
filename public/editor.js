// Scheda "Personalizza alert": modifica testi, suoni, font, colori, sfondo e animazioni con anteprima dal vivo.
(function () {
  const { api, el } = window.TG;
  const $ = (id) => document.getElementById(id);

  const ANIMATION_LABELS = {
    pop: 'Pop (dall\'alto)', fade: 'Dissolvenza', 'slide-down': 'Scende dall\'alto', 'slide-up': 'Sale dal basso',
    'slide-left': 'Entra da destra', 'slide-right': 'Entra da sinistra', zoom: 'Zoom', bounce: 'Rimbalzo',
    flip: 'Ribaltamento', shake: 'Scossa', window: 'Finestra (si apre dall\'alto)',
  };
  const ALERT_STYLE_LABELS = { classic: 'Classico', brutal: 'Brutalism (come il tema)', errore: 'ERRORE_DI_SISTEMA' };
  // tipi con la grafica di ERRORE_DI_SISTEMA
  const ERRORE_TYPES = ['sub', 'giftsub', 'follow', 'resub', 'donation', 'redemption', 'cheer', 'raid'];
  const ERRORE_HINT = 'ERRORE_DI_SISTEMA ha la sua grafica: testi, icona e colore si cambiano nella sezione "ERRORE_DI_SISTEMA" di ogni alert, colori e tempi in "Impostazioni generali". Font, dimensioni, animazione, immagine e posizione qui sotto non si applicano; suono e messaggio in chat sì.';
  const styleOptions = () => Object.entries(ALERT_STYLE_LABELS).map(([value, label]) => ({ value, label }));
  const BRUTAL_HINT = 'Brutalism usa i colori (nero, bianco, lilla) e i font del tema: colori e font qui sotto non si applicano. Dimensioni, animazione e posizione sì. Con l\'animazione "Pop" la finestra si apre dall\'alto.';
  const POSITION_LABELS = {
    'top-left': 'In alto a sinistra', 'top-center': 'In alto al centro', 'top-right': 'In alto a destra', center: 'Al centro',
    'bottom-left': 'In basso a sinistra', 'bottom-center': 'In basso al centro', 'bottom-right': 'In basso a destra',
  };
  const SOUND_LABELS = {
    chime: '🔔 Campanellino', coin: '🪙 Moneta', pop: '💬 Pop', fanfare: '🎺 Fanfara', bell: '🛎️ Campana', levelup: '⬆️ Level up', laser: '⚡ Laser',
  };
  // Cosa rappresenta l'importo per ogni tipo (minimo, varianti, anteprima).
  const AMOUNT = {
    resub: { label: 'Mesi di abbonamento', sample: 12 },
    giftsub: { label: 'Sub regalate', sample: 5 },
    cheer: { label: 'Bits', sample: 500 },
    raid: { label: 'Spettatori', sample: 25 },
    donation: { label: 'Importo (€)', sample: 10 },
  };
  const MIN_AMOUNT_TYPES = ['cheer', 'raid', 'donation', 'giftsub'];
  const MESSAGE_TYPES = ['resub', 'cheer', 'redemption', 'donation'];
  const PLACEHOLDERS = {
    common: { user: 'nome dello spettatore' },
    sub: { tier: 'livello (1, 2, 3)' },
    resub: { months: 'mesi totali', streak: 'mesi consecutivi', tier: 'livello', message: 'messaggio' },
    giftsub: { amount: 'quante sub', tier: 'livello' },
    cheer: { amount: 'bits', message: 'messaggio' },
    raid: { amount: 'spettatori', login: 'nome canale' },
    redemption: { reward: 'nome ricompensa', cost: 'costo in punti', message: 'testo scritto' },
    donation: { amountFormatted: 'importo con valuta', amount: 'importo', currency: 'valuta', message: 'messaggio' },
  };
  // Stili che, se non impostati nell'alert, vengono presi dalle impostazioni generali.
  const INHERITED = ['font', 'fontSize', 'titleSize', 'messageSize', 'textColor', 'background', 'backgroundOpacity', 'animation'];

  let saved = null;
  let draft = null;
  let defaults = null;
  let media = { sounds: [], images: [] };
  let chatAccount = null;
  let twitchConfigured = true;
  let selected = 'follow';
  let previewType = 'follow';
  let lastTextField = null;
  const sample = {};

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  /** Completa le impostazioni con i valori predefiniti (se ne manca qualcuna l'editor non si blocca). */
  function withDefaults(value, defs) {
    if (!isObj(defs)) return value === undefined ? clone(defs) : value;
    const out = isObj(value) ? { ...value } : {};
    for (const [k, d] of Object.entries(defs)) out[k] = isObj(d) ? withDefaults(out[k], d) : (out[k] === undefined ? clone(d) : out[k]);
    return out;
  }
  const isDirty = () => JSON.stringify(draft) !== JSON.stringify(saved);

  // ---------- Caricamento ----------

  async function load() {
    const data = await api('/api/config', { method: 'GET' });
    if (!data) return;
    if (data.apiLevel !== window.TG.API_LEVEL) {
      // Programma vecchio acceso: l'editor nuovo non può funzionare, spiega cosa fare invece di restare vuoto.
      $('form').replaceChildren(el('div', { className: 'notice' }, el('b', {}, '⚠️ Serve un riavvio di TwitchGestor. '), window.TG.RESTART_HELP));
      return;
    }
    defaults = data.defaults;
    saved = withDefaults(data.config, defaults);
    draft = clone(saved);
    media = data.media;
    chatAccount = data.chatAccount;
    twitchConfigured = data.twitchConfigured;
    for (const f of window.ALERT_FONTS.google) window.loadFont(f);
    render();
  }

  if (location.hash === '#chat') selected = '__general';

  window.addEventListener('editor:open', async () => {
    if (!draft) {
      await load();
      if (location.hash === '#chat') {
        document.getElementById('chat-section')?.scrollIntoView({ block: 'center' });
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
    else schedulePreview();
  });
  // stile degli alert scelto nella scheda Tema (già salvato): aggiorna la copia dell'editor senza perdere le modifiche in corso
  window.addEventListener('alerts:style', (e) => {
    if (!saved) return;
    saved.overlay.alertStyle = e.detail;
    draft.overlay.alertStyle = e.detail;
    render();
  });
  window.addEventListener('beforeunload', (e) => {
    if (draft && isDirty()) e.preventDefault();
  });

  // ---------- Accesso ai valori ----------

  function typeCfg(type = selected) {
    return draft.types[type];
  }

  function markChanged({ rerender = false } = {}) {
    $('save-bar').hidden = !isDirty();
    renderNav();
    if (rerender) renderForm();
    schedulePreview();
  }

  /** Riporta un campo al valore predefinito (o a quello delle impostazioni generali). */
  function resetField(obj, key, def) {
    if (def !== undefined && key in def) obj[key] = clone(def[key]);
    else delete obj[key];
  }

  // ---------- Controlli del modulo ----------

  function field(label, control, { hint, onReset } = {}) {
    return el('label', { className: 'field' },
      el('span', { className: 'field-label' }, label,
        onReset ? el('button', { type: 'button', className: 'reset', title: 'Ripristina', onclick: (e) => { e.preventDefault(); onReset(); } }, '↺') : null),
      control,
      hint ? el('span', { className: 'hint' }, hint) : null);
  }

  function textInput(obj, key, { multiline = false, placeholder = '' } = {}) {
    const input = el(multiline ? 'textarea' : 'input', { type: multiline ? undefined : 'text', value: obj[key] ?? '', placeholder, rows: multiline ? 2 : undefined });
    input.addEventListener('focus', () => { lastTextField = { input, obj, key }; });
    input.addEventListener('input', () => {
      if (input.value === '' && placeholder) delete obj[key];
      else obj[key] = input.value;
      markChanged();
    });
    return input;
  }

  function checkbox(obj, key, label) {
    return el('label', { className: 'check' },
      el('input', { type: 'checkbox', checked: Boolean(obj[key]), onchange: (e) => { obj[key] = e.target.checked; markChanged({ rerender: true }); } }),
      label);
  }

  function numberInput(obj, key, { min = 0, step = 1, placeholder = '' } = {}) {
    return el('input', {
      type: 'number', min, step, value: obj[key] ?? '', placeholder,
      oninput: (e) => {
        if (e.target.value === '') delete obj[key];
        else obj[key] = Number(e.target.value);
        markChanged();
      },
    });
  }

  function range(obj, key, { min, max, step, fallback, format = (v) => v, scale = 1 }) {
    const value = obj[key] ?? fallback;
    const out = el('output', {}, format(value));
    const input = el('input', {
      type: 'range', min, max, step, value: value / scale,
      oninput: (e) => {
        obj[key] = Number(e.target.value) * scale;
        out.textContent = format(obj[key]);
        markChanged();
      },
    });
    return el('div', { className: 'range' }, input, out);
  }

  function colorInput(obj, key, fallback) {
    return el('input', { type: 'color', value: obj[key] ?? fallback, oninput: (e) => { obj[key] = e.target.value; markChanged(); } });
  }

  function select(obj, key, options, { inheritLabel, onchange } = {}) {
    const node = el('select', {
      onchange: (e) => {
        if (e.target.value === '' && inheritLabel) delete obj[key];
        else obj[key] = e.target.value;
        onchange?.();
        markChanged({ rerender: Boolean(onchange) });
      },
    },
    inheritLabel ? el('option', { value: '' }, inheritLabel) : null,
    options.map((o) => (o.group
      ? el('optgroup', { label: o.group }, o.options.map((x) => el('option', { value: x.value, style: x.style }, x.label)))
      : el('option', { value: o.value, style: o.style }, o.label))));
    node.value = obj[key] ?? '';
    return node;
  }

  function fontSelect(obj, key, inheritLabel) {
    const opt = (f) => ({ value: f, label: f, style: { fontFamily: window.fontStack(f) } });
    return select(obj, key, [
      { group: 'Google Fonts', options: window.ALERT_FONTS.google.map(opt) },
      { group: 'Font di sistema', options: window.ALERT_FONTS.system.map(opt) },
    ], { inheritLabel });
  }

  async function upload(kind, onDone) {
    const input = el('input', { type: 'file', accept: kind === 'sounds' ? '.mp3,.ogg,.wav,audio/*' : '.png,.jpg,.jpeg,.gif,.webp,.webm,.mp4,image/*,video/*' });
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const data = await api(`/api/upload?kind=${kind}`, { body: file, headers: { 'x-filename': encodeURIComponent(file.name) } });
      if (!data) return;
      media = data.media;
      onDone(data.path);
    };
    input.click();
  }

  const fileName = (p) => decodeURIComponent(p.includes('#') ? p.split('#').pop() : p.split('/').pop());

  function soundPicker(obj, key, { inheritLabel } = {}) {
    const current = obj[key];
    const options = [
      ...(inheritLabel ? [] : [{ value: '', label: '🔇 Nessun suono' }]),
      { group: 'Suoni integrati', options: Object.keys(SOUND_LABELS).map((s) => ({ value: s, label: SOUND_LABELS[s] })) },
      ...(media.sounds.length ? [{ group: 'I tuoi suoni', options: media.sounds.map((s) => ({ value: s, label: fileName(s) })) }] : []),
      ...(current && !SOUND_LABELS[current] && !media.sounds.includes(current) ? [{ value: current, label: `Personalizzato: ${fileName(current)}` }] : []),
    ];
    const sel = select(obj, key, options, { inheritLabel });
    if (!inheritLabel && !current) sel.value = '';
    return el('div', { className: 'row' }, sel,
      el('button', { type: 'button', title: 'Ascolta', onclick: () => window.playSound(obj[key] ?? typeCfg().sound, obj.volume ?? typeCfg().volume ?? 0.5) }, '▶'),
      el('button', { type: 'button', onclick: () => upload('sounds', (p) => { obj[key] = p; markChanged({ rerender: true }); }) }, '📁 Carica'));
  }

  function imagePicker(obj, key, { inheritLabel } = {}) {
    const current = obj[key];
    const options = [
      ...(inheritLabel ? [] : [{ value: '', label: 'Nessuna immagine' }]),
      ...(media.images.length ? [{ group: 'Le tue immagini', options: media.images.map((s) => ({ value: s, label: fileName(s) })) }] : []),
      ...(current && !media.images.includes(current) ? [{ value: current, label: `Personalizzata: ${fileName(current)}` }] : []),
    ];
    const sel = select(obj, key, options, { inheritLabel, onchange: () => {} });
    if (!inheritLabel && !current) sel.value = '';
    const src = current ? (/^[a-z][a-z0-9+.-]*:/i.test(current) ? current : `/${current.replace(/^\//, '')}`) : '';
    const thumb = !current ? null : /\.(webm|mp4)$/i.test(current)
      ? el('video', { className: 'thumb', src, muted: true, autoplay: true, loop: true })
      : el('img', { className: 'thumb', src, alt: '' });
    return el('div', {},
      el('div', { className: 'row' }, sel,
        el('button', { type: 'button', onclick: () => upload('images', (p) => { obj[key] = p; markChanged({ rerender: true }); }) }, '📁 Carica')),
      thumb);
  }

  function section(title, ...children) {
    return el('fieldset', { className: 'section' }, el('legend', {}, title), ...children);
  }

  function placeholderChips(type) {
    const list = { ...PLACEHOLDERS.common, ...(PLACEHOLDERS[type] ?? {}) };
    return el('div', { className: 'chips' },
      el('span', { className: 'hint' }, 'Clicca per inserire nel testo selezionato:'),
      Object.entries(list).map(([k, desc]) => el('button', {
        type: 'button', className: 'chip', title: desc,
        onmousedown: (e) => e.preventDefault(),
        onclick: () => insertPlaceholder(`{${k}}`),
      }, `{${k}}`, el('small', {}, ` ${desc}`))));
  }

  function insertPlaceholder(token) {
    if (!lastTextField || !document.body.contains(lastTextField.input)) return;
    const { input, obj, key } = lastTextField;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + token + input.value.slice(end);
    obj[key] = input.value;
    input.focus();
    input.setSelectionRange(start + token.length, start + token.length);
    markChanged();
  }

  // ---------- Modulo per un tipo di alert ----------

  function renderTypeForm(type) {
    const t = typeCfg(type);
    const def = defaults.types[type] ?? {};
    const general = draft.overlay;
    const reset = (key) => () => { resetField(t, key, def); markChanged({ rerender: true }); };
    const inheritedReset = (key) => (key in t ? reset(key) : undefined);
    const amountLabel = AMOUNT[type]?.label;

    return [
      el('div', { className: 'form-head' },
        el('h2', {}, t.label ?? type),
        el('label', { className: 'switch' },
          el('input', { type: 'checkbox', checked: t.enabled !== false, onchange: (e) => { t.enabled = e.target.checked; markChanged({ rerender: true }); } }),
          el('span', {}, t.enabled !== false ? 'Attivo' : 'Disattivato'))),

      t.enabled === false ? el('p', { className: 'notice' }, 'Questo tipo di notifica è ignorato del tutto: non compare né nell\'overlay né nello storico.') : null,

      erroreTypeSection(type, t),

      section('Quando mostrarlo',
        checkbox(t, 'alert', 'Mostra l\'alert in OBS (se disattivato, la notifica finisce solo nello storico)'),
        MIN_AMOUNT_TYPES.includes(type) ? field(`Minimo per mostrare l'alert (${amountLabel})`, numberInput(t, 'minAmount', { min: 0 }), { onReset: reset('minAmount') }) : null,
        type === 'sub' ? checkbox(t, 'ignoreGifted', 'Non mostrare le singole sub regalate (c\'è già l\'alert "Abbonamenti regalati")') : null,
        type === 'redemption' ? field('Ricompense da ignorare (una per riga)', el('textarea', {
          rows: 3, value: (t.ignoreRewards ?? []).join('\n'),
          oninput: (e) => { t.ignoreRewards = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean); markChanged(); },
        })) : null,
        field('Durata', range(t, 'duration', { min: 2, max: 30, step: 0.5, fallback: 5000, scale: 1000, format: (v) => `${(v / 1000).toFixed(1)} s` }), { onReset: reset('duration') })),

      section('Testi',
        field('Titolo', textInput(t, 'title'), { onReset: reset('title') }),
        field('Testo', textInput(t, 'text', { multiline: true }), { onReset: reset('text') }),
        placeholderChips(type),
        MESSAGE_TYPES.includes(type) ? checkbox(t, 'showMessage', 'Mostra il messaggio scritto dallo spettatore') : null),

      section('Aspetto',
        field('Stile del riquadro', select(t, 'alertStyle', styleOptions(), { inheritLabel: `Come generale (${ALERT_STYLE_LABELS[general.alertStyle ?? 'classic']})`, onchange: () => {} })),
        (t.alertStyle ?? general.alertStyle) === 'brutal' ? el('p', { className: 'hint' }, BRUTAL_HINT) : null,
        (t.alertStyle ?? general.alertStyle) === 'errore' ? el('p', { className: 'hint' }, ERRORE_HINT) : null,
        el('div', { className: 'grid-2' },
          field('Font', fontSelect(t, 'font', `Come generale (${general.font})`)),
          field('Dimensione titolo', range(t, 'titleSize', { min: 14, max: 140, step: 1, fallback: general.titleSize ?? Math.round((t.fontSize ?? general.fontSize) * 1.4), format: (v) => `${v}px` }), { onReset: inheritedReset('titleSize') }),
          field('Dimensione testo', range(t, 'fontSize', { min: 14, max: 96, step: 1, fallback: general.fontSize, format: (v) => `${v}px` }), { onReset: inheritedReset('fontSize') }),
          field('Dimensione messaggio', range(t, 'messageSize', { min: 10, max: 80, step: 1, fallback: general.messageSize ?? Math.round((t.fontSize ?? general.fontSize) * 0.77), format: (v) => `${v}px` }), { onReset: inheritedReset('messageSize') }),
          field('Colore principale (titolo e bordo)', colorInput(t, 'color', '#9146ff'), { onReset: reset('color') }),
          field('Colore del testo', colorInput(t, 'textColor', general.textColor), { onReset: inheritedReset('textColor') }),
          field('Colore dello sfondo', colorInput(t, 'background', general.background), { onReset: inheritedReset('background') }),
          field('Opacità dello sfondo', range(t, 'backgroundOpacity', { min: 0, max: 100, step: 5, scale: 0.01, fallback: general.backgroundOpacity, format: (v) => `${Math.round(v * 100)}%` }), {
            onReset: inheritedReset('backgroundOpacity'), hint: '0% = nessun riquadro, solo testo',
          }),
          field('Animazione', select(t, 'animation', Object.entries(ANIMATION_LABELS).map(([value, label]) => ({ value, label })), { inheritLabel: `Come generale (${ANIMATION_LABELS[general.animation]})` }))),
        field('Immagine, GIF o video', imagePicker(t, 'image'), { hint: 'PNG, JPG, GIF, WEBP, WEBM o MP4 (max 30 MB)' })),

      section('Suono',
        field('Suono', soundPicker(t, 'sound'), { hint: 'Puoi caricare MP3, OGG o WAV' }),
        field('Volume', range(t, 'volume', { min: 0, max: 100, step: 5, scale: 0.01, fallback: 0.5, format: (v) => `${Math.round(v * 100)}%` }), { onReset: reset('volume') })),

      section('Messaggio in chat',
        draft.chat.enabled
          ? el('p', { className: 'hint' }, `Scrive: ${chatWho()}. Si cambia in "Impostazioni generali".`)
          : el('p', { className: 'notice' }, 'I messaggi in chat sono disattivati: attivali in "Impostazioni generali".'),
        field('Messaggio (vuoto = nessun messaggio)', textInput(t, 'chatReply', { multiline: true }), { onReset: reset('chatReply') })),

      ['follow', 'sub'].includes(type) ? null : renderVariants(type, t),
    ];
  }

  function renderVariants(type, t) {
    const variants = t.variants ?? [];
    const isReward = type === 'redemption';
    const amountLabel = AMOUNT[type]?.label ?? 'Importo';
    const blankToDelete = (v, key) => (e) => {
      if (e.target.value === '') delete v[key];
      else v[key] = e.target.type === 'number' ? Number(e.target.value) : e.target.value;
      markChanged();
    };

    return section(isReward ? 'Alert dedicati a singole ricompense' : 'Alert speciali per importo',
      el('p', { className: 'hint' }, isReward
        ? 'Dai un aspetto diverso a una ricompensa specifica. I campi vuoti restano come sopra.'
        : `Cambia l'alert quando ${amountLabel.toLowerCase()} supera una soglia. Vince la soglia più alta raggiunta. I campi vuoti restano come sopra.`),
      variants.map((v, i) => el('div', { className: 'variant' },
        el('div', { className: 'variant-head' },
          isReward
            ? field('Nome della ricompensa', el('input', { type: 'text', value: v.reward ?? '', oninput: blankToDelete(v, 'reward') }))
            : field(`Da (${amountLabel})`, el('input', { type: 'number', min: 0, value: v.minAmount ?? '', oninput: blankToDelete(v, 'minAmount') })),
          el('button', {
            type: 'button', className: 'small-btn', title: 'Mostra nell\'anteprima',
            onclick: () => {
              if (isReward) sample.reward = v.reward ?? '';
              else sample.amount = v.minAmount ?? 0;
              renderSample();
              previewNow({ play: true });
            },
          }, '👁 Anteprima'),
          el('button', { type: 'button', className: 'small-btn danger', onclick: () => { variants.splice(i, 1); markChanged({ rerender: true }); } }, '🗑')),
        el('div', { className: 'grid-2' },
          field('Titolo', el('input', { type: 'text', value: v.title ?? '', placeholder: t.title ?? '', oninput: blankToDelete(v, 'title') })),
          field('Testo', el('input', { type: 'text', value: v.text ?? '', placeholder: t.text ?? '', oninput: blankToDelete(v, 'text') })),
          field('Colore principale', el('div', { className: 'row' },
            el('input', { type: 'color', value: v.color ?? t.color ?? '#9146ff', oninput: (e) => { v.color = e.target.value; markChanged(); } }),
            v.color ? el('button', { type: 'button', className: 'small-btn', onclick: () => { delete v.color; markChanged({ rerender: true }); } }, 'Come sopra') : null)),
          field('Durata (secondi)', el('input', {
            type: 'number', min: 1, max: 60, step: 0.5, value: v.duration ? v.duration / 1000 : '', placeholder: String((t.duration ?? 5000) / 1000),
            oninput: (e) => { if (e.target.value === '') delete v.duration; else v.duration = Number(e.target.value) * 1000; markChanged(); },
          })),
          field('Animazione', select(v, 'animation', Object.entries(ANIMATION_LABELS).map(([value, label]) => ({ value, label })), { inheritLabel: 'Come sopra' })),
          field('Stile del riquadro', select(v, 'alertStyle', styleOptions(), { inheritLabel: 'Come sopra' })),
          field('Suono', soundPicker(v, 'sound', { inheritLabel: 'Come sopra' })),
          field('Immagine', imagePicker(v, 'image', { inheritLabel: 'Come sopra' }))))),
      el('button', {
        type: 'button',
        onclick: () => {
          t.variants = variants;
          const last = variants.at(-1)?.minAmount ?? t.minAmount ?? 0;
          variants.push(isReward ? { reward: '' } : { minAmount: Math.max(1, last * 2 || 10) });
          markChanged({ rerender: true });
        },
      }, isReward ? '＋ Aggiungi ricompensa' : '＋ Aggiungi soglia'));
  }

  // ---------- Stile ERRORE_DI_SISTEMA ----------

  const usesErrore = (type) => ERRORE_TYPES.includes(type) && (draft.types[type]?.alertStyle ?? draft.overlay.alertStyle) === 'errore';

  /** Prova in OBS: ferma l'alert in corso e parte subito, nel layout scelto (anche senza salvare). */
  function erroreTestButtons(type) {
    const go = (mode) => api(`/api/test/${type}`, { body: { config: draft, sample: sampleFor(type), interrupt: true, mode } });
    const preview = (mode) => { previewType = type; $('preview-mode').value = mode; render(); previewNow({ play: true }); };
    return el('div', { className: 'row', style: { flexWrap: 'wrap', gap: '6px' } },
      el('button', { type: 'button', onclick: () => preview('normal') }, '▶ Anteprima normale'),
      el('button', { type: 'button', onclick: () => preview('ingame') }, '▶ Anteprima in-game'),
      el('button', { type: 'button', onclick: () => go('normal') }, '📺 Prova in OBS: normale'),
      el('button', { type: 'button', onclick: () => go('ingame') }, '📺 Prova in OBS: in-game'));
  }

  function erroreTypeSection(type, t) {
    if (!usesErrore(type) || !t.errore) return null;
    const e = t.errore;
    const d = defaults.types[type]?.errore ?? {};
    const reset = (key) => () => { resetField(e, key, d); markChanged({ rerender: true }); };
    return section('ERRORE_DI_SISTEMA',
      el('p', { className: 'hint' }, 'Testi di questo alert nello stile ERRORE_DI_SISTEMA. Se un testo è troppo lungo, il carattere si rimpicciolisce da solo.'),
      el('div', { className: 'grid-2' },
        field('Flavour text (prima parte)', textInput(e, 'tag'), { onReset: reset('tag') }),
        field('Flavour text (seconda parte)', textInput(e, 'tag2'), { onReset: reset('tag2') }),
        field('Titolo (scena normale)', textInput(e, 'title'), { onReset: reset('title') }),
        field('Titolo (scena in-game)', textInput(e, 'igTitle'), { onReset: reset('igTitle') }),
        field('Messaggio (vuoto = niente riga)', textInput(e, 'msg'), { onReset: reset('msg') }),
        field('Valore in grassetto', textInput(e, 'amount'), { onReset: reset('amount'), hint: 'Arriva dall\'evento, es. {amount} Sub' })),
      placeholderChips(type),
      el('div', { className: 'grid-2' },
        field('Icona', imagePicker(e, 'icon'), { onReset: reset('icon'), hint: 'PNG con fondo trasparente' }),
        field('Colore dell\'icona (glow e flavour text)', colorInput(e, 'color', d.color ?? '#ff2d95'), { onReset: reset('color') })),
      erroreTestButtons(type));
  }

  function erroreGeneralSection() {
    if (draft.overlay.alertStyle !== 'errore' && !ERRORE_TYPES.some(usesErrore)) return null;
    const c = draft.overlay.errore;
    if (!c) return null;
    const d = defaults.overlay.errore ?? {};
    const reset = (key) => () => { resetField(c, key, d); markChanged({ rerender: true }); };
    const px = (v) => `${v}px`;
    const sec = (v) => `${(v / 1000).toFixed(1)} s`;
    const scenes = window.TG.obsScenes?.() ?? [];
    const words = () => String(c.normalScenes ?? '').split(',').map((w) => w.trim()).filter(Boolean);
    const isNormal = (name) => words().some((w) => name.toLowerCase().includes(w.toLowerCase()));
    return section('ERRORE_DI_SISTEMA',
      el('h3', {}, 'Colori'),
      el('div', { className: 'grid-2' },
        field('Bordo, titolo finestra e X', colorInput(c, 'red', d.red), { onReset: reset('red') }),
        field('Testi pixel di errore', colorInput(c, 'accent', d.accent), { onReset: reset('accent') }),
        field('Nome dello spettatore', colorInput(c, 'name', d.name), { onReset: reset('name') }),
        field('Titolo (NUOVO SUB)', colorInput(c, 'title', d.title), { onReset: reset('title') }),
        field('Sfondo sotto i bit', colorInput(c, 'bg', d.bg), { onReset: reset('bg') }),
        field('Testo in grassetto', colorInput(c, 'text', d.text), { onReset: reset('text') }),
        field('Testo del messaggio', colorInput(c, 'muted', d.muted), { onReset: reset('muted') })),
      el('h3', {}, 'Sfondo ed effetti'),
      field('Immagine di sfondo (bit)', imagePicker(c, 'bitsImage'), { onReset: reset('bitsImage'), hint: 'Meglio con il fondo trasparente (WEBP o PNG): fuori dal bordo si vedono solo i bit' }),
      el('div', { className: 'grid-2' },
        field('Opacità dei bit', range(c, 'bitsOpacity', { min: 0, max: 100, step: 5, scale: 0.01, fallback: 0.6, format: (v) => `${Math.round(v * 100)}%` }), { onReset: reset('bitsOpacity') }),
        field('Quanto escono i bit ai lati', range(c, 'bitsBleed', { min: 0, max: 80, step: 1, fallback: 24, format: px }), { onReset: reset('bitsBleed') }),
        field('Chromatic aberration (titolo e icona)', range(c, 'ca', { min: 0, max: 10, step: 0.5, fallback: 3, format: px }), { onReset: reset('ca') }),
        field('Spostamento rosso/blu del glitch', range(c, 'glitchDx', { min: 0, max: 20, step: 1, fallback: 6, format: px }), { onReset: reset('glitchDx') })),
      el('h3', {}, 'Tempi'),
      el('div', { className: 'grid-2' },
        field('Durata alert normale', range(c, 'holdMs', { min: 1, max: 20, step: 0.5, scale: 1000, fallback: 6000, format: sec }), { onReset: reset('holdMs') }),
        field('Durata alert in-game', range(c, 'igHoldMs', { min: 1, max: 20, step: 0.5, scale: 1000, fallback: 3500, format: sec }), { onReset: reset('igHoldMs') }),
        field('Finestre di errore a cascata', range(c, 'windows', { min: 0, max: 30, step: 1, fallback: 14 }), { onReset: reset('windows') }),
        field('Ritardo tra le finestre', range(c, 'spawnMs', { min: 20, max: 300, step: 10, fallback: 70, format: (v) => `${v} ms` }), { onReset: reset('spawnMs') }),
        field('Sfalsamento della cascata', range(c, 'offset', { min: 0, max: 60, step: 1, fallback: 20, format: px }), { onReset: reset('offset') })),
      el('h3', {}, 'Scene: alert normale o in-game'),
      field('Scene con l\'alert normale (il nome contiene…)', textInput(c, 'normalScenes'), {
        onReset: reset('normalScenes'),
        hint: 'Nomi delle scene separati da virgola (basta una parte del nome, es. chatting, pausa). In tutte le altre scene l\'alert è quello in-game. Se non ne scegli nessuna, è sempre quello normale.',
      }),
      scenes.length ? el('div', { className: 'chips' }, el('span', { className: 'hint' }, 'Le tue scene: tocca quelle in cui vuoi l\'alert normale.'),
        scenes.map((name) => {
          const normal = isNormal(name);
          const ingame = !normal && words().length > 0;
          return el('button', {
            type: 'button', className: `chip${normal ? ' active' : ''}`, title: normal ? 'Alert normale' : ingame ? 'Alert in-game' : 'Alert normale (nessuna scena scelta)',
            onclick: () => {
              const list = words();
              c.normalScenes = (normal ? list.filter((w) => !name.toLowerCase().includes(w.toLowerCase())) : [...list, name]).join(', ');
              markChanged({ rerender: true });
            },
          }, `${ingame ? '🎮' : '🖥️'} ${name}`);
        })) : el('p', { className: 'hint' }, 'Collega OBS (scheda Live) per scegliere le scene con un tocco.'),
      el('h3', {}, 'Barra in-game'),
      el('div', { className: 'grid-2' },
        field('Larghezza', range(c, 'igW', { min: 400, max: 1920, step: 2, fallback: 966, format: px }), { onReset: reset('igW') }),
        field('Altezza', range(c, 'igH', { min: 100, max: 400, step: 1, fallback: 163, format: px }), { onReset: reset('igH') }),
        field('Distanza dal bordo alto', range(c, 'igTop', { min: 0, max: 600, step: 2, fallback: 40, format: px }), { onReset: reset('igTop') })),
      el('p', { className: 'hint' }, 'In OBS usa un\'unica Sorgente browser dell\'overlay condivisa tra le scene (nelle altre scene: Aggiungi → Sorgente browser → "Aggiungi esistente"): se cambi scena durante un alert, continua nell\'altro layout.'),
      erroreTestButtons(ERRORE_TYPES.includes(previewType) ? previewType : 'sub'));
  }

  // ---------- Account che scrive in chat ----------

  function chatWho() {
    if (!chatAccount) return 'nessuno (collega prima il tuo account Twitch)';
    if (chatAccount.kind === 'bot' && !chatAccount.sameAsChannel) return `🤖 ${chatAccount.user.login} (bot)`;
    return `il tuo account (${chatAccount.user.login})`;
  }

  function botBox() {
    if (!twitchConfigured) return el('p', { className: 'notice' }, 'Prima imposta TWITCH_CLIENT_ID e TWITCH_CLIENT_SECRET nel file .env.');
    const bot = chatAccount?.kind === 'bot' ? chatAccount : null;
    const disconnect = el('button', {
      type: 'button', className: 'small-btn danger',
      onclick: async () => {
        if (!confirm(`Scollegare l'account bot ${bot.user.login}? I messaggi torneranno a essere scritti dal tuo account.`)) return;
        if (await api('/api/auth/bot/logout')) {
          chatAccount = (await api('/api/config', { method: 'GET' }))?.chatAccount ?? null;
          renderForm();
        }
      },
    }, 'Scollega bot');

    if (bot && bot.sameAsChannel) {
      return el('div', { className: 'bot-box' },
        el('p', { className: 'notice' }, `Come bot hai collegato lo stesso account del canale (${bot.user.login}). Scollegalo e ricollegalo accedendo con l'account del bot.`),
        disconnect);
    }
    if (bot) {
      return el('div', { className: 'bot-box' },
        el('div', { className: 'bot-name' }, el('span', { className: 'pill ok' }, `🤖 ${bot.user.login}`), el('span', {}, 'scrive i ringraziamenti in chat')),
        el('p', { className: 'hint' }, `Consiglio: rendilo moderatore del tuo canale scrivendo in chat /mod ${bot.user.login}, così non viene bloccato da modalità follower, slow mode o limiti di messaggi.`),
        disconnect);
    }
    return el('div', { className: 'bot-box' },
      el('p', {}, chatAccount
        ? `Ora i messaggi li scrive ${chatWho()}. Per farli scrivere a un account bot (es. Wolfery):`
        : 'Collega prima il tuo account Twitch (in alto a destra). Per far scrivere i messaggi a un account bot (es. Wolfery):'),
      el('ol', { className: 'steps' },
        el('li', {}, 'Clicca "Collega account bot": si apre la pagina di Twitch.'),
        el('li', {}, 'Se Twitch mostra il tuo account, clicca "Non sei tu?" (o "Not you?") e accedi con l\'account del bot.'),
        el('li', {}, 'Autorizza: servirà solo a scrivere in chat.')),
      el('p', { className: 'hint' }, 'In alternativa apri il link in una finestra in incognito, dove sei già collegato con l\'account del bot.'),
      el('a', { className: 'btn primary', href: '/auth/bot/login' }, '🤖 Collega account bot'));
  }

  // ---------- Impostazioni generali ----------

  function renderGeneralForm() {
    const o = draft.overlay;
    const d = defaults.overlay;
    const reset = (key) => () => { resetField(o, key, d); markChanged({ rerender: true }); };
    return [
      el('div', { className: 'form-head' }, el('h2', {}, '⚙️ Impostazioni generali')),
      el('p', { className: 'hint' }, 'Valgono per tutti gli alert, a meno che un alert non abbia un valore suo.'),
      section('Overlay',
        field('Stile del riquadro', select(o, 'alertStyle', styleOptions(), { onchange: () => {} }), { hint: 'Si sceglie anche dalla scheda Tema.' }),
        (o.alertStyle ?? 'classic') === 'brutal' ? el('p', { className: 'hint' }, BRUTAL_HINT) : null,
        (o.alertStyle ?? 'classic') === 'errore' ? el('p', { className: 'hint' }, ERRORE_HINT) : null,
        el('div', { className: 'grid-2' },
          field('Posizione sullo schermo', select(o, 'position', Object.entries(POSITION_LABELS).map(([value, label]) => ({ value, label })))),
          field('Animazione', select(o, 'animation', Object.entries(ANIMATION_LABELS).map(([value, label]) => ({ value, label })))),
          field('Font', fontSelect(o, 'font')),
          field('Dimensione titolo', range(o, 'titleSize', { min: 14, max: 140, step: 1, fallback: Math.round((o.fontSize ?? 26) * 1.4), format: (v) => `${v}px` }), { onReset: reset('titleSize') }),
          field('Dimensione testo', range(o, 'fontSize', { min: 14, max: 96, step: 1, fallback: 26, format: (v) => `${v}px` }), { onReset: reset('fontSize') }),
          field('Dimensione messaggio', range(o, 'messageSize', { min: 10, max: 80, step: 1, fallback: Math.round((o.fontSize ?? 26) * 0.77), format: (v) => `${v}px` }), { onReset: reset('messageSize') }),
          field('Colore del testo', colorInput(o, 'textColor', '#ffffff'), { onReset: reset('textColor') }),
          field('Colore dello sfondo', colorInput(o, 'background', '#121218'), { onReset: reset('background') }),
          field('Opacità dello sfondo', range(o, 'backgroundOpacity', { min: 0, max: 100, step: 5, scale: 0.01, fallback: 0.88, format: (v) => `${Math.round(v * 100)}%` }), { onReset: reset('backgroundOpacity') }))),
      erroreGeneralSection(),
      section('Coda',
        field('Pausa tra un alert e l\'altro', range(draft.queue, 'gapMs', { min: 0, max: 5, step: 0.1, scale: 1000, fallback: 800, format: (v) => `${(v / 1000).toFixed(1)} s` }))),
      el('div', { id: 'chat-section' }, section('Chat',
        checkbox(draft.chat, 'enabled', 'Scrivi un ringraziamento in chat per ogni notifica (il testo si imposta in ogni alert)'),
        el('h3', {}, 'Account che scrive in chat'),
        botBox())),
      section('Ripristino',
        el('button', {
          type: 'button', className: 'danger',
          onclick: () => {
            if (!confirm('Riportare TUTTI gli alert alle impostazioni originali? Potrai ancora annullare prima di salvare.')) return;
            draft = clone(defaults);
            markChanged({ rerender: true });
          },
        }, '↺ Ripristina tutto alle impostazioni originali')),
    ];
  }

  // ---------- Rendering ----------

  function renderNav() {
    const list = $('type-list');
    list.replaceChildren(...Object.entries(draft.types).map(([type, t]) => {
      const changed = JSON.stringify(t) !== JSON.stringify(saved.types[type]);
      return el('button', {
        className: `type-item ${selected === type ? 'active' : ''} ${t.enabled === false ? 'off' : ''}`,
        onclick: () => { selected = type; previewType = type; render(); },
      },
      el('span', { className: 'dot', style: { background: t.color } }),
      el('span', { className: 'name' }, t.label ?? type),
      t.enabled === false ? el('span', { className: 'badge' }, 'spento') : null,
      changed ? el('span', { className: 'changed', title: 'Modifiche non salvate' }, '●') : null);
    }));
    $('nav-general').classList.toggle('active', selected === '__general');
  }

  function renderForm() {
    const scroll = $('form').parentElement.scrollTop;
    try {
      // intestazione sopra, i riquadri in un contenitore (sugli schermi larghi vanno su due colonne)
      const [head, ...parts] = (selected === '__general' ? renderGeneralForm() : renderTypeForm(selected)).filter(Boolean);
      $('form').replaceChildren(head, el('div', { className: 'form-fields' }, ...parts));
    } catch (err) {
      $('form').replaceChildren(el('div', { className: 'notice' }, el('b', {}, '⚠️ Questa sezione non si è caricata. '), 'Il dettaglio dell\'errore è nel riquadro rosso in basso: copialo e mandalo a chi ti aiuta.'));
      window.TG.showError?.(`Editor (${selected}): ${err.message}\n${err.stack ?? ''}`);
    }
    $('form').parentElement.scrollTop = scroll;
  }

  function renderSample() {
    const box = $('preview-sample');
    const type = previewType;
    const inputs = [];
    if (AMOUNT[type]) {
      sample.amount ??= AMOUNT[type].sample;
      inputs.push(field(`${AMOUNT[type].label} di prova`, el('input', {
        type: 'number', min: 0, value: sample.amount,
        oninput: (e) => { sample.amount = Number(e.target.value); schedulePreview(); },
      })));
    }
    if (type === 'redemption') {
      inputs.push(field('Ricompensa di prova', el('input', {
        type: 'text', value: sample.reward ?? 'Idratati',
        oninput: (e) => { sample.reward = e.target.value; schedulePreview(); },
      })));
    }
    box.replaceChildren(...inputs);
  }

  let lastSampleType = null;
  function render() {
    if (lastSampleType !== previewType) {
      delete sample.amount;
      delete sample.reward;
      lastSampleType = previewType;
    }
    renderNav();
    renderForm();
    renderSample();
    $('save-bar').hidden = !isDirty();
    schedulePreview();
  }

  // ---------- Anteprima ----------

  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => previewNow(), 300);
  }

  function sampleFor(type) {
    return {
      amount: AMOUNT[type] ? sample.amount ?? AMOUNT[type].sample : undefined,
      reward: type === 'redemption' ? sample.reward ?? 'Idratati' : undefined,
    };
  }

  async function previewNow({ play = false } = {}) {
    if (!draft || $('tab-editor').hidden) return;
    const data = await api('/api/preview', { body: { type: previewType, config: draft, sample: sampleFor(previewType) }, quiet: true });
    if (!data) return;
    const alert = data.alert;
    $('preview-mode').hidden = !alert.errore;
    if (alert.errore) alert.errore.mode = $('preview-mode').value; // ERRORE_DI_SISTEMA: layout normale o in-game
    if (!play) alert.duration = 24 * 3600 * 1000; // resta visibile mentre modifichi
    $('preview').contentWindow?.postMessage({
      type: 'alert', alert, overlay: draft.overlay, silent: !(play && $('preview-sound').checked),
    }, location.origin);
  }

  function fitPreview() {
    const frame = $('preview');
    const box = frame.parentElement;
    frame.style.transform = `scale(${box.clientWidth / 1920})`;
  }
  new ResizeObserver(fitPreview).observe($('preview').parentElement);
  $('preview').addEventListener('load', () => schedulePreview());

  // ---------- Azioni ----------

  $('btn-zoom').onclick = () => {
    const big = document.querySelector('.editor-preview').classList.toggle('big');
    $('btn-zoom').textContent = big ? '✕ Chiudi' : '⛶ Ingrandisci';
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.querySelector('.editor-preview.big')) $('btn-zoom').click();
  });
  $('nav-general').onclick = () => { selected = '__general'; render(); };
  $('btn-replay').onclick = () => previewNow({ play: true });
  $('preview-mode').onchange = () => previewNow({ play: true });
  $('btn-test-obs').onclick = () => api(`/api/test/${previewType}`, { body: { config: draft, sample: sampleFor(previewType) } });
  $('btn-discard').onclick = () => {
    if (!confirm('Annullare tutte le modifiche non salvate?')) return;
    draft = clone(saved);
    render();
  };
  $('btn-save').onclick = async () => {
    const btn = $('btn-save');
    btn.disabled = true;
    const data = await api('/api/config', { method: 'PUT', body: { config: draft } });
    btn.disabled = false;
    if (!data) return;
    saved = data.config;
    draft = clone(saved);
    render();
    const toast = el('div', { className: 'toast' }, '✓ Salvato: gli alert in OBS usano già le nuove impostazioni');
    document.body.append(toast);
    setTimeout(() => toast.remove(), 3000);
  };

  // La scheda può essere già aperta al caricamento della pagina (ricarica o ritorno dal login del bot).
  if (!$('tab-editor').hidden) window.dispatchEvent(new Event('editor:open'));
})();
