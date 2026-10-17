// Finestra "⚙ Sistema": aggiornamenti (sul Raspberry) e copia di sicurezza (esporta/importa).
(function () {
  const { el } = window.TG;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => window.TG.api(path, opts);
  const dialog = $('system-dialog');
  let info = null;
  let state = null;
  let poll = null;

  const when = (iso) => (iso ? new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const RESULT = {
    ok: '✓ riuscito',
    rollback: '✕ non riuscito: è tornato da solo alla versione precedente',
    error: '✕ non riuscito',
    running: '… in corso',
    'up-to-date': '✓ era già aggiornato',
    'skipped-live': 'rimandato: eri in live',
  };

  function render() {
    const box = $('sys-update');
    if (!info) { box.replaceChildren(el('p', { className: 'muted small' }, 'Controllo…')); return; }
    const version = el('p', {}, 'Versione installata: ', el('b', {}, `v${state?.version ?? '?'}`), info.commit ? el('span', { className: 'muted small' }, ` (${info.commit})`) : null);
    if (!info.managed) {
      box.replaceChildren(version, el('p', { className: 'muted small' },
        'Su questo PC aggiorni scaricando la nuova versione di TwitchGestor e riavviandolo: impostazioni e dati restano dove sono. Sul Raspberry (installato con lo script) gli aggiornamenti sono automatici.'));
      return;
    }
    const c = info.check ?? {};
    const live = Boolean(state?.obs?.stream?.active);
    const last = info.last;
    const lines = [version];
    if (info.pending || last?.result === 'running') {
      lines.push(el('p', { className: 'cmd-ok' }, '⏳ Aggiornamento in corso: TwitchGestor si riavvia da solo (circa un minuto) e questa pagina si ricarica.'));
    } else if (c.error) {
      lines.push(el('p', { className: 'cmd-warn' }, c.error));
    } else if (c.available) {
      lines.push(el('p', { className: 'cmd-ok' }, el('b', {}, `Nuova versione disponibile`), ` (${c.behind} ${c.behind === 1 ? 'modifica' : 'modifiche'}):`),
        el('ul', { className: 'sys-changes' }, ...(c.changes ?? []).map((x) => el('li', {}, x.text))),
        el('div', { className: 'row' },
          el('button', {
            type: 'button', className: 'primary',
            onclick: async () => {
              if (live && !confirm('Sei in live: durante l\'aggiornamento (circa un minuto) alert, chat e bot si fermano. Aggiornare adesso?')) return;
              const res = await api('/api/update');
              if (res) { info = res; render(); watch(); }
            },
          }, '⬆ Aggiorna ora')));
    } else {
      lines.push(el('p', { className: 'muted small' }, `✓ È l'ultima versione${c.checkedAt ? ` (controllato ${when(new Date(c.checkedAt).toISOString())})` : ''}.`));
    }
    lines.push(el('label', { className: 'inline small' },
      el('input', {
        type: 'checkbox', checked: info.settings?.auto !== false,
        onchange: async (e) => { const res = await api('/api/update/settings', { method: 'PUT', body: { auto: e.target.checked } }); if (res) { info = res; render(); } },
      }),
      `Aggiorna da solo ogni notte alle ${info.settings?.hour ?? 5}:00 (mai durante la live)`));
    if (last?.at) {
      lines.push(el('p', { className: `small ${last.result === 'rollback' || last.result === 'error' ? 'mod-error' : 'muted'}` },
        `Ultimo aggiornamento: ${when(last.at)} — ${RESULT[last.result] ?? last.result}${last.message ? ` (${last.message})` : ''}`));
    }
    lines.push(el('button', { type: 'button', className: 'small-btn', onclick: async () => { info = null; render(); info = await api('/api/update/check', { quiet: true }); render(); } }, '↻ Controlla adesso'));
    box.replaceChildren(...lines);
  }

  // durante l'aggiornamento il programma si riavvia: quando torna, la pagina si ricarica da sola (vedi dashboard.js)
  function watch() {
    clearInterval(poll);
    poll = setInterval(async () => {
      const res = await api('/api/update', { method: 'GET', quiet: true });
      if (!res) return;
      info = res;
      render();
      if (!res.pending && res.last?.result !== 'running') clearInterval(poll);
    }, 4000);
  }

  async function open() {
    dialog.showModal();
    info = null;
    render();
    info = await api('/api/update', { method: 'GET', quiet: true });
    render();
    if (info?.pending) watch();
  }

  $('btn-system').onclick = open;
  $('app-version').onclick = open;
  $('sys-close').onclick = () => { dialog.close(); clearInterval(poll); };
  dialog.addEventListener('click', (e) => { if (e.target === dialog) { dialog.close(); clearInterval(poll); } });

  $('sys-export').onclick = async () => {
    const out = $('sys-backup-out');
    out.textContent = 'Preparo il file…';
    const token = window.TG.token();
    const res = await fetch('/api/backup', { headers: token ? { 'x-dashboard-token': token } : {} }).catch(() => null);
    if (!res?.ok) { out.textContent = (await res?.json().catch(() => null))?.error ?? 'Esportazione non riuscita.'; return; }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'twitchgestor.tar.gz';
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    out.textContent = `✓ Salvato "${name}" (${Math.max(1, Math.round(blob.size / 1024))} KB). Contiene anche gli accessi a Twitch: tienilo per te.`;
  };

  $('sys-import').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!confirm(`Importare "${file.name}"? Impostazioni, accessi e dati di questo TwitchGestor verranno sostituiti da quelli del file (prima ne salvo una copia). Poi il programma si riavvia.`)) return;
    const out = $('sys-backup-out');
    out.textContent = 'Importo…';
    const res = await api('/api/backup/restore', { body: file });
    if (!res) { out.textContent = 'Importazione non riuscita.'; return; }
    out.textContent = `✓ Importato.${res.obsHost ? ` OBS ora è collegato a ${res.obsHost} (il computer da cui hai importato).` : ''} `
      + (res.managed ? 'TwitchGestor si riavvia da solo: la pagina si ricarica tra poco.' : 'TwitchGestor si è chiuso: riaprilo (Avvia TwitchGestor) e ricarica la pagina.');
  };

  // Sul Raspberry Twitch accetta l'accesso solo da "localhost": serve il piccolo file per Windows che collega il PC al Raspberry.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="/auth/"]');
    if (!a || !state?.managed || ['localhost', '127.0.0.1'].includes(location.hostname)) return;
    e.preventDefault();
    const bot = a.getAttribute('href').includes('/bot/');
    if (!confirm(`Twitch permette di accedere solo da "localhost", quindi con TwitchGestor sul Raspberry l'accesso ${bot ? 'del bot ' : ''}si fa dal PC Windows con un piccolo file.\n\nOK = scarica il file, poi aprilo con doppio clic: si apre la pagina di Twitch e accedi come sempre${bot ? ' (con l\'account del bot)' : ''}.`)) return;
    const token = window.TG.token();
    location.href = `/api/raspberry/login.bat?kind=${bot ? 'bot' : 'channel'}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  }, true);

  window.addEventListener('tg:state', (e) => {
    state = e.detail;
    // sul Raspberry "Spegni" in realtà riavvia (il servizio lo fa ripartire)
    if (state.managed) {
      $('btn-shutdown').textContent = '⟳ Riavvia';
      $('btn-shutdown').title = 'Riavvia TwitchGestor';
    }
    if (dialog.open) render();
  });
})();
