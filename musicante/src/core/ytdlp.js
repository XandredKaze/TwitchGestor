/**
 * Musicante – cosa si chiede a yt-dlp e come si leggono le sue risposte.
 * Non dipende da Node: lo usano il programma sul Raspberry e la demo nel browser.
 */

/** Solo link web normali (niente file del Raspberry o altri protocolli). */
export function cleanUrl(input) {
  const text = String(input ?? '').trim();
  if (!text || text.length > 2000) return '';
  try {
    const u = new URL(text);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

/** Nome della sottocartella della musica (diventa una playlist in TwitchGestor). '' = cartella principale. */
export function cleanFolder(input) {
  return String(input ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\.{2,}/g, ' ') // niente ".." (si resta dentro la cartella della musica)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 60)
    .trim();
}

export const FILE_MARK = 'MUSICANTE_FILE ';
export const PROGRESS_MARK = 'MUSICANTE_PROGRESS ';
export const MAIN_MARK = 'MUSICANTE_MAIN '; // file completo nella cartella di lavoro (Musicante poi lo sposta)

/**
 * Argomenti di yt-dlp per scaricare l'audio in MP3.
 * work: cartella di lavoro (i file finiti li sposta Musicante nella musica, così lì non c'è mai niente a metà);
 * archive: file che ricorda i brani già scaricati (non li riscarica);
 * split: un MP3 per ogni capitolo del video (i minutaggi della descrizione), in work/capitoli.
 */
/**
 * Opzioni per YouTube: jsRuntime = Node.js del Raspberry (yt-dlp lo usa per leggere le pagine di YouTube),
 * cookies = file dei cookie di un account (quando YouTube chiede di confermare che non sei un bot).
 */
export function accessArgs({ jsRuntime = '', cookies = '' } = {}) {
  return [
    // Node.js per i controlli di YouTube; gli script che servono si prendono dal sito di yt-dlp se mancano
    ...(jsRuntime ? ['--js-runtimes', `node:${jsRuntime}`, '--remote-components', 'ejs:github'] : []),
    ...(cookies ? ['--cookies', cookies] : []),
  ];
}

export function downloadArgs({ url, playlist = false, work, archive, split = false, access = {} }) {
  return [
    ...accessArgs(access),
    // --print rende yt-dlp "silenzioso": --progress fa vedere lo stesso l'avanzamento
    '--newline', '--progress', '--color', 'never', '--ignore-config',
    '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-metadata',
    playlist ? '--yes-playlist' : '--no-playlist',
    '--ignore-errors', '--no-overwrites',
    ...(archive ? ['--download-archive', archive] : []),
    '--windows-filenames',
    '-o', `${work}/%(title).150B.%(ext)s`,
    ...(split ? ['--split-chapters', '-o', `chapter:${work}/capitoli/%(section_title).150B.%(ext)s`] : []),
    '--progress-template', `download:${PROGRESS_MARK}%(progress._percent_str)s|%(info.playlist_index)s|%(info.n_entries)s|%(info.title)s`,
    '--print', `after_move:${MAIN_MARK}%(filepath)s`,
    '--', url,
  ];
}

/** Argomenti per l'anteprima: titolo e (per le playlist) l'elenco dei brani, senza scaricare. */
export function probeArgs({ url, playlist = false, access = {} }) {
  return [...accessArgs(access), '--color', 'never', '--ignore-config', '-J', '--flat-playlist', playlist ? '--yes-playlist' : '--no-playlist', '--', url];
}

/** Dalla risposta JSON dell'anteprima a quello che serve alla pagina. */
export function parseProbe(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  const entries = Array.isArray(d?.entries) ? d.entries.filter(Boolean) : null;
  return {
    title: String(d?.title ?? '').slice(0, 200),
    uploader: String(d?.uploader ?? d?.channel ?? '').slice(0, 120),
    isPlaylist: Boolean(entries),
    count: entries ? entries.length : 1,
    duration: entries ? entries.reduce((s, e) => s + (Number(e.duration) || 0), 0) : Number(d?.duration) || 0,
    entries: (entries ?? []).slice(0, 100).map((e) => ({ title: String(e.title ?? e.id ?? '').slice(0, 200), duration: Number(e.duration) || 0 })),
    // capitoli del video (YouTube li crea dai minutaggi nella descrizione)
    chapters: (Array.isArray(d?.chapters) ? d.chapters : []).slice(0, 200).map((c) => ({ title: String(c?.title ?? '').slice(0, 200), start: Number(c?.start_time) || 0, end: Number(c?.end_time) || 0 })),
  };
}

/**
 * Una riga scritta da yt-dlp durante il download.
 * Ritorna { type: 'progress', percent, index, total, title } | { type: 'file', path } | { type: 'skip' } (già scaricato)
 *   | { type: 'main', path } (file completo, nella cartella di lavoro) | { type: 'chapter', path } (un capitolo)
 *   | { type: 'error', text } | null
 */
export function parseLine(raw) {
  const line = String(raw ?? '').trim();
  if (!line) return null;
  if (line.startsWith(PROGRESS_MARK)) {
    const [pct, index, total, ...title] = line.slice(PROGRESS_MARK.length).split('|');
    const n = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : null);
    const percent = Number.parseFloat(String(pct).replace('%', ''));
    return { type: 'progress', percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : null, index: n(index), total: n(total), title: title.join('|').trim() === 'NA' ? '' : title.join('|').trim() };
  }
  if (line.startsWith(FILE_MARK)) return { type: 'file', path: line.slice(FILE_MARK.length).trim() };
  if (line.startsWith(MAIN_MARK)) return { type: 'main', path: line.slice(MAIN_MARK.length).trim() };
  const ch = /^\[SplitChapters\] Chapter \d+; Destination: (.+)$/.exec(line);
  if (ch) return { type: 'chapter', path: ch[1].trim() };
  if (/has already been recorded in the archive|has already been downloaded/i.test(line)) return { type: 'skip' };
  if (/^ERROR:/.test(line)) return { type: 'error', text: friendlyError(line.replace(/^ERROR:\s*/, '')) };
  return null;
}

/** Gli errori più comuni di yt-dlp, spiegati. */
export function friendlyError(text) {
  const t = String(text ?? '');
  if (/Unsupported URL/i.test(t)) return 'Questo link non è supportato';
  if (/Private video|private/i.test(t) && /video/i.test(t)) return 'Il video è privato';
  if (/Video unavailable|This video is not available|removed/i.test(t)) return 'Il video non è disponibile';
  if (/Sign in to confirm your age|age-restricted/i.test(t)) return 'Il video è vietato ai minori: non si può scaricare senza accesso';
  if (/Sign in to confirm you.?re not a bot/i.test(t)) return 'YouTube chiede di confermare che non sei un bot: carica i cookie di YouTube (riquadro "Accesso a YouTube" qui sotto)';
  if (/ffmpeg|ffprobe/i.test(t) && /not found|not installed/i.test(t)) return 'Manca ffmpeg sul Raspberry (si installa da solo al prossimo aggiornamento)';
  if (/HTTP Error 429|Too Many Requests/i.test(t)) return 'Troppe richieste: riprova tra un po\'';
  if (/Unable to download webpage|Failed to resolve|Network is unreachable|timed out/i.test(t)) return 'Il Raspberry non riesce a raggiungere il sito: controlla internet';
  return t.replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, '').slice(0, 300);
}

/** "3:25" / "1:02:03" */
export function formatDuration(sec) {
  const s = Math.round(Number(sec) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
