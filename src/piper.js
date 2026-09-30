import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createLogger } from './logger.js';

const log = createLogger('piper');

/**
 * Voci naturali Piper (https://github.com/rhasspy/piper, open source, funzionano senza Internet).
 * Il programma e le voci si scaricano una volta dalla dashboard in data/piper/.
 * Chi preferisce può anche copiare a mano altre voci (.onnx + .onnx.json) in data/piper/voices/.
 */
const RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/';
const ARCHIVES = {
  win32: 'piper_windows_amd64.zip',
  linux: 'piper_linux_x86_64.tar.gz',
  darwin: 'piper_macos_x64.tar.gz',
};
const VOICES_URL = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/';
export const PIPER_VOICES = {
  paola: { label: 'Paola (italiano, voce femminile)', path: 'it/it_IT/paola/medium/it_IT-paola-medium', size: '63 MB' },
  riccardo: { label: 'Riccardo (italiano, voce maschile)', path: 'it/it_IT/riccardo/x_low/it_IT-riccardo-x_low', size: '28 MB' },
};

function findFile(dir, name, depth = 3) {
  if (depth < 0 || !fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return p;
    if (entry.isDirectory()) {
      const found = findFile(p, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

async function download(url, file) {
  const host = new URL(url).host;
  const tmp = `${file}.part`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`il sito ${host} ha risposto con errore ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(`${err.message} ${err.cause?.code ?? ''}`)) {
      throw new Error(`impossibile collegarsi a ${host}: controlla la connessione a Internet (o firewall/antivirus) e riprova`);
    }
    throw err;
  }
}

function extract(archive, dir) {
  // tar è incluso in Windows 10/11 e sa aprire anche i file .zip
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xf', archive, '-C', dir], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`estrazione non riuscita: ${err.trim() || code}`))));
  });
}

export class PiperManager {
  constructor({ dir, platform = process.platform, releaseUrl = RELEASE, voicesUrl = VOICES_URL }) {
    this.dir = dir;
    this.releaseUrl = releaseUrl;
    this.voicesUrl = voicesUrl;
    this.voicesDir = path.join(dir, 'voices');
    this.platform = platform;
    this.job = null; // download in corso: { voice, step, error, done }
    const manager = this;
    this.engine = {
      name: 'piper',
      group: 'Piper (voci naturali)',
      ready: () => Boolean(manager.exe()) && manager.models().length > 0,
      voices: async () => (manager.exe() ? manager.models().map((m) => ({ name: m.name, lang: m.lang, label: m.label })) : []),
      speak: (text, file, opts) => manager.speak(text, file, opts),
    };
  }

  get supported() {
    return Boolean(ARCHIVES[this.platform]);
  }

  exe() {
    return findFile(this.dir, this.platform === 'win32' ? 'piper.exe' : 'piper');
  }

  /** Voci presenti in data/piper/voices (file .onnx con il suo .onnx.json). */
  models() {
    if (!fs.existsSync(this.voicesDir)) return [];
    return fs.readdirSync(this.voicesDir)
      .filter((f) => f.endsWith('.onnx') && fs.existsSync(path.join(this.voicesDir, `${f}.json`)))
      .map((f) => {
        const name = f.replace(/\.onnx$/, '');
        const known = Object.values(PIPER_VOICES).find((v) => v.path.endsWith(name));
        let lang = '';
        try {
          lang = JSON.parse(fs.readFileSync(path.join(this.voicesDir, `${f}.json`), 'utf8')).language?.code ?? '';
        } catch { /* file della voce senza lingua */ }
        return { name, lang, label: known ? known.label.split(' (')[0] : name, file: path.join(this.voicesDir, f) };
      });
  }

  status() {
    const installed = new Set(this.models().map((m) => m.name));
    return {
      supported: this.supported,
      program: Boolean(this.exe()),
      voices: Object.entries(PIPER_VOICES).map(([key, v]) => ({
        key, label: v.label, size: v.size, installed: installed.has(v.path.split('/').pop()),
      })),
      job: this.job,
    };
  }

  /** Scarica (se mancano) il programma Piper e la voce scelta. Parte in background. */
  install(key, { onDone } = {}) {
    const voice = PIPER_VOICES[key];
    if (!voice) throw Object.assign(new Error('Voce sconosciuta'), { status: 400 });
    if (!this.supported) throw Object.assign(new Error('Piper non è disponibile per questo sistema'), { status: 400 });
    if (this.job && !this.job.done) throw Object.assign(new Error('Un download è già in corso'), { status: 409 });
    this.job = { voice: key, step: 'Preparazione…', error: null, done: false };
    const step = (text) => { this.job.step = text; log.info(text); };
    (async () => {
      fs.mkdirSync(this.voicesDir, { recursive: true });
      if (!this.exe()) {
        const archive = path.join(this.dir, ARCHIVES[this.platform]);
        step('Scarico il programma Piper (circa 20 MB)…');
        await download(this.releaseUrl + ARCHIVES[this.platform], archive);
        step('Estraggo il programma Piper…');
        await extract(archive, this.dir);
        fs.rmSync(archive, { force: true });
        const exe = this.exe();
        if (!exe) throw new Error('programma Piper non trovato dopo l\'estrazione');
        if (this.platform !== 'win32') fs.chmodSync(exe, 0o755);
      }
      const base = voice.path.split('/').pop();
      step(`Scarico la voce ${voice.label.split(' (')[0]} (${voice.size})…`);
      await download(`${this.voicesUrl}${voice.path}.onnx.json`, path.join(this.voicesDir, `${base}.onnx.json`));
      await download(`${this.voicesUrl}${voice.path}.onnx`, path.join(this.voicesDir, `${base}.onnx`));
      step(`Voce ${voice.label.split(' (')[0]} pronta`);
      this.job.done = true;
      onDone?.();
    })().catch((err) => {
      log.error(`Installazione di Piper non riuscita: ${err.message}`);
      this.job = { ...this.job, error: err.message, done: true };
    });
    return this.status();
  }

  speak(text, file, { voice, rate }) {
    const exe = this.exe();
    const model = this.models().find((m) => m.name === voice) ?? this.models()[0];
    if (!exe || !model) return Promise.reject(new Error('Piper non è installato'));
    const f = Math.max(-10, Math.min(10, Number(rate) || 0));
    const lengthScale = 1 / (f >= 0 ? 1 + f * 0.2 : 1 + f * 0.05);
    return new Promise((resolve, reject) => {
      const child = spawn(exe, ['--model', model.file, '--output_file', file, '--length_scale', lengthScale.toFixed(2)], {
        cwd: path.dirname(exe), windowsHide: true,
      });
      let err = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Tempo scaduto')); }, 30000);
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(file)) resolve();
        else reject(new Error(err.trim().split('\n').pop() || `Piper uscito con codice ${code}`));
      });
      child.stdin.on('error', () => {});
      child.stdin.end(`${text.replace(/\s+/g, ' ')}\n`);
    });
  }
}
