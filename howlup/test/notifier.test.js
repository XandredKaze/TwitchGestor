import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Notifier, cleanSettings, isQuiet, buildBriefing } from '../src/core/notifier.js';
import { cleanEvent, cleanTask, DEFAULT_CATEGORIES } from '../src/core/agenda.js';

function setup({ settings = {}, start = new Date(2026, 9, 19, 7, 0).getTime() } = {}) { // lunedì 19 ottobre, 7:00
  let now = start;
  const sent = [];
  let saved = null;
  const events = [
    cleanEvent({ id: 'w', title: 'Lavoro', category: 'work', date: '2026-10-19', time: '09:00', remindMin: 30 }),
    cleanEvent({ id: 'l', title: 'Live', category: 'live', date: '2026-10-20', time: '21:00' }),
  ];
  const tasks = [cleanTask({ title: 'Bolletta', due: '2026-10-18' }), cleanTask({ title: 'Grafica', due: '2026-10-19' })];
  const n = new Notifier({
    getSettings: () => ({ ...settings, channels: { ntfy: { enabled: true, topic: 'howlup-test01' } } }),
    getData: () => ({ events, tasks, categories: DEFAULT_CATEGORIES }),
    getExtra: () => ({ recap: { startedAt: start - 10 * 3600000, durationMs: 9000000, viewers: { average: 23, peak: 41 }, followers: { gained: 8 }, chat: { messages: 640 } } }),
    send: (m) => { sent.push(m); },
    store: { load: () => saved, save: (d) => { saved = structuredClone(d); } },
    now: () => now,
  });
  return { n, sent, go: (min) => { now += min * 60000; }, saved: () => saved };
}

test('impostazioni: orari e valori ripuliti', () => {
  const s = cleanSettings({ briefing: { time: '25:00', days: [1, 9, 3] }, repeat: { everyMin: 1, maxTimes: 99 }, channels: { ntfy: { topic: 'no spazi!' } } });
  assert.equal(s.briefing.time, '08:00');
  assert.deepEqual(s.briefing.days, [1, 3]);
  assert.deepEqual([s.repeat.everyMin, s.repeat.maxTimes], [5, 30]);
  assert.equal(s.channels.ntfy.topic, '');
  assert.equal(isQuiet(new Date(2026, 9, 19, 23, 30), '23:00', '07:30'), true);
  assert.equal(isQuiet(new Date(2026, 9, 19, 7, 45), '23:00', '07:30'), false);
});

test('buongiorno: impegni, da fare, prossima live e ultima live', () => {
  const { n } = setup();
  const b = buildBriefing(n.getData(), { day: '2026-10-19', recap: n.getExtra().recap });
  assert.match(b.title, /Buongiorno! Lunedì 19 ottobre/);
  assert.match(b.text, /09:00 💼 Lavoro/);
  assert.match(b.text, /Bolletta \(in ritardo\)/);
  assert.match(b.text, /Prossima live: martedì 20 ottobre alle 21:00/);
  assert.match(b.text, /23 spettatori in media.*\+8 follower/);
});

test('arriva all\'ora scelta, una volta; si ripete finché non confermi, mai oltre il massimo', async () => {
  const { n, sent, go } = setup({ settings: { briefing: { time: '07:30' }, repeat: { everyMin: 15, maxTimes: 3 }, reminders: { enabled: false } } });
  await n.tick();
  assert.equal(sent.length, 0, 'alle 7:00 ancora no');
  go(30); await n.tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /Buongiorno/);
  go(1); await n.tick();
  assert.equal(sent.length, 1, 'non due volte');
  go(15); await n.tick();
  assert.equal(sent.length, 2);
  assert.match(sent[1].title, /^🔁/);
  go(15); await n.tick();
  go(15); await n.tick();
  assert.equal(sent.length, 3, 'al massimo 3 volte in tutto');
  assert.equal(n.pending().length, 1);
  n.ack(n.pending()[0].id);
  assert.equal(n.pending().length, 0);
});

test('confermata subito: niente ripetizioni; promemoria prima degli impegni', async () => {
  const { n, sent, go } = setup({ settings: { briefing: { enabled: false } } });
  go(31); await n.tick(); // 7:31: niente
  assert.equal(sent.length, 0);
  go(60); await n.tick(); // 8:31: promemoria del lavoro delle 9 (30 min prima)
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /Tra 29 min: Lavoro/);
  n.ack('');
  go(20); await n.tick();
  assert.equal(sent.length, 1, 'confermato: non si ripete');
});

test('di notte non si ripete', async () => {
  const { n, sent, go } = setup({ settings: { briefing: { time: '22:50' }, repeat: { everyMin: 5, quietFrom: '23:00', quietTo: '07:30' } }, start: new Date(2026, 9, 19, 22, 55).getTime() });
  await n.tick();
  assert.equal(sent.length, 1);
  go(10); await n.tick(); // 23:05
  assert.equal(sent.length, 1);
});
