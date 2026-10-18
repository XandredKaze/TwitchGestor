import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Goals } from '../src/core/goals.js';
import { sanitizeConfig } from '../src/core/schema.js';
import fs from 'node:fs';

function setup(list) {
  let saved = null;
  let changes = 0;
  const g = new Goals({ getConfig: () => list, store: { load: () => saved, save: (d) => { saved = structuredClone(d); } }, onChange: () => { changes += 1; } });
  return { g, changes: () => changes, saved: () => saved };
}
const snap = (g, id) => g.snapshot().find((x) => x.id === id);

test('abbonati e follower: totale del canale o solo i nuovi da quando azzeri', () => {
  const { g } = setup([
    { id: 'sub', type: 'subs', target: 30, mode: 'total' },
    { id: 'fol', type: 'followers', target: 100, mode: 'new', showPercent: false },
  ]);
  assert.equal(snap(g, 'sub').ready, false);
  g.setTotals({ followers: 800, subs: 12 });
  assert.deepEqual([snap(g, 'sub').current, snap(g, 'sub').percent, snap(g, 'sub').title], [12, 40, 'SUB GOAL']);
  assert.equal(snap(g, 'fol').current, 0);
  assert.equal(snap(g, 'fol').showPercent, false);
  g.notification({ type: 'follow' });
  g.notification({ type: 'giftsub', amount: 5 });
  g.notification({ type: 'sub' });
  g.notification({ type: 'follow', test: true });
  assert.equal(snap(g, 'fol').current, 1);
  assert.equal(snap(g, 'sub').current, 18);
  g.setTotals({ followers: 805, subs: 18 }); // Twitch corregge
  assert.equal(snap(g, 'fol').current, 5);
  g.reset('fol');
  assert.equal(snap(g, 'fol').current, 0);
});

test('bits e donazioni: somma da quando azzeri, correzioni a mano, percentuale al massimo 100', () => {
  const { g, saved } = setup([{ id: 'b', type: 'bits', target: 1000 }, { id: 'd', type: 'donations', target: 50 }]);
  g.notification({ type: 'cheer', amount: 600 });
  g.notification({ type: 'cheer', amount: 700 });
  g.notification({ type: 'donation', amount: 12.5, currency: 'EUR' });
  assert.deepEqual([snap(g, 'b').current, snap(g, 'b').percent], [1300, 100]);
  assert.equal(snap(g, 'd').current, 12.5);
  g.adjust('d', 5);
  assert.equal(snap(g, 'd').current, 17.5);
  assert.equal(saved().goals.d.adjust, 5);
  g.reset('b');
  assert.equal(snap(g, 'b').current, 0);
  assert.equal(g.adjust('nessuno', 1), false);
});

test('impostazioni dei goal: tipi, obiettivo e id ripuliti', () => {
  const defaults = JSON.parse(fs.readFileSync(new URL('../src/core/defaults.json', import.meta.url)));
  assert.equal(sanitizeConfig({}, defaults).goals[0].type, 'subs');
  const out = sanitizeConfig({ goals: [{ id: 'a', type: 'boh', target: -3 }, { id: 'a', type: 'bits' }, { id: 'x y', type: 'donations', target: '12.5', showPercent: false }] }, defaults).goals;
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].type, out[0].target], ['subs', 1]);
  assert.match(out[1].id, /^g[a-z0-9]+$/);
  assert.deepEqual([out[1].target, out[1].showPercent], [12.5, false]);
});
