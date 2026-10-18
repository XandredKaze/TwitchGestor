import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramNotifier, fillText, DEFAULT_TEXTS } from '../src/core/telegramNotify.js';

function setup(cfg = {}, start = new Date(2026, 9, 19, 9, 0).getTime()) { // lunedì 19 ottobre, 9:00
  const sent = [];
  let now = start;
  let saved = null;
  const n = new TelegramNotifier({
    getConfig: () => ({ enabled: true, token: 't', chatId: '1', channelId: '-100', channelReminder: true, reminderMin: 30, channelWeekly: true, weeklyDay: 1, weeklyHour: 10, channelLiveStart: true, ...cfg }),
    send: (where, text) => { sent.push([where, text]); },
    store: { load: () => saved, save: (d) => { saved = structuredClone(d); } },
    now: () => now,
  });
  return { n, sent, tick: (ms) => { now += ms; }, at: () => now };
}
const VARS = { channel: 'xandred_kaze', link: 'https://twitch.tv/xandred_kaze', next: 'giovedì alle 21:00', title: '', game: '' };

test('testi: variabili e caratteri sicuri per Telegram', () => {
  assert.equal(fillText('Ciao {channel} <3 {boh}', { channel: 'A&B' }), 'Ciao A&amp;B &lt;3 {boh}');
  assert.match(fillText(DEFAULT_TEXTS.liveStart, { ...VARS, title: 'Elden Ring', game: 'Elden Ring' }), /xandred_kaze è in live!\nElden Ring/);
});

test('inizio live: privato solo se richiesto, canale con il suo testo', () => {
  const { n, sent } = setup({ sendLiveStart: false, texts: { liveStart: 'LIVE {title}' } });
  n.liveStart({ ...VARS, title: 'Prova' });
  assert.deepEqual(sent, [['channel', 'LIVE Prova']]);
  const b = setup({ sendLiveStart: true, channelId: '' });
  b.n.liveStart(VARS);
  assert.deepEqual(b.sent.map((x) => x[0]), ['private']);
  const off = setup({ enabled: false });
  off.n.liveStart(VARS);
  assert.equal(off.sent.length, 0);
});

test('avvisi privati: raid, donazioni e bits sopra la soglia, mai i test', () => {
  const { n, sent } = setup({ donationMin: 5, bitsMin: 500 });
  n.notification({ type: 'raid', user: { name: 'Amico' }, amount: 12 });
  n.notification({ type: 'donation', user: { name: 'Nonna' }, amount: 2, currency: 'EUR' });
  n.notification({ type: 'donation', user: { name: 'Nonna' }, amount: 10, currency: 'EUR', message: 'brava <3' });
  n.notification({ type: 'cheer', user: { name: 'Pixel' }, amount: 100 });
  n.notification({ type: 'cheer', user: { name: 'Pixel' }, amount: 1000 });
  n.notification({ type: 'raid', user: { name: 'Prova' }, amount: 5, test: true });
  assert.equal(sent.length, 3);
  assert.ok(sent.every(([w]) => w === 'private'));
  assert.match(sent[1][1], /10 EUR\n«brava &lt;3»/);
});

test('connessione pessima per 20 secondi: un avviso, poi silenzio per 10 minuti', () => {
  const { n, sent, tick } = setup();
  const bad = { active: true, quality: { level: 1 }, droppedPct: 12 };
  n.streamHealth(bad); tick(10000); n.streamHealth(bad);
  assert.equal(sent.length, 0);
  tick(11000); n.streamHealth(bad);
  assert.equal(sent.length, 1);
  tick(60000); n.streamHealth(bad);
  assert.equal(sent.length, 1);
  n.streamHealth({ active: true, quality: { level: 4 } });
  tick(10 * 60000); n.streamHealth(bad); tick(21000); n.streamHealth(bad);
  assert.equal(sent.length, 2);
});

test('promemoria sul canale una volta sola, programmazione della settimana il lunedì', () => {
  const { n, sent, tick, at } = setup();
  const start = at() + 31 * 60000;
  const entries = [{ id: 'a', start, title: 'Elden Ring', game: 'Elden Ring' }, { id: 'b', start: at() + 3 * 86400000, title: 'Chiacchiere', game: 'Just Chatting' }];
  n.tick(entries, VARS);
  assert.equal(sent.length, 0); // 31 minuti prima: ancora presto, e sono le 9 (programmazione alle 10)
  tick(60000); n.tick(entries, VARS);
  assert.equal(sent.length, 1);
  assert.match(sent[0][1], /Tra 30 minuti si va in live!\nElden Ring/);
  tick(60000); n.tick(entries, VARS);
  assert.equal(sent.length, 1);
  tick(60 * 60000); n.tick(entries, VARS); // 10:02 di lunedì
  assert.equal(sent.length, 2);
  assert.match(sent[1][1], /Le live di questa settimana\n\n• Giovedì 22 ott, 09:00 — Chiacchiere \(Just Chatting\)/);
  tick(60000); n.tick(entries, VARS);
  assert.equal(sent.length, 2);
});

test('promemoria saltato se TwitchGestor era spento fino a poco prima della live', () => {
  const { n, sent, at } = setup({ channelWeekly: false });
  n.tick([{ id: 'x', start: at() + 5 * 60000, title: 'T' }], VARS);
  assert.equal(sent.length, 0);
});
