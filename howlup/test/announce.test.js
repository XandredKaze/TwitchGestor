import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffLives, buildAnnouncement, Announcements, cleanAnnounceSettings } from '../src/core/announce.js';

const NOW = new Date(2026, 9, 19, 10, 0).getTime();
const L = (id, start, title = 'Elden Ring', game = 'Elden Ring') => ({ id, start, title, game });

test('cosa è cambiato: nuove, spostate, annullate, aggiornate (solo future)', () => {
  const before = [L('a', '2026-10-20T21:00'), L('b', '2026-10-22T21:00'), L('c', '2026-10-24T18:30', 'Chiacchiere', 'Just Chatting'), L('old', '2026-10-10T21:00')];
  const after = [L('a', '2026-10-20T22:00'), L('c', '2026-10-24T18:30', 'Chiacchiere con ospite', 'Just Chatting'), L('d', '2026-10-27T21:00'), L('old', '2026-10-11T21:00')];
  const ch = diffLives(before, after, NOW);
  assert.deepEqual(ch.map((c) => `${c.type}:${c.live.id}`), ['moved:a', 'cancelled:b', 'changed:c', 'new:d']);
});

test('testi degli annunci', () => {
  const moved = buildAnnouncement([{ type: 'moved', live: L('a', '2026-10-20T22:00'), before: L('a', '2026-10-20T21:00') }], { login: 'xandred_kaze' });
  assert.equal(moved.headline, 'CAMBIO DI PROGRAMMA');
  assert.match(moved.text, /La live di martedì 20 ottobre alle 21:00 si sposta a martedì 20 ottobre alle 22:00\.\nElden Ring\n🎮 Elden Ring\n\n👉 twitch.tv\/xandred_kaze/);
  const cancelled = buildAnnouncement([{ type: 'cancelled', live: L('b', '2026-10-22T21:00') }], { next: L('d', '2026-10-27T21:00') });
  assert.match(cancelled.text, /non ci sarà, mi dispiace!\nCi vediamo martedì 27 ottobre alle 21:00\./);
  const many = buildAnnouncement([{ type: 'new', live: L('x', '2026-10-20T21:00') }, { type: 'new', live: L('y', '2026-10-22T21:00') }]);
  assert.equal(many.kind, 'new-many');
  assert.match(many.text, /• Mar 20 ott, 21:00 — Elden Ring \(Elden Ring\)\n• Gio 22 ott/);
  const mixed = buildAnnouncement([{ type: 'new', live: L('x', '2026-10-20T21:00') }, { type: 'cancelled', live: L('y', '2026-10-22T21:00') }]);
  assert.equal(mixed.kind, 'mixed');
});

test('annunci: il primo elenco non annuncia nulla; invio automatico dopo il ritardo, fermabile', async () => {
  let now = NOW;
  const sent = [];
  const a = new Announcements({
    getSettings: () => ({ auto: { enabled: true, delayMin: 10 } }),
    getContext: () => ({ login: 'xandred_kaze' }),
    send: async (d, opts) => { sent.push([d.id, opts.text, Boolean(opts.image)]); return { telegram: 'ok' }; },
    now: () => now,
  });
  assert.equal(a.observe([L('a', '2026-10-20T21:00')]), null);
  const d = a.observe([L('a', '2026-10-20T21:30')]);
  assert.equal(d.kind, 'moved');
  assert.equal(a.observe([L('a', '2026-10-20T21:30')]), null, 'niente di nuovo');
  now += 5 * 60000; await a.tick();
  assert.equal(sent.length, 0);
  a.update(d.id, { text: 'Testo mio' });
  now += 6 * 60000; await a.tick();
  assert.deepEqual(sent, [[d.id, 'Testo mio', false]]);
  assert.equal(a.drafts[0].status, 'sent');
  const d2 = a.observe([]);
  a.hold(d2.id);
  now += 60 * 60000; await a.tick();
  assert.equal(sent.length, 1, 'fermato: non parte');
  a.dismiss(d2.id);
  assert.equal(a.drafts[0].status, 'dismissed');
});

test('impostazioni: webhook di Discord valido', () => {
  assert.equal(cleanAnnounceSettings({ discordWebhook: 'https://discord.com/api/webhooks/123/abc-DEF_9' }).discordWebhook, 'https://discord.com/api/webhooks/123/abc-DEF_9');
  assert.equal(cleanAnnounceSettings({ discordWebhook: 'https://sito-strano.example/x' }).discordWebhook, '');
  assert.equal(cleanAnnounceSettings({}).auto.enabled, false);
});
