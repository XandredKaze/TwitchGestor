import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NotificationManager } from '../src/core/NotificationManager.js';
import { fromEventSub, donation } from '../src/core/normalize.js';

const config = JSON.parse(fs.readFileSync(new URL('../src/core/defaults.json', import.meta.url)));
const u = { user_id: '1', user_login: 'anna', user_name: 'Anna' };

function setup(overrides = {}) {
  const m = new NotificationManager({ config: { ...config, ...overrides } });
  const alerts = [];
  m.on('alert', (a) => alerts.push(a));
  return { m, alerts };
}

test('mostra gli alert uno alla volta rispettando durata e pausa tra alert', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { m, alerts } = setup();
  m.ingest(fromEventSub('channel.follow', u, 'a'));
  m.ingest(fromEventSub('channel.follow', { ...u, user_name: 'Bea' }, 'b'));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].text, 'Anna ora ti segue ❤️');
  t.mock.timers.tick(config.types.follow.duration + config.queue.gapMs - 1);
  assert.equal(alerts.length, 1);
  t.mock.timers.tick(1);
  assert.equal(alerts.length, 2);
  assert.equal(alerts[1].text, 'Bea ora ti segue ❤️');
});

test('ignora i duplicati', () => {
  const { m, alerts } = setup();
  assert.equal(m.ingest(fromEventSub('channel.follow', u, 'x')), true);
  assert.equal(m.ingest(fromEventSub('channel.follow', u, 'x')), false);
  assert.equal(alerts.length, 1);
  assert.equal(m.history.length, 1);
  m.stop();
});

test('non duplica gli alert delle sub regalate ma le registra', () => {
  const { m, alerts } = setup();
  m.ingest(fromEventSub('channel.subscribe', { ...u, tier: '1000', is_gift: true }, 's'));
  assert.equal(alerts.length, 0);
  assert.equal(m.history[0].alerted, false);
  assert.match(m.history[0].skipReason, /regalata/);
  assert.equal(m.stats.counts.sub, 1);
  m.stop();
});

test('rispetta il minimo e i tipi disattivati', () => {
  const types = structuredClone(config.types);
  types.cheer.minAmount = 100;
  types.follow.enabled = false;
  const { m, alerts } = setup({ types });
  m.ingest(fromEventSub('channel.cheer', { ...u, bits: 50 }, 'c1'));
  assert.equal(alerts.length, 0);
  assert.equal(m.history.length, 1);
  assert.equal(m.ingest(fromEventSub('channel.follow', u, 'f')), false);
  assert.equal(m.history.length, 1);
  m.stop();
});

test('sceglie la variante più specifica', () => {
  const { m } = setup();
  assert.equal(m.buildAlert(fromEventSub('channel.subscription.gift', { ...u, total: 20, tier: '1000' })).title, 'PIOGGIA DI ABBONAMENTI! 🎁');
  assert.equal(m.buildAlert(fromEventSub('channel.subscription.gift', { ...u, total: 1, tier: '1000' })).text, 'Anna ha regalato 1 abbonamento Tier 1');
  const hydrate = fromEventSub('channel.channel_points_custom_reward_redemption.add', { ...u, reward: { title: 'idratati', cost: 1 } });
  assert.equal(m.buildAlert(hydrate).title, '💧 Idratati!');
  m.stop();
});

test('pausa, ripresa, salto e replay', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { m, alerts } = setup();
  m.pause();
  m.ingest(fromEventSub('channel.follow', u, 'p1'));
  assert.equal(alerts.length, 0);
  assert.equal(m.queueState().pending.length, 1);
  m.resume();
  assert.equal(alerts.length, 1);
  m.skip();
  assert.equal(m.queueState().current, null);
  assert.equal(m.replay('p1'), true);
  assert.equal(alerts.length, 2);
  assert.equal(m.replay('inesistente'), false);
});

test('statistiche e top donatori', () => {
  const { m } = setup();
  m.ingest(donation({ id: '1', source: 'webhook', name: 'Anna', amount: 5, currency: 'EUR' }));
  m.ingest(donation({ id: '2', source: 'webhook', name: 'Anna', amount: 2.5, currency: 'EUR' }));
  m.ingest(donation({ id: '3', source: 'webhook', name: 'Bea', amount: 20, currency: 'EUR' }));
  m.ingest(fromEventSub('channel.cheer', { ...u, bits: 100 }, 'b1'));
  assert.equal(m.stats.donations.EUR, 27.5);
  assert.equal(m.stats.bits, 100);
  assert.deepEqual(m.topDonors().map((d) => [d.name, d.amount]), [['Bea', 20], ['Anna', 7.5]]);
  m.stop();
});

test('ringraziamento in chat solo se attivo', () => {
  const off = setup();
  const offMsgs = [];
  off.m.on('chat', (t) => offMsgs.push(t));
  off.m.ingest(fromEventSub('channel.raid', { from_broadcaster_user_login: 'luca', from_broadcaster_user_name: 'Luca', viewers: 3 }, 'r0'));
  assert.equal(offMsgs.length, 0);
  off.m.stop();

  const on = setup({ chat: { enabled: true } });
  const msgs = [];
  on.m.on('chat', (t) => msgs.push(t));
  on.m.ingest(fromEventSub('channel.raid', { from_broadcaster_user_login: 'luca', from_broadcaster_user_name: 'Luca', viewers: 3 }, 'r1'));
  on.m.ingest(fromEventSub('channel.follow', u, 'f1'));
  assert.deepEqual(msgs, ['Benvenuti raiders di Luca! Andate a seguirlo su twitch.tv/luca 🚀']);
  on.m.stop();
});
