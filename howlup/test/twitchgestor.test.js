import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTwitchLink } from '../src/twitchgestor.js';
import { livesToEvents, occurrences } from '../src/core/agenda.js';

/** TwitchGestor finto: risponde come quello vero a /api/schedule. */
function fakeTG({ down = false } = {}) {
  const calls = [];
  let entries = [{ id: 'a1', start: '2026-10-20T21:00', durationMin: 180, title: 'Elden Ring', game: 'Elden Ring', gameId: '512953', notes: '', autoTitle: true, applied: false, twitchId: 'tw1' }];
  const fetchFn = async (url, opts = {}) => {
    const path = url.replace(/^http:\/\/127\.0\.0\.1:\d+/, '');
    calls.push(`${opts.method ?? 'GET'} ${path}`);
    if (down) throw new Error('ECONNREFUSED');
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    if (path === '/api/schedule' && (opts.method ?? 'GET') === 'GET') return ok({ entries, canPublish: true });
    if (path === '/api/schedule' && opts.method === 'PUT') { entries = JSON.parse(opts.body).entries; return ok({ entries, canPublish: true }); }
    if (path === '/api/schedule/publish') return ok({ results: [] });
    return { ok: false, status: 404, json: async () => ({ error: 'no' }) };
  };
  return { fetchFn, calls, get entries() { return entries; } };
}

test('legge le live di TwitchGestor e le mostra come impegni', async () => {
  const tg = fakeTG();
  let changes = 0;
  const link = createTwitchLink({ fetchFn: tg.fetchFn, onChange: () => { changes += 1; } });
  await link.refresh();
  assert.equal(link.state.ok, true);
  assert.equal(changes, 1);
  await link.refresh();
  assert.equal(changes, 1, 'niente di nuovo, nessun aggiornamento');
  const ev = livesToEvents(link.state.entries);
  assert.deepEqual([ev[0].date, ev[0].time, ev[0].endTime, ev[0].category, ev[0].published], ['2026-10-20', '21:00', '', 'live', true]);
  assert.equal(occurrences(ev, '2026-10-20', '2026-10-20').length, 1);
});

test('modifiche da Howl-UP: salvate in TwitchGestor, ripubblicate sul calendario di Twitch', async () => {
  const tg = fakeTG();
  const link = createTwitchLink({ fetchFn: tg.fetchFn });
  await link.saveLive({ id: 'a1', start: '2026-10-20T22:00', durationMin: 120, title: 'Elden Ring: si sposta!' });
  assert.equal(tg.entries[0].start, '2026-10-20T22:00');
  assert.equal(tg.entries[0].twitchId, 'tw1', 'resta pubblicata');
  assert.ok(tg.calls.includes('POST /api/schedule/publish'));
  const nuova = await link.saveLive({ start: '2026-10-25T18:30', title: 'Chiacchiere' });
  assert.equal(tg.entries.length, 2);
  assert.ok(nuova.id);
  const added = await link.addWeeks({ from: '2026-10-26', weeks: 2, days: [2, 4], time: '21:00', durationMin: 180, title: 'Live fissa' });
  assert.equal(added.length, 4);
  assert.equal(await link.deleteLive('a1'), true);
  assert.equal(tg.entries.length, 5);
});

test('TwitchGestor spento: lo dice e non cambia niente', async () => {
  const link = createTwitchLink({ fetchFn: fakeTG({ down: true }).fetchFn });
  await link.refresh();
  assert.equal(link.state.ok, false);
  assert.match(link.state.error, /non risponde/);
  await assert.rejects(link.saveLive({ start: '2026-10-20T21:00' }), /non risponde/);
});
