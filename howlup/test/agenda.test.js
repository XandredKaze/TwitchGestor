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
  assert.equal(a.categories.length, 4);
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

test('turni di notte: si segnano i giorni del mese in un colpo, gli straordinari restano', async () => {
  const { Agenda, toICS } = await import('../src/core/agenda.js');
  const a = new Agenda({});
  assert.ok(a.categories.some((c) => c.id === 'cube'));
  assert.deepEqual([a.shift.time, a.shift.endTime], ['23:00', '07:00']);
  const r = a.setShifts({ from: '2026-11-01', to: '2026-11-30', days: ['2026-11-02', '2026-11-03', '2026-12-01'] });
  assert.deepEqual(r, { added: 2, removed: 0 });
  const e = a.events.find((x) => x.date === '2026-11-02');
  assert.deepEqual([e.title, e.category, e.time, e.endTime, e.source], ['Turno al Cube', 'cube', '23:00', '07:00', 'shift']);
  assert.match(toICS([e], { categories: a.categories }), /DTSTART:20261102T230000\r\nDTEND:20261103T070000/);
  // straordinario su un turno: resta com'è quando risalvi il mese
  a.saveEvent({ ...e, endTime: '09:00' });
  const again = a.setShifts({ from: '2026-11-01', to: '2026-11-30', days: ['2026-11-02', '2026-11-05'] });
  assert.deepEqual(again, { added: 1, removed: 1 });
  assert.equal(a.events.find((x) => x.date === '2026-11-02').endTime, '09:00');
  // gli impegni normali non si toccano
  a.saveEvent({ title: 'Riunione', date: '2026-11-03', time: '10:00', category: 'work' });
  a.setShifts({ from: '2026-11-01', to: '2026-11-30', days: [], shift: { time: '22:00', endTime: '06:00' } });
  assert.deepEqual(a.events.map((x) => x.title), ['Riunione']);
  assert.equal(a.shift.time, '22:00');
  assert.throws(() => a.setShifts({ from: '2026-11-30', to: '2026-11-01' }), /Periodo/);
});

test('note: titolo obbligatorio, giorno e ora facoltativi, modifica ed eliminazione', async () => {
  const { Agenda } = await import('../src/core/agenda.js');
  let saved = null;
  const a = new Agenda({ store: { load: () => saved, save: (d) => { saved = structuredClone(d); } } });
  assert.throws(() => a.saveNote({ title: '  ' }), /titolo/);
  const n = a.saveNote({ title: 'Idee live', subtitle: 'Halloween', body: 'Costume da lupo\nGiochi horror', time: '21:00' });
  assert.deepEqual([n.date, n.time], ['', '']); // l'ora senza giorno non vale
  const dated = a.saveNote({ title: 'Riunione', date: '2026-10-21', time: '10:30' });
  assert.deepEqual([dated.date, dated.time], ['2026-10-21', '10:30']);
  const edited = a.saveNote({ ...n, body: 'Solo costume' });
  assert.equal(edited.createdAt, n.createdAt);
  assert.equal(new Agenda({ store: { load: () => saved } }).notes.find((x) => x.id === n.id).body, 'Solo costume');
  assert.equal(a.deleteNote(n.id), true);
  assert.deepEqual(a.notes.map((x) => x.title), ['Riunione']);
});

test('caratteristiche della categoria: orario, promemoria e note fisse, anche sugli impegni futuri già creati', async () => {
  const { Agenda } = await import('../src/core/agenda.js');
  let now = new Date(2026, 9, 20, 12).getTime();
  const a = new Agenda({ now: () => now });
  const past = a.saveEvent({ title: 'Vecchio', category: 'work', date: '2026-10-01', time: '09:00' });
  const f1 = a.saveEvent({ title: 'Ufficio', category: 'work', date: '2026-10-22', time: '09:00', remindMin: 30 });
  const f2 = a.saveEvent({ title: 'Cliente', category: 'work', date: '2026-10-23', time: '15:00', remindMin: 30 });
  const set = (defaults) => a.saveCategories(a.categories.map((c) => (c.id === 'work' ? { ...c, defaults } : c)));
  set({ time: '10:00', endTime: '12:00', remindMin: 60, notes: '  Portare il badge  ', extra: 'no' });
  assert.deepEqual(a.categories.find((c) => c.id === 'work').defaults, { time: '10:00', endTime: '12:00', remindMin: 60, notes: 'Portare il badge' });
  const ev = (id) => a.events.find((e) => e.id === id);
  assert.deepEqual([ev(f1.id).time, ev(f1.id).endTime, ev(f1.id).remindMin], ['10:00', '12:00', 60]);
  assert.equal(ev(past.id).time, '09:00'); // quelli passati non si toccano
  a.saveEvent({ ...ev(f2.id), time: '16:00' }); // cambiato a mano
  set({ time: '11:00', endTime: '12:00', remindMin: null });
  assert.deepEqual([ev(f1.id).time, ev(f1.id).remindMin], ['11:00', null]);
  assert.equal(ev(f2.id).time, '16:00');
});

test('sovrapposizioni: avvisa se l\'impegno si accavalla con un altro (anche di notte e nelle serie)', async () => {
  const { findOverlaps, cleanEvent } = await import('../src/core/agenda.js');
  const ev = [
    cleanEvent({ id: 'cube', title: 'Turno al Cube', category: 'work', date: '2026-10-21', time: '23:00', endTime: '07:00' }),
    cleanEvent({ id: 'gym', title: 'Palestra', category: 'personal', date: '2026-10-19', time: '18:30', endTime: '19:30', repeat: { freq: 'weekly', days: [1, 3] } }),
    cleanEvent({ id: 'all', title: 'Compleanno', category: 'personal', date: '2026-10-22', allDay: true }),
    { id: 'tg-1', title: 'Live', category: 'live', date: '2026-10-22', time: '21:00', endTime: '', durationMin: 180 },
  ];
  const t = '2026-10-20';
  const c = (x) => cleanEvent({ title: 'Nuovo', category: 'personal', ...x });
  assert.deepEqual(findOverlaps(c({ date: '2026-10-22', time: '06:00', endTime: '08:00' }), ev, { today: t }).map((o) => o.title), ['Turno al Cube']); // il turno finisce alle 7 del giorno dopo
  assert.deepEqual(findOverlaps(c({ date: '2026-10-22', time: '07:00' }), ev, { today: t }), []); // finisce esattamente quando inizia
  assert.deepEqual(findOverlaps(c({ date: '2026-10-22', time: '23:30' }), ev, { today: t }).map((o) => o.title), ['Live']); // live di 3 ore
  assert.deepEqual(findOverlaps(c({ date: '2026-10-21', time: '19:00' }), ev, { today: t }).map((o) => o.title), ['Palestra']); // serie del mercoledì
  const weekly = findOverlaps(c({ date: '2026-10-20', time: '19:00', repeat: { freq: 'weekly', days: [3] } }), ev, { today: t, max: 3 });
  assert.equal(weekly.length, 3);
  assert.deepEqual(findOverlaps({ ...ev[1] }, ev, { today: t }), []); // se stesso non conta
  assert.deepEqual(findOverlaps(c({ date: '2026-10-22', allDay: true }), ev, { today: t }), []);
});
