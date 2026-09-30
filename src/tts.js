import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createLogger } from './logger.js';
import { PiperManager } from './piper.js';

export { cleanText } from './core/ttsText.js';

const log = createLogger('voce');

/**
 * Text-to-speech gratuito e locale, con più "motori":
 * - sapi:    voci classiche di Windows (System.Speech, es. "Microsoft Elsa Desktop")
 * - onecore: voci moderne di Windows (es. "Microsoft Cosimo", quelle aggiunte dalle Impostazioni)
 * - piper:   voci naturali Piper (scaricate dalla dashboard, funzionano senza Internet)
 * - espeak:  espeak-ng su Linux
 * Ogni voce ha un id "motore:nome". Il testo passa ai programmi esterni tramite variabili
 * d'ambiente o stdin, mai dentro il comando. Il volume si applica quando l'overlay suona l'audio.
 */

export function run(cmd, args, { env, input, timeout = 20000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true, cwd });
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
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

/** Velocità: da -10..10 a un moltiplicatore (0,5 = lento, 1 = normale, 3 = veloce). */
export function speedFactor(rate) {
  const r = Math.max(-10, Math.min(10, Number(rate) || 0));
  return r >= 0 ? 1 + r * 0.2 : 1 + r * 0.05;
}

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

const SAPI_VOICES = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }
`;
const SAPI_SPEAK = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($env:TG_TTS_VOICE) { try { $s.SelectVoice($env:TG_TTS_VOICE) } catch {} }
$s.Rate = [int]$env:TG_TTS_RATE
$s.SetOutputToWaveFile($env:TG_TTS_OUT)
$s.Speak($env:TG_TTS_TEXT)
$s.Dispose()
`;

// Voci moderne di Windows (Windows.Media.SpeechSynthesis) usate da PowerShell tramite WinRT.
const ONECORE_SETUP = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
`;
const ONECORE_VOICES = `${ONECORE_SETUP}
[Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object { $_.DisplayName + '|' + $_.Language }
`;
const ONECORE_SPEAK = `${ONECORE_SETUP}
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq $env:TG_TTS_VOICE } | Select-Object -First 1
if ($voice) { $synth.Voice = $voice }
try { $synth.Options.SpeakingRate = [double]::Parse($env:TG_TTS_SPEED, [Globalization.CultureInfo]::InvariantCulture) } catch {}
$op = $synth.SynthesizeTextToStreamAsync($env:TG_TTS_TEXT)
$task = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]).Invoke($null, @($op))
$task.Wait(-1) | Out-Null
$stream = $task.Result
$reader = New-Object System.IO.BinaryReader([System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream))
[System.IO.File]::WriteAllBytes($env:TG_TTS_OUT, $reader.ReadBytes([int]$stream.Size))
`;

const parseVoiceLines = (out) => out.split(/\r?\n/).filter(Boolean).map((line) => {
  const [name, lang] = line.split('|');
  return { name: name.trim(), lang: (lang || '').trim() };
});

export const engines = {
  sapi: {
    name: 'sapi',
    group: 'Voci di Windows (classiche)',
    available: () => process.platform === 'win32',
    voices: async () => parseVoiceLines(await run('powershell.exe', [...POWERSHELL, SAPI_VOICES])),
    async speak(text, file, { voice, rate }) {
      await run('powershell.exe', [...POWERSHELL, SAPI_SPEAK], {
        env: { TG_TTS_TEXT: text, TG_TTS_VOICE: voice, TG_TTS_RATE: String(Math.round(rate)), TG_TTS_OUT: file },
      });
    },
  },
  onecore: {
    name: 'onecore',
    group: 'Voci di Windows (moderne)',
    available: () => process.platform === 'win32',
    voices: async () => parseVoiceLines(await run('powershell.exe', [...POWERSHELL, ONECORE_VOICES])),
    async speak(text, file, { voice, rate }) {
      await run('powershell.exe', [...POWERSHELL, ONECORE_SPEAK], {
        env: { TG_TTS_TEXT: text, TG_TTS_VOICE: voice, TG_TTS_SPEED: String(speedFactor(rate)), TG_TTS_OUT: file },
      });
    },
  },
  espeak: {
    name: 'espeak',
    group: 'espeak-ng',
    available: () => process.platform !== 'win32' && spawnSync('espeak-ng', ['--version'], { stdio: 'ignore' }).status === 0,
    voices: async () => ['it', 'en', 'es', 'de', 'fr'].map((v) => ({ name: v, lang: v })),
    async speak(text, file, { voice, rate }) {
      await run('espeak-ng', ['-v', voice || 'it', '-s', String(Math.round(175 * speedFactor(rate))), '-w', file, '--stdin'], { input: text });
    },
  },
};

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
  /**
   * @param dir    cartella dei file audio creati
   * @param engine (per i test) un solo motore al posto di quelli di sistema
   * @param piper  gestore delle voci Piper (null per disattivarle)
   */
  constructor({ dir, engine, piper = null }) {
    this.dir = dir;
    this.piper = piper;
    this.engines = engine !== undefined
      ? (engine ? [engine] : [])
      : Object.values(engines).filter((e) => e.available());
    if (piper) this.engines.push(piper.engine);
    this.voicesCache = null;
    const names = this.engines.map((e) => e.group ?? e.name).join(', ');
    if (names) log.info(`Text-to-speech disponibile: ${names}`);
    else log.info('Text-to-speech: nessuna voce di sistema trovata, si userà la voce del browser (non funziona dentro OBS)');
  }

  /** Il primo motore disponibile (usato se non è stata scelta una voce). */
  get engine() {
    return this.engines.find((e) => e.name !== 'piper' || e.ready?.()) ?? null;
  }

  invalidateVoices() {
    this.voicesCache = null;
  }

  /** Tutte le voci, con id "motore:nome". Un motore che non risponde non blocca gli altri. */
  async voices() {
    if (!this.voicesCache) {
      const lists = await Promise.all(this.engines.map(async (e) => {
        try {
          return (await e.voices()).map((v) => ({ ...v, id: `${e.name}:${v.name}`, engine: e.name, group: e.group ?? e.name }));
        } catch (err) {
          log.warn(`${e.group ?? e.name}: impossibile leggere le voci (${err.message})`);
          return [];
        }
      }));
      this.voicesCache = lists.flat();
    }
    return this.voicesCache;
  }

  /** Motore e nome della voce da un id "motore:nome" (anche i vecchi valori senza motore). */
  #resolve(voiceId = '') {
    const i = voiceId.indexOf(':');
    const prefix = i > 0 ? voiceId.slice(0, i) : '';
    const byName = this.engines.find((e) => e.name === prefix);
    if (byName && (byName.name !== 'piper' || byName.ready?.())) return { engine: byName, voice: voiceId.slice(i + 1) };
    return { engine: this.engine, voice: prefix ? '' : voiceId };
  }

  /** Crea il file audio e ritorna { url, duration } oppure null se non c'è un motore. */
  async synthesize(text, options = {}) {
    const { engine, voice } = this.#resolve(options.voice);
    if (!engine || !text) return null;
    fs.mkdirSync(this.dir, { recursive: true });
    this.#cleanup();
    const name = `${randomUUID()}.wav`;
    const file = path.join(this.dir, name);
    await engine.speak(text, file, { voice, rate: Math.max(-10, Math.min(10, Math.round(Number(options.rate) || 0))) });
    return { url: `/tts/${name}`, duration: wavDuration(file), engine: engine.name };
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

export { PiperManager };
