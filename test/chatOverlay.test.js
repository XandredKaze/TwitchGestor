import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import WebSocket from 'ws';
import { toChatMessage, shouldShow, ChatFeed, badgeMap } from '../src/core/chatOverlay.js';
import { sanitizeConfig } from '../src/core/schema.js';
import { createServer } from '../src/server.js';

const defaults = JSON.parse(fs.readFileSync(new URL('../src/core/defaults.json', import.meta.url)));
const event = (over = {}) => ({
  message_id: 'm1', chatter_user_id: '10', chatter_user_login: 'anna', chatter_user_name: 'Anna', color: '#FF0000',
  badges: [{ set_id: 'subscriber', id: '12' }],
  message: { text: 'ciao Kappa', fragments: [{ type: 'text', text: 'ciao ' }, { type: 'emote', text: 'Kappa', emote: { id: '25' } }] },
  ...over,
});

test('messaggio di Twitch → messaggio per la chat di OBS, con emote e badge', () => {
  const m = toChatMessage(event(), { botId: '99' });
  assert.equal(m.name, 'Anna');
  assert.equal(m.color, '#FF0000');
  assert.deepEqual(m.badges, [{ set: 'subscriber', id: '12' }]);
  assert.deepEqual(m.fragments, [{ type: 'text', text: 'ciao ' }, { type: 'emote', text: 'Kappa', id: '25' }]);
  assert.equal(m.bot, false);
  assert.equal(toChatMessage(event({ chatter_user_id: '99' }), { botId: '99' }).bot, true);
  assert.deepEqual(badgeMap({ data: [{ set_id: 'vip', versions: [{ id: '1', image_url_2x: 'u2' }] }] }), { 'vip/1': 'u2' });
});

test('nasconde il bot, i comandi e gli account scelti', () => {
  const s = sanitizeConfig({}, defaults).chatOverlay;
  const msg = (over) => ({ ...toChatMessage(event()), ...over });
  assert.equal(shouldShow(msg({}), s), true);
  assert.equal(shouldShow(msg({ bot: true }), s), false, 'Wolfery nascosto di predefinito');
  assert.equal(shouldShow(msg({ bot: true }), { ...s, hideBot: false }), true);
  assert.equal(shouldShow(msg({ text: '!discord' }), s), false);
  assert.equal(shouldShow(msg({ text: '?discord' }), s, { commandPrefix: '?' }), false);
  assert.equal(shouldShow(msg({ login: 'nightbot' }), s), false);
  assert.equal(shouldShow(msg({ text: '   ' }), s), false);
});

test('impostazioni della chat: valori validi e account ripuliti', () => {
  const c = sanitizeConfig({ chatOverlay: { style: 'boxes', fontSize: 999, style2: 'x', hiddenUsers: ['@Wolfery', 'wolfery', 'nome non valido', 'StreamElements'] } }, defaults).chatOverlay;
  assert.equal(c.style, 'boxes');
  assert.equal(c.fontSize, 80);
  assert.deepEqual(c.hiddenUsers, ['wolfery', 'streamelements']);
  assert.equal(c.hideBot, true);
});

test('la pagina /chat riceve impostazioni, ultimi messaggi e cancellazioni', async () => {
  const feedOut = [];
  const app = {
    env: {}, manager: {}, auth: {}, getState: () => ({}), broadcastState() {},
    config: { get: () => ({ overlay: {}, chatOverlay: { style: 'brutal' } }), defaults: () => ({}) },
  };
  const web = createServer(app);
  const feed = new ChatFeed({ send: (m) => { feedOut.push(m); web.toChat(m); } });
  feed.badges = { 'vip/1': 'x' };
  app.chatFeed = feed;
  feed.push({ id: 'old', text: 'prima', userId: '1' });
  web.server.listen(0, '127.0.0.1');
  await once(web.server, 'listening');
  const { port } = web.server.address();
  const page = await fetch(`http://127.0.0.1:${port}/chat`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /chat\.js/);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?role=chat`);
  const got = [];
  ws.on('message', (d) => got.push(JSON.parse(d)));
  await once(ws, 'open');
  while (!got.length) await new Promise((r) => setTimeout(r, 10));
  assert.equal(got[0].type, 'hello');
  assert.equal(got[0].settings.style, 'brutal');
  assert.deepEqual(got[0].messages.map((m) => m.id), ['old']);
  feed.push({ id: 'new', text: 'dopo', userId: '2' });
  feed.removeUser('2');
  while (got.length < 3) await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(got.slice(1).map((m) => m.type), ['message', 'remove-user']);
  assert.deepEqual(feed.messages.map((m) => m.id), ['old']);
  ws.close();
  web.server.close();
});
