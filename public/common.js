// Funzioni condivise dalle pagine della dashboard.
(function () {
  // Il token (se DASHBOARD_TOKEN è impostato) si passa una volta con ?token=... e viene ricordato.
  const params = new URLSearchParams(location.search);
  let token = params.get('token');
  try {
    if (token) localStorage.setItem('dashboardToken', token);
    else token = localStorage.getItem('dashboardToken');
  } catch { /* storage non disponibile */ }

  /** Chiamata alle API del programma. Mostra un avviso se qualcosa va storto e ritorna null. */
  async function api(path, { method = 'POST', body, headers = {}, quiet = false } = {}) {
    const isFile = body instanceof Blob;
    const res = await fetch(path, {
      method,
      headers: {
        'x-twitchgestor': '1',
        ...(token ? { 'x-dashboard-token': token } : {}),
        ...(body !== undefined && !isFile ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isFile ? body : JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: 'Programma non raggiungibile' };
    if (res?.status === 401) { askPassword(Boolean(token)); return null; }
    if (!res?.ok) {
      if (!quiet) alert(data.error ?? `Errore ${res.status}`);
      return null;
    }
    return data;
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'style') for (const [prop, val] of Object.entries(v)) node.style.setProperty(prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), val ?? '');
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'className') node.className = v;
      else if (k === 'value' || k === 'checked') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== '' && c !== false));
    return node;
  }

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(amount);
    } catch {
      return `${amount} ${currency}`;
    }
  }

  // Deve corrispondere ad API_LEVEL in src/version.js.
  const API_LEVEL = 22;
  const RESTART_HELP = 'Il programma TwitchGestor acceso è una versione precedente rispetto a questa pagina (succede se aggiorni i file mentre è acceso). Riavvialo: clicca "⏻ Spegni" in alto a destra, poi riapri OBS (oppure fai doppio clic su "Avvia TwitchGestor.vbs") e ricarica questa pagina con Ctrl+F5.';

  /** Risultato del controllo della cartella condivisa fatto dal Raspberry (null se non ancora fatto). */
  function shareCheck(c) {
    if (!c) return el('p', { className: 'muted small' }, 'Il Raspberry controllerà la cartella al prossimo aggiornamento.');
    const when = c.at ? new Date(c.at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '';
    let text;
    let good = false;
    if (c.smbd !== 'yes') text = 'Il servizio della cartella condivisa sul Raspberry è spento.';
    else if (c.path !== 'yes') text = 'Il Raspberry non riesce ad aprire la cartella dei file (permessi).';
    else if (c.login === 'ok') {
      good = true;
      text = 'Il Raspberry è entrato nella cartella con questo utente e questa password: dal lato del Raspberry funziona. Se Windows dice "accesso negato", ha ricordato credenziali vecchie: apri "Gestione credenziali" → Credenziali di Windows, elimina quelle di twitchgestor, riavvia il PC e riprova copiando utente e password da qui.';
    } else if (/LOGON_FAILURE|WRONG_PASSWORD/.test(c.login)) text = 'Il Raspberry non riesce a entrare con questa password neanche da solo: la cartella non accetta la password della dashboard.';
    else if (/ACCESS_DENIED|BAD_NETWORK_NAME/.test(c.login)) text = 'Utente e password vanno, ma la cartella rifiuta l\'accesso (impostazioni della cartella condivisa).';
    else text = `Controllo non riuscito: ${c.login}`;
    return el('p', { className: `small ${good ? 'share-ok' : 'mu-warn'}` }, `${good ? '✓' : '⚠'} ${text}`, when ? el('span', { className: 'muted' }, ` (controllo del ${when}${c.login && c.login !== 'ok' ? `, ${c.login}` : ''})`) : null);
  }

  window.TG = { api, el, money, shareCheck, token: () => token, API_LEVEL, RESTART_HELP, version: '' };

  // Password della dashboard (DASHBOARD_TOKEN): su un dispositivo nuovo (es. il telefono) si chiede qui
  // e resta ricordata in questo browser.
  let passwordBox = null;
  function askPassword(wrong = false) {
    if (passwordBox || !document.body) return;
    const input = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'password della dashboard', style: { width: '100%', boxSizing: 'border-box', font: 'inherit', padding: '10px 12px', borderRadius: '10px', border: '1px solid #8886', background: 'transparent', color: 'inherit' } });
    const msg = el('p', { style: { margin: '0', color: '#e5484d', minHeight: '1.2em' } }, wrong ? 'La password salvata non è più valida: scrivila di nuovo.' : '');
    const form = el('form', {
      style: { display: 'grid', gap: '12px', width: 'min(420px, calc(100vw - 32px))', padding: '22px', borderRadius: '16px', background: 'var(--panel, #1c1a24)', color: 'var(--text, #fff)', boxShadow: '0 20px 60px rgba(0,0,0,.5)', font: '15px/1.45 system-ui, sans-serif' },
      onsubmit: async (e) => {
        e.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        msg.textContent = 'Controllo…';
        const res = await fetch('/api/state', { headers: { 'x-dashboard-token': value } }).catch(() => null);
        if (res?.ok) {
          try { localStorage.setItem('dashboardToken', value); } catch { /* storage non disponibile */ }
          location.replace(location.pathname + location.search.replace(/([?&])token=[^&]*&?/, '$1').replace(/[?&]$/, '') + location.hash);
        } else msg.textContent = res ? 'Password sbagliata.' : 'Programma non raggiungibile.';
      },
    },
    el('b', { style: { fontSize: '18px' } }, '🔒 Password della dashboard'),
    el('span', {}, 'Su questo dispositivo serve una volta sola, poi resta ricordata.'),
    input, msg,
    el('button', { type: 'submit', className: 'primary', style: { padding: '10px', fontWeight: '700' } }, 'Entra'),
    el('span', { style: { fontSize: '13px', opacity: '.75' } }, 'È la stessa che usi sul PC: la trovi nell\'indirizzo della dashboard dopo "token=", oppure sul PC in 🎵 Musica → Cartella condivisa (sul Raspberry).'));
    passwordBox = el('div', { role: 'dialog', 'aria-modal': 'true', style: { position: 'fixed', inset: '0', zIndex: '1000', display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.6)' } }, form);
    document.body.append(passwordBox);
    input.focus();
  }
  window.TG.askPassword = askPassword;
  // all'apertura: se il programma chiede la password e qui non c'è (o è sbagliata), la si chiede subito
  const checkPassword = () => fetch('/api/state', { headers: token ? { 'x-dashboard-token': token } : {} })
    .then((r) => { if (r.status === 401) askPassword(Boolean(token)); }).catch(() => {});
  if (!/\bdemo\b/.test(location.search)) {
    if (document.body) checkPassword(); else window.addEventListener('DOMContentLoaded', checkPassword);
  }

  /** Mostra un errore della pagina in un riquadro, con un pulsante per copiarlo e mandarlo a chi ti aiuta. */
  let errorBox = null;
  function showError(message) {
    if (!document.body) return;
    const text = `TwitchGestor ${window.TG.version || '(versione sconosciuta)'} – ${location.pathname}\n${message}`;
    if (!errorBox) {
      errorBox = el('div', { className: 'error-box', role: 'alert' });
      document.body.append(errorBox);
    }
    const pre = el('pre', {}, text);
    errorBox.replaceChildren(
      el('b', {}, '⚠️ Si è verificato un errore nella pagina'),
      el('p', {}, 'Copia il testo qui sotto e mandalo a chi ti aiuta con TwitchGestor.'),
      pre,
      el('div', { className: 'buttons' },
        el('button', {
          onclick: async (e) => {
            try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copiato!'; } catch { getSelection().selectAllChildren(pre); }
          },
        }, 'Copia'),
        el('button', { onclick: () => { errorBox.remove(); errorBox = null; } }, 'Chiudi')));
  }
  window.TG.showError = showError;
  window.addEventListener('error', (e) => showError(`${e.message}\n${e.filename?.split('/').pop() ?? ''}:${e.lineno ?? ''}:${e.colno ?? ''}\n${e.error?.stack ?? ''}`.trim()));
  window.addEventListener('unhandledrejection', (e) => showError(`${e.reason?.message ?? e.reason}\n${e.reason?.stack ?? ''}`.trim()));
})();
