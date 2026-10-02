import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { ObsClient, obsAuth, sanitizeObsSettings, summarizeStream, connectionQuality } from '../src/obs.js';

/** Finto OBS WebSocket v5 con password. */
async function fakeObs(password = 'segreta') {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(wss, 'listening');
  const auth = { salt: 'sale', challenge: 'sfida' };
  const obs = { scenes: ['Inizio', 'Gioco', 'Fine'], current: 'Inizio', requests: [] };
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1, authentication: auth } }));
    ws.on('message', (raw) => {
      const { op, d } = JSON.parse(raw);
      if (op === 1) {
        if (d.authentication !== obsAuth(password, auth)) return ws.close(4009, 'Authentication failed.');
        return ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      }
      if (op !== 6) return;
      obs.requests.push(d.requestType);
      const reply = (responseData, result = true) => ws.send(JSON.stringify({
        op: 7, d: { requestType: d.requestType, requestId: d.requestId, requestStatus: { result, code: result ? 100 : 600 }, responseData },
      }));
      if (d.requestType === 'GetSceneList') {
        // Come OBS: dal basso verso l'alto, con sceneIndex più alto in cima alla lista.
        const n = obs.scenes.length;
        reply({ currentProgramSceneName: obs.current, scenes: obs.scenes.map((sceneName, i) => ({ sceneName, sceneIndex: n - i - 1 })).reverse() });
      } else if (d.requestType === 'SetCurrentProgramScene') {
        obs.current = d.requestData.sceneName;
        reply({});
        ws.send(JSON.stringify({ op: 5, d: { eventType: 'CurrentProgramSceneChanged', eventIntent: 4, eventData: { sceneName: obs.current } } }));
      } else if (d.requestType === 'GetStreamStatus') {
        obs.bytes = (obs.bytes ?? 0) + 750_000; // ~3000 kbps con letture ogni 2 s
        reply({ outputActive: true, outputReconnecting: false, outputBytes: obs.bytes, outputSkippedFrames: 0, outputTotalFrames: obs.bytes / 10000, outputCongestion: 0.02, outputDuration: 60000 });
      } else if (d.requestType === 'GetStats') {
        reply({ activeFps: 60, cpuUsage: 7.5, renderSkippedFrames: 0, renderTotalFrames: 1000 });
      } else reply(null, false);
    });
  });
  return { wss, obs, port: wss.address().port };
}

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-obs-')), 'obs.json');
}

const waitFor = async (check) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(check());
};

test('si collega con la password, legge le scene in ordine e cambia scena', async () => {
  const { wss, obs, port } = await fakeObs();
  const file = tmpFile();
  const client = new ObsClient({ file });
  client.configure({ enabled: true, host: '127.0.0.1', port, password: 'segreta' });
  await waitFor(() => client.scenes.length === 3);
  assert.equal(client.status, 'connesso');
  assert.deepEqual(client.scenes, ['Inizio', 'Gioco', 'Fine']);
  assert.equal(client.current, 'Inizio');

  const state = await client.setScene('Gioco');
  assert.equal(state.current, 'Gioco');
  assert.equal(obs.current, 'Gioco');
  await assert.rejects(client.setScene('Inesistente'), /Scena sconosciuta/);

  // La password è salvata su disco ma non esce mai nello stato per la dashboard.
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).password, 'segreta');
  assert.equal(client.state().hasPassword, true);
  assert.ok(!JSON.stringify(client.state()).includes('segreta'));

  client.stop();
  wss.close();
});

test('password errata: si ferma e lo dice, senza riprovare', async () => {
  const { wss, port } = await fakeObs();
  const client = new ObsClient({ file: tmpFile() });
  client.configure({ enabled: true, host: '127.0.0.1', port, password: 'sbagliata' });
  await waitFor(() => client.status === 'password errata');
  assert.match(client.error, /Password errata/);
  client.stop();
  wss.close();
});

test('OBS chiuso: stato "non raggiungibile" e nuovo tentativo programmato', async () => {
  const { wss, port } = await fakeObs();
  wss.close();
  await once(wss, 'close');
  const client = new ObsClient({ file: tmpFile() });
  client.configure({ enabled: true, host: '127.0.0.1', port, password: 'x' });
  await waitFor(() => client.status === 'non raggiungibile');
  await assert.rejects(client.setScene('Gioco'), /non è collegato/);
  client.stop();
});

test('impostazioni: valori non validi ignorati, password vuota non cancella quella salvata', () => {
  const current = { enabled: true, host: '127.0.0.1', port: 4455, password: 'abc' };
  assert.deepEqual(sanitizeObsSettings({ host: 'ws://cattivo/"', port: 99999, password: '' }, current), current);
  assert.equal(sanitizeObsSettings({ clearPassword: true }, current).password, '');
  assert.equal(sanitizeObsSettings({ host: '192.168.1.20', port: '4456' }, current).port, 4456);
});

test('bitrate e qualità della connessione dai campioni di OBS', () => {
  const base = { active: true, reconnecting: false, congestion: 0.02, durationMs: 1000, fps: 60, cpu: 5, renderSkipped: 0, renderTotal: 0 };
  const samples = [
    { ...base, t: 0, bytes: 0, skipped: 0, total: 0 },
    { ...base, t: 2000, bytes: 1_500_000, skipped: 0, total: 120 },
    { ...base, t: 4000, bytes: 3_000_000, skipped: 3, total: 240 },
  ];
  const s = summarizeStream(samples);
  assert.equal(s.bitrateKbps, 6000);
  assert.equal(s.droppedPct, 1.25); // 3 persi su 240 negli ultimi secondi
  assert.equal(s.quality.label, 'buona');
  assert.equal(connectionQuality({ active: true, congestion: 0, droppedPct: 0 }).level, 4);
  assert.equal(connectionQuality({ active: true, congestion: 0.6, droppedPct: 8 }).label, 'pessima');
  assert.equal(connectionQuality({ active: true, reconnecting: true }).level, 0);
  assert.equal(connectionQuality({ active: false }), null);
  // diretta ripartita: i byte ricominciano da zero, niente bitrate negativo
  assert.equal(summarizeStream([samples[2], { ...base, t: 6000, bytes: 100, skipped: 0, total: 1 }]).bitrateKbps, 0);
});

test('collegato a OBS legge bitrate e statistiche della diretta', async () => {
  const { wss, port } = await fakeObs();
  const client = new ObsClient({ file: tmpFile() });
  const streams = [];
  client.on('stream', (s) => streams.push(s));
  client.configure({ enabled: true, host: '127.0.0.1', port, password: 'segreta' });
  await waitFor(() => streams.length >= 2);
  const s = streams.at(-1);
  assert.equal(s.active, true);
  assert.ok(s.bitrateKbps > 0);
  assert.equal(s.fps, 60);
  assert.equal(s.quality.label, 'ottima');
  assert.ok(client.state().stream);
  client.stop();
  assert.equal(client.state().stream, null);
  wss.close();
});
