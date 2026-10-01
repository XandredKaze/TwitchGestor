import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { ObsClient, obsAuth, sanitizeObsSettings } from '../src/obs.js';

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
