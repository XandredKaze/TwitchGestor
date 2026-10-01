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
