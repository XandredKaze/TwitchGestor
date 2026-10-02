import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ChatCommands, userRank, humanDuration } from '../src/core/commands.js';
import { sanitizeConfig } from '../src/core/schema.js';

const defaults = JSON.parse(fs.readFileSync(new URL('../src/core/defaults.json', import.meta.url)));

function setup(overrides = {}) {
  let now = 1_000_000;
  const sent = [];
  const settings = {
    enabled: true,
    prefix: '!',
    list: [
      { id: 'discord', name: 'discord', aliases: ['dc'], action: 'reply', response: 'Discord: link · ciao {user}', permission: 'everyone', cooldown: 10, userCooldown: 0, enabled: true },
      { id: 'so', name: 'so', aliases: [], action: 'reply', response: 'Seguite {target}!', permission: 'moderator', cooldown: 0, userCooldown: 0, enabled: true },
      { id: 'morti', name: 'morti', aliases: [], action: 'reply', response: 'Morti: {count}', permission: 'everyone', cooldown: 0, userCooldown: 0, enabled: true },
      { id: 'scena', name: 'scena', aliases: [], action: 'scene', response: 'Scena: {scene}', permission: 'moderator', cooldown: 0, userCooldown: 0, enabled: true },
      { id: 'comandi', name: 'comandi', aliases: [], action: 'list', response: 'Comandi: {result}', permission: 'everyone', cooldown: 0, userCooldown: 0, enabled: true },
      { id: 'off', name: 'spento', aliases: [], action: 'reply', response: 'no', permission: 'everyone', cooldown: 0, userCooldown: 0, enabled: false },
    ],
    timers: [{ id: 't1', message: 'Seguimi su Instagram!', interval: 10, minLines: 3, enabled: true }],
    ...overrides,
  };
  const scenes = ['Inizio', 'Gioco', 'Fine'];
  const c = new ChatCommands({
    getConfig: () => settings,
    send: (t) => sent.push(t),
    now: () => now,
    vars: { channel: () => 'xandred_', uptime: async () => '2 ore' },
    actions: { scene: async (w) => scenes.find((s) => s.toLowerCase().startsWith(w.toLowerCase())) },
    log: { warn() {} },
  });
  return { c, sent, settings, advance: (ms) => { now += ms; } };
}
const viewer = (text, name = 'Anna') => ({ text, user: { id: name, login: name.toLowerCase(), name }, badges: [] });
const mod = (text) => ({ text, user: { id: 'm', login: 'mod', name: 'Mod' }, badges: [{ set_id: 'moderator' }] });

test('risponde ai comandi e ai nomi alternativi, ignora il resto', async () => {
  const { c, sent } = setup();
  assert.equal(await c.handle(viewer('!discord')), 'Discord: link · ciao Anna');
  assert.equal(await c.handle(viewer('ciao a tutti')), null);
  assert.equal(await c.handle(viewer('!inesistente')), null);
  assert.equal(await c.handle(viewer('!spento')), null);
  assert.deepEqual(sent, ['Discord: link · ciao Anna']);
});

test('attesa tra un uso e l\'altro (ma non per moderatori e canale)', async () => {
  const { c, advance } = setup();
  assert.ok(await c.handle(viewer('!dc', 'Anna')));
  assert.equal(await c.handle(viewer('!dc', 'Bea')), null, 'ancora in attesa');
  assert.ok(await c.handle(mod('!dc')), 'i moderatori non aspettano');
  advance(11_000);
  assert.ok(await c.handle(viewer('!dc', 'Bea')));
});

test('permessi: !so solo per i moderatori; {target} senza @', async () => {
  const { c } = setup();
  assert.equal(await c.handle(viewer('!so @Pippo')), null);
  assert.equal(await c.handle(mod('!so @Pippo')), 'Seguite Pippo!');
  assert.equal(userRank([{ set_id: 'broadcaster' }]), 4);
  assert.equal(userRank([{ set_id: 'founder' }]), 1);
});

test('contatore, elenco dei comandi, scena di OBS e variabili', async () => {
  const { c } = setup();
  assert.equal(await c.handle(viewer('!morti')), 'Morti: 1');
  assert.equal(await c.handle(viewer('!morti')), 'Morti: 2');
  assert.equal(await c.handle(viewer('!comandi')), 'Comandi: !discord !morti !comandi');
  assert.equal(await c.handle(mod('!scena gio')), 'Scena: Gioco');
  assert.equal(await c.render('{channel} è in live da {uptime} · {sconosciuta}'), 'xandred_ è in live da 2 ore · {sconosciuta}');
  const n = Number(await c.render('{random:5-6}'));
  assert.ok(n === 5 || n === 6);
});

test('la prova dalla dashboard non scrive in chat né conta, e il bot non risponde a sé stesso', async () => {
  const { c, sent } = setup();
  assert.equal(await c.handle(viewer('!morti'), { dryRun: true }), 'Morti: 1');
  assert.equal(await c.handle(viewer('!morti'), { dryRun: true }), 'Morti: 1');
  assert.deepEqual(sent, []);
  const { c: c2, sent: sent2, settings } = setup();
  settings.list[0].response = '!dc';
  await c2.handle(viewer('!dc'));
  assert.equal(await c2.handle({ ...viewer('!dc', 'Wolfery') }), null, 'messaggio appena scritto dal bot');
  assert.deepEqual(sent2, ['!dc']);
});

test('messaggi a tempo: solo dopo l\'intervallo e se in chat si è scritto abbastanza', async () => {
  const { c, sent, advance } = setup();
  c.tick(); // parte il conteggio
  advance(11 * 60000);
  c.tick();
  assert.deepEqual(sent, [], 'chat troppo silenziosa');
  for (const t of ['a', 'b', 'c']) await c.handle(viewer(t));
  c.tick();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent, ['Seguimi su Instagram!']);
});

test('impostazioni: nomi unici, senza "!", senza doppioni tra i nomi alternativi', () => {
  const out = sanitizeConfig({
    commands: {
      enabled: true,
      prefix: '?',
      list: [
        { id: 'a', name: '!Discord', aliases: ['DC', 'discord', 'bad name'], response: 'x', permission: 'boss' },
        { id: 'b', name: 'dc', response: 'doppione' },
        { id: 'c', name: 'ok', response: 'y', cooldown: 99999 },
      ],
    },
  }, defaults).commands;
  assert.equal(out.prefix, '?');
  assert.deepEqual(out.list.map((c) => c.name), ['discord', 'ok']);
  assert.deepEqual(out.list[0].aliases, ['dc']);
  assert.equal(out.list[0].permission, 'everyone');
  assert.equal(out.list[1].cooldown, 3600);
  assert.equal(humanDuration(3 * 3600 * 1000 + 12 * 60000), '3 ore e 12 minuti');
});
