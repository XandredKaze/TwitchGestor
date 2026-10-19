// Alert "ERRORE_DI_SISTEMA" per l'overlay di OBS: stessa grafica e stesse animazioni della demo alert.html.
// Due layout per lo stesso alert: normale (finestre di errore a cascata) e in-game (barra in alto).
// Se la scena di OBS cambia mentre un alert è in corso, l'alert continua nell'altro layout per il tempo che resta.
// La coda, i suoni e i tempi tra un alert e l'altro restano quelli di TwitchGestor (overlay.js).
(function () {
  const X = '<svg class="x" viewBox="0 0 24 24" aria-hidden="true"><use href="#es-x"/></svg>';
  const ERR_ICON = '<div class="err-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#es-x"/></svg></div>';
  // solo struttura fissa: i testi (anche gli username di Twitch) si inseriscono dopo con textContent
  const TEMPLATE = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="es-x" viewBox="0 0 24 24"><path d="M4 4L20 20M20 4L4 20" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></symbol>
  <filter id="es-ca" x="-8%" y="-5%" width="116%" height="110%" color-interpolation-filters="sRGB">
    <feColorMatrix in="SourceGraphic" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>
    <feOffset in="r" dx="-6" result="r2" class="es-dx-r"/>
    <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>
    <feColorMatrix in="SourceGraphic" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>
    <feOffset in="b" dx="6" result="b2" class="es-dx-b"/>
    <feBlend mode="screen" in="r2" in2="g" result="rg"/>
    <feBlend mode="screen" in="rg" in2="b2"/>
  </filter>
</svg>
<div id="e-stage" hidden>
  <div class="win" id="e-main">
    <div class="bits"></div>
    <div class="bar"><span>ERRORE_DI_SISTEMA</span>${X}</div>
    <div class="body">
      <div class="err">${ERR_ICON}<div class="err-text">ERRORE<br>ERRORE ERRORE<br>ERR0R_SYS<small>FATAL_EXCEPTION 0x00XSUB</small></div></div>
      <div class="info">
        <img class="star icon reveal" alt="">
        <div class="info-main">
          <div class="tag reveal"><span data-k="tag"></span><span data-k="tag2"></span></div>
          <div class="title reveal" data-k="title"></div>
          <div class="user reveal" data-k="user"></div>
          <div class="msg reveal"><span data-k="msg"></span> <b data-k="amount"></b></div>
        </div>
      </div>
    </div>
  </div>
</div>
<div id="e-ig" hidden>
  <div class="bits"></div>
  <div class="ig-c">
    <div class="ig-err">${ERR_ICON}<div class="err-text">ERRORE ERRORE ERRORE<small>FATAL_EXCEPTION 0x00XSUB</small></div></div>
    <div class="ig-info">
      <img class="ig-star icon" alt="">
      <div class="ig-main">
        <div class="tag"><span data-k="tag"></span><span data-k="tag2"></span></div>
        <div class="title" data-k="igTitle"></div>
        <div class="user" data-k="user"></div>
      </div>
      ${X.replace('class="x"', 'class="x ig-x"')}
    </div>
  </div>
</div>`;

  let root = null;
  let stage;
  let main;
  let ig;
  function ensure() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'errore';
    root.innerHTML = TEMPLATE;
    document.body.append(root);
    stage = root.querySelector('#e-stage');
    main = root.querySelector('#e-main');
    ig = root.querySelector('#e-ig');
  }

  // impostazioni grafiche (tab Alert) → variabili CSS
  const VARS = { red: '--red', accent: '--accent', name: '--name', title: '--title', bg: '--bg', text: '--text', muted: '--muted' };
  const mediaSrc = (src) => (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') ? src : `/${src}`);
  function applyConfig(cfg = {}) {
    ensure();
    const s = root.style;
    for (const [k, v] of Object.entries(VARS)) if (cfg[k]) s.setProperty(v, cfg[k]);
    if (cfg.bitsImage) s.setProperty('--bits', `url("${mediaSrc(cfg.bitsImage).replace(/["\\]/g, '')}")`);
    if (cfg.bitsOpacity !== undefined) s.setProperty('--bits-opacity', cfg.bitsOpacity);
    if (cfg.bitsBleed !== undefined) s.setProperty('--bits-bleed', `${cfg.bitsBleed}px`);
    if (cfg.ca !== undefined) s.setProperty('--ca', `${cfg.ca}px`);
    if (cfg.igW) s.setProperty('--ig-w', `${cfg.igW}px`);
    if (cfg.igH) s.setProperty('--ig-h', `${cfg.igH}px`);
    if (cfg.igTop !== undefined) s.setProperty('--ig-top', `${cfg.igTop}px`);
    if (cfg.glitchDx !== undefined) {
      root.querySelector('.es-dx-r').setAttribute('dx', -cfg.glitchDx);
      root.querySelector('.es-dx-b').setAttribute('dx', cfg.glitchDx);
    }
  }

  // una sola attesa alla volta; cancel() la interrompe subito (nuovo alert, stop o cambio scena)
  let cancel = () => {};
  const sleep = (ms) => new Promise((ok, stop) => {
    const t = setTimeout(ok, ms);
    cancel = (why) => { clearTimeout(t); stop(why); };
  });

  // copia della finestra principale con solo l'errore
  function errorTemplate() {
    const w = main.cloneNode(true);
    w.removeAttribute('id');
    w.style.visibility = '';
    w.classList.add('pop');
    w.querySelector('.info').remove();
    return w;
  }

  // c.endAt = quando l'alert deve finire. Se c'è già, l'alert sta continuando dopo un cambio scena:
  // si salta l'intro e si mostra solo il tempo rimasto.
  async function playNormal(c) {
    main.className = 'win';
    main.style.zIndex = '';
    stage.hidden = false;
    void main.offsetWidth;
    if (!c.endAt) {
      main.style.visibility = 'hidden'; // la principale arriva per ultima

      // 1. cascata di finestre errore (la principale è l'ultima, davanti)
      const tpl = errorTemplate();
      const n = Number(c.cfg.windows ?? 14);
      const clones = [];
      for (let i = n; i > 0; i--) {
        const w = tpl.cloneNode(true);
        w.style.translate = `${-i * c.cfg.offset}px ${-i * c.cfg.offset * 0.75}px`;
        w.style.zIndex = n - i;
        stage.insertBefore(w, main);
        clones.push(w);
        await sleep(c.cfg.spawnMs);
      }
      main.style.visibility = '';
      main.style.zIndex = n + 1;
      main.classList.add('pop');
      await sleep(400);

      // 2. glitch: spariscono le finestre dietro e compaiono le info
      main.classList.add('glitch');
      clones.forEach((w) => w.classList.add('out'));
      await sleep(250);
      main.classList.add('show-info');
      fit(main);
      await sleep(200);
      clones.forEach((w) => w.remove());
      await sleep(100);
      main.classList.remove('glitch');
      c.endAt = Date.now() + c.hold;
    } else {
      main.style.visibility = '';
      main.classList.add('pop', 'show-info');
      fit(main);
    }

    // 3. attesa, poi uscita con glitch
    await sleep(Math.max(0, c.endAt - Date.now()));
    main.classList.add('out');
    await sleep(450);
  }

  async function playIngame(c) {
    ig.className = '';
    ig.hidden = false;
    void ig.offsetWidth; // così ig-in riparte sempre
    if (!c.endAt) {
      // 1. compare dall'alto, dalla trasparenza, con il testo di errore
      ig.classList.add('ig-in');
      await sleep(900);
      // 2. glitch dall'errore al testo, su tutta la finestra
      ig.classList.replace('ig-in', 'glitch');
      await sleep(250);
      ig.classList.add('show-info');
      fit(ig);
      await sleep(300);
      ig.classList.remove('glitch');
      c.endAt = Date.now() + c.igHold;
    } else {
      ig.classList.add('ig-in', 'show-info');
      fit(ig);
    }

    // 3. attesa, poi risale e sparisce
    await sleep(Math.max(0, c.endAt - Date.now()));
    ig.classList.add('ig-out');
    await sleep(400);
  }

  function reset() {
    if (!root) return;
    stage.hidden = true;
    ig.hidden = true;
    stage.querySelectorAll('.win:not(#e-main)').forEach((w) => w.remove());
  }

  // titoli e flavour text lunghi: riduce il font finché il testo sta nella riga
  function fit(box) {
    box.querySelectorAll('.title, .tag').forEach((node) => {
      node.style.fontSize = '';
      let fs = parseFloat(getComputedStyle(node).fontSize);
      while (node.scrollWidth > node.clientWidth && fs > 8) node.style.fontSize = `${fs -= 1}px`;
    });
  }

  function fill(c) {
    // textContent: i nomi arrivano da Twitch, mai innerHTML
    root.querySelectorAll('[data-k]').forEach((node) => { node.textContent = c[node.dataset.k] ?? ''; });
    root.querySelectorAll('.msg').forEach((node) => { node.hidden = !c.msg && !c.amount; });
    root.querySelectorAll('.icon').forEach((img) => {
      if (c.icon) { img.src = mediaSrc(c.icon); img.hidden = false; } else img.hidden = true;
    });
    root.style.setProperty('--icon', c.color || '#ff2d95');
  }

  // scena attiva: 'normal' o 'ingame'
  let mode = 'normal';
  let current = null;
  let seq = 0;
  const modeOf = (c) => c.forced || mode;

  async function run(c, gen) {
    for (;;) { // si ripete solo se cambia scena: stesso alert, altro layout
      reset();
      fill(c);
      try {
        await (modeOf(c) === 'ingame' ? playIngame : playNormal)(c);
        break;
      } catch (why) {
        if (why !== 'switch') return;
      }
    }
    if (gen === seq) { reset(); current = null; }
  }

  /** Mostra un alert (ferma quello in corso). alert.errore: testi, icona, colore, cfg (impostazioni grafiche). */
  function play(alert) {
    ensure();
    stop();
    const e = alert.errore;
    const cfg = { windows: 14, spawnMs: 70, offset: 20, holdMs: 6000, igHoldMs: 3500, ...(e.cfg ?? {}) };
    applyConfig(cfg);
    // anteprima della tab Alert: resta ferma finché modifichi (durata lunghissima)
    const still = alert.duration >= 3600000;
    current = {
      ...e, id: alert.id, cfg, endAt: null, forced: e.mode === 'ingame' || e.mode === 'normal' ? e.mode : null,
      hold: still ? alert.duration : cfg.holdMs, igHold: still ? alert.duration : cfg.igHoldMs,
    };
    const gen = ++seq;
    const go = () => { if (gen === seq) run(current, gen); };
    // i font devono essere pronti, altrimenti fit() misura male i testi
    if (document.fonts?.load) {
      Promise.all(['22px "ES Silkscreen"', '44px "ES Rubik Mono One"', '900 36px "ES Nunito"'].map((f) => document.fonts.load(f)))
        .catch(() => {}).then(go);
    } else go();
  }

  function stop(id) {
    if (!current || (id && current.id !== id)) return;
    seq++;
    cancel('stop');
    current = null;
    reset();
  }

  /** Cambio scena: l'alert in corso continua nell'altro layout. */
  function setMode(m) {
    if (m !== 'ingame' && m !== 'normal') return;
    if (m === mode) return;
    mode = m;
    if (current && !current.forced) cancel('switch');
  }

  window.ErroreAlert = { play, stop, setMode, isPlaying: (id) => Boolean(current && (!id || current.id === id)) };
})();
