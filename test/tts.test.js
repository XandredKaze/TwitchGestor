import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { cleanText } from '../src/core/ttsText.js';
import { TtsService, wavDuration, speedFactor } from '../src/tts.js';
import { PiperManager } from '../src/piper.js';
import { NotificationManager } from '../src/core/NotificationManager.js';
import { sanitizeConfig } from '../src/core/schema.js';
import { fromEventSub } from '../src/core/normalize.js';
import { createServer } from '../src/server.js';

const defaults = JSON.parse(fs.readFileSync(new URL('../config/default.json', import.meta.url)));

/** WAV finto: 16 kHz, 16 bit mono, `seconds` secondi di silenzio. */
function fakeWav(file, seconds) {
  const data = Buffer.alloc(Math.round(32000 * seconds));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
const fakeEngine = (spoken = []) => ({
  name: 'finto', label: 'finto',
  voices: async () => [{ name: 'Elsa', lang: 'it-IT' }],
  speak: async (text, file, opts) => { spoken.push({ text, opts }); fakeWav(file, 2); },
});

test('pulisce il testo: link, parole vietate, cheermote, ripetizioni, lunghezza', () => {
  assert.equal(cleanText('guarda https://sito.it/x ciao', {}), 'guarda link ciao');
  assert.equal(cleanText('Cheer100 grande Kappa50 streamer', {}), 'grande streamer');
  assert.equal(cleanText('sei uno SCEMO', { bannedWords: ['scemo'] }), 'sei uno bip');
  assert.equal(cleanText('ciaoooooooo', {}), 'ciaooo');
  assert.equal(cleanText('Mario ha donato 5 €. ', {}), 'Mario ha donato 5 €.');
  assert.equal(cleanText('Mario dice: ', {}), 'Mario dice');
  assert.equal(cleanText('uno due tre quattro', { maxLength: 10 }), 'uno due…');
});

test('crea il file audio e ne calcola la durata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tts-'));
  const spoken = [];
  const tts = new TtsService({ dir, engine: fakeEngine(spoken) });
  const r = await tts.synthesize('ciao', { voice: 'finto:Elsa', rate: 50, volume: 80 });
  assert.match(r.url, /^\/tts\/[\w-]+\.wav$/);
  assert.equal(Math.round(r.duration), 2);
  assert.equal(Math.round(wavDuration(path.join(dir, r.url.slice(5)))), 2);
  assert.deepEqual(spoken[0].opts, { voice: 'Elsa', rate: 10 });
  assert.deepEqual(await tts.voices(), [{ name: 'Elsa', lang: 'it-IT', id: 'finto:Elsa', engine: 'finto', group: 'finto' }]);
  // un vecchio valore senza motore va al motore predefinito
  await tts.synthesize('ciao', { voice: 'Elsa' });
  assert.equal(spoken[1].opts.voice, 'Elsa');
  assert.equal(await new TtsService({ dir, engine: null }).synthesize('ciao'), null);
});

test('la voce si legge solo se attiva in generale e nell\'alert (anche con soglia)', () => {
  const config = sanitizeConfig({
    tts: { enabled: true },
    types: { cheer: { tts: false, variants: [{ minAmount: 100, tts: true, ttsText: '{user}: {message}' }] } },
  }, defaults);
  const m = new NotificationManager({ config });
  const small = m.buildAlert(fromEventSub('channel.cheer', { user_name: 'Anna', bits: 50, message: 'ciao' }));
  const big = m.buildAlert(fromEventSub('channel.cheer', { user_name: 'Anna', bits: 200, message: 'Cheer200 forza!' }));
  assert.equal(small.tts, undefined);
  assert.equal(big.tts.text, 'Anna: forza!');
  const off = new NotificationManager({ config: sanitizeConfig({ tts: { enabled: false }, types: { cheer: { tts: true } } }, defaults) });
  assert.equal(off.buildAlert(fromEventSub('channel.cheer', { user_name: 'Anna', bits: 50 })).tts, undefined);
});

test('l\'alert aspetta l\'audio della voce e dura abbastanza per sentirla', async () => {
  const config = sanitizeConfig({ tts: { enabled: true }, types: { follow: { tts: true, duration: 3000 } } }, defaults);
  const m = new NotificationManager({ config });
  m.prepareAlert = async (alert) => {
    await new Promise((r) => setTimeout(r, 30));
    alert.tts = { ...alert.tts, url: '/tts/x.wav', delay: 1200 };
    alert.duration = Math.max(alert.duration, 1200 + 6000 + 800);
  };
  const shown = [];
  m.on('alert', (a) => shown.push(a));
  m.ingest(fromEventSub('channel.follow', { user_name: 'Anna' }, 'f1'));
  assert.equal(shown.length, 0, 'prima si prepara la voce');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(shown.length, 1);
  assert.equal(shown[0].tts.url, '/tts/x.wav');
  assert.equal(shown[0].duration, 8000);
  m.skip();
  m.stop();
});

test('prova della voce dalla dashboard', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-tts-'));
  const app = {
    env: {}, manager: {}, getState: () => ({}), broadcastState() {},
    config: { get: () => sanitizeConfig({}, defaults), defaults: () => defaults }, auth: {},
    tts: new TtsService({ dir, engine: fakeEngine() }),
  };
  const web = createServer(app);
  web.server.listen(0, '127.0.0.1');
  await once(web.server, 'listening');
  const base = `http://127.0.0.1:${web.server.address().port}`;
  const voices = await (await fetch(`${base}/api/tts/voices`)).json();
  assert.equal(voices.engine, 'finto');
  const res = await (await fetch(`${base}/api/tts/test`, { method: 'POST', headers: { 'x-twitchgestor': '1', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'prova https://x.it' }) })).json();
  assert.equal(res.text, 'prova link');
  const audio = await fetch(base + res.url);
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get('content-type'), 'audio/wav');
  assert.ok((await audio.arrayBuffer()).byteLength > 44);
  web.server.close();
});

test('velocità della voce', () => {
  assert.equal(speedFactor(0), 1);
  assert.equal(speedFactor(10), 3);
  assert.equal(speedFactor(-10), 0.5);
});

test('Piper: trova programma e voci nella sua cartella e le propone tra le voci', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-piper-'));
  const piper = new PiperManager({ dir, platform: 'linux' });
  assert.equal(piper.engine.ready(), false);
  assert.deepEqual(piper.status().voices.map((v) => [v.key, v.installed]), [['paola', false], ['riccardo', false]]);
  fs.mkdirSync(path.join(dir, 'piper'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'piper', 'piper'), '');
  fs.mkdirSync(path.join(dir, 'voices'));
  fs.writeFileSync(path.join(dir, 'voices', 'it_IT-paola-medium.onnx'), '');
  fs.writeFileSync(path.join(dir, 'voices', 'it_IT-paola-medium.onnx.json'), JSON.stringify({ language: { code: 'it_IT' } }));
  assert.equal(piper.engine.ready(), true);
  assert.equal(piper.status().voices[0].installed, true);
  const tts = new TtsService({ dir: path.join(dir, 'out'), engine: null, piper });
  const voices = await tts.voices();
  assert.deepEqual(voices.map((v) => [v.id, v.label, v.lang]), [['piper:it_IT-paola-medium', 'Paola', 'it_IT']]);
  assert.throws(() => piper.install('sconosciuta'), /Voce sconosciuta/);
});
