import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ChatModerator, findBanned, normalizeText, describeAction } from '../src/core/moderation.js';
import { sanitizeConfig } from '../src/core/schema.js';

const defaults = JSON.parse(fs.readFileSync(new URL('../src/core/defaults.json', import.meta.url)));
const WORDS = [
  { text: 'stupido', action: 'delete' },
  { text: 'idiot*', action: 'timeout', duration: 600 },
  { text: 'brutta parola', action: 'ban' },
  { text: 'cacca', action: 'delete', inside: true },
];

test('riconosce le parole anche scritte in modo diverso, senza falsi allarmi', () => {
  const hit = (t) => findBanned(t, WORDS)?.text ?? null;
  assert.equal(hit('sei uno STUPIDO!'), 'stupido');
  assert.equal(hit('5tup1d0'), 'stupido');
  assert.equal(hit('sei uno 5tup1d0!'), 'stupido');
  assert.equal(hit('st!pido'), null);
  assert.equal(hit('$tupido'), 'stupido');
  assert.equal(hit('stuuuuupido'), 'stupido');
  assert.equal(hit('stùpido'), 'stupido');
  assert.equal(hit('idiota'), 'idiot*');
  assert.equal(hit('brutta, parola'), 'brutta parola');
  assert.equal(hit('c a c c a'), 'cacca');
  assert.equal(hit('pizzacacca'), 'cacca');
  for (const ok of ['classe stupenda', 'ciao!', 'gg 2024', 'stupida idea? no', 'pidocchio']) assert.equal(hit(ok), null, ok);
  assert.equal(normalizeText('Ciào   Mondo!!!'), 'ciao mondo');
  assert.equal(describeAction({ action: 'timeout', duration: 600 }), 'timeout 10 min');
});

function setup(cfg = {}) {
  const calls = [];
  const warned = [];
  let now = 0;
  const mod = new ChatModerator({
    getConfig: () => ({ enabled: true, words: WORDS, warning: '{user}, niente parolacce ({action})', ...cfg }),
    act: {
      delete: async (id) => calls.push(['delete', id]),
      timeout: async (u, s) => calls.push(['timeout', u, s]),
      ban: async (u) => calls.push(['ban', u]),
      unban: async (u) => calls.push(['unban', u]),
    },
    warn: (t) => warned.push(t),
    now: () => now,
    log: { warn() {} },
  });
  return { mod, calls, warned, advance: (ms) => { now += ms; } };
}
const msg = (text, badges = [], name = 'Anna') => ({ id: `m-${text}`, text, user: { id: `u-${name}`, name }, badges });

test('cancella, dà timeout o banna e scrive l\'avviso (non troppo spesso)', async () => {
  const { mod, calls, warned, advance } = setup();
  assert.equal(await mod.handle(msg('ciao a tutti')), null);
  await mod.handle(msg('sei stupido'));
  await mod.handle(msg('idiota', [], 'Bea'));
  advance(11000);
  await mod.handle(msg('brutta parola', [], 'Carlo'));
  assert.deepEqual(calls, [['delete', 'm-sei stupido'], ['timeout', 'u-Bea', 600], ['ban', 'u-Carlo']]);
  assert.deepEqual(warned, ['Anna, niente parolacce (messaggio cancellato)', 'Carlo, niente parolacce (ban)']);
  assert.equal(mod.history.length, 3);
  assert.equal(mod.history[0].user, 'Carlo');
  await mod.undo(0);
  assert.deepEqual(calls.at(-1), ['unban', 'u-Carlo']);
  await assert.rejects(mod.undo(0), /Niente da annullare/);
});

test('tu e i moderatori siete esenti; VIP e abbonati solo se scelto; spenta non fa nulla', async () => {
  const { mod, calls } = setup({ exemptVip: true });
  await mod.handle(msg('stupido', [{ set_id: 'moderator' }]));
  await mod.handle(msg('stupido', [{ set_id: 'broadcaster' }]));
  await mod.handle(msg('stupido', [{ set_id: 'vip' }]));
  assert.equal(calls.length, 0);
  await mod.handle(msg('stupido', [{ set_id: 'subscriber' }]));
  assert.equal(calls.length, 1);
  const off = setup({ enabled: false });
  assert.equal(await off.mod.handle(msg('stupido')), null);
  assert.equal((await off.mod.handle(msg('stupido'), { dryRun: true })).label, 'messaggio cancellato', 'la prova funziona anche se spenta');
  assert.equal(off.calls.length, 0);
});

test('se Twitch rifiuta (es. bot non moderatore) lo segna nel registro e non scrive l\'avviso', async () => {
  const warned = [];
  const mod = new ChatModerator({
    getConfig: () => ({ enabled: true, words: WORDS, warning: 'no' }),
    act: { delete: async () => { throw new Error('Wolfery non è moderatore del canale'); } },
    warn: (t) => warned.push(t),
    log: { warn() {} },
  });
  await mod.handle(msg('stupido'));
  assert.match(mod.history[0].error, /non è moderatore/);
  assert.deepEqual(warned, []);
});

test('impostazioni: niente doppioni (anche scritti diversamente), azioni e durate valide', () => {
  const out = sanitizeConfig({
    moderation: {
      enabled: true,
      words: [{ text: 'Stupido', action: 'boh' }, { text: 'STUPIDO!' }, { text: '  ' }, { text: 'idiot*', action: 'timeout', duration: 99999999 }],
    },
  }, defaults).moderation;
  assert.equal(out.enabled, true);
  assert.deepEqual(out.words.map((w) => [w.text, w.action]), [['Stupido', 'delete'], ['idiot*', 'timeout']]);
  assert.equal(out.words[1].duration, 1209600);
});
