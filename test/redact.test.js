import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, envSecrets } from '../src/core/redact.js';

test('rapporto: password, token e chiavi vengono tolti', () => {
  const secrets = envSecrets('PORT=3000\nDASHBOARD_TOKEN=abc123def456\nTWITCH_CLIENT_SECRET="segretissimo"\nHOST=0.0.0.0\n');
  assert.deepEqual(secrets, ['abc123def456', 'segretissimo']);
  const out = redact([
    'login con abc123def456 riuscito',
    'GET /dashboard?token=xyz987&tab=1',
    'Authorization: Bearer eyJhbGciOi.xxx',
    '{"access_token":"tok_123456","refresh_token":"ref_654321","login":"xandred_kaze"}',
    'irc PASS oauth:abcdef0123',
    'client_secret=segretissimo',
    'Porta 3000, utente xandred',
  ].join('\n'), secrets);
  for (const s of ['abc123def456', 'xyz987', 'eyJhbGciOi', 'tok_123456', 'ref_654321', 'abcdef0123', 'segretissimo']) assert.ok(!out.includes(s), s);
  assert.match(out, /xandred_kaze/); // il resto resta leggibile
  assert.match(out, /Porta 3000, utente xandred/);
  assert.match(out, /tab=1/);
});
