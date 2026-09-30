// Scheda "Personalizza alert": modifica testi, suoni, font, colori, sfondo e animazioni con anteprima dal vivo.
(function () {
  const { api, el } = window.TG;
  const $ = (id) => document.getElementById(id);

  const ANIMATION_LABELS = {
    pop: 'Pop (dall\'alto)', fade: 'Dissolvenza', 'slide-down': 'Scende dall\'alto', 'slide-up': 'Sale dal basso',
    'slide-left': 'Entra da destra', 'slide-right': 'Entra da sinistra', zoom: 'Zoom', bounce: 'Rimbalzo',
    flip: 'Ribaltamento', shake: 'Scossa',
  };
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
  const INHERITED = ['font', 'fontSize', 'textColor', 'background', 'backgroundOpacity', 'animation'];

  let saved = null;
  let draft = null;
  let defaults = null;
  let media = { sounds: [], images: [] };
  let chatAccount = null;
  let twitchConfigured = true;
  let ttsInfo = { engine: null, voices: [], piper: null };
  let selected = 'follow';
  let previewType = 'follow';
  let lastTextField = null;
  const sample = {};

  const clone = (o) => JSON.parse(JSON.stringify(o));
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
    saved = data.config;
    draft = clone(saved);
    defaults = data.defaults;
    media = data.media;
    chatAccount = data.chatAccount;
    twitchConfigured = data.twitchConfigured;
    for (const f of window.ALERT_FONTS.google) window.loadFont(f);
    ttsInfo = (await api('/api/tts/voices', { method: 'GET', quiet: true })) ?? ttsInfo;
    if (ttsInfo.piper?.job && !ttsInfo.piper.job.done) watchPiper();
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
        el('div', { className: 'grid-2' },
          field('Font', fontSelect(t, 'font', `Come generale (${general.font})`)),
          field('Dimensione testo', range(t, 'fontSize', { min: 14, max: 72, step: 1, fallback: general.fontSize, format: (v) => `${v}px` }), { onReset: inheritedReset('fontSize') }),
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

      section('Voce (text-to-speech)',
        ttsOffNotice(),
        checkbox(t, 'tts', 'Leggi ad alta voce questo alert'),
        field('Testo da leggere', textInput(t, 'ttsText', { multiline: true }), { onReset: reset('ttsText'), hint: 'Usa gli stessi segnaposto dei testi, es. {user} e {message}. Link e parole vietate non vengono letti.' }),
        el('div', { className: 'buttons' },
          el('button', { type: 'button', onclick: async () => listen(await sampleTtsText(type)) }, '▶ Ascolta con dati di prova')),
        ['follow', 'sub'].includes(type) ? null : el('p', { className: 'hint' }, type === 'redemption'
          ? 'Per leggere solo una ricompensa (es. "Leggi il mio messaggio"), lascia spento qui e attiva la voce in un alert dedicato qui sotto.'
          : 'Per leggere solo sopra una soglia (es. bits da 100 in su), lascia spento qui e attiva la voce in un alert speciale qui sotto.')),

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
          field('Suono', soundPicker(v, 'sound', { inheritLabel: 'Come sopra' })),
          field('Immagine', imagePicker(v, 'image', { inheritLabel: 'Come sopra' })),
          field('Voce', (() => {
            const sel = el('select', {
              onchange: (e) => {
                if (e.target.value === '') delete v.tts; else v.tts = e.target.value === 'on';
                markChanged({ rerender: true });
              },
            }, el('option', { value: '' }, 'Come sopra'), el('option', { value: 'on' }, 'Leggi ad alta voce'), el('option', { value: 'off' }, 'Non leggere'));
            sel.value = v.tts === undefined ? '' : v.tts ? 'on' : 'off';
            return sel;
          })()),
          v.tts ? field('Testo letto', el('input', { type: 'text', value: v.ttsText ?? '', placeholder: t.ttsText ?? '', oninput: blankToDelete(v, 'ttsText') })) : null))),
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

  // ---------- Voce (text-to-speech) ----------

  let stopTest = () => {};
  /** Legge un testo con le impostazioni della voce non ancora salvate. */
  async function listen(text) {
    stopTest();
    const data = await api('/api/tts/test', { body: { text, config: draft } });
    if (!data) return;
    stopTest = window.speak({ text: data.text, url: data.url, rate: data.rate ?? draft.tts.rate, volume: data.volume ?? draft.tts.volume / 100 });
  }

  /** Testo che verrebbe letto per questo alert, con dati di prova. */
  async function sampleTtsText(type, ttsText) {
    const cfg = clone(draft);
    cfg.tts.enabled = true;
    cfg.types[type] = { ...cfg.types[type], tts: true, ...(ttsText !== undefined ? { ttsText } : {}), variants: [] };
    const data = await api('/api/preview', { body: { type, config: cfg, sample: sampleFor(type) }, quiet: true });
    return data?.alert?.tts?.text ?? '';
  }

  /** Riquadro per scaricare le voci naturali Piper, con l'avanzamento del download. */
  let piperPoll = null;
  function piperBox() {
    const piper = ttsInfo.piper;
    if (!piper) return null;
    if (!piper.supported) return el('p', { className: 'hint' }, 'Le voci Piper non sono disponibili per questo sistema.');
    const job = piper.job;
    const running = job && !job.done;
    const rows = piper.voices.map((v) => el('div', { className: 'piper-row' },
      el('span', {}, el('b', {}, v.label.split(' (')[0]), ` ${v.label.slice(v.label.indexOf('('))}`),
      v.installed
        ? el('span', { className: 'pill ok' }, 'installata')
        : el('button', {
          type: 'button', disabled: running,
          onclick: async () => {
            const data = await api('/api/tts/piper/install', { body: { voice: v.key } });
            if (data) { ttsInfo.piper = data; renderForm(); watchPiper(); }
          },
        }, `⬇ Scarica (${v.size})`)));
    return el('div', { className: 'piper-box' },
      el('h3', {}, 'Voci naturali Piper'),
      el('p', { className: 'hint' }, 'Voci molto più naturali, gratuite e open source. Si scaricano una volta sola (serve Internet solo per il download), poi funzionano anche senza. La prima volta viene scaricato anche il programma Piper (circa 20 MB).'),
      ...rows,
      job ? el('p', { className: job.error ? 'notice' : 'hint' }, job.error ? `Download non riuscito: ${job.error}` : job.step) : null);
  }

  function watchPiper() {
    clearInterval(piperPoll);
    piperPoll = setInterval(async () => {
      const status = await api('/api/tts/piper', { method: 'GET', quiet: true });
      if (!status) return;
      ttsInfo.piper = status;
      if (status.job?.done) {
        clearInterval(piperPoll);
        ttsInfo = (await api('/api/tts/voices', { method: 'GET', quiet: true })) ?? ttsInfo;
        // appena installata, la voce Piper diventa quella scelta
        const fresh = ttsInfo.voices.find((v) => v.engine === 'piper' && v.name.includes(status.job.voice));
        if (fresh && !status.job.error) { draft.tts.voice = fresh.id; markChanged(); }
      }
      if (selected === '__general') renderForm();
    }, 1500);
  }

  function voiceSelect() {
    const groups = new Map();
    for (const v of ttsInfo.voices) {
      if (!groups.has(v.group)) groups.set(v.group, []);
      groups.get(v.group).push({ value: v.id, label: `${v.label || v.name}${v.lang ? ` (${v.lang})` : ''}` });
    }
    const options = [...groups].map(([group, list]) => ({ group, options: list }));
    const current = draft.tts.voice;
    if (current && !ttsInfo.voices.some((v) => v.id === current)) options.push({ value: current, label: `${current} (non trovata su questo PC)` });
    return select(draft.tts, 'voice', options, { inheritLabel: 'Voce predefinita' });
  }

  function ttsOffNotice() {
    return draft.tts.enabled ? null : el('p', { className: 'notice' }, 'La voce è spenta in generale: attivala in "Impostazioni generali → Voce".');
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
        el('div', { className: 'grid-2' },
          field('Posizione sullo schermo', select(o, 'position', Object.entries(POSITION_LABELS).map(([value, label]) => ({ value, label })))),
          field('Animazione', select(o, 'animation', Object.entries(ANIMATION_LABELS).map(([value, label]) => ({ value, label })))),
          field('Font', fontSelect(o, 'font')),
          field('Dimensione testo', range(o, 'fontSize', { min: 14, max: 72, step: 1, fallback: 26, format: (v) => `${v}px` }), { onReset: reset('fontSize') }),
          field('Colore del testo', colorInput(o, 'textColor', '#ffffff'), { onReset: reset('textColor') }),
          field('Colore dello sfondo', colorInput(o, 'background', '#121218'), { onReset: reset('background') }),
          field('Opacità dello sfondo', range(o, 'backgroundOpacity', { min: 0, max: 100, step: 5, scale: 0.01, fallback: 0.88, format: (v) => `${Math.round(v * 100)}%` }), { onReset: reset('backgroundOpacity') }))),
      section('Voce (text-to-speech)',
        checkbox(draft.tts, 'enabled', 'Attiva la voce (poi scegli in ogni alert cosa leggere)'),
        ttsInfo.voices.length
          ? el('p', { className: 'hint' }, `${ttsInfo.voices.length} voci disponibili. La voce va in live tramite l'overlay, come i suoni.`)
          : el('p', { className: 'notice' }, 'Su questo computer non ci sono voci di sistema: userà la voce del browser, che nel browser si sente ma dentro OBS no. Sul PC Windows TwitchGestor usa le voci di Windows (e le voci Piper, se le scarichi) e la voce va in live.'),
        el('div', { className: 'grid-2' },
          ttsInfo.voices.length ? field('Voce', voiceSelect()) : null,
          field('Velocità', range(draft.tts, 'rate', { min: -10, max: 10, step: 1, fallback: 0, format: (v) => (v > 0 ? `+${v}` : `${v}`) })),
          field('Volume', range(draft.tts, 'volume', { min: 0, max: 100, step: 5, fallback: 100, format: (v) => `${v}%` })),
          field('Lunghezza massima (caratteri)', numberInput(draft.tts, 'maxLength', { min: 20, step: 10 }))),
        checkbox(draft.tts, 'skipLinks', 'Non leggere i link (dice solo "link")'),
        field('Parole vietate (una per riga, vengono lette come "bip")', el('textarea', {
          rows: 3, value: (draft.tts.bannedWords ?? []).join('\n'),
          oninput: (e) => { draft.tts.bannedWords = e.target.value.split('\n').map((w) => w.trim()).filter(Boolean); markChanged(); },
        })),
        (() => {
          const input = el('input', { type: 'text', value: 'Ciao! Questa è la voce degli alert di TwitchGestor.' });
          return field('Prova la voce', el('div', { className: 'row' }, input, el('button', { type: 'button', onclick: () => listen(input.value) }, '▶ Ascolta')));
        })(),
        piperBox(),
        el('p', { className: 'hint' }, 'Altre voci di Windows: Impostazioni di Windows → Ora e lingua → Voce → Aggiungi voci, poi riavvia TwitchGestor.')),
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
    $('form').replaceChildren(...(selected === '__general' ? renderGeneralForm() : renderTypeForm(selected)).filter(Boolean));
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
