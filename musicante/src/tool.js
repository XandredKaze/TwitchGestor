/**
 * yt-dlp sul Raspberry: Musicante lo scarica da solo (versione ufficiale per Linux, dal sito di yt-dlp su GitHub)
 * in data/musicante/bin e lo tiene aggiornato una volta al giorno. Per convertire in MP3 serve ffmpeg,
 * che installa il servizio di aggiornamento di TwitchGestor (scripts/raspberry/system-setup.sh).
 * MUSICANTE_YTDLP: percorso di un yt-dlp già installato (usato anche dai test).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { probeArgs, parseProbe, downloadArgs, friendlyError } from './core/ytdlp.js';

const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

export function createTool({ dataDir, binPath = process.env.MUSICANTE_YTDLP, log = () => {}, fetchFn = fetch } = {}) {
  const own = !binPath; // scaricato da Musicante (si può aggiornare da solo)
  const bin = binPath || path.join(dataDir, 'bin', 'yt-dlp');
  const archive = path.join(dataDir, 'archivio.txt');
  let state = { ytdlp: '', ffmpeg: false, busy: '', error: '', updatedAt: 0 };

  const exec = (file, args, timeout = 30000) => new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error((stderr || err.message).trim().split('\n').filter((l) => l.startsWith('ERROR')).pop() || (stderr || err.message).trim().split('\n').pop()), { code: err.code }));
      else resolve(stdout);
    });
  });

  async function version() {
    try { return (await exec(bin, ['--version'], 20000)).trim(); } catch { return ''; }
  }

  async function hasFfmpeg() {
    try { await exec('ffmpeg', ['-version'], 10000); return true; } catch { return false; }
  }

  /** Scarica yt-dlp se manca (prima volta) e controlla ffmpeg. */
  async function ensure() {
    state.ffmpeg = await hasFfmpeg();
    state.ytdlp = await version();
    if (state.ytdlp || !own) { if (!state.ytdlp) state.error = 'yt-dlp non trovato'; return state; }
    state.busy = 'Scarico yt-dlp…';
    try {
      fs.mkdirSync(path.dirname(bin), { recursive: true });
      const res = await fetchFn(RELEASE_URL, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`GitHub ha risposto ${res.status}`);
      const tmp = `${bin}.tmp`;
      fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
      fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, bin);
      state.ytdlp = await version();
      state.error = state.ytdlp ? '' : 'yt-dlp scaricato ma non parte (serve python3 sul Raspberry)';
      log(`yt-dlp pronto: ${state.ytdlp}`);
    } catch (err) {
      state.error = `yt-dlp non scaricato: ${err.message}`;
      log(state.error);
    }
    state.busy = '';
    return state;
  }

  /** Aggiorna yt-dlp (i siti cambiano spesso: le versioni nuove li seguono). */
  async function update() {
    if (!own) return state;
    if (!state.ytdlp) return ensure();
    state.busy = 'Aggiorno yt-dlp…';
    try {
      await exec(bin, ['-U'], 180000);
      state.ytdlp = await version();
      state.updatedAt = Date.now();
      state.error = '';
    } catch (err) {
      state.error = `Aggiornamento di yt-dlp non riuscito: ${err.message}`;
    }
    state.busy = '';
    return state;
  }

  async function probe({ url, playlist }) {
    if (!state.ytdlp) throw Object.assign(new Error('yt-dlp non è ancora pronto: riprova tra poco'), { status: 503 });
    try {
      return parseProbe(await exec(bin, probeArgs({ url, playlist }), 90000));
    } catch (err) {
      throw Object.assign(new Error(friendlyError(err.message.replace(/^ERROR:\s*/, ''))), { status: 422 });
    }
  }

  /** Avvia il download: ogni riga scritta da yt-dlp va a onLine; ritorna il codice di uscita. */
  function run(job, { onLine, signal, dir }) {
    return new Promise((resolve, reject) => {
      if (!state.ytdlp) { reject(new Error('yt-dlp non è pronto')); return; }
      fs.mkdirSync(dir, { recursive: true });
      const child = spawn(bin, downloadArgs({ url: job.url, playlist: job.playlist, dir, archive }), { signal, stdio: ['ignore', 'pipe', 'pipe'] });
      const lines = (stream) => {
        let buf = '';
        stream.setEncoding('utf8');
        stream.on('data', (d) => {
          buf += d;
          const parts = buf.split(/\r?\n|\r/);
          buf = parts.pop();
          for (const l of parts) onLine(l);
        });
        stream.on('end', () => { if (buf) onLine(buf); });
      };
      lines(child.stdout);
      lines(child.stderr);
      child.on('error', (err) => { if (err.name === 'AbortError') resolve(130); else reject(err); });
      child.on('close', (code) => {
        // download annullato: si tolgono i pezzi a metà
        if (signal?.aborted) {
          try { for (const f of fs.readdirSync(dir)) if (/\.(part|ytdl)$|\.part-Frag\d+/.test(f)) fs.rmSync(path.join(dir, f), { force: true }); } catch { /* niente */ }
        }
        resolve(code ?? 130);
      });
    });
  }

  return { get state() { return state; }, ensure, update, probe, run };
}
