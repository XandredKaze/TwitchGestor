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

  window.TG = { api, el, money, token: () => token };
})();
