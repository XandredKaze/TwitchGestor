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
    // un aggiornamento "in corso" da più di 20 minuti si è fermato a metà (es. Raspberry spento durante l'aggiornamento)
    const stuck = last?.result === 'running' && Date.now() - Date.parse(last.at) > 20 * 60000;
    if (stuck && !info.pending) {
      lines.push(el('p', { className: 'cmd-warn' }, `⚠ L'aggiornamento iniziato alle ${new Date(last.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })} si è fermato a metà. TwitchGestor funziona con la versione installata${c.available ? ': riprova con "Aggiorna ora"' : ''}.`));
    }
    if (info.pending || (last?.result === 'running' && !stuck)) {
      lines.push(el('p', { className: 'cmd-ok' }, '⏳ Aggiornamento in corso: TwitchGestor si riavvia da solo (di solito 1–3 minuti) e questa pagina si ricarica.'));
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
    const s = info.settings ?? {};
    const mode = el('select', {
      onchange: async (e) => {
        const v = e.target.value;
        const res = await api('/api/update/settings', { method: 'PUT', body: v === 'off' ? { auto: false } : { auto: true, when: v } });
        if (res) { info = res; render(); }
      },
    },
    el('option', { value: 'always' }, 'Appena c\'è una versione nuova (controllo ogni 5 minuti)'),
    el('option', { value: 'night' }, `Solo di notte, alle ${s.hour ?? 5}:00`),
    el('option', { value: 'off' }, 'Mai da solo (solo con "Aggiorna ora")'));
    mode.value = s.auto === false ? 'off' : s.when === 'night' ? 'night' : 'always';
    lines.push(el('label', { className: 'field sys-auto' }, el('span', { className: 'field-label' }, 'Aggiornamento automatico'), mode,
      el('span', { className: 'hint' }, 'Mai durante la live: in diretta non controlla nemmeno. Dopo l\'aggiornamento TwitchGestor si riavvia (circa un minuto) e le pagine aperte si ricaricano da sole.')));
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

  // ---------- Accesso da fuori casa (Tailscale) ----------
  let remote = null;
  let remotePoll = null;
  let remoteBusy = false;

  function copyLine(text) {
    const btn = el('button', {
      type: 'button', className: 'small-btn',
      onclick: async () => { try { await navigator.clipboard.writeText(text); btn.textContent = 'Copiato!'; } catch { btn.textContent = 'Selezionalo'; } setTimeout(() => { btn.textContent = 'Copia'; }, 1500); },
    }, 'Copia');
    return el('div', { className: 'sys-copy' }, el('code', {}, text), btn);
  }

  async function remoteCall(action) {
    remoteBusy = true;
    renderRemote();
    const res = await api(`/api/remote/${action}`);
    remoteBusy = false;
    if (res) remote = res;
    renderRemote();
    watchRemote();
  }

  function renderRemote() {
    const sec = $('sys-remote-sec');
    sec.hidden = !state?.managed && !state?.remoteDemo;
    if (sec.hidden) return;
    const box = $('sys-remote');
    const r = remote;
    if (!r) { box.replaceChildren(el('p', { className: 'muted small' }, 'Controllo…')); return; }
    const intro = el('p', { className: 'muted small' }, 'Apri la dashboard da ovunque (telefono, portatile) con ', el('b', {}, 'Tailscale'),
      ': una rete privata gratuita tra i tuoi dispositivi. Nessuna porta aperta sul router: entra solo chi usa il tuo account Tailscale.');
    const installing = r.pending || r.install?.result === 'running';
    if (remoteBusy) { box.replaceChildren(intro, el('p', { className: 'cmd-ok' }, '⏳ Un momento…')); return; }

    if (!r.installed || installing || r.install?.result === 'error' || (r.state === 'NoState' && r.error)) {
      const lines = [intro];
      if (installing) lines.push(el('p', { className: 'cmd-ok' }, '⏳ Installo Tailscale sul Raspberry: ci vogliono 1–3 minuti. Puoi chiudere questa finestra.'));
      else {
        if (r.install?.result === 'error') lines.push(el('p', { className: 'cmd-warn' }, `✕ ${r.install.message || 'Installazione non riuscita'}`));
        lines.push(el('ol', { className: 'small sys-steps' },
          el('li', {}, 'Premi ', el('b', {}, 'Attiva'), ': il Raspberry installa Tailscale (1–3 minuti).'),
          el('li', {}, 'Premi ', el('b', {}, 'Collega'), ' e apri il link che compare: accedi a Tailscale (anche con Google). Si fa una volta sola, da casa.'),
          el('li', {}, 'Installa l\'app Tailscale sul telefono con lo stesso account: fatto.')),
        el('button', { type: 'button', className: 'primary', onclick: () => remoteCall('install') }, r.install?.result === 'error' ? '↻ Riprova' : '🌍 Attiva l\'accesso da fuori casa'));
      }
      box.replaceChildren(...lines);
      return;
    }

    if (!r.connected) {
      box.replaceChildren(intro,
        el('p', { className: 'cmd-ok' }, '✓ Tailscale è installato sul Raspberry. Ora collegalo al tuo account (gratis):'),
        r.authUrl
          ? el('div', { className: 'sys-remote-login' },
            el('a', { href: r.authUrl, target: '_blank', rel: 'noopener', className: 'btn primary' }, '🔑 Apri il link e accedi a Tailscale'),
            el('p', { className: 'muted small' }, 'Accedi (anche con Google o Microsoft) e premi ', el('b', {}, 'Connect'), '. Questa finestra si aggiorna da sola quando hai finito.'))
          : el('button', { type: 'button', className: 'primary', onclick: () => remoteCall('connect') }, '🔗 Collega'));
      return;
    }

    const port = r.httpPort ?? 3000;
    const name = r.dnsName || r.ip;
    const here = [r.ip, r.dnsName].includes(location.hostname);
    box.replaceChildren(
      el('p', { className: 'cmd-ok' }, `✓ Collegato${r.account ? ` (account ${r.account})` : ''}${here ? ': stai usando proprio questo accesso' : ''}.`),
      el('p', { className: 'small' }, el('b', {}, 'Sul telefono'), ': installa l\'app ', el('a', { href: 'https://tailscale.com/download', target: '_blank', rel: 'noopener' }, 'Tailscale'),
        ', accedi con lo stesso account e tienila attiva. Poi apri nel browser:'),
      copyLine(`http://${name}:${port}/dashboard`),
      r.dnsName ? el('p', { className: 'muted small' }, 'Se non si apre, usa l\'indirizzo numerico: ', el('code', {}, `http://${r.ip}:${port}/dashboard`)) : null,
      el('p', { className: 'muted small' }, 'La prima volta chiede la password della dashboard. Funziona tutto tranne anteprima e chat di Twitch nella scheda Live (su un portatile funzionano se installi il certificato, vedi sotto): per la chat dal telefono usa l\'app di Twitch.'),
      el('p', { className: 'muted small' }, el('b', {}, 'Scheda Live su un PC o portatile fuori casa'), ': il certificato di TwitchGestor ora vale anche per Tailscale. Su ogni PC dove l\'avevi già installato, ',
        el('a', { href: '/twitchgestor-certificato.crt' }, 'scaricalo di nuovo'), ' e installalo come la prima volta (stessi passaggi della scheda Live).'),
      el('p', { className: 'muted small' }, 'Anche la cartella condivisa funziona da fuori casa: ', el('code', {}, `\\\\${r.ip}\\TwitchGestor`), '.'),
      el('button', {
        type: 'button', className: 'small-btn',
        onclick: () => confirm(here ? 'Stai usando proprio l\'accesso da fuori casa: scollegandolo questa pagina smette di funzionare finché non torni a casa. Scollegare?' : 'Scollegare l\'accesso da fuori casa? Potrai ricollegarlo quando vuoi.') && remoteCall('disconnect'),
      }, 'Scollega'),
    );
  }

  function watchRemote() {
    clearInterval(remotePoll);
    const waiting = remote && (remote.pending || remote.install?.result === 'running' || (remote.installed && !remote.connected && remote.authUrl));
    if (!waiting || !dialog.open) return;
    remotePoll = setInterval(async () => {
      if (!dialog.open) { clearInterval(remotePoll); return; }
      const res = await api('/api/remote', { method: 'GET', quiet: true });
      if (!res) return;
      remote = res;
      renderRemote();
      if (!(res.pending || res.install?.result === 'running' || (res.installed && !res.connected && res.authUrl))) clearInterval(remotePoll);
    }, 4000);
  }

  async function loadRemote() {
    if (!state?.managed && !state?.remoteDemo) { renderRemote(); return; }
    remote = null;
    renderRemote();
    remote = await api('/api/remote', { method: 'GET', quiet: true });
    renderRemote();
    watchRemote();
  }

  // ---------- 🧰 Tools ----------
  // per aggiungere un programma futuro basta una riga qui (stesso Raspberry, porta sua, stessa password)
  const TOOLS = [
    { id: 'howlup', name: 'Howl-UP', icon: '🐺', port: 3100, desc: 'L\'agenda dei tuoi impegni: live, lavoro, vita personale, note e annunci per la community.' },
    { id: 'musicante', name: 'Musicante', icon: '🎵', port: 3200, desc: 'Scarica la musica in MP3 (anche playlist e mix divisi per capitoli) nella musica di TwitchGestor.' },
  ];
  const toolUrl = (t) => `http://${location.hostname}:${t.port}/${window.TG.token() ? `?token=${encodeURIComponent(window.TG.token())}` : ''}`;
  function renderTools() {
    const list = $('sys-tools-list');
    list.replaceChildren(...TOOLS.map((t) => {
      const dot = el('span', { className: 'sys-tool-dot', title: 'Controllo…' }, '●');
      // acceso o spento? (da una pagina https il browser non lascia controllare un indirizzo http: si salta)
      if (location.protocol === 'http:') {
        fetch(`http://${location.hostname}:${t.port}/`, { mode: 'no-cors', signal: AbortSignal.timeout(3000) })
          .then(() => { dot.classList.add('ok'); dot.title = 'Acceso'; })
          .catch(() => { dot.classList.add('off'); dot.title = 'Non risponde (si sta aggiornando o è spento)'; });
      } else dot.hidden = true;
      return el('a', { className: 'sys-tool', href: toolUrl(t), target: '_blank', rel: 'noopener' },
        el('span', { className: 'sys-tool-icon', 'aria-hidden': 'true' }, t.icon),
        el('span', { className: 'sys-tool-text' }, el('b', {}, t.name, ' ', dot), el('span', { className: 'small muted' }, t.desc)),
        el('span', { className: 'sys-tool-go', 'aria-hidden': 'true' }, '↗'));
    }));
  }
  $('sys-tools-btn').onclick = () => {
    const box = $('sys-tools');
    box.hidden = !box.hidden;
    $('sys-tools-btn').setAttribute('aria-expanded', String(!box.hidden));
    $('sys-tools-btn').classList.toggle('active', !box.hidden);
    if (!box.hidden) { renderTools(); box.scrollIntoView({ block: 'nearest' }); }
  };

  async function open() {
    dialog.showModal();
    // 🧰 Tools: gli altri programmi sul Raspberry (Howl-UP, Musicante…), con lo stesso nome o indirizzo
    $('sys-tools-btn').hidden = !state?.managed;
    if (!state?.managed) $('sys-tools').hidden = true;
    loadRemote();
    info = null;
    render();
    info = await api('/api/update', { method: 'GET', quiet: true });
    render();
    if (info?.pending) watch();
  }

  $('btn-system').onclick = open;
  $('app-version').onclick = open;
  $('sys-close').onclick = () => { dialog.close(); clearInterval(poll); clearInterval(remotePoll); };
  dialog.addEventListener('click', (e) => { if (e.target === dialog) { dialog.close(); clearInterval(poll); clearInterval(remotePoll); } });

  // rapporto per l'assistenza: da copiare in chat o scaricare
  $('sys-report').onclick = async () => {
    const out = $('sys-report-out');
    const btn = $('sys-report');
    btn.disabled = true;
    out.replaceChildren(el('p', { className: 'muted small' }, 'Raccolgo le informazioni (qualche secondo)…'));
    const token = window.TG.token();
    const res = await fetch('/api/system/report', { headers: token ? { 'x-dashboard-token': token } : {} }).catch(() => null);
    btn.disabled = false;
    if (!res?.ok) { out.replaceChildren(el('p', { className: 'cmd-warn' }, (await res?.json().catch(() => null))?.error ?? 'Rapporto non riuscito: il programma non risponde.')); return; }
    const text = await res.text();
    const area = el('textarea', { className: 'sys-report-text', readonly: true, rows: '8', 'aria-label': 'Rapporto' });
    area.value = text;
    const copy = el('button', {
      type: 'button', className: 'primary',
      onclick: async () => {
        try { await navigator.clipboard.writeText(text); } catch { area.select(); document.execCommand('copy'); }
        copy.textContent = '✓ Copiato: incollalo in chat';
        setTimeout(() => { copy.textContent = '📋 Copia'; }, 2500);
      },
    }, '📋 Copia');
    const save = el('button', {
      type: 'button',
      onclick: () => {
        const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: `rapporto-twitchgestor-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.txt` });
        document.body.append(a);
        a.click();
        a.remove();
      },
    }, '⬇ Scarica .txt');
    out.replaceChildren(el('div', { className: 'row' }, copy, save), area);
  };

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
