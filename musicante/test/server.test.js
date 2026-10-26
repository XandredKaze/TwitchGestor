import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicante-'));
const music = path.join(dir, 'music');
Object.assign(process.env, {
  MUSICANTE_TEST: '1', MUSICANTE_DATA: path.join(dir, 'data'), MUSICANTE_MUSIC: music, MUSICANTE_PORT: '0', DASHBOARD_TOKEN: 'pw', HOST: '127.0.0.1',
  MUSICANTE_YTDLP: fileURLToPath(new URL('../demo/finto-ytdlp.mjs', import.meta.url)),
});
let base;
let srv;
let tool;
before(async () => {
  const mod = await import('../src/index.js');
  srv = mod.server;
  tool = mod.tool;
  base = `http://127.0.0.1:${await mod.ready}`;
  await tool.ensure();
});
after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const h = { 'x-musicante': '1', 'x-dashboard-token': 'pw', 'Content-Type': 'application/json' };
const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: h, body: JSON.stringify(body ?? {}) });
const state = async () => (await fetch(`${base}/api/state`, { headers: h })).json();
const waitDone = async (id) => {
  for (let i = 0; i < 100; i++) {
    const j = (await state()).jobs.find((x) => x.id === id);
    if (!['queued', 'running'].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('download mai finito');
};

test('password e intestazione obbligatorie; pagina pubblica', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/api/downloads`, { method: 'POST', headers: { 'x-dashboard-token': 'pw' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/core/ytdlp.js`)).status, 200);
  const s = await state();
  assert.equal(s.tool.ytdlp, '2026.10.01');
});

test('anteprima di una playlist ed errori spiegati', async () => {
  const r = await (await post('/api/probe', { url: 'https://www.youtube.com/playlist?list=abc', playlist: true })).json();
  assert.deepEqual([r.info.title, r.info.count], ['La mia playlist', 2]);
  const bad = await post('/api/probe', { url: 'https://www.youtube.com/watch?v=errore' });
  assert.equal(bad.status, 422);
  assert.match((await bad.json()).error, /non è disponibile/);
  assert.equal((await post('/api/probe', { url: 'non è un link' })).status, 400);
});

test('scarica una playlist in una cartella nuova della musica', async () => {
  const r = await (await post('/api/downloads', { url: 'https://www.youtube.com/playlist?list=abc', playlist: true, folder: 'Lo-fi live', title: 'La mia playlist' })).json();
  const j = await waitDone(r.job.id);
  assert.equal(j.status, 'done');
  assert.deepEqual(j.files, ['Primo brano.mp3', 'Secondo brano.mp3']);
  assert.ok(fs.existsSync(path.join(music, 'Lo-fi live', 'Secondo brano.mp3')));
  assert.ok((await state()).folders.includes('Lo-fi live'));
  // fuori dalla cartella della musica non si va
  const out = await (await post('/api/downloads', { url: 'https://x.y/a', folder: '../../fuori' })).json();
  assert.equal(out.job.folder, 'fuori');
});

test('errore, annullamento e pulizia dell\'elenco', async () => {
  const e = await (await post('/api/downloads', { url: 'https://www.youtube.com/watch?v=errore' })).json();
  const je = await waitDone(e.job.id);
  assert.equal(je.status, 'error');
  assert.match(je.errors[0], /non è disponibile/);
  const slow = await (await post('/api/downloads', { url: 'https://www.youtube.com/playlist?list=lento', playlist: true })).json();
  await new Promise((r) => setTimeout(r, 300));
  await post(`/api/downloads/${slow.job.id}/cancel`);
  assert.equal((await waitDone(slow.job.id)).status, 'cancelled');
  await post('/api/downloads/clear');
  assert.equal((await state()).jobs.length, 0);
});

test('mix con i minutaggi: anteprima dei capitoli e un MP3 per capitolo (il file intero non resta)', async () => {
  const p = await (await post('/api/probe', { url: 'https://www.youtube.com/watch?v=mix' })).json();
  assert.deepEqual(p.info.chapters.map((c) => c.title), ['Intro', 'Pioggia sul vetro']);
  const r = await (await post('/api/downloads', { url: 'https://www.youtube.com/watch?v=mix', split: true, folder: 'Mix' })).json();
  const j = await waitDone(r.job.id);
  assert.equal(j.status, 'done');
  assert.deepEqual(j.files.sort(), ['Intro.mp3', 'Pioggia sul vetro.mp3']);
  assert.deepEqual(fs.readdirSync(path.join(music, 'Mix')).sort(), ['Intro.mp3', 'Pioggia sul vetro.mp3']);
  // senza "dividi" resta un solo MP3; un nome già presente non viene sovrascritto
  const one = await (await post('/api/downloads', { url: 'https://www.youtube.com/watch?v=mix&x=1', folder: 'Mix' })).json();
  assert.deepEqual((await waitDone(one.job.id)).files, ['Brano singolo.mp3']);
  const again = await (await post('/api/downloads', { url: 'https://www.youtube.com/watch?v=mix&x=2', folder: 'Mix' })).json();
  assert.deepEqual((await waitDone(again.job.id)).files, ['Brano singolo (2).mp3']);
  // nella cartella di lavoro non resta niente
  assert.deepEqual(fs.readdirSync(path.join(dir, 'data', 'lavoro')), []);
});

test('TwitchGestor chiede se Musicante è occupato prima di aggiornarsi', async () => {
  const slow = await (await post('/api/downloads', { url: 'https://www.youtube.com/playlist?list=lento2', playlist: true })).json();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await (await fetch(`${base}/api/busy`, { headers: h })).json()).busy, true);
  await post(`/api/downloads/${slow.job.id}/cancel`);
  await waitDone(slow.job.id);
  assert.equal((await (await fetch(`${base}/api/busy`, { headers: h })).json()).busy, false);
});

test('già scaricato: nessun file nuovo, avviso e "Scarica di nuovo"; file non segnalati recuperati lo stesso', async () => {
  const url = 'https://www.youtube.com/watch?v=unavolta';
  const first = await waitDone((await (await post('/api/downloads', { url, folder: 'Prove' })).json()).job.id);
  assert.deepEqual([first.files.length, first.already], [1, undefined]);
  const second = await waitDone((await (await post('/api/downloads', { url, folder: 'Prove' })).json()).job.id);
  assert.deepEqual([second.status, second.files.length, second.already], ['done', 0, true]);
  const again = await waitDone((await (await post('/api/downloads', { url, folder: 'Prove', force: true })).json()).job.id);
  assert.deepEqual(again.files, ['Brano singolo (2).mp3']);
  // yt-dlp non dice dove ha salvato: Musicante trova lo stesso il file finito
  const silent = await waitDone((await (await post('/api/downloads', { url: 'https://www.youtube.com/watch?v=noprint', folder: 'Prove' })).json()).job.id);
  assert.equal(silent.files.length, 1);
  // capitoli anche se il video era già stato scaricato intero
  await waitDone((await (await post('/api/downloads', { url: 'https://www.youtube.com/watch?v=mix&y=1', folder: 'Mix2' })).json()).job.id);
  const ch = await waitDone((await (await post('/api/downloads', { url: 'https://www.youtube.com/watch?v=mix&y=1', split: true, folder: 'Mix2' })).json()).job.id);
  assert.deepEqual(ch.files.sort(), ['Intro.mp3', 'Pioggia sul vetro.mp3']);
});
