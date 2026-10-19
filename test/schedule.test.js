import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schedule, generateWeeks, cleanEntry, toLocal, fromLocal } from '../src/core/schedule.js';

test('crea più settimane nei giorni scelti, alla stessa ora', () => {
  // 19 ottobre 2026 è un lunedì
  const list = generateWeeks({ from: '2026-10-19', weeks: 2, days: [2, 6], time: '21:30', durationMin: 150, title: 'Elden Ring', game: 'Elden Ring', gameId: '1' });
  assert.deepEqual(list.map((e) => e.start), ['2026-10-20T21:30', '2026-10-24T21:30', '2026-10-27T21:30', '2026-10-31T21:30']);
  assert.equal(list[0].durationMin, 150);
  assert.equal(list[0].autoTitle, true);
  assert.equal(cleanEntry({ start: 'domani' }), null);
  assert.equal(cleanEntry({ start: '2026-10-20T21:00', durationMin: 99999 }).durationMin, 1440);
});

test('prossima live, titolo da impostare 10 minuti prima, niente doppioni', () => {
  let now = fromLocal('2026-10-20T20:40');
  const s = new Schedule({ now: () => now });
  s.replace([
    { id: 'a', start: '2026-10-20T21:00', durationMin: 120, title: 'Live A', gameId: '1' },
    { id: 'b', start: '2026-10-24T21:00', title: 'Live B' },
    { id: 'c', start: '2026-10-10T21:00', title: 'vecchia' },
  ]);
  assert.equal(s.next().id, 'a');
  assert.deepEqual(s.upcoming().map((e) => e.id), ['a', 'b']);
  assert.deepEqual(s.due(), [], 'ancora troppo presto');
  now = fromLocal('2026-10-20T20:51');
  assert.deepEqual(s.due().map((e) => e.id), ['a']);
  s.markApplied('a');
  assert.deepEqual(s.due(), []);
  // cambiando il titolo si reimposta di nuovo
  s.replace(s.entries.map((e) => (e.id === 'a' ? { ...e, title: 'Live A bis' } : e)));
  assert.deepEqual(s.due().map((e) => e.id), ['a']);
  assert.equal(toLocal(fromLocal('2026-10-20T21:00')), '2026-10-20T21:00');
});

test('le live già nel calendario di Twitch entrano nella Programmazione una volta sola', async () => {
  const { segmentsToEntries, toLocal } = await import('../src/core/schedule.js');
  const now = Date.parse('2026-10-19T12:00:00Z');
  const seg = (id, start, extra = {}) => ({ id, start_time: start, end_time: new Date(Date.parse(start) + 3 * 3600000).toISOString(), title: 'Isaac', category: { id: '123', name: 'The Binding of Isaac' }, ...extra });
  const segments = [
    seg('a', '2026-10-21T19:00:00Z'),
    seg('b', '2026-10-23T19:00:00Z', { is_recurring: true }),
    seg('c', '2026-10-24T19:00:00Z', { canceled_until: '2026-10-25T00:00:00Z' }),
    seg('old', '2026-10-01T19:00:00Z'),
    seg('linked', '2026-10-25T19:00:00Z'),
  ];
  const existing = [{ id: 'x', start: '2026-10-30T21:00', twitchId: 'linked' }];
  const r = segmentsToEntries(existing, segments, { now });
  assert.equal(r.added.length, 2);
  const [a, b] = r.added;
  assert.deepEqual([a.start, a.durationMin, a.title, a.game, a.gameId, a.twitchId], [toLocal(Date.parse('2026-10-21T19:00:00Z')), 180, 'Isaac', 'The Binding of Isaac', '123', 'a']);
  assert.equal(b.twitchId, ''); // ricorrente: non collegata, così non si tocca la serie su Twitch
  // la seconda volta (o se le hai cancellate) non tornano
  assert.equal(segmentsToEntries(existing, segments, { now, seen: r.seen }).added.length, 0);
});
