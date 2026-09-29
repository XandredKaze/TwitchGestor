import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { CreditsStore, fetchCreditsData } from '../src/credits.js';
import { createServer } from '../src/server.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-')), 'credits.json');

function fakeHelix(pages) {
  const calls = [];
  return {
    calls,
    async request(method, url) {
      calls.push(url);
      const u = new URL(url, 'https://x');
      const key = u.pathname.slice(1);
      if (pages[key] instanceof Error) throw pages[key];
      const list = pages[key] ?? [];
      const after = Number(u.searchParams.get('after') ?? 0);
      return { data: list.slice(after, after + 2), pagination: after + 2 < list.length ? { cursor: String(after + 2) } : {} };
    },
  };
}

test('scarica abbonati (tutte le pagine) e follower, escludendo il canale e i gift anonimi', async () => {
  const store = new CreditsStore({ file: tmpFile() });
  store.set('settings', { maxFollowers: 3 });
  const helix = fakeHelix({
    subscriptions: [
      { user_id: '1', user_name: 'IoStesso' },
      { user_id: '2', user_name: 'Anna', is_gift: false },
      { user_id: '3', user_name: 'Bea', is_gift: true, gifter_name: 'Carlo', gifter_login: 'carlo' },
      { user_id: '4', user_name: 'Dino', is_gift: true, gifter_name: 'AnAnonymousGifter', gifter_login: 'ananonymousgifter' },
    ],
    'channels/followers': ['F1', 'F2', 'F3', 'F4', 'F5'].map((user_name) => ({ user_name })),
  });
  const { data, errors } = await fetchCreditsData({ store, helix, user: { id: '1' } });
  assert.deepEqual(errors, []);
  assert.deepEqual(data.subs.map((s) => s.name), ['Anna', 'Bea', 'Dino']);
  assert.equal(data.subs[1].gifter, 'Carlo');
  assert.equal(data.subs[2].gifter, '');
  assert.deepEqual(data.followers, ['F1', 'F2', 'F3']);
  assert.ok(helix.calls.some((c) => c.includes('after=2')), 'deve leggere la seconda pagina');
  assert.equal(store.get('status').error, '');
});

test('se gli abbonati non sono disponibili, i follower arrivano lo stesso', async () => {
  const store = new CreditsStore({ file: tmpFile() });
  const helix = fakeHelix({ subscriptions: new Error('solo affiliate'), 'channels/followers': [{ user_name: 'F1' }] });
  const { data, errors } = await fetchCreditsData({ store, helix, user: { id: '1' } });
  assert.deepEqual(data.followers, ['F1']);
  assert.match(errors[0], /Abbonati: solo affiliate/);
  assert.match(store.get('status').error, /solo affiliate/);
});

test('lo stato si salva su disco e la pagina può scrivere solo le sue chiavi', () => {
  const file = tmpFile();
  const store = new CreditsStore({ file });
  store.set('settings', { speed: 100 }, { fromPage: true });
  assert.throws(() => store.set('qualsiasi', 1, { fromPage: true }), /non consentita/);
  store.saveNow();
  assert.equal(new CreditsStore({ file }).get('settings').speed, 100);
});

test('la sorgente OBS legge senza token, le scritture sono protette', async () => {
  const store = new CreditsStore({ file: tmpFile() });
  const app = {
    env: { DASHBOARD_TOKEN: 'segreto' }, manager: {}, config: { get: () => ({ overlay: {} }) }, getState: () => ({}), broadcastState() {},
    auth: { user: { login: 'xandredkaze' }, configured: true }, credits: { store, refresh: async () => ({ errors: [] }) },
  };
  const web = createServer(app);
  web.server.listen(0, '127.0.0.1');
  await once(web.server, 'listening');
  const base = `http://127.0.0.1:${web.server.address().port}`;

  const read = await (await fetch(`${base}/api/credits/state?rev=0`)).json();
  assert.equal(read.account, 'xandredkaze');
  assert.ok(read.state);
  const unchanged = await (await fetch(`${base}/api/credits/state?rev=${read.rev}`)).json();
  assert.equal(unchanged.state, undefined);

  const noToken = await fetch(`${base}/api/credits/state/settings`, { method: 'PUT', headers: { 'x-twitchgestor': '1' }, body: '{"speed":50}' });
  assert.equal(noToken.status, 401);
  const ok = await fetch(`${base}/api/credits/state/settings`, { method: 'PUT', headers: { 'x-twitchgestor': '1', 'x-dashboard-token': 'segreto' }, body: '{"speed":50}' });
  assert.equal(ok.status, 200);
  assert.equal(store.get('settings').speed, 50);
  const badKey = await fetch(`${base}/api/credits/state/auth`, { method: 'PUT', headers: { 'x-twitchgestor': '1', 'x-dashboard-token': 'segreto' }, body: '{}' });
  assert.equal(badKey.status, 400);
  web.server.close();
});

test('importando il vecchio state.json del Credit Roll i token vengono scartati', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ settings: { speed: 120 }, auth: { accessToken: 'segreto' }, data: { subs: [] } }));
  const store = new CreditsStore({ file });
  assert.equal(store.get('settings').speed, 120);
  assert.equal(store.snapshot(0).state.auth, undefined);
});
