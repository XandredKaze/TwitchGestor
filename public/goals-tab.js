// Scheda "Goal": le barre degli obiettivi per OBS (abbonati, follower, bits, donazioni),
// con anteprima, correzioni a mano e indirizzo da copiare in OBS.
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => window.TG.api(path, opts);
  let config = []; // i goal come sono nelle impostazioni
  let live = []; // i goal con i numeri attuali
  let selected = null;
  let draft = null; // il goal che stai modificando (non ancora salvato)
  let isDemo = false;

  const TYPES = {
    subs: { label: 'Abbonati', icon: '⭐', title: 'SUB GOAL' },
    followers: { label: 'Follower', icon: '💜', title: 'FOLLOWER GOAL' },
    bits: { label: 'Bits', icon: '💎', title: 'BITS GOAL' },
    donations: { label: 'Donazioni (€)', icon: '💶', title: 'DONATION GOAL' },
  };
  const page = () => (isDemo ? 'goal.html' : '/goal');
  const obsUrl = (id) => (window.TG.obsUrl('goal') || `${location.origin}/goal`) + `?id=${encodeURIComponent(id)}`;
  const liveOf = (id) => live.find((g) => g.id === id);
  window.addEventListener('tg:state', (e) => { isDemo = Boolean(e.detail?.demo); });

  async function load() {
    const [cfg, g] = await Promise.all([
      api('/api/config', { method: 'GET', quiet: true }),
      api('/api/goals', { method: 'GET', quiet: true }),
    ]);
    config = cfg?.config?.goals ?? [];
    live = g?.goals ?? [];
    if (!config.some((x) => x.id === selected)) selected = config[0]?.id ?? null;
    draft = null;
    render();
  }

  async function saveAll(list) {
    const r = await api('/api/goals', { method: 'PUT', body: { goals: list } });
    if (!r) return false;
    config = r.config;
    live = r.goals;
    return true;
  }

  function preview(goal, { staticOnly = false } = {}) {
    const frame = el('iframe', {
      className: 'goal-frame', title: 'Anteprima del goal', tabindex: '-1',
      src: `${page()}?id=${encodeURIComponent(goal.id)}&preview${staticOnly ? '&static' : ''}`,
    });
    return el('div', { className: 'goal-frame-box' }, frame);
  }

  // anteprima del modulo: i dati vanno alla pagina del goal prima di salvare
  function pushDraft() {
    const frame = $('goal-edit').querySelector('iframe');
    if (!frame || !draft) return;
    const now = liveOf(draft.id);
    const current = now?.type === draft.type ? now.current : Math.round(Number(draft.target) * 0.4);
    const target = Math.max(1, Number(draft.target) || 1);
    frame.contentWindow?.postMessage({
      type: 'goal-preview',
      goal: { ...draft, title: draft.title || TYPES[draft.type].title, target, current, percent: Math.min(100, Math.floor((current / target) * 100)), showPercent: draft.showPercent !== false },
    }, location.origin);
  }

  const statusText = (g) => { const n = liveOf(g.id); return `${TYPES[g.type].label} · ${n ? `${n.current} su ${n.target} (${n.percent}%)` : '…'}`; };
  // numeri nuovi: cambia solo il testo delle schede (le anteprime si aggiornano da sole)
  function updateStatus() {
    for (const g of config) {
      const node = $('goal-list').querySelector(`[data-id="${CSS.escape(g.id)}"] .goal-status`);
      if (node) node.textContent = statusText(g);
    }
  }

  function renderList() {
    if (!config.length) {
      $('goal-list').replaceChildren(el('section', { className: 'panel' },
        el('p', {}, 'Nessun goal. Premi ', el('b', {}, '➕ Nuovo goal'), ' per crearne uno.')));
      return;
    }
    $('goal-list').replaceChildren(...config.map((g) => {
      const n = liveOf(g.id);
      const t = TYPES[g.type];
      const step = g.type === 'donations' ? 5 : g.type === 'bits' ? 100 : 1;
      const copyBtn = el('button', {
        type: 'button', className: 'small-btn',
        onclick: async () => {
          try { await navigator.clipboard.writeText(obsUrl(g.id)); copyBtn.textContent = 'Copiato!'; } catch { copyBtn.textContent = 'Selezionalo e copialo'; }
          setTimeout(() => { copyBtn.textContent = 'Copia'; }, 1500);
        },
      }, 'Copia');
      const adjust = async (delta) => { const r = await api(`/api/goals/${encodeURIComponent(g.id)}/adjust`, { body: { delta } }); if (r) { live = r.goals; updateStatus(); } };
      return el('section', { className: `panel goal-card${g.id === selected ? ' selected' : ''}`, 'data-id': g.id },
        el('div', { className: 'goal-card-head' },
          el('b', {}, `${t.icon} ${g.title || t.title}`),
          el('span', { className: 'muted small goal-status' }, statusText(g)),
          el('button', { type: 'button', className: 'small-btn', onclick: () => { selected = g.id; draft = null; render(); } }, g.id === selected ? '✏ In modifica' : '✏ Modifica')),
        preview(g),
        n && !n.ready ? el('p', { className: 'muted small' }, 'In attesa del numero da Twitch (serve l\'accesso con Twitch).') : null,
        el('div', { className: 'goal-card-actions' },
          el('span', { className: 'muted small' }, 'Correggi:'),
          el('button', { type: 'button', className: 'small-btn', onclick: () => adjust(-step) }, `−${step}`),
          el('button', { type: 'button', className: 'small-btn', onclick: () => adjust(step) }, `+${step}`),
          el('button', {
            type: 'button', className: 'small-btn',
            onclick: async () => {
              if (!confirm(g.type === 'followers' || g.type === 'subs'
                ? 'Azzerare il goal? Le correzioni a mano si tolgono e, con "solo i nuovi", si ricomincia a contare da adesso.'
                : 'Azzerare il goal? Si ricomincia a contare da 0.')) return;
              const r = await api(`/api/goals/${encodeURIComponent(g.id)}/reset`, { body: {} });
              if (r) { live = r.goals; updateStatus(); }
            },
          }, '↺ Azzera')),
        el('div', { className: 'goal-url' }, el('span', { className: 'field-label' }, 'In OBS: Sorgente browser, 1800 × 260 (o 900 × 130)'), el('div', { className: 'mu-url-row' }, el('code', {}, obsUrl(g.id)), copyBtn)));
    }));
  }

  function renderEdit() {
    const box = $('goal-edit');
    const g = config.find((x) => x.id === selected);
    if (!g) { box.replaceChildren(el('h2', {}, 'Modifica'), el('p', { className: 'muted' }, 'Scegli o crea un goal.')); return; }
    draft ??= { ...g };
    const type = el('select', {}, ...Object.entries(TYPES).map(([k, t]) => el('option', { value: k }, `${t.icon} ${t.label}`)));
    type.value = draft.type;
    const title = el('input', { type: 'text', maxlength: '40', value: draft.title ?? '', placeholder: TYPES[draft.type].title });
    const target = el('input', { type: 'number', min: '1', step: draft.type === 'donations' ? '0.5' : '1', value: String(draft.target ?? 30) });
    const mode = el('select', {}, el('option', { value: 'total' }, 'Il totale del canale'), el('option', { value: 'new' }, 'Solo i nuovi, da quando azzero'));
    mode.value = draft.mode === 'new' ? 'new' : 'total';
    const pct = el('input', { type: 'checkbox', checked: draft.showPercent !== false });
    const totals = draft.type === 'subs' || draft.type === 'followers';
    const update = () => {
      draft = { ...draft, type: type.value, title: title.value, target: Number(target.value), mode: mode.value, showPercent: pct.checked };
      pushDraft();
    };
    for (const c of [title, target]) c.oninput = update;
    for (const c of [mode, pct]) c.onchange = update;
    type.onchange = () => { update(); renderEdit(); };
    const frameBox = preview(draft, { staticOnly: true });
    frameBox.querySelector('iframe').addEventListener('load', pushDraft);
    box.replaceChildren(
      el('h2', {}, 'Modifica il goal'),
      frameBox,
      el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'Cosa conta'), type),
      el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'Scritta'), title, el('span', { className: 'hint' }, `Vuota = "${TYPES[draft.type].title}"`)),
      el('label', { className: 'field' }, el('span', { className: 'field-label' }, draft.type === 'donations' ? 'Obiettivo (€)' : 'Obiettivo'), target),
      totals
        ? el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'Conteggio'), mode,
          el('span', { className: 'hint' }, 'Totale: tutti i tuoi ' + (draft.type === 'subs' ? 'abbonati attuali' : 'follower') + ' (da Twitch). Solo i nuovi: parte da 0 quando premi "Azzera".'))
        : el('p', { className: 'hint' }, `Conta ${draft.type === 'bits' ? 'i bits' : 'le donazioni (tutte le valute sommate come euro)'} ricevuti da quando premi "Azzera".`),
      el('label', { className: 'check' }, pct, ' Mostra la percentuale'),
      el('div', { className: 'row' },
        el('button', {
          type: 'button', className: 'primary',
          onclick: async () => {
            const list = config.map((x) => (x.id === draft.id ? { ...draft } : x));
            if (await saveAll(list)) { draft = null; render(); }
          },
        }, 'Salva'),
        el('button', { type: 'button', onclick: () => { draft = null; renderEdit(); } }, 'Annulla'),
        el('button', {
          type: 'button', className: 'danger',
          onclick: async () => {
            if (!confirm(`Eliminare "${g.title || TYPES[g.type].title}"? In OBS la sorgente resterà vuota.`)) return;
            if (await saveAll(config.filter((x) => x.id !== g.id))) { selected = config[0]?.id ?? null; draft = null; render(); }
          },
        }, 'Elimina')));
  }

  function render() {
    renderList();
    renderEdit();
  }

  $('goal-add').onclick = async () => {
    const used = new Set(config.map((g) => g.id));
    const type = ['subs', 'followers', 'bits', 'donations'].find((t) => !config.some((g) => g.type === t)) ?? 'subs';
    let id = type === 'subs' ? 'sub' : type === 'followers' ? 'follower' : type;
    for (let i = 2; used.has(id); i++) id = `${type}${i}`;
    if (await saveAll([...config, { id, type, title: '', target: type === 'donations' ? 100 : type === 'bits' ? 5000 : 30, mode: 'total', showPercent: true }])) {
      selected = id;
      draft = null;
      render();
    }
  };
  window.addEventListener('tab:goals', load);
  window.addEventListener('tg:goals', (e) => {
    live = e.detail ?? [];
    if ($('tab-goals').hidden) return;
    updateStatus();
  });
})();
