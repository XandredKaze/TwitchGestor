/**
 * Howl-UP in https (serve per installarlo come app sul telefono o sul PC: i browser lo permettono solo in https).
 * Lo dà Tailscale ("tailscale serve"): indirizzo https://<raspberry>.<tua-rete>.ts.net:8443 con un certificato
 * vero e gratuito, valido in ogni browser senza installare niente. Funziona dai dispositivi con Tailscale attivo.
 * La prima volta Tailscale chiede di attivare i certificati https per la tua rete: un link da aprire una volta.
 */

import { execFile } from 'node:child_process';
import { parseStatus } from '../../src/remote.js';

const runTailscale = (args, timeout = 10000) => new Promise((resolve, reject) => {
  execFile('tailscale', args, { timeout }, (err, stdout, stderr) => {
    if (err) reject(Object.assign(new Error(`${stderr || ''}\n${stdout || ''}`.trim() || err.message), { code: err.code }));
    else resolve(`${stdout}\n${stderr}`);
  });
});

export function createSecureLink({ port = 3100, httpsPort = 8443, run = runTailscale, log = () => {} } = {}) {
  // status: 'checking' | 'ok' | 'enable' (serve il link per attivare https) | 'no-tailscale' | 'error'
  let state = { status: 'checking', url: '', enableUrl: '', error: '' };

  async function refresh() {
    let st;
    try {
      st = parseStatus(await run(['status', '--json']));
    } catch (err) {
      state = { status: 'no-tailscale', url: '', enableUrl: '', error: err.code === 'ENOENT' ? 'Tailscale non è installato' : '' };
      return state;
    }
    if (!st.connected || !st.dnsName) { state = { status: 'no-tailscale', url: '', enableUrl: '', error: '' }; return state; }
    const url = `https://${st.dnsName}:${httpsPort}`;
    const already = await run(['serve', 'status', '--json']).then((out) => out.includes(`${st.dnsName}:${httpsPort}`)).catch(() => false);
    if (already) { state = { status: 'ok', url, enableUrl: '', error: '' }; return state; }
    try {
      await run(['serve', '--bg', `--https=${httpsPort}`, `http://127.0.0.1:${port}`], 20000);
      log(`Howl-UP in https: ${url}`);
      state = { status: 'ok', url, enableUrl: '', error: '' };
    } catch (err) {
      // https non ancora attivo per la tua rete Tailscale: Tailscale dà il link per attivarlo
      const link = err.message.match(/https:\/\/login\.tailscale\.com\/\S+/);
      if (link) state = { status: 'enable', url, enableUrl: link[0], error: '' };
      else {
        state = { status: 'error', url, enableUrl: '', error: err.message.split('\n').find((l) => l.trim()) ?? 'errore' };
        log(`https con Tailscale: ${state.error}`);
      }
    }
    return state;
  }

  return { get state() { return state; }, refresh };
}
