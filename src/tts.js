import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createLogger } from './logger.js';

export { cleanText } from './core/ttsText.js';

const log = createLogger('voce');

/**
 * Text-to-speech gratuito e locale.
 * - Windows: voci installate nel sistema (System.Speech, es. "Microsoft Elsa" in italiano).
 * - Linux: espeak-ng, se installato.
 * Il testo passa al programma esterno tramite variabili d'ambiente o stdin, mai dentro il comando.
 * Se nessun motore è disponibile, l'overlay usa la voce del browser (non funziona dentro OBS).
 */

const SAPI_SPEAK = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($env:TG_TTS_VOICE) { try { $s.SelectVoice($env:TG_TTS_VOICE) } catch {} }
$s.Rate = [int]$env:TG_TTS_RATE
$s.Volume = [int]$env:TG_TTS_VOLUME
$s.SetOutputToWaveFile($env:TG_TTS_OUT)
$s.Speak($env:TG_TTS_TEXT)
$s.Dispose()
`;

const SAPI_VOICES = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }
`;

function run(cmd, args, { env, input, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Tempo scaduto')); }, timeout);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').pop() || `uscito con codice ${code}`));
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

export const engines = {
  windows: {
    name: 'windows',
    label: 'Voci di Windows',
    async voices() {
      const out = await run('powershell.exe', [...POWERSHELL, SAPI_VOICES]);
      return out.split(/\r?\n/).filter(Boolean).map((line) => {
        const [name, lang] = line.split('|');
        return { name: name.trim(), lang: (lang || '').trim() };
      });
    },
    async speak(text, file, { voice = '', rate = 0, volume = 100 }) {
      await run('powershell.exe', [...POWERSHELL, SAPI_SPEAK], {
        env: { TG_TTS_TEXT: text, TG_TTS_VOICE: voice, TG_TTS_RATE: String(rate), TG_TTS_VOLUME: String(volume), TG_TTS_OUT: file },
      });
    },
  },
  espeak: {
    name: 'espeak',
    label: 'espeak-ng',
    async voices() {
      return [{ name: 'it', lang: 'it' }, { name: 'en', lang: 'en' }, { name: 'es', lang: 'es' }, { name: 'de', lang: 'de' }, { name: 'fr', lang: 'fr' }];
    },
    async speak(text, file, { voice = '', rate = 0, volume = 100 }) {
      const speed = Math.round(175 + rate * 12);
      await run('espeak-ng', ['-v', voice || 'it', '-s', String(speed), '-a', String(Math.round(volume * 2)), '-w', file, '--stdin'], { input: text });
    },
  },
};

export function detectEngine() {
  if (process.platform === 'win32') return engines.windows;
  const probe = spawnSync('espeak-ng', ['--version'], { stdio: 'ignore' });
  return probe.status === 0 ? engines.espeak : null;
}

/** Durata in secondi di un file WAV (dall'intestazione). */
export function wavDuration(file) {
  try {
    const buf = fs.readFileSync(file);
    const byteRate = buf.readUInt32LE(28);
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const id = buf.toString('ascii', offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      if (id === 'data') return byteRate ? Math.min(size, buf.length - offset - 8) / byteRate : 0;
      offset += 8 + size;
    }
  } catch { /* file non leggibile */ }
  return 0;
}

export class TtsService {
  constructor({ dir, engine = detectEngine() }) {
    this.dir = dir;
    this.engine = engine;
    this.voicesCache = null;
    if (engine) log.info(`Text-to-speech disponibile: ${engine.label}`);
    else log.info('Text-to-speech: nessuna voce di sistema trovata, si userà la voce del browser (non funziona dentro OBS)');
  }

  async voices() {
    if (!this.engine) return [];
    if (!this.voicesCache) {
      this.voicesCache = await this.engine.voices().catch((err) => {
        log.warn(`Impossibile leggere le voci: ${err.message}`);
        return [];
      });
    }
    return this.voicesCache;
  }

  /** Crea il file audio e ritorna { url, duration } oppure null se non c'è un motore. */
  async synthesize(text, options = {}) {
    if (!this.engine || !text) return null;
    fs.mkdirSync(this.dir, { recursive: true });
    this.#cleanup();
    const name = `${randomUUID()}.wav`;
    const file = path.join(this.dir, name);
    await this.engine.speak(text, file, {
      voice: options.voice ?? '',
      rate: Math.max(-10, Math.min(10, Math.round(Number(options.rate) || 0))),
      volume: Math.max(0, Math.min(100, Math.round(Number(options.volume ?? 100)))),
    });
    return { url: `/tts/${name}`, duration: wavDuration(file) };
  }

  /** Cancella i file audio più vecchi di un'ora. */
  #cleanup() {
    const limit = Date.now() - 3600 * 1000;
    for (const f of fs.readdirSync(this.dir)) {
      const p = path.join(this.dir, f);
      try {
        if (fs.statSync(p).mtimeMs < limit) fs.rmSync(p);
      } catch { /* già rimosso */ }
    }
  }
}
