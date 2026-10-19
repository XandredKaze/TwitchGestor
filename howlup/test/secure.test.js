import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecureLink } from '../src/secure.js';

const status = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'twitchgestor.tail1234.ts.net.', TailscaleIPs: ['100.76.162.8'] } });
const fake = (handlers) => async (args) => {
  const h = handlers[args[0] === 'serve' && args[1] === 'status' ? 'serveStatus' : args[0]];
  if (typeof h === 'function') return h(args);
  if (h instanceof Error) throw h;
  return h;
};

test('senza Tailscale collegato chiede di collegarlo', async () => {
  const off = createSecureLink({ run: fake({ status: Object.assign(new Error('x'), { code: 'ENOENT' }) }) });
  assert.equal((await off.refresh()).status, 'no-tailscale');
  const stopped = createSecureLink({ run: fake({ status: JSON.stringify({ BackendState: 'Stopped' }) }) });
  assert.equal((await stopped.refresh()).status, 'no-tailscale');
});

test('avvia "tailscale serve" e dà l\'indirizzo https', async () => {
  let called = null;
  const s = createSecureLink({ port: 3100, run: fake({ status, serveStatus: '{}', serve: (a) => { called = a; return ''; } }) });
  const st = await s.refresh();
  assert.equal(st.status, 'ok');
  assert.equal(st.url, 'https://twitchgestor.tail1234.ts.net:8443');
  assert.deepEqual(called, ['serve', '--bg', '--https=8443', 'http://127.0.0.1:3100']);
  // già attivo: non lo rilancia
  const again = createSecureLink({ run: fake({ status, serveStatus: '{"Web":{"twitchgestor.tail1234.ts.net:8443":{}}}', serve: () => { throw new Error('non doveva'); } }) });
  assert.equal((await again.refresh()).status, 'ok');
});

test('https non attivo sulla rete: dà il link di Tailscale per attivarlo', async () => {
  const err = new Error('Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=abc123\n');
  const s = createSecureLink({ run: fake({ status, serveStatus: '{}', serve: err }) });
  const st = await s.refresh();
  assert.equal(st.status, 'enable');
  assert.equal(st.enableUrl, 'https://login.tailscale.com/f/serve?node=abc123');
  const other = createSecureLink({ run: fake({ status, serveStatus: '{}', serve: new Error('Access denied: serve config denied') }) });
  assert.deepEqual([(await other.refresh()).status, other.state.error], ['error', 'Access denied: serve config denied']);
});
