import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { EventSubClient } from '../src/twitch/eventsub.js';

function welcome(id) {
  return JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: { id, keepalive_timeout_seconds: 10 } } });
}
function notification(messageId, type, event) {
  return JSON.stringify({ metadata: { message_id: messageId, message_type: 'notification' }, payload: { subscription: { type }, event } });
}

test('si iscrive, riceve eventi, scarta i duplicati e migra la sessione senza reiscriversi', async () => {
  const wss = new WebSocketServer({ port: 0 });
  const port = wss.address().port;
  const url = `ws://127.0.0.1:${port}/ws`;
  const subscribed = [];
  const helix = { createEventSubSubscription: async (s) => subscribed.push(s) };
  const client = new EventSubClient({ helix, userId: '42', url });
  const events = [];
  client.on('event', (type, e) => events.push([type, e.user_name]));

  const sockets = [];
  wss.on('connection', (ws, req) => {
    sockets.push(ws);
    ws.send(welcome(req.url.includes('reconnect') ? 's2' : 's1'));
  });

  client.start();
  await once(client, 'status'); // connessione…
  while (client.status !== 'connesso') await once(client, 'status');
  assert.equal(subscribed.length, 9);
  assert.ok(subscribed.every((s) => s.sessionId === 's1'));
  assert.equal(subscribed.find((s) => s.type === 'channel.raid').condition.to_broadcaster_user_id, '42');

  sockets[0].send(notification('m1', 'channel.follow', { user_name: 'Anna' }));
  sockets[0].send(notification('m1', 'channel.follow', { user_name: 'Anna' }));
  await once(client, 'event');

  sockets[0].send(JSON.stringify({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: `${url}?reconnect` } } }));
  await once(client, 'status'); // connessione…
  while (client.status !== 'connesso') await once(client, 'status');
  assert.equal(subscribed.length, 9, 'nessuna nuova iscrizione dopo la migrazione');

  sockets[1].send(notification('m2', 'channel.cheer', { user_name: 'Bea' }));
  await once(client, 'event');
  assert.deepEqual(events, [['channel.follow', 'Anna'], ['channel.cheer', 'Bea']]);

  client.stop();
  wss.close();
});
