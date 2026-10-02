import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuickActions, explainTwitchError } from '../src/quickActions.js';

function fakeTwitch(responses = {}) {
  const calls = [];
  const helix = {
    async request(method, url, body) {
      calls.push({ method, url, body });
      const key = `${method} ${url.split('?')[0]}`;
      const r = responses[key];
      if (r instanceof Error) throw r;
      return typeof r === 'function' ? r(url, body) : (r ?? {});
    },
  };
  return { calls, qa: createQuickActions({ helix, getUser: () => ({ id: '42', login: 'xandred_' }) }) };
}

test('titolo, segnalibro, clip e pubblicità usano le API giuste', async () => {
  const { calls, qa } = fakeTwitch({ 'POST /clips': { data: [{ edit_url: 'https://clips.twitch.tv/x/edit' }] } });
  await qa.run('info', { title: '  Nuova live!  ', gameId: '509658' });
  assert.deepEqual(calls[0], { method: 'PATCH', url: '/channels?broadcaster_id=42', body: { title: 'Nuova live!', game_id: '509658' } });
  await qa.run('marker', { description: 'momento epico' });
  assert.deepEqual(calls[1].body, { user_id: '42', description: 'momento epico' });
  assert.equal((await qa.run('clip')).url, 'https://clips.twitch.tv/x/edit');
  await qa.run('ad', { length: 999 });
  assert.equal(calls[3].body.length, 30, 'durata non valida → 30 secondi');
});

test('raid e shoutout cercano prima il canale', async () => {
  const { calls, qa } = fakeTwitch({ 'GET /users': { data: [{ id: '7', display_name: 'Pippo' }] } });
  const r = await qa.run('raid', { channel: '@Pippo' });
  assert.equal(calls[0].url, '/users?login=pippo');
  assert.equal(calls[1].url, '/raids?from_broadcaster_id=42&to_broadcaster_id=7');
  assert.equal(r.raiding, 'Pippo');
  await qa.run('shoutout', { channel: 'pippo' });
  assert.equal(calls[3].url, '/chat/shoutouts?from_broadcaster_id=42&to_broadcaster_id=7&moderator_id=42');
  await assert.rejects(qa.run('raid', { channel: 'nome con spazi!' }), /non valido/);
});

test('sondaggi, pronostici e chat: dati controllati prima di chiamare Twitch', async () => {
  const { calls, qa } = fakeTwitch();
  await assert.rejects(qa.run('poll', { title: 'Che gioco?', choices: ['Solo uno'] }), /almeno 2/);
  assert.equal(calls.length, 0);
  await qa.run('poll', { title: 'Che gioco?', choices: ['A', '', 'B'], duration: 5 });
  assert.deepEqual(calls[0].body, { broadcaster_id: '42', title: 'Che gioco?', choices: [{ title: 'A' }, { title: 'B' }], duration: 15 });
  await qa.run('endPrediction', { id: 'p1', status: 'RESOLVED', winner: 'o2' });
  assert.deepEqual(calls[1].body, { broadcaster_id: '42', id: 'p1', status: 'RESOLVED', winning_outcome_id: 'o2' });
  await qa.run('chatMode', { mode: 'slow', on: true, value: 500 });
  assert.deepEqual(calls[2].body, { slow_mode: true, slow_mode_wait_time: 120 });
  await assert.rejects(qa.run('inventata'), /sconosciuta/);
});

test('stato: ogni parte è indipendente, gli errori di Twitch diventano messaggi chiari', async () => {
  const noScope = Object.assign(new Error('Missing scope: moderator:read:shield_mode'), { status: 401 });
  const { qa } = fakeTwitch({
    'GET /channels': { data: [{ title: 'Live', game_id: '1', game_name: 'Just Chatting' }] },
    'GET /chat/settings': { data: [{ emote_mode: true, slow_mode: true, slow_mode_wait_time: 10 }] },
    'GET /moderation/shield_mode': noScope,
    'GET /polls': { data: [{ id: 'x', status: 'COMPLETED' }] },
    'GET /predictions': { data: [] },
  });
  const s = await qa.state();
  assert.equal(s.channel.value.gameName, 'Just Chatting');
  assert.equal(s.chat.value.emote, true);
  assert.equal(s.chat.value.slowSeconds, 10);
  assert.equal(s.shield.ok, false);
  assert.match(s.shield.error, /permesso/);
  assert.equal(s.poll.value, null, 'un sondaggio finito non conta');
  assert.match(explainTwitchError(new Error('The broadcaster must be a partner or affiliate')), /affiliate/);
});
