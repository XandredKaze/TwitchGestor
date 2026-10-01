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
  const API_LEVEL = 5;
  const RESTART_HELP = 'Il programma TwitchGestor acceso è una versione precedente rispetto a questa pagina (succede se aggiorni i file mentre è acceso). Riavvialo: clicca "⏻ Spegni" in alto a destra, poi riapri OBS (oppure fai doppio clic su "Avvia TwitchGestor.vbs") e ricarica questa pagina con Ctrl+F5.';

  window.TG = { api, el, money, token: () => token, API_LEVEL, RESTART_HELP, version: '' };

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
