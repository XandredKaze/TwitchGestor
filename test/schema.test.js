import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeConfig, diffConfig, isSafeMedia } from '../src/core/schema.js';
import { NotificationManager } from '../src/core/NotificationManager.js';
import { fromEventSub } from '../src/core/normalize.js';

const defaults = JSON.parse(fs.readFileSync(new URL('../src/core/defaults.json', import.meta.url)));

test('accetta solo valori validi e ignora il resto', () => {
  const c = sanitizeConfig({
    overlay: { position: 'center', animation: 'esplosione', font: 'Bangers' },
    types: {
      cheer: { color: '#FF0000', textColor: 'rosso', duration: 999999, image: 'javascript:alert(1)', sound: 'media/sounds/a.mp3', hacker: true },
      inventato: { title: 'x' },
    },
  }, defaults);
  assert.equal(c.overlay.position, 'center');
  assert.equal(c.overlay.animation, 'pop');
  assert.equal(c.overlay.font, 'Bangers');
  assert.equal(c.types.cheer.color, '#ff0000');
  assert.equal(c.types.cheer.textColor, undefined);
  assert.equal(c.types.cheer.duration, 60000);
  assert.equal(c.types.cheer.image, '');
  assert.equal(c.types.cheer.sound, 'media/sounds/a.mp3');
  assert.equal(c.types.cheer.hacker, undefined);
  assert.equal(c.types.inventato, undefined);
});

test('percorsi dei file sicuri', () => {
  assert.ok(isSafeMedia('chime'));
  assert.ok(isSafeMedia('media/images/gatto.gif'));
  assert.ok(isSafeMedia('https://esempio.it/a.mp3'));
  assert.ok(!isSafeMedia('media/../../.env'));
  assert.ok(!isSafeMedia('javascript:alert(1)'));
  assert.ok(!isSafeMedia('media/a" onerror="x'));
});

test('salva solo le differenze, indipendentemente dall\'ordine delle chiavi', () => {
  assert.equal(diffConfig(sanitizeConfig(structuredClone(defaults), defaults), defaults), undefined);
  const edited = structuredClone(defaults);
  edited.types.follow.title = 'Ciao!';
  edited.types.follow.image = '';
  assert.deepEqual(diffConfig(sanitizeConfig(edited, defaults), defaults), { types: { follow: { title: 'Ciao!' } } });
});

test('lo stile dell\'alert usa i valori generali se l\'alert non ne ha di suoi', () => {
  const config = sanitizeConfig({ overlay: { font: 'Anton', animation: 'fade' }, types: { cheer: { animation: 'zoom', fontSize: 40 } } }, defaults);
  const m = new NotificationManager({ config });
  const cheer = m.buildAlert(fromEventSub('channel.cheer', { user_name: 'Anna', bits: 10 }));
  assert.equal(cheer.font, 'Anton');
  assert.equal(cheer.animation, 'zoom');
  assert.equal(cheer.fontSize, 40);
  const follow = m.buildAlert(fromEventSub('channel.follow', { user_name: 'Bea' }));
  assert.equal(follow.animation, 'fade');
  assert.equal(follow.fontSize, 26);
});

test('una ricompensa lasciata vuota non vale per tutte', () => {
  const config = sanitizeConfig({ types: { redemption: { variants: [{ reward: '', title: 'SBAGLIATO' }] } } }, defaults);
  const m = new NotificationManager({ config });
  const n = fromEventSub('channel.channel_points_custom_reward_redemption.add', { user_name: 'Anna', reward: { title: 'Canzone', cost: 10 } });
  assert.equal(m.buildAlert(n).title, 'Canzone');
});

test('tema della dashboard: solo i temi conosciuti, salvato solo se diverso dal predefinito', () => {
  assert.equal(sanitizeConfig({ ui: { theme: 'brutal' } }, defaults).ui.theme, 'brutal');
  assert.equal(sanitizeConfig({ ui: { theme: 'inventato' } }, defaults).ui.theme, 'default');
  assert.deepEqual(diffConfig(sanitizeConfig({ ui: { theme: 'brutal' } }, defaults), defaults), { ui: { theme: 'brutal' } });
  assert.equal(diffConfig(sanitizeConfig({}, defaults), defaults), undefined);
});
