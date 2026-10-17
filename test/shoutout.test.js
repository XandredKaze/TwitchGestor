import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AutoShoutout, renderShoutout, cleanLogin, shoutoutCard, OFFICIAL_GAP_MS } from '../src/core/shoutout.js';
import { sanitizeConfig } from '../src/core/schema.js';

const defaults = JSON.parse(fs.readFileSync(new URL('../src/core/defaults.json', import.meta.url)));
const CHANNELS = {
  luna: { id: '1', login: 'luna', name: 'LunaRossa', game: 'Minecraft', title: 'costruiamo' },
  drago: { id: '2', login: 'drago', name: 'Drago_TV', game: '', title: '' },
};

function setup(cfg = {}, { live = '2026-10-16T18:00:00Z' } = {}) {
  const sent = [];
  const official = [];
  let started = live;
  let saved = null;
  const so = new AutoShoutout({
    getConfig: () => ({ ...defaults.shoutouts, enabled: true, users: [{ login: 'luna' }, { login: 'drago', message: 'Seguite {user}!' }], ...cfg }),
    send: async (t) => { sent.push(t); },
    shoutout: async (id) => { official.push(id); },
    channelInfo: async (login) => CHANNELS[login] ?? null,
    liveSince: async () => started,
    store: { load: () => saved, save: (d) => { saved = d; } },
    log: { warn() {} },
  });
  return { so, sent, official, setLive: (v) => { started = v; }, saved: () => saved };
}
const msg = (login) => ({ user: { id: `u-${login}`, login, name: login } });

test('testo dello shoutout e nomi dei canali', () => {
  assert.equal(renderShoutout('Da {user} ({login}) con {game}: {link}', CHANNELS.luna), 'Da LunaRossa (luna) con Minecraft: twitch.tv/luna');
  assert.match(renderShoutout('', CHANNELS.drago), /Drago_TV.*qualcosa di bello.*twitch\.tv\/drago/);
  assert.equal(cleanLogin('@Luna'), 'luna');
  assert.equal(cleanLogin('https://www.twitch.tv/Drago_TV/videos'), 'drago_tv');
  assert.equal(cleanLogin('nome non valido'), '');
});

test('solo le persone scelte, solo al primo messaggio della live', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { so, sent, official, setLive } = setup();
  assert.equal(await so.handle(msg('anna')), null, 'non è nell\'elenco');
  const r = await so.handle(msg('Luna'));
  assert.equal(r.chat, 'ok');
  assert.deepEqual(sent, ['📣 Passate a trovare LunaRossa! L\'ultima volta era in live con Minecraft → twitch.tv/luna']);
  assert.equal(await so.handle(msg('luna')), null, 'secondo messaggio: niente');
  await so.handle(msg('drago'));
  assert.equal(sent[1], 'Seguite Drago_TV!', 'messaggio personalizzato');
  // shoutout ufficiali: il primo subito, il secondo dopo 2 minuti (limite di Twitch)
  t.mock.timers.tick(0);
  await new Promise(setImmediate);
  assert.deepEqual(official, ['1']);
  assert.equal(so.history[1].official, 'ok');
  assert.equal(so.history[0].official, 'in coda');
  t.mock.timers.tick(OFFICIAL_GAP_MS);
  await new Promise(setImmediate);
  assert.deepEqual(official, ['1', '2']);
  // nuova live: si ricomincia
  setLive('2026-10-17T18:00:00Z');
  assert.ok(await so.handle(msg('luna')));
  assert.equal(sent.length, 3);
});

test('fuori dalla live non fa nulla (e saluta alla prossima), a meno che non sia scelto', async () => {
  const off = setup({}, { live: null });
  assert.equal(await off.so.handle(msg('luna')), null);
  off.setLive('2026-10-16T18:00:00Z');
  assert.ok(await off.so.handle(msg('luna')), 'appena vai in live lo saluta');

  const any = setup({ onlyLive: false }, { live: null });
  const r = await any.so.handle(msg('luna'));
  assert.equal(r.chat, 'ok');
  assert.match(r.official, /solo quando sei in live/);
  assert.equal(await any.so.handle(msg('luna')), null, 'una volta al giorno');
});

test('ricorda chi è già stato salutato anche dopo un riavvio; "Rifai" ricomincia', async () => {
  const a = setup({ official: false });
  await a.so.handle(msg('luna'));
  const b = new AutoShoutout({
    getConfig: () => ({ ...defaults.shoutouts, enabled: true, official: false, users: [{ login: 'luna' }] }),
    send: async () => { throw new Error('non dovrebbe scrivere'); },
    channelInfo: async (l) => CHANNELS[l],
    liveSince: async () => '2026-10-16T18:00:00Z',
    store: { load: a.saved, save() {} },
  });
  assert.equal(await b.handle(msg('luna')), null);
  a.so.reset();
  assert.ok(await a.so.handle(msg('luna')));
});

test('spento non fa nulla; impostazioni ripulite', async () => {
  const { so, sent } = setup({ enabled: false });
  assert.equal(await so.handle(msg('luna')), null);
  assert.equal(sent.length, 0);
  const s = sanitizeConfig({ shoutouts: { enabled: true, official: false, users: ['@Luna', 'luna', { login: 'twitch.tv/Drago', message: ' Ciao {user} ' }, 'x y'] } }, defaults).shoutouts;
  assert.deepEqual(s.users, [{ login: 'luna' }, { login: 'drago', message: 'Ciao {user}' }]);
  assert.equal(s.official, false);
  assert.equal(s.onlyLive, true);
});

test('scheda dello shoutout nella chat di OBS (se attiva)', async () => {
  const cards = [];
  const make = (obsCard) => new AutoShoutout({
    getConfig: () => ({ ...defaults.shoutouts, enabled: true, official: false, obsCard, users: [{ login: 'luna' }] }),
    send: async () => {},
    channelInfo: async () => ({ ...CHANNELS.luna, avatar: 'https://img/luna.png' }),
    liveSince: async () => '2026-10-16T18:00:00Z',
    onCard: (info) => cards.push(shoutoutCard(info, 5)),
  });
  await make(true).handle(msg('luna'));
  assert.deepEqual(cards, [{ id: 'so-luna-5', kind: 'shoutout', userId: 'so:1', login: 'luna', name: 'LunaRossa', avatar: 'https://img/luna.png', game: 'Minecraft', title: 'costruiamo', text: '', at: 5 }]);
  await make(false).handle(msg('luna'));
  assert.equal(cards.length, 1);
});
