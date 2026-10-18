import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseStatus, tailscaleAddresses } from '../src/remote.js';
import { certificateNames, tailnetDomain, caLimits, ensureCertificates } from '../src/https.js';

test('stato di Tailscale: collegato, in attesa del link, indirizzi', () => {
  const running = parseStatus({
    BackendState: 'Running',
    Self: { TailscaleIPs: ['100.101.102.103', 'fd7a:115c::1'], DNSName: 'twitchgestor.tail1234.ts.net.', UserID: 7 },
    User: { 7: { LoginName: 'xandred@gmail.com' } },
  });
  assert.deepEqual(running, { state: 'Running', connected: true, authUrl: '', ip: '100.101.102.103', dnsName: 'twitchgestor.tail1234.ts.net', account: 'xandred@gmail.com' });
  const login = parseStatus('{"BackendState":"NeedsLogin","AuthURL":"https://login.tailscale.com/a/abc123","Self":{}}');
  assert.equal(login.connected, false);
  assert.equal(login.authUrl, 'https://login.tailscale.com/a/abc123');
  assert.equal(parseStatus({ BackendState: 'NeedsLogin', AuthURL: 'https://sito-strano.example/a' }).authUrl, '');
});

test('indirizzi di Tailscale tra quelli del computer', () => {
  const nets = { eth0: [{ family: 'IPv4', address: '192.168.1.50' }], tailscale0: [{ family: 'IPv4', address: '100.101.102.103' }], x: [{ family: 'IPv4', address: '100.200.1.1' }] };
  assert.deepEqual(tailscaleAddresses(nets), ['100.101.102.103']);
});

test('certificato: nomi di Tailscale solo quando è collegato e solo della propria rete', () => {
  assert.equal(tailnetDomain('twitchgestor.tail1234.ts.net.'), 'tail1234.ts.net');
  assert.equal(tailnetDomain('twitchgestor.example.com'), '');
  assert.deepEqual(certificateNames('twitchgestor', ['192.168.1.50']), ['DNS:twitchgestor.local', 'DNS:localhost', 'IP:127.0.0.1', 'IP:192.168.1.50']);
  assert.deepEqual(certificateNames('twitchgestor', [], { ip: '100.101.102.103', dnsName: 'twitchgestor.tail1234.ts.net' }).slice(3),
    ['IP:100.101.102.103', 'DNS:twitchgestor.tail1234.ts.net']);
  assert.ok(!caLimits().includes('100.64'));
  assert.match(caLimits('tail1234.ts.net'), /IP:100\.64\.0\.0\/255\.192\.0\.0,permitted;DNS:tail1234\.ts\.net$/);
});

test('collegando Tailscale l\'autorità si rifà una volta e il certificato vale anche per Tailscale', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-https-'));
  const first = await ensureCertificates(dir);
  assert.equal(first.caChanged, false);
  assert.ok(!first.names.includes('ts.net'));
  // vecchia installazione senza il file dei limiti: senza Tailscale non cambia niente
  fs.rmSync(path.join(dir, 'ca.limits'));
  const same = await ensureCertificates(dir);
  assert.equal(same.caChanged, false);
  const ts = { ip: '100.101.102.103', dnsName: 'twitchgestor.tail1234.ts.net' };
  const withTs = await ensureCertificates(dir, { tailscale: ts });
  assert.equal(withTs.caChanged, true);
  assert.match(withTs.names, /IP:100\.101\.102\.103,DNS:twitchgestor\.tail1234\.ts\.net$/);
  // il certificato del Raspberry è firmato dalla nuova autorità e rispetta i suoi limiti
  const out = execFileSync('openssl', ['verify', '-CAfile', path.join(dir, 'ca.crt'), path.join(dir, 'server.crt')]).toString();
  assert.match(out, /OK/);
  const again = await ensureCertificates(dir, { tailscale: ts });
  assert.equal(again.caChanged, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
