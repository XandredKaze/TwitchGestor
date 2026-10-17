import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, mergeEnv } from '../src/updates.js';

test('importando, il .env tiene indirizzo e password di questo computer e prende le chiavi di Twitch', () => {
  const pi = '# Raspberry\nHOST=0.0.0.0\nPORT=3000\nDASHBOARD_TOKEN=segreto\nTWITCHGESTOR_MANAGED=raspberry\nTWITCH_CLIENT_ID=\n';
  const pc = 'HOST=127.0.0.1\nDASHBOARD_TOKEN=\nTWITCH_CLIENT_ID=abc\nTWITCH_CLIENT_SECRET="xyz"\nKOFI_VERIFICATION_TOKEN=k\r\n';
  const out = parseEnv(mergeEnv(pi, pc));
  assert.equal(out.HOST, '0.0.0.0');
  assert.equal(out.DASHBOARD_TOKEN, 'segreto');
  assert.equal(out.TWITCHGESTOR_MANAGED, 'raspberry');
  assert.equal(out.TWITCH_CLIENT_ID, 'abc');
  assert.equal(out.TWITCH_CLIENT_SECRET, 'xyz');
  assert.equal(out.KOFI_VERIFICATION_TOKEN, 'k');
  assert.match(mergeEnv(pi, pc), /^# Raspberry\n/, 'i commenti restano');
});

test('.env vuoto: niente righe vuote in mezzo', () => {
  assert.equal(mergeEnv('HOST=0.0.0.0\n\n', 'A=1\nB=2'), 'HOST=0.0.0.0\nA=1\nB=2\n');
  assert.equal(mergeEnv('', 'A=1'), 'A=1\n');
});
