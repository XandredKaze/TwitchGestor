import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TitleLog } from '../src/core/titles.js';

function setup() {
  let now = Date.parse('2026-10-18T20:00:00Z');
  let saved = null;
  const log = new TitleLog({ store: { load: () => saved, save: (d) => { saved = JSON.parse(JSON.stringify(d)); } }, now: () => now });
  return { log, advance: (ms) => { now += ms; }, saved: () => saved };
}

test('registra le live con titolo, categoria e i cambi durante la diretta', () => {
  const { log, advance } = setup();
  log.update({ title: 'fuori live', game: 'X' });
  assert.equal(log.lives.length, 0, 'fuori dalla live non registra');
  log.online({ startedAt: '2026-10-18T20:00:00Z', title: 'Elden Ring cieco', game: 'Elden Ring', gameId: '1' });
  log.online({ startedAt: '2026-10-18T20:00:20Z', title: 'Elden Ring cieco', game: 'Elden Ring', gameId: '1' });
  assert.equal(log.lives.length, 1, 'stessa live (stesso inizio)');
  advance(3600000);
  log.update({ title: 'Elden Ring cieco - boss finale', game: 'Elden Ring', gameId: '1' });
  log.update({ title: 'Elden Ring cieco - boss finale', game: 'Elden Ring', gameId: '1' });
  advance(1800000);
  log.offline();
  const live = log.lives[0];
  assert.equal(live.changes.length, 2);
  assert.equal(live.endedAt - live.startedAt, 5400000);
  assert.equal(log.current, null);
});

test('titoli usati senza doppioni, il più recente per primo, con categoria per riusarli', () => {
  const { log, advance } = setup();
  log.online({ startedAt: '2026-10-10T20:00:00Z', title: 'Just Chatting con voi', game: 'Just Chatting', gameId: '509658' });
  log.offline();
  advance(86400000);
  log.online({ startedAt: '2026-10-11T20:00:00Z', title: 'Minecraft hardcore', game: 'Minecraft', gameId: '27471' });
  log.offline();
  advance(86400000);
  log.online({ startedAt: '2026-10-12T20:00:00Z', title: 'just chatting con voi', game: 'Just Chatting', gameId: '509658' });
  const t = log.titles();
  assert.deepEqual(t.map((x) => [x.title, x.count]), [['just chatting con voi', 2], ['Minecraft hardcore', 1]]);
  assert.equal(t[1].gameId, '27471');
});

test('dopo un riavvio ritrova lo storico; una live rimasta aperta si chiude', () => {
  const a = setup();
  a.log.online({ startedAt: '2026-10-18T20:00:00Z', title: 'A', game: 'G' });
  a.advance(600000);
  a.log.seen();
  const b = new TitleLog({ store: { load: a.saved, save() {} } });
  assert.equal(b.lives.length, 1);
  b.online({ startedAt: '2026-10-19T20:00:00Z', title: 'B', game: 'G' });
  assert.equal(b.lives[1].endedAt, Date.parse('2026-10-18T20:10:00Z'), 'chiusa all\'ultimo momento in cui era in corso');
  assert.equal(b.current.changes[0].title, 'B');
});
