/**
 * Rapporto per l'assistenza (⚙ Sistema → Assistenza): stato del programma, del Raspberry e registri recenti,
 * in un testo da copiare in chat. Password, token e chiavi vengono tolti (src/core/redact.js).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT_DIR, DATA_DIR } from './config.js';
import { APP_VERSION } from './version.js';
import { recentLogs } from './logger.js';
import * as updates from './updates.js';
import { redact, envSecrets } from './core/redact.js';

const run = (file, args, timeout = 15000) => new Promise((resolve) => {
  execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() });
  });
});
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const mb = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;
const ago = (sec) => {
  const s = Math.round(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d ? `${d}g ` : ''}${h}h ${m}m`;
};

const SERVICES = ['twitchgestor', 'howlup', 'musicante', 'twitchgestor-update.timer', 'twitchgestor-update', 'smbd', 'nmbd', 'tailscaled'];

/** state: app.getState() */
export async function buildReport({ state = {} } = {}) {
  const managed = updates.isManaged();
  const parts = [];
  const section = (title, body) => parts.push(`\n===== ${title} =====\n${String(body ?? '').trim() || '(niente)'}`);

  parts.push(`RAPPORTO TWITCHGESTOR · ${new Date().toLocaleString('it-IT')}`);
  section('Programma', [
    `Versione: ${APP_VERSION} (${(await updates.installedCommit()).slice(0, 7) || '?'})`,
    `Dove gira: ${managed ? 'Raspberry (installato con lo script)' : 'PC'} · ${os.hostname()} · ${os.platform()} ${os.arch()} · Node ${process.version}`,
    `Acceso da: ${ago(process.uptime())} · sistema acceso da: ${ago(os.uptime())}`,
    `Memoria: ${mb(os.freemem())} libera su ${mb(os.totalmem())} · carico: ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`,
  ].join('\n'));

  // spazio sulla scheda SD e cartelle più grandi
  const disk = [];
  try {
    const st = fs.statfsSync(DATA_DIR);
    disk.push(`Spazio libero: ${mb(st.bavail * st.bsize)} su ${mb(st.blocks * st.bsize)}`);
  } catch (err) { disk.push(`Spazio libero: non leggibile (${err.message})`); }
  const du = await run('du', ['-sk', ...['media/music', 'media/overlay', 'media/images', 'media/sounds', 'backups', 'musicante', 'howlup', 'tts', 'piper']
    .map((d) => path.join(DATA_DIR, d)).filter((d) => fs.existsSync(d))], 30000);
  if (du.out) disk.push(...du.out.split('\n').map((l) => { const [k, p] = l.split('\t'); return `  ${path.relative(DATA_DIR, p)}: ${mb(Number(k) * 1024)}`; }));
  section('Disco', disk.join('\n'));

  const tw = state.twitch ?? {};
  const obs = state.obs ?? {};
  section('Collegamenti', [
    `Twitch: ${tw.configured ? 'configurato' : 'NON configurato'} · account: ${tw.user?.login ?? 'nessuno'} · eventi: ${tw.status ?? '?'}`,
    tw.missingScopes?.length ? `  permessi mancanti: ${tw.missingScopes.join(', ')}` : null,
    tw.failedSubscriptions?.length ? `  eventi non attivati: ${JSON.stringify(tw.failedSubscriptions)}` : null,
    `OBS: ${obs.enabled ? obs.status : 'disattivato'}${obs.error ? ` · errore: ${obs.error}` : ''}${obs.enabled ? ` · ${obs.host}:${obs.port} · scene: ${(obs.scenes ?? []).length}` : ''}`,
    `Overlay aperti: ${state.overlays ?? 0} · lettori musica: ${state.musicPages ?? 0}`,
    `Altre fonti: ${Object.entries(state.sources ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  ].filter(Boolean).join('\n'));

  section('Aggiornamenti', JSON.stringify({ ultimo: updates.lastUpdate(), impostazioni: updates.updateSettings(), controllo: await updates.checkForUpdates().catch((e) => ({ errore: e.message })) }, null, 2));

  if (managed) {
    const svc = [];
    for (const s of SERVICES) {
      const r = await run('systemctl', ['show', s, '-p', 'ActiveState,SubState,NRestarts,ActiveEnterTimestamp,Result'], 8000);
      const v = Object.fromEntries(r.out.split('\n').map((l) => l.split('=')).filter((x) => x.length >= 2).map(([k, ...rest]) => [k, rest.join('=')]));
      svc.push(`${s.padEnd(26)} ${v.ActiveState ?? '?'}/${v.SubState ?? '?'}${v.Result && v.Result !== 'success' ? ` · esito: ${v.Result}` : ''}${Number(v.NRestarts) ? ` · riavvii: ${v.NRestarts}` : ''}${v.ActiveEnterTimestamp ? ` · dal ${v.ActiveEnterTimestamp}` : ''}`);
    }
    section('Servizi', svc.join('\n'));

    // le altre app: rispondono?
    const ping = async (port, p = '/') => {
      try { const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(4000) }); return `risponde (${r.status})`; } catch (err) { return `NON risponde (${err.cause?.code ?? err.name})`; }
    };
    section('Altre app', `Howl-UP (3100): ${await ping(3100)}\nMusicante (3200): ${await ping(3200)}`);

    let smb = '';
    try { smb = /# --- TwitchGestor[\s\S]*?# --- fine TwitchGestor ---/.exec(fs.readFileSync('/etc/samba/smb.conf', 'utf8'))?.[0] ?? '(sezione TwitchGestor non trovata in smb.conf)'; } catch (err) { smb = `smb.conf non leggibile (${err.message})`; }
    section('Cartella condivisa', `${JSON.stringify(readJson(path.join(DATA_DIR, 'condivisa-stato.json')), null, 2)}\n${smb}`);
  }

  section('Registro di TwitchGestor (ultime righe)', recentLogs().slice(-150).map((r) => r.line ?? String(r)).join('\n'));
  if (managed) {
    for (const [unit, n] of [['twitchgestor-update', 80], ['howlup', 40], ['musicante', 40], ['smbd', 20]]) {
      // senza le righe di servizio (apertura e chiusura delle sessioni), che coprirebbero quelle utili
      const r = await run('journalctl', ['-u', unit, '-n', String(n * 4), '--no-pager', '-o', 'short-iso'], 15000);
      const lines = r.out.split('\n').filter((l) => !/pam_unix\(|: Deactivated successfully\.|Consumed .* CPU time/.test(l)).slice(-n).join('\n');
      section(`Registro di ${unit}`, r.out && !/No journal files|insufficient permissions/i.test(r.out) ? lines : `non leggibile${r.err ? ` (${r.err.split('\n')[0]})` : ''}`);
    }
  }

  // via password, token e chiavi (quelli del file .env e qualsiasi cosa che ci somigli)
  let envText = '';
  try { envText = fs.readFileSync(path.join(ROOT_DIR, '.env'), 'utf8'); } catch { /* niente .env */ }
  return redact(parts.join('\n'), [...envSecrets(envText), process.env.DASHBOARD_TOKEN].filter(Boolean));
}
