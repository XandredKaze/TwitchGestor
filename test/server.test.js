import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.js';

function fakeApp() {
  const calls = [];
  return {
    calls,
    env: {},
    manager: { skip: () => calls.push('skip'), pause() {}, resume() {}, clearQueue() {}, resetStats() {} },
    config: { get: () => ({ overlay: {} }), defaults: () => ({}) },
    auth: {},
    getState: () => ({ ok: true }),
    broadcastState() {},
    shutdown: () => calls.push('shutdown'),
  };
}

async function start() {
  const app = fakeApp();
  const web = createServer(app);
  web.server.listen(0, '127.0.0.1');
  await once(web.server, 'listening');
  const base = `http://127.0.0.1:${web.server.address().port}`;
  return { app, web, base };
}

test('le azioni richiedono l\'intestazione della dashboard e la stessa origine', async () => {
  const { app, web, base } = await start();
  const ok = await fetch(`${base}/api/queue/skip`, { method: 'POST', headers: { 'x-twitchgestor': '1' } });
  assert.equal(ok.status, 200);
  const noHeader = await fetch(`${base}/api/queue/skip`, { method: 'POST' });
  assert.equal(noHeader.status, 403);
  const otherSite = await fetch(`${base}/api/queue/skip`, { method: 'POST', headers: { 'x-twitchgestor': '1', origin: 'https://sito-cattivo.example' } });
  assert.equal(otherSite.status, 403);
  assert.deepEqual(app.calls, ['skip']);
  web.server.close();
});

test('lo script di OBS può spegnere il programma da questo PC', async () => {
  const { app, web, base } = await start();
  const res = await fetch(`${base}/api/shutdown`, { method: 'POST', headers: { 'x-twitchgestor-stop': '1' } });
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(app.calls, ['shutdown']);
  web.server.close();
});

test('i file caricati non possono uscire dalla loro cartella', async () => {
  const { web, base } = await start();
  const res = await fetch(`${base}/media/..%2F..%2Fpackage.json`);
  assert.equal(res.status, 404);
  const bad = await fetch(`${base}/api/upload?kind=sounds`, { method: 'POST', headers: { 'x-twitchgestor': '1', 'x-filename': 'virus.exe' }, body: 'x' });
  assert.equal(bad.status, 400);
  web.server.close();
});

test('tema: si salva solo il tema e i temi sconosciuti sono rifiutati', async () => {
  const app = fakeApp();
  let saved = null;
  app.config = { get: () => ({ overlay: {}, ui: { theme: 'default' } }), defaults: () => ({}), save: (c) => { saved = c; return c; } };
  const web = createServer(app);
  web.server.listen(0, '127.0.0.1');
  await once(web.server, 'listening');
  const base = `http://127.0.0.1:${web.server.address().port}`;
  const put = (theme) => fetch(`${base}/api/ui`, { method: 'PUT', headers: { 'x-twitchgestor': '1', 'content-type': 'application/json' }, body: JSON.stringify({ theme }) });
  const ok = await put('brutal');
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).ui, { theme: 'brutal' });
  assert.deepEqual(saved, { overlay: {}, ui: { theme: 'brutal' } });
  const bad = await put('inventato');
  assert.equal(bad.status, 400);
  await bad.text();
  web.server.close();
});

test('musica: comandi dalla dashboard, pagina /music e file a pezzi (Range)', async () => {
  const app = fakeApp();
  const done = [];
  app.music = {
    library: () => [{ id: 'a.mp3', folder: '', name: 'a.mp3', url: '/media/music/a.mp3' }],
    rescan: () => done.push('rescan'),
    player: {
      playlists: () => [{ id: '*', name: 'Tutta la musica', count: 1 }],
      snapshot: () => ({ playing: done.includes('toggle') }),
      pageState: () => ({ type: 'music', track: { id: 'a.mp3', url: '/media/music/a.mp3' }, playing: true, volume: 0.5 }),
      toggle: () => done.push('toggle'),
      fromPage: (m) => done.push(`page:${m.type}`),
    },
  };
  const web = createServer(app);
  web.server.listen(0, '127.0.0.1');
  await once(web.server, 'listening');
  const base = `http://127.0.0.1:${web.server.address().port}`;
  const h = { 'x-twitchgestor': '1' };

  const lib = await (await fetch(`${base}/api/music`, { headers: h })).json();
  assert.equal(lib.tracks.length, 1);
  assert.match(lib.tracks[0].url ?? '', /^\/media\/music\//); // serve al pulsante 🎧 "Ascolta qui"
  assert.equal(lib.pages, 0);
  assert.equal(lib.share, null); // la cartella condivisa c'è solo sul Raspberry
  const r = await (await fetch(`${base}/api/music/toggle`, { method: 'POST', headers: h })).json();
  assert.equal(r.player.playing, true);
  assert.equal((await fetch(`${base}/api/music/boh`, { method: 'POST', headers: h })).status, 404);

  // la pagina di OBS riceve cosa suonare e avvisa quando il brano finisce
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?role=music`);
  const [hello] = await once(ws, 'message');
  const msg = JSON.parse(hello);
  assert.equal(msg.type, 'hello');
  assert.equal(msg.track.id, 'a.mp3');
  assert.equal(web.musicPages(), 1);
  ws.send(JSON.stringify({ type: 'ended', id: 'a.mp3' }));
  await new Promise((res) => setTimeout(res, 100));
  assert.ok(done.includes('page:ended'));
  ws.close();

  const part = await fetch(`${base}/common.js`, { headers: { range: 'bytes=0-9' } });
  assert.equal(part.status, 206);
  assert.equal((await part.text()).length, 10);
  assert.match(part.headers.get('content-range'), /^bytes 0-9\/\d+$/);
  web.server.close();
});

test('configurazione per la dashboard: c\'è l\'elenco dei file caricati', async () => {
  const app = fakeApp();
  app.chatAccount = () => null;
  const web = createServer(app);
  web.server.listen(0, '127.0.0.1');
  await once(web.server, 'listening');
  const res = await fetch(`http://127.0.0.1:${web.server.address().port}/api/config`, { headers: { 'x-twitchgestor': '1' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.media.music) && Array.isArray(body.media.sounds));
  web.server.close();
});

test('overlay: elenco, caricamento e azioni dalla dashboard', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createOverlayFolder } = await import('../src/overlayFolder.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-ov-'));
  const app = fakeApp();
  app.overlay = createOverlayFolder({ dir: path.join(tmp, 'overlay'), linksFile: path.join(tmp, 'l.json'), obs: null });
  const web = createServer(app);
  web.server.listen(0, '127.0.0.1');
  await once(web.server, 'listening');
  const base = `http://127.0.0.1:${web.server.address().port}`;
  const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-twitchgestor': '1', ...headers }, body });
  try {
    const up = await post('/api/overlay/upload?folder=Inizio', 'video', { 'x-filename': encodeURIComponent('intro clip.mp4') });
    assert.equal(up.status, 200);
    assert.equal((await up.json()).path, 'Inizio/intro clip.mp4');
    const list = await (await fetch(`${base}/api/overlay`)).json();
    assert.deepEqual(list.folders, ['Inizio']);
    assert.equal(list.files[0].url, '/media/overlay/Inizio/intro%20clip.mp4');
    assert.equal(list.files[0].type, 'video');
    const ren = await post('/api/overlay/rename', JSON.stringify({ from: 'Inizio/intro clip.mp4', to: 'Inizio/intro.mp4' }), { 'content-type': 'application/json' });
    assert.equal((await ren.json()).to, 'Inizio/intro.mp4');
    const obs = await (await fetch(`${base}/api/overlay/obs`)).json();
    assert.equal(obs.connected, false);
    const del = await post('/api/overlay/delete', JSON.stringify({ path: 'Inizio' }), { 'content-type': 'application/json' });
    assert.equal(del.status, 200);
    await del.text();
    assert.deepEqual((await (await fetch(`${base}/api/overlay`)).json()).files, []);
  } finally {
    web.server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
