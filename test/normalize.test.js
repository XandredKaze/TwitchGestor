import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromEventSub, testNotification, NOTIFICATION_TYPES } from '../src/core/normalize.js';
import { parseKofi, parseGenericDonation } from '../src/sources/webhooks.js';

const u = { user_id: '1', user_login: 'anna', user_name: 'Anna' };

test('follow', () => {
  const n = fromEventSub('channel.follow', { ...u, followed_at: 'x' }, 'm1');
  assert.equal(n.type, 'follow');
  assert.equal(n.id, 'm1');
  assert.deepEqual(n.user, { id: '1', login: 'anna', name: 'Anna' });
});

test('abbonamento regalato e tier', () => {
  const n = fromEventSub('channel.subscribe', { ...u, tier: '2000', is_gift: true });
  assert.equal(n.type, 'sub');
  assert.equal(n.tier, '2');
  assert.equal(n.isGift, true);
});

test('rinnovo con messaggio', () => {
  const n = fromEventSub('channel.subscription.message', {
    ...u, tier: '1000', cumulative_months: 14, streak_months: null, message: { text: 'ciao' },
  });
  assert.equal(n.type, 'resub');
  assert.equal(n.months, 14);
  assert.equal(n.amount, 14);
  assert.equal(n.message, 'ciao');
});

test('sub regalate anonime', () => {
  const n = fromEventSub('channel.subscription.gift', { user_id: null, is_anonymous: true, total: 5, tier: '1000' });
  assert.equal(n.user, null);
  assert.equal(n.amount, 5);
});

test('bits, raid e punti canale', () => {
  assert.equal(fromEventSub('channel.cheer', { ...u, is_anonymous: false, bits: 300, message: 'hey' }).amount, 300);
  const raid = fromEventSub('channel.raid', { from_broadcaster_user_id: '9', from_broadcaster_user_login: 'luca', from_broadcaster_user_name: 'Luca', viewers: 42 });
  assert.equal(raid.user.name, 'Luca');
  assert.equal(raid.amount, 42);
  const r = fromEventSub('channel.channel_points_custom_reward_redemption.add', {
    ...u, user_input: 'rock', reward: { id: 'r', title: 'Canzone', cost: 2000 },
  });
  assert.equal(r.reward.title, 'Canzone');
  assert.equal(r.message, 'rock');
});

test('donazione benefica Twitch con decimali', () => {
  const n = fromEventSub('channel.charity_campaign.donate', { ...u, charity_name: 'X', amount: { value: 1050, decimal_places: 2, currency: 'EUR' } });
  assert.equal(n.type, 'donation');
  assert.equal(n.amount, 10.5);
});

test('tipo sconosciuto', () => {
  assert.equal(fromEventSub('channel.update', {}), null);
});

test('notifiche di test per ogni tipo', () => {
  for (const type of NOTIFICATION_TYPES) assert.equal(testNotification(type).type, type);
});

test('Ko-fi: verifica il token e rispetta le donazioni private', () => {
  const data = JSON.stringify({ verification_token: 'abc', type: 'Donation', from_name: 'Anna', amount: '3.00', currency: 'EUR', message: 'segreto', is_public: false, kofi_transaction_id: 't1' });
  const n = parseKofi({ data }, 'abc');
  assert.equal(n.amount, 3);
  assert.equal(n.user, null);
  assert.equal(n.message, '');
  assert.equal(n.id, 'kofi:t1');
  assert.throws(() => parseKofi({ data }, 'sbagliato'), /verification_token/);
});

test('webhook generico', () => {
  const n = parseGenericDonation({ name: 'Anna', amount: '7.5', currency: 'usd' });
  assert.equal(n.amount, 7.5);
  assert.equal(n.currency, 'USD');
  assert.throws(() => parseGenericDonation({ name: 'x' }), /amount/);
});
