/**
 * Indirizzo https per la dashboard (sul Raspberry): Twitch mostra il suo player e la sua chat
 * solo su pagine https o "localhost". TwitchGestor crea un proprio certificato con openssl:
 *   - un'autorità di certificazione ("TwitchGestor – questa casa") da installare una volta sul PC,
 *     valida solo per nomi .local, localhost e indirizzi della rete di casa (non può valere per altri siti)
 *     e, se attivi l'accesso da fuori casa, per la tua rete Tailscale (indirizzi 100.x e nome .ts.net);
 *   - il certificato del Raspberry, rifatto da solo se cambiano nome o indirizzo di rete.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createLogger } from './logger.js';

const log = createLogger('https');

const run = (args, cwd) => new Promise((resolve, reject) => {
  execFile('openssl', args, { cwd, timeout: 60000 }, (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout)));
});

/** Indirizzi IPv4 della rete di casa di questo computer. */
export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))
    .map((i) => i.address);
}

/** Dominio della rete Tailscale dal nome del Raspberry (es. "twitchgestor.tail1234.ts.net" → "tail1234.ts.net"). */
export function tailnetDomain(dnsName) {
  const d = String(dnsName ?? '').toLowerCase().replace(/\.$/, '').split('.').slice(1).join('.');
  return /^[a-z0-9-]{1,63}\.ts\.net$/.test(d) ? d : '';
}

/**
 * Nomi e indirizzi per cui vale il certificato (tutti dentro i limiti dell'autorità).
 * tailscale: { ip, dnsName } se l'accesso da fuori casa è collegato.
 */
export function certificateNames(hostname = os.hostname(), ips = lanAddresses(), tailscale = null) {
  const host = String(hostname).toLowerCase().replace(/\.local$/, '').replace(/[^a-z0-9-]/g, '');
  const ts = [];
  if (tailscale?.ip && /^100\.\d+\.\d+\.\d+$/.test(tailscale.ip)) ts.push(`IP:${tailscale.ip}`);
  if (tailnetDomain(tailscale?.dnsName)) ts.push(`DNS:${tailscale.dnsName.toLowerCase().replace(/\.$/, '')}`);
  return [`DNS:${host}.local`, 'DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`), ...ts];
}

// L'autorità vale solo per la rete di casa (e per la tua rete Tailscale, se la usi):
// anche se qualcuno ne copiasse la chiave, non potrebbe usarla per altri siti.
export function caLimits(tailnet = '') {
  return [
    'permitted;DNS:local', 'permitted;DNS:localhost',
    'permitted;IP:127.0.0.0/255.0.0.0', 'permitted;IP:10.0.0.0/255.0.0.0',
    'permitted;IP:172.16.0.0/255.240.0.0', 'permitted;IP:192.168.0.0/255.255.0.0',
    ...(tailnet ? ['permitted;IP:100.64.0.0/255.192.0.0', `permitted;DNS:${tailnet}`] : []),
  ].join(',');
}

/**
 * Prepara (se serve) autorità e certificato in dir. Ritorna { key, cert, caFile, names, caChanged } oppure null se openssl manca.
 * Se colleghi l'accesso da fuori casa, l'autorità si rifà una volta per valere anche per la rete Tailscale
 * (e il certificato va reinstallato sul PC).
 */
export async function ensureCertificates(dir, { tailscale = null } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (name) => path.join(dir, name);
  try {
    const tailnet = tailnetDomain(tailscale?.dnsName);
    const limits = caLimits(tailnet);
    const current = fs.existsSync(f('ca.limits')) ? fs.readFileSync(f('ca.limits'), 'utf8') : caLimits();
    const hasCa = fs.existsSync(f('ca.key')) && fs.existsSync(f('ca.crt'));
    let caChanged = false;
    if (!hasCa || (tailnet && current !== limits)) {
      if (hasCa) {
        for (const n of ['ca.key', 'ca.crt']) fs.renameSync(f(n), f(`old-${n}`));
        caChanged = true;
      }
      await run(['req', '-x509', '-new', '-nodes', '-newkey', 'rsa:2048', '-sha256', '-days', '3650',
        '-keyout', 'ca.key', '-out', 'ca.crt',
        '-subj', `/O=TwitchGestor/CN=TwitchGestor - questa casa${tailnet ? ' e Tailscale' : ''}`,
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-addext', `nameConstraints=critical,${limits}`], dir);
      fs.chmodSync(f('ca.key'), 0o600);
      fs.writeFileSync(f('ca.limits'), limits);
      fs.rmSync(f('server.names'), { force: true }); // il certificato del Raspberry va rifatto con la nuova autorità
      log.info(`Creata l'autorità per il certificato https${tailnet ? ' (anche per Tailscale)' : ''}: da installare una volta sul PC`);
    }
    const caNow = fs.existsSync(f('ca.limits')) ? fs.readFileSync(f('ca.limits'), 'utf8') : '';
    const valid = tailnet && caNow === limits ? tailscale : null;
    const names = certificateNames(undefined, undefined, valid).join(',');
    const oldEnough = fs.existsSync(f('server.crt')) && Date.now() - fs.statSync(f('server.crt')).mtimeMs > 700 * 86400000;
    const same = fs.existsSync(f('server.names')) && fs.readFileSync(f('server.names'), 'utf8') === names;
    if (!same || oldEnough || !fs.existsSync(f('server.key'))) {
      fs.writeFileSync(f('server.ext'), [
        'basicConstraints=CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=serverAuth', `subjectAltName=${names}`, '',
      ].join('\n'));
      await run(['req', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'server.key', '-out', 'server.csr',
        '-subj', `/O=TwitchGestor/CN=${names.split(',')[0].slice(4)}`], dir);
      await run(['x509', '-req', '-sha256', '-days', '825', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key',
        '-CAcreateserial', '-out', 'server.crt', '-extfile', 'server.ext'], dir);
      fs.chmodSync(f('server.key'), 0o600);
      fs.writeFileSync(f('server.names'), names);
      log.info(`Certificato https valido per: ${names.replace(/(DNS|IP):/g, '')}`);
    }
    return { key: fs.readFileSync(f('server.key')), cert: fs.readFileSync(f('server.crt')), caFile: f('ca.crt'), names, caChanged };
  } catch (err) {
    log.warn(`Indirizzo https non disponibile (serve openssl): ${err.message}`);
    return null;
  }
}
