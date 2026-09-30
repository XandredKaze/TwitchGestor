import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liveSession } from '../src/core/session.js';
import { CreditsStore, fetchCreditsData, sessionFrom } from '../src/credits.js';

const at = (min) => new Date(Date.UTC(2026, 8, 30, 20, min)).toISOString();
const ev = (type, name, min, extra = {}) => ({ type, user: name ? { name } : null, timestamp: at(min), source: 'twitch', ...extra });

test('riassume gli eventi della live, escludendo le prove e quelli prima dell\'inizio', () => {
  const history = [
    ev('donation', 'Anna', 50, { amount: 5, currency: 'EUR' }),
    ev('donation', 'Anna', 45, { amount: 2.5, currency: 'EUR' }),
    ev('redemption', 'Bea', 40, { reward: { title: 'Idratati' } }),
    ev('raid', 'Canale', 35, { amount: 30 }),
    ev('cheer', null, 30, { amount: 100 }),
    ev('cheer', 'Dino', 28, { amount: 500 }),
    ev('giftsub', 'Ezio', 25, { amount: 5 }),
    ev('resub', 'Fede', 20, { months: 14 }),
    ev('sub', 'Gino', 15, { isGift: true }),
    ev('sub', 'Ivo', 12, {}),
    ev('follow', 'Lia', 10),
    ev('follow', 'Lia', 9),
    ev('follow', 'Test', 8, { source: 'test' }),
    ev('follow', 'Vecchio', 1),
  ];
  const s = liveSession(history, at(5));
  assert.deepEqual(s.follows, ['Lia']);
  assert.deepEqual(s.subs, ['Ivo']);
  assert.deepEqual(s.resubs, [{ name: 'Fede', value: 14 }]);
  assert.deepEqual(s.gifters.map((g) => [g.name, g.value]), [['Ezio', 5]]);
  assert.deepEqual(s.cheers.map((g) => [g.name, g.value]), [['Dino', 500], ['Anonimo', 100]]);
  assert.deepEqual(s.donations.map((d) => [d.name, d.value, d.currency]), [['Anna', 7.5, 'EUR']]);
  assert.deepEqual(s.raids, [{ name: 'Canale', value: 30 }]);
  assert.deepEqual(s.redemptions, [{ name: 'Bea', reward: 'Idratati' }]);
});

test('senza live in corso considera le ultime 12 ore', () => {
  const recent = { type: 'follow', user: { name: 'Nuovo' }, timestamp: new Date().toISOString(), source: 'twitch' };
  const old = { type: 'follow', user: { name: 'Vecchio' }, timestamp: new Date(Date.now() - 13 * 3600e3).toISOString(), source: 'twitch' };
  const s = sessionFrom([recent, old], null);
  assert.deepEqual(s.follows, ['Nuovo']);
  assert.equal(s.live, false);
});

test('scarica moderatori, VIP, classifica bits e chat solo se una sezione li usa', async () => {
  const store = new CreditsStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-')), 'c.json') });
  store.set('settings', { customSections: [
    { id: 'a', source: 'mods' }, { id: 'b', source: 'vips' }, { id: 'c', source: 'bits', period: 'week' }, { id: 'd', source: 'chatters' },
  ] });
  const calls = [];
  const helix = {
    async request(method, url) {
      calls.push(url);
      const key = new URL(url, 'https://x').pathname.slice(1);
      const data = {
        'moderation/moderators': [{ user_name: 'ModAnna' }],
        'channels/vips': [{ user_name: 'VipBea' }],
        'bits/leaderboard': [{ user_name: 'Ricco', score: 900 }],
        'chat/chatters': [{ user_id: '1', user_name: 'Io' }, { user_id: '2', user_name: 'Spettatore' }],
        streams: [{ started_at: '2026-09-30T20:00:00Z' }],
      }[key] ?? [];
      return { data, pagination: {} };
    },
  };
  const { data, errors } = await fetchCreditsData({ store, helix, user: { id: '1' }, history: [] });
  assert.deepEqual(errors, []);
  assert.deepEqual(data.moderators, ['ModAnna']);
  assert.deepEqual(data.vips, ['VipBea']);
  assert.deepEqual(data.bits.week, [{ name: 'Ricco', value: 900 }]);
  assert.deepEqual(data.chatters.map((c) => c.name), ['Spettatore']);
  assert.equal(data.liveStartedAt, '2026-09-30T20:00:00Z');
  assert.ok(calls.some((c) => c.includes('period=week')));

  store.set('settings', {});
  calls.length = 0;
  await fetchCreditsData({ store, helix, user: { id: '1' }, history: [] });
  assert.ok(!calls.some((c) => /moderators|vips|leaderboard|chatters/.test(c)), 'senza sezioni che li usano non li scarica');
});

test('permesso mancante: messaggio chiaro, le altre categorie arrivano lo stesso', async () => {
  const store = new CreditsStore({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-')), 'c.json') });
  store.set('settings', { customSections: [{ id: 'a', source: 'vips' }] });
  const helix = {
    async request(method, url) {
      if (url.includes('vips')) throw Object.assign(new Error('Missing scope: channel:read:vips'), { status: 401 });
      return { data: url.includes('followers') ? [{ user_name: 'F1' }] : [], pagination: {} };
    },
  };
  const { data, errors } = await fetchCreditsData({ store, helix, user: { id: '1' } });
  assert.deepEqual(data.followers, ['F1']);
  assert.match(errors.join(), /VIP: serve un nuovo accesso a Twitch/);
});
