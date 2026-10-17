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
