import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveStats, computeRecap, recapText, dayKey } from '../src/core/livestats.js';

const T0 = Date.parse('2026-10-18T18:00:00Z');
function setup() {
  let now = T0;
  let saved = null;
  const stats = new LiveStats({ store: { load: () => saved, save: (d) => { saved = JSON.parse(JSON.stringify(d)); } }, now: () => now });
  return { stats, advance: (ms) => { now += ms; }, saved: () => saved };
}

test('durante la live: spettatori, chat e follower; a fine live il riepilogo', () => {
  const { stats, advance } = setup();
  stats.totals({ followers: 100, subscribers: 5 });
  stats.start(new Date(T0).toISOString());
  stats.totals({ followers: 100, subscribers: 5 });
  for (const v of [10, 20, 30, 20]) { stats.sample(v); advance(60000); }
  stats.chat('anna', 'Anna'); stats.chat('anna', 'Anna'); stats.chat('bea', 'Bea');
  advance(3600000 - 240000);
  stats.totals({ followers: 107, subscribers: 6 });
  const live = stats.end();
  const r = computeRecap(live, {
    session: { follows: ['Carlo'], subs: ['Dina'], resubs: [], gifters: [{ name: 'Eva', value: 5 }], cheers: [{ name: 'Fede', value: 300 }], donations: [{ name: 'Gio', value: 5, currency: 'EUR' }], raids: [{ name: 'Hugo', value: 12 }], redemptions: [] },
    titles: [{ at: T0, title: 'Elden Ring', game: 'Elden Ring' }],
  });
  assert.equal(r.durationMs, 3600000);
  assert.deepEqual([r.viewers.peak, r.viewers.average, r.viewers.hoursWatched], [30, 20, 20]);
  assert.equal(r.followers.gained, 7);
  assert.equal(r.subscribers.gifted, 5);
  assert.equal(r.bits.total, 300);
  assert.deepEqual(r.donations.totals, { EUR: 5 });
  assert.deepEqual([r.chat.messages, r.chat.people, r.chat.top[0].name], [3, 2, 'Anna']);
  assert.deepEqual(r.games, ['Elden Ring']);
  assert.equal(r.compare, undefined, 'senza live precedenti nessun confronto');
  const text = recapText(r);
  assert.match(text, /Spettatori in media: <b>20<\/b>/);
  assert.match(text, /Hugo \(12\)/);
});

test('confronto con la media delle live precedenti', () => {
  const prev = [{ viewers: { average: 10, peak: 20 }, durationMs: 3600000, chat: { messages: 100 }, followers: { gained: 2 } }];
  const live = { startedAt: T0, endedAt: T0 + 7200000, samples: [[T0, 15]], messages: 50, chatters: {}, followersStart: 10, followersEnd: 15 };
  const r = computeRecap(live, { previous: prev });
  assert.deepEqual(r.compare, { lives: 1, averageViewers: 50, peakViewers: -25, duration: 100, messages: -50, followersGained: 3 });
});

test('ritrova la live dopo un riavvio; statistiche dei giorni e delle live', () => {
  const a = setup();
  a.stats.totals({ followers: 50 });
  a.stats.start(T0);
  a.stats.sample(8);
  a.stats.save();
  const b = new LiveStats({ store: { load: a.saved, save() {} }, now: () => T0 + 1000 });
  assert.ok(b.current);
  b.start(T0 + 20000);
  assert.equal(b.lives.length, 1, 'stessa live');
  const live = b.end(T0 + 3600000);
  live.recap = computeRecap(live, {});
  const o = b.overview(30);
  assert.equal(o.lives.length, 1);
  assert.equal(o.lives[0].averageViewers, 8);
  assert.deepEqual(o.daily, [{ date: dayKey(T0), followers: 50 }]);
});
