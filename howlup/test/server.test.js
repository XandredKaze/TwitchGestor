import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'howlup-'));
Object.assign(process.env, { HOWLUP_NO_TWITCH: '1', HOWLUP_TEST: '1', HOWLUP_DATA: dir, HOWLUP_PORT: '0', DASHBOARD_TOKEN: 'pw', HOST: '127.0.0.1' });
let base;
let srv;
before(async () => {
  const mod = await import('../src/index.js');
  srv = mod.server;
  base = `http://127.0.0.1:${await mod.ready}`;
});
after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const h = { 'x-howlup': '1', 'x-dashboard-token': 'pw', 'Content-Type': 'application/json' };

test('serve la password; le modifiche vogliono l\'intestazione di Howl-UP', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/api/state`, { headers: { 'x-dashboard-token': 'no' } })).status, 401);
  const noHeader = await fetch(`${base}/api/tasks`, { method: 'PUT', headers: { 'x-dashboard-token': 'pw' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/core/agenda.js`)).status, 200);
  assert.equal((await fetch(`${base}/core/..%2F..%2F..%2Fpackage.json`)).status, 404);
});

test('impegni, cose da fare e calendario', async () => {
  const r = await (await fetch(`${base}/api/events`, { method: 'PUT', headers: h, body: JSON.stringify({ event: { title: 'Live', category: 'live', date: '2026-10-20', time: '21:00', repeat: { freq: 'weekly', days: [2] } } }) })).json();
  assert.equal(r.event.title, 'Live');
  const one = await fetch(`${base}/api/events/${r.event.id}/occurrence`, { method: 'POST', headers: h, body: JSON.stringify({ day: '2026-10-27', event: { time: '22:00' } }) });
  assert.equal(one.status, 200);
  await fetch(`${base}/api/tasks`, { method: 'PUT', headers: h, body: JSON.stringify({ task: { title: 'Grafica', due: '2026-10-20' } }) });
  const st = await (await fetch(`${base}/api/state`, { headers: h })).json();
  assert.equal(st.events.length, 2);
  assert.equal(st.tasks.length, 1);
  const same = await (await fetch(`${base}/api/state?rev=${st.rev}`, { headers: h })).json();
  assert.equal(same.unchanged, true);
  const ics = await (await fetch(`${base}${st.calendarPath}`)).text();
  assert.match(ics, /RRULE:FREQ=WEEKLY/);
  assert.equal((await fetch(`${base}/calendar/sbagliato.ics`)).status, 404);
  assert.ok(fs.existsSync(path.join(dir, 'agenda.json')));
  const del = await fetch(`${base}/api/events/${r.event.id}`, { method: 'DELETE', headers: h });
  assert.equal(del.status, 200);
});

test('la prova delle notifiche dice com\'è andata su ogni canale', async () => {
  const none = await (await fetch(`${base}/api/notify/test`, { method: 'POST', headers: h })).json();
  assert.deepEqual(none.last.results, {});
  const { settings } = await (await fetch(`${base}/api/notify`, { headers: h })).json();
  settings.channels.ntfy = { ...settings.channels.ntfy, enabled: true, server: 'http://127.0.0.1:1' };
  await fetch(`${base}/api/notify`, { method: 'PUT', headers: h, body: JSON.stringify({ settings }) });
  const bad = await (await fetch(`${base}/api/notify/test`, { method: 'POST', headers: h })).json();
  assert.match(bad.last.results.ntfy, /non raggiunge http:\/\/127\.0\.0\.1:1/);
  const view = await (await fetch(`${base}/api/notify`, { headers: h })).json();
  assert.equal(view.last.results.ntfy, bad.last.results.ntfy);
});
