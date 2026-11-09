import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TwitchAuth } from '../src/twitch/auth.js';

test('accesso con codice: codice da Twitch, attesa, poi collegato (e app pubblica senza segreto)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dev-'));
  const realFetch = globalThis.fetch;
  const calls = [];
  let polls = 0;
  globalThis.fetch = async (url, opts = {}) => {
    const body = Object.fromEntries(new URLSearchParams(String(opts.body ?? '')));
    calls.push([String(url).split('/').pop(), body]);
    const json = (status, data) => ({ ok: status === 200, status, json: async () => data });
    if (String(url).endsWith('/device')) return json(200, { device_code: 'DC', user_code: 'ABCD-1234', verification_uri: 'https://www.twitch.tv/activate?x', interval: 0, expires_in: 1800 });
    if (String(url).endsWith('/token')) {
      polls += 1;
      if (body.client_secret) return json(400, { status: 400, message: 'invalid client secret' });
      if (polls < 3) return json(400, { status: 400, message: 'authorization_pending' });
      return json(200, { access_token: 'AT', refresh_token: 'RT' });
    }
    if (String(url).endsWith('/validate')) return json(200, { scopes: ['user:read:chat'], user_id: '42', login: 'xandred' });
    throw new Error(`inatteso ${url}`);
  };
  try {
    const a = new TwitchAuth({ clientId: 'cid', clientSecret: 'sec', tokenFile: path.join(dir, 't.json'), scopes: ['user:read:chat'] });
    const authorized = new Promise((r) => a.once('authorized', r));
    const st = await a.startDeviceLogin();
    assert.deepEqual([st.state, st.code], ['pending', 'ABCD-1234']);
    assert.equal(calls[0][1].scopes, 'user:read:chat');
    assert.deepEqual(await authorized, { id: '42', login: 'xandred' });
    assert.equal(a.deviceStatus().state, 'done');
    assert.equal(a.accessToken, 'AT');
    assert.equal(calls.find((c) => c[0] === 'token')[1].grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
  } finally {
    globalThis.fetch = realFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
