/**
 * Musicante – la coda dei download: uno alla volta, nell'ordine in cui li aggiungi.
 * Non dipende da Node: lo usano il programma sul Raspberry e la demo nel browser.
 *
 * Chi usa questo modulo fornisce:
 *   run(job, { onLine, signal })  avvia yt-dlp e ritorna una Promise con il codice di uscita
 *   store                         { load(), save(list) } per ricordare gli ultimi download
 */

import { parseLine, cleanUrl, cleanFolder } from './ytdlp.js';

let counter = 0;
const newId = () => `d${Date.now().toString(36)}${(counter++).toString(36)}`;
const KEEP = 40; // download ricordati nell'elenco

export class Downloads {
  constructor({ run, store, onChange, now = () => Date.now(), log = () => {} } = {}) {
    Object.assign(this, { run, store, onChange, now, log });
    this.jobs = [];
    try { this.jobs = (store?.load?.() ?? []).filter((j) => j && j.id); } catch { /* prima volta */ }
    // download rimasti a metà (programma riavviato): si segnano come interrotti
    for (const j of this.jobs) if (j.status === 'running' || j.status === 'queued') Object.assign(j, { status: 'error', errors: [...(j.errors ?? []), 'Interrotto: Musicante è stato riavviato'], endedAt: this.now() });
    this.current = null;
  }

  list() { return this.jobs; }

  add({ url, playlist = false, folder = '', title = '', count = 0 } = {}) {
    const u = cleanUrl(url);
    if (!u) throw Object.assign(new Error('Incolla un link valido (https://…)'), { status: 400 });
    const job = {
      id: newId(), url: u, playlist: playlist === true, folder: cleanFolder(folder), title: String(title ?? '').slice(0, 200), count: Number(count) || 0,
      status: 'queued', percent: 0, index: null, total: null, current: '', files: [], skipped: 0, errors: [], createdAt: this.now(), startedAt: null, endedAt: null,
    };
    this.jobs = [job, ...this.jobs].slice(0, KEEP);
    this.#changed();
    this.#pump();
    return job;
  }

  cancel(id) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return false;
    if (j.status === 'queued') { Object.assign(j, { status: 'cancelled', endedAt: this.now() }); this.#changed(); return true; }
    if (j.status === 'running' && this.current?.job === j) { this.current.abort.abort(); return true; }
    return false;
  }

  /** Toglie dall'elenco un download finito (i file restano nella cartella). */
  remove(id) {
    const n = this.jobs.length;
    this.jobs = this.jobs.filter((j) => j.id !== id || j.status === 'running' || j.status === 'queued');
    if (this.jobs.length !== n) this.#changed();
    return this.jobs.length !== n;
  }

  clearFinished() {
    this.jobs = this.jobs.filter((j) => j.status === 'running' || j.status === 'queued');
    this.#changed();
  }

  /** Percentuale complessiva (per le playlist conta anche i brani già fatti). */
  static overall(j) {
    if (j.status === 'done') return 100;
    if (!j.total) return j.percent ?? 0;
    return Math.min(100, ((Math.max(1, j.index ?? 1) - 1) + (j.percent ?? 0) / 100) / j.total * 100);
  }

  async #pump() {
    if (this.current) return;
    const job = [...this.jobs].reverse().find((j) => j.status === 'queued'); // il più vecchio in attesa
    if (!job) return;
    const abort = new AbortController();
    this.current = { job, abort };
    Object.assign(job, { status: 'running', startedAt: this.now() });
    this.#changed();
    let code = 1;
    let lastSave = 0;
    try {
      code = await this.run(job, {
        signal: abort.signal,
        onLine: (raw) => {
          const r = parseLine(raw);
          if (!r) return;
          if (r.type === 'progress') {
            if (r.percent !== null) job.percent = r.percent;
            if (r.index) job.index = r.index;
            if (r.total) job.total = r.total;
            if (r.title) job.current = r.title;
          } else if (r.type === 'file') {
            job.files.push(r.path.split(/[\\/]/).pop());
          } else if (r.type === 'skip') {
            job.skipped += 1;
          } else if (r.type === 'error') {
            if (!job.errors.includes(r.text)) job.errors = [...job.errors, r.text].slice(-20);
          }
          // durante il download si avvisa la pagina spesso, ma si salva su disco al massimo ogni 5 secondi
          const t = this.now();
          this.#changed(t - lastSave > 5000);
          if (t - lastSave > 5000) lastSave = t;
        },
      });
    } catch (err) {
      if (!abort.signal.aborted) job.errors = [...job.errors, err.message];
    }
    job.endedAt = this.now();
    if (abort.signal.aborted) job.status = 'cancelled';
    else if (job.files.length || job.skipped || code === 0) job.status = 'done';
    else {
      job.status = 'error';
      if (!job.errors.length) job.errors = [`yt-dlp si è fermato (codice ${code})`];
    }
    job.current = '';
    this.current = null;
    this.log(`Download ${job.status}: ${job.title || job.url} (${job.files.length} file)`);
    this.#changed();
    this.#pump();
  }

  #changed(save = true) {
    if (save) { try { this.store?.save?.(this.jobs); } catch { /* non importante */ } }
    this.onChange?.();
  }
}
