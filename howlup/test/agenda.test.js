import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agenda, cleanEvent, occurrences, occursOn, repeatText, toICS, addDays, weekday } from '../src/core/agenda.js';

test('date: giorni, settimana, cambio dell\'ora legale', () => {
  assert.equal(addDays('2026-10-24', 2), '2026-10-26'); // passa la notte del cambio ora
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekday('2026-10-19'), 1); // lunedì
  assert.equal(weekday('2026-10-25'), 7);
});

test('impegni ricorrenti: settimanali, ogni 2 settimane, mensili, fino a, giorni saltati', () => {
  const live = cleanEvent({ title: 'Live', date: '2026-10-20', time: '21:00', repeat: { freq: 'weekly', days: [2, 4] } });
  const days = occurrences([live], '2026-10-19', '2026-11-01').map((o) => o.day);
  assert.deepEqual(days, ['2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29']);
  const two = cleanEvent({ title: 'Palestra', date: '2026-10-19', repeat: { freq: 'weekly', interval: 2, days: [1, 3] } });
  assert.deepEqual(occurrences([two], '2026-10-19', '2026-11-08').map((o) => o.day), ['2026-10-19', '2026-10-21', '2026-11-02', '2026-11-04']);
  const month = cleanEvent({ title: 'Affitto', date: '2026-01-31', repeat: { freq: 'monthly', until: '2026-05-31' } });
  assert.deepEqual(occurrences([month], '2026-01-01', '2026-12-31').map((o) => o.day), ['2026-01-31', '2026-03-31', '2026-05-31']);
  const skip = { ...live, skip: ['2026-10-22'] };
  assert.equal(occursOn(skip, '2026-10-22'), false);
  assert.equal(repeatText(live), 'ogni martedì e giovedì');
  assert.equal(repeatText(two), 'ogni 2 settimane (lunedì e mercoledì)');
  assert.equal(repeatText(cleanEvent({ title: 'Lavoro', date: '2026-10-19', repeat: { freq: 'weekly', days: [1, 2, 3, 4, 5] } })), 'dal lunedì al venerdì');
});

test('agenda: salva, modifica un solo giorno della serie, elimina, cose da fare', () => {
  let saved = null;
  const a = new Agenda({ store: { load: () => saved, save: (d) => { saved = structuredClone(d); } } });
  assert.equal(a.categories.length, 3);
  const e = a.saveEvent({ title: 'Live', category: 'live', date: '2026-10-20', time: '21:00', endTime: '23:00', repeat: { freq: 'weekly', days: [2] } });
  const moved = a.saveOccurrence(e.id, '2026-10-27', { time: '22:00' });
  const list = occurrences(a.events, '2026-10-19', '2026-11-04');
  assert.deepEqual(list.map((o) => `${o.day} ${o.time}`), ['2026-10-20 21:00', '2026-10-27 22:00', '2026-11-03 21:00']);
  assert.equal(moved.repeat.freq, 'none');
  a.deleteEvent(e.id, '2026-11-03');
  assert.equal(occurrences(a.events, '2026-11-03', '2026-11-03').length, 0);
  assert.throws(() => a.saveEvent({ title: '', date: '2026-10-20' }), /titolo/);
  const t = a.saveTask({ title: 'Preparare la grafica', due: '2026-10-21' });
  a.saveTask({ ...t, done: true });
  assert.equal(a.tasks[0].done, true);
  const b = new Agenda({ store: { load: () => saved } });
  assert.equal(b.events.length, 2);
  assert.equal(b.tasks.length, 1);
  b.saveCategories([{ id: 'live', name: 'Live', color: '#e36dc9' }]);
  assert.ok(b.events.every((x) => x.category === 'live'));
});

test('calendario .ics per Google Calendar e il telefono', () => {
  const e = cleanEvent({ id: 'abc', title: 'Live, Elden Ring', category: 'live', date: '2026-10-20', time: '21:00', remindMin: 30, repeat: { freq: 'weekly', days: [2, 4], until: '2026-12-31' }, skip: ['2026-10-22'] });
  const ics = toICS([e]);
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261020T210000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=TU,TH;UNTIL=20261231T235959/);
  assert.match(ics, /EXDATE:20261022T210000/);
  assert.match(ics, /SUMMARY:🔴 Live\\, Elden Ring/);
  assert.match(ics, /TRIGGER:-PT30M/);
});
