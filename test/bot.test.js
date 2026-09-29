import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { HelixClient } from '../src/twitch/helix.js';
import { createServer } from '../src/server.js';

test('il bot scrive nella chat del tuo canale con il proprio account', async () => {
  let received;
  const twitch = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ message_id: 'x', is_sent: true }] }));
    });
  });
  twitch.listen(0);
  await once(twitch, 'listening');
  const botAuth = { clientId: 'id', accessToken: 'token-del-bot', user: { id: '999', login: 'wolfery' }, refresh: async () => false };
  const helix = new HelixClient({ auth: botAuth, baseUrl: `http://127.0.0.1:${twitch.address().port}` });

  await helix.sendChatMessage('Grazie Mario!', '123');
  assert.equal(received.url, '/chat/messages');
  assert.equal(received.auth, 'Bearer token-del-bot');
  assert.deepEqual(received.body, { broadcaster_id: '123', sender_id: '999', message: 'Grazie Mario!' });
  twitch.close();
});

test('il messaggio bloccato da Twitch viene segnalato', async () => {
  const twitch = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => res.end(JSON.stringify({ data: [{ is_sent: false, drop_reason: { message: 'Solo follower' } }] })));
  });
  twitch.listen(0);
  await once(twitch, 'listening');
  const helix = new HelixClient({ auth: { clientId: 'id', accessToken: 't', user: { id: '9' }, refresh: async () => false }, baseUrl: `http://127.0.0.1:${twitch.address().port}` });
  await assert.rejects(helix.sendChatMessage('ciao', '1'), /Solo follower/);
  twitch.close();
});

test('il ritorno da Twitch va all\'account giusto (principale o bot)', async () => {
  const handled = [];
  const makeAuth = (name, states) => ({
    configured: true,
    ownsState: (s) => states.includes(s),
    handleCallback: async (p) => handled.push([name, p.state]),
    authorizeUrl: () => `https://id.twitch.tv/${name}`,
  });
  const app = {
    env: {}, manager: {}, config: { get: () => ({ overlay: {} }) }, getState: () => ({}), broadcastState() {},
    auth: makeAuth('canale', ['s1']), botAuth: makeAuth('bot', ['s2']),
  };
  const web = createServer(app);
  web.server.listen(0, '127.0.0.1');
  await once(web.server, 'listening');
  const base = `http://127.0.0.1:${web.server.address().port}`;
  const bot = await fetch(`${base}/auth/callback?code=a&state=s2`, { redirect: 'manual' });
  const main = await fetch(`${base}/auth/callback?code=b&state=s1`, { redirect: 'manual' });
  assert.deepEqual(handled, [['bot', 's2'], ['canale', 's1']]);
  assert.equal(bot.headers.get('location'), '/dashboard#chat');
  assert.equal(main.headers.get('location'), '/dashboard');
  const login = await fetch(`${base}/auth/bot/login`, { redirect: 'manual' });
  assert.equal(login.headers.get('location'), 'https://id.twitch.tv/bot');
  web.server.close();
});
