// Demo di Musicante: risponde al posto del Raspberry con la stessa coda dei download (src/core),
// ma i download sono finti (non si scarica niente) e i dati restano solo in questa pagina.
import { Downloads } from '../src/core/downloads.js';
import { cleanUrl, cleanFolder, PROGRESS_MARK, FILE_MARK } from '../src/core/ytdlp.js';

let rev = Date.now();
const folders = ['Lo-fi', 'Pausa', 'Sigle'];
const isList = (u) => /[?&]list=|\/playlist|\/sets\/|\/album\//i.test(u);
const SONGS = ['Notte in città', 'Caffè e pioggia', 'Lupo solitario', 'Luci al neon', 'Strada di casa', 'Ultimo livello'];
const songsFor = (url, playlist) => (playlist && isList(url) ? SONGS : [SONGS[url.length % SONGS.length]]);

const downloads = new Downloads({
  onChange: () => { rev = Date.now(); },
  // download finto: avanza a scatti e "salva" i brani
  run: (job, { onLine, signal }) => new Promise((resolve) => {
    const songs = songsFor(job.url, job.playlist);
    let i = 0;
    let p = 0;
    const timer = setInterval(() => {
      if (signal.aborted) { clearInterval(timer); resolve(130); return; }
      p += 20 + Math.random() * 25;
      if (p >= 100) {
        onLine(`${PROGRESS_MARK}100%|${songs.length > 1 ? i + 1 : 'NA'}|${songs.length > 1 ? songs.length : 'NA'}|${songs[i]}`);
        onLine(`${FILE_MARK}/music/${job.folder}/${songs[i]}.mp3`);
        i += 1;
        p = 0;
        if (i >= songs.length) { clearInterval(timer); if (job.folder && !folders.includes(job.folder)) folders.push(job.folder); resolve(0); }
        return;
      }
      onLine(`${PROGRESS_MARK}${p.toFixed(1)}%|${songs.length > 1 ? i + 1 : 'NA'}|${songs.length > 1 ? songs.length : 'NA'}|${songs[i]}`);
    }, 450);
  }),
});

const tool = { ytdlp: '2026.10.22', ffmpeg: true, busy: '', error: '', updatedAt: Date.now() };
const view = () => ({ rev, tool, folders: [...folders].sort((a, b) => a.localeCompare(b, 'it')), jobs: downloads.list().map((j) => ({ ...j, overall: Math.round(Downloads.overall(j)) })) });
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const i = url.pathname.indexOf('/api/');
  if (i < 0) return realFetch(input, init);
  const path = url.pathname.slice(i);
  const method = (init.method || 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : {};
  await new Promise((r) => setTimeout(r, 120));
  try {
    if (path === '/api/state') return url.searchParams.get('rev') === String(rev) ? json(200, { rev, unchanged: true }) : json(200, view());
    if (path === '/api/probe') {
      const u = cleanUrl(body.url);
      if (!u) return json(400, { error: 'Incolla un link valido (https://…)' });
      const songs = songsFor(u, body.playlist);
      await new Promise((r) => setTimeout(r, 700));
      return json(200, { info: songs.length > 1
        ? { title: 'Lo-fi per le live (demo)', uploader: 'Canale di esempio', isPlaylist: true, count: songs.length, duration: songs.length * 185, entries: songs.map((t, k) => ({ title: t, duration: 160 + k * 11 })) }
        : { title: songs[0], uploader: 'Canale di esempio', isPlaylist: false, count: 1, duration: 203, entries: [] } });
    }
    if (method === 'POST' && path === '/api/downloads') { const job = downloads.add({ ...body, folder: cleanFolder(body.folder) }); return json(200, { job, ...view() }); }
    if (method === 'POST' && path === '/api/downloads/clear') { downloads.clearFinished(); return json(200, view()); }
    const m = /^\/api\/downloads\/([\w-]+)(\/cancel)?$/.exec(path);
    if (m && method === 'POST' && m[2]) { downloads.cancel(m[1]); return json(200, view()); }
    if (m && method === 'DELETE') { downloads.remove(m[1]); return json(200, view()); }
    if (path === '/api/tool/update') { await new Promise((r) => setTimeout(r, 800)); tool.updatedAt = Date.now(); rev = Date.now(); return json(200, view()); }
    return json(404, { error: 'Non trovato' });
  } catch (err) {
    return json(err.status ?? 500, { error: err.message });
  }
};
