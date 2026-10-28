/**
 * yt-dlp sul Raspberry: Musicante lo scarica da solo (versione ufficiale per Linux, dal sito di yt-dlp su GitHub)
 * in data/musicante/bin e lo tiene aggiornato una volta al giorno. Per convertire in MP3 serve ffmpeg,
 * che installa il servizio di aggiornamento di TwitchGestor (scripts/raspberry/system-setup.sh).
 * MUSICANTE_YTDLP: percorso di un yt-dlp già installato (usato anche dai test).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { probeArgs, parseProbe, downloadArgs, friendlyError, parseLine, FILE_MARK } from './core/ytdlp.js';

const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

export function createTool({ dataDir, binPath = process.env.MUSICANTE_YTDLP, log = () => {}, fetchFn = fetch } = {}) {
  const own = !binPath; // scaricato da Musicante (si può aggiornare da solo)
  const bin = binPath || path.join(dataDir, 'bin', 'yt-dlp');
  const archive = path.join(dataDir, 'archivio.txt');
  // cookie di YouTube (caricati dalla pagina) e Node.js per i controlli JavaScript di YouTube
  const cookiesFile = path.join(dataDir, 'cookies.txt');
  const access = () => ({ jsRuntime: process.execPath, cookies: fs.existsSync(cookiesFile) ? cookiesFile : '' });
  // cartella di lavoro: yt-dlp scarica e converte qui; nella musica arrivano solo gli MP3 finiti
  const workRoot = path.join(dataDir, 'lavoro');
  try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch { /* pezzi di download interrotti (riavvio) */ }

  /** Sposta un file finito nella musica, senza mai sovrascriverne uno con lo stesso nome. */
  function moveInto(file, dir) {
    const ext = path.extname(file);
    const base = path.basename(file, ext);
    fs.mkdirSync(dir, { recursive: true });
    let dest = path.join(dir, `${base}${ext}`);
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${base} (${n})${ext}`);
    try { fs.renameSync(file, dest); } catch { fs.copyFileSync(file, dest); fs.rmSync(file, { force: true }); }
    return dest;
  }
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
      return parseProbe(await exec(bin, probeArgs({ url, playlist, access: access() }), 90000));
    } catch (err) {
      throw Object.assign(new Error(friendlyError(err.message.replace(/^ERROR:\s*/, ''))), { status: 422 });
    }
  }

  /**
   * Avvia il download: ogni riga scritta da yt-dlp va a onLine; ritorna il codice di uscita.
   * I file completi passano dalla cartella di lavoro alla musica (dir) solo quando yt-dlp ha finito con loro;
   * con i capitoli si spostano i capitoli e il file intero si butta (se il video non ha capitoli si tiene quello).
   */
  function run(job, { onLine, signal, dir }) {
    return new Promise((resolve, reject) => {
      if (!state.ytdlp) { reject(new Error('yt-dlp non è pronto')); return; }
      // dir: cartella fissa, oppure funzione (file) => cartella (download "per artista")
      const dirFor = typeof dir === 'function' ? dir : () => dir;
      if (typeof dir !== 'function') fs.mkdirSync(dir, { recursive: true });
      const work = path.join(workRoot, job.id);
      fs.mkdirSync(work, { recursive: true });
      const audio = (d) => { try { return fs.readdirSync(d).filter((f) => /\.(mp3|m4a|opus|ogg|webm|flac|wav)$/i.test(f) && !/\.(part|ytdl|temp)\./i.test(f)).map((f) => path.join(d, f)); } catch { return []; } };
      const chapDir = path.join(work, 'capitoli');
      let moved = 0;
      // un file finito: con i capitoli si spostano i capitoli (dalla loro cartella) e il file intero si butta
      const finish = (main) => {
        try {
          const chapters = job.split ? audio(chapDir) : [];
          if (chapters.length) {
            for (const c of chapters) { onLine(`${FILE_MARK}${moveInto(c, dirFor(c))}`); moved += 1; }
            if (main) fs.rmSync(main, { force: true });
          } else if (main && fs.existsSync(main)) {
            onLine(`${FILE_MARK}${moveInto(main, dirFor(main))}`);
            moved += 1;
          }
        } catch (err) {
          onLine(`ERROR: file non spostato nella musica (${err.message})`);
        }
      };
      const handle = (l) => {
        const r = parseLine(l);
        if (r?.type === 'chapter') return;
        if (r?.type === 'main') { finish(r.path); return; }
        onLine(l);
      };
      // i capitoli o "Scarica di nuovo" non guardano l'archivio dei già scaricati
      const child = spawn(bin, downloadArgs({ url: job.url, playlist: job.playlist, split: job.split, work, archive: job.split || job.force ? null : archive, access: access() }), { signal, stdio: ['ignore', 'pipe', 'pipe'] });
      const lines = (stream) => {
        let buf = '';
        stream.setEncoding('utf8');
        stream.on('data', (d) => {
          buf += d;
          const parts = buf.split(/\r?\n|\r/);
          buf = parts.pop();
          for (const l of parts) handle(l);
        });
        stream.on('end', () => { if (buf) handle(buf); });
      };
      lines(child.stdout);
      lines(child.stderr);
      const cleanup = () => { try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* niente */ } };
      child.on('error', (err) => { cleanup(); if (err.name === 'AbortError') resolve(130); else reject(err); });
      // finito o annullato: quello che è rimasto nella cartella di lavoro è incompleto e si butta
      child.on('close', (code) => {
        // rete di sicurezza: file completi rimasti nella cartella di lavoro (se yt-dlp non li ha segnalati)
        if (!signal?.aborted && code === 0) {
          if (job.split && audio(chapDir).length) finish(audio(work)[0] ?? null);
          else for (const f of audio(work)) finish(f);
        }
        cleanup();
        resolve(code ?? 130);
      });
    });
  }

  /** Cookie di YouTube in formato Netscape (cookies.txt, da un'estensione del browser). */
  function setCookies(text) {
    const t = String(text ?? '');
    if (!t.trim()) { fs.rmSync(cookiesFile, { force: true }); return false; }
    if (!/\t/.test(t) || !/youtube\.com|google\.com/i.test(t)) throw Object.assign(new Error('Non sembra un file cookies.txt di YouTube (formato Netscape)'), { status: 400 });
    fs.writeFileSync(cookiesFile, t.startsWith('# ') ? t : `# Netscape HTTP Cookie File\n${t}`, { mode: 0o600 });
    return true;
  }

  return { get state() { return { ...state, cookies: fs.existsSync(cookiesFile) }; }, ensure, update, probe, run, setCookies };
}
