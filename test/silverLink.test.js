import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createSilverLink, eventText } from '../src/silverLink.js';
import { sniff } from '../src/silverAssets.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'silver-')), 'keys.json');

test('Silver si collega solo dopo "Consenti", e la chiave si riceve una volta', () => {
  const file = tmp();
  const s = createSilverLink({}, { file });
  const { id } = s.request('DESKTOP-XAN', '::ffff:192.168.1.20');
  assert.equal(s.poll(id).status, 'pending');
  assert.deepEqual(s.pending().map((r) => [r.pc, r.ip]), [['DESKTOP-XAN', '192.168.1.20']]);
  s.allow(id);
  const got = s.poll(id);
  assert.equal(got.status, 'ok');
  assert.equal(s.poll(id).status, 'gone');
  assert.ok(s.check(got.key));
  assert.ok(!s.check('sbagliata'));
  assert.ok(!fs.readFileSync(file, 'utf8').includes(got.key)); // salvata solo l'impronta
  // stesso PC di nuovo: la chiave vecchia non vale più
  const again = s.request('DESKTOP-XAN', '');
  s.allow(again.id);
  const key2 = s.poll(again.id).key;
  assert.ok(s.check(key2) && !s.check(got.key));
  assert.equal(s.devices().length, 1);
  s.unpair(s.devices()[0].id);
  assert.ok(!s.check(key2));
  // rifiutato
  const no = s.request('ALTRO', '');
  s.deny(no.id);
  assert.equal(s.poll(no.id).status, 'denied');
});

test('avvisi per Silver: testo in italiano, solo quelli nuovi, niente prove', async () => {
  const manager = new EventEmitter();
  const s = createSilverLink({ manager }, { file: tmp() });
  manager.emit('notification', { type: 'follow', user: { name: 'Lupo' } });
  manager.emit('notification', { type: 'donation', user: { name: 'Ada' }, amount: 5, currency: 'EUR' });
  manager.emit('notification', { type: 'follow', user: { name: 'Prova' }, test: true });
  const f = await s.feed(0);
  assert.deepEqual(f.events.map((e) => e.text), ['Nuovo follower: Lupo.', 'Ada ha donato 5 EUR.']);
  assert.equal((await s.feed(f.seq)).events.length, 0);
  assert.equal(eventText({ type: 'raid', user: { name: 'X' }, amount: 12 }), 'Raid di X con 12 spettatori.');
});

test('comandi di Silver: scena per nome parziale e nota in Howl-UP', async () => {
  let scene, sent;
  const obs = { state: () => ({ scenes: ['Inizio', 'Gioco', 'Pausa'], current: 'Inizio' }), setScene: async (n) => { scene = n; } };
  const fetchFn = async (url, opts) => {
    if (url.endsWith('/api/upcoming?days=7')) return { ok: true, json: async () => ({ today: '2026-10-29', events: [{ day: '2026-10-29', time: '18:00', title: 'Palestra' }], tasks: [] }) };
    sent = { url, body: JSON.parse(opts.body), h: opts.headers };
    return { ok: true };
  };
  const s = createSilverLink({ obs }, { file: tmp(), howlupPort: 3999, fetchFn });
  assert.equal((await s.run({ action: 'scene', scene: 'gio' })).text, 'Scena: Gioco.');
  assert.equal(scene, 'Gioco');
  assert.match((await s.run({ action: 'scene', scene: 'boh' })).text, /Non trovo/);
  assert.equal((await s.run({ action: 'note', text: 'comprare il microfono' })).text, 'Segnato nelle note di Howl-UP.');
  assert.equal(sent.url, 'http://127.0.0.1:3999/api/notes');
  assert.equal(sent.body.note.title, 'comprare il microfono');
  assert.equal(sent.h['x-howlup'], '1');
  assert.equal((await s.feed(0)).agenda.events[0].title, 'Palestra'); // l'agenda di Howl-UP arriva a Silver
  // impegno creato parlando con Silver: va a Howl-UP così com'è
  const fetch2 = async (url, opts) => { sent = { url, body: JSON.parse(opts.body), method: opts.method }; return { ok: true, json: async () => ({ event: { id: 'e1' } }) }; };
  const s2 = createSilverLink({ obs }, { file: tmp(), howlupPort: 3999, fetchFn: fetch2 });
  const r = await s2.run({ action: 'event', event: { title: 'Dentista', date: '2026-10-30', time: '16:00' } });
  assert.equal(r.text, "Salvato nell'agenda di Howl-UP.");
  assert.deepEqual([sent.url, sent.method, sent.body.event.title], ['http://127.0.0.1:3999/api/events', 'PUT', 'Dentista']);
});

test('immagine e voce di Silver: si riconoscono dal contenuto', () => {
  assert.equal(sniff(Buffer.from('89504e470d0a1a0a0000000d', 'hex')), 'png');
  assert.equal(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])), 'webp');
  assert.equal(sniff(Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000')), 'mp3');
  assert.equal(sniff(Buffer.from('<html>ciao mondo</html>')), null);
});
