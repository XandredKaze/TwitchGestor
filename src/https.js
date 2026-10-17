/**
 * Indirizzo https per la dashboard (sul Raspberry): Twitch mostra il suo player e la sua chat
 * solo su pagine https o "localhost". TwitchGestor crea un proprio certificato con openssl:
 *   - un'autorità di certificazione ("TwitchGestor – questa casa") da installare una volta sul PC,
 *     valida solo per nomi .local, localhost e indirizzi della rete di casa (non può valere per altri siti);
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

/** Nomi e indirizzi per cui vale il certificato (tutti dentro i limiti dell'autorità). */
export function certificateNames(hostname = os.hostname(), ips = lanAddresses()) {
  const host = String(hostname).toLowerCase().replace(/\.local$/, '').replace(/[^a-z0-9-]/g, '');
  return [`DNS:${host}.local`, 'DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)];
}

// L'autorità vale solo per la rete di casa: anche se qualcuno ne copiasse la chiave, non potrebbe usarla per altri siti.
const CA_LIMITS = [
  'permitted;DNS:local', 'permitted;DNS:localhost',
  'permitted;IP:127.0.0.0/255.0.0.0', 'permitted;IP:10.0.0.0/255.0.0.0',
  'permitted;IP:172.16.0.0/255.240.0.0', 'permitted;IP:192.168.0.0/255.255.0.0',
].join(',');

/** Prepara (se serve) autorità e certificato in dir. Ritorna { key, cert, caFile } oppure null se openssl manca. */
export async function ensureCertificates(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (name) => path.join(dir, name);
  try {
    if (!fs.existsSync(f('ca.key')) || !fs.existsSync(f('ca.crt'))) {
      await run(['req', '-x509', '-new', '-nodes', '-newkey', 'rsa:2048', '-sha256', '-days', '3650',
        '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/O=TwitchGestor/CN=TwitchGestor - questa casa',
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-addext', `nameConstraints=critical,${CA_LIMITS}`], dir);
      fs.chmodSync(f('ca.key'), 0o600);
      log.info('Creata l\'autorità per il certificato https (da installare una volta sul PC)');
    }
    const names = certificateNames().join(',');
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
    return { key: fs.readFileSync(f('server.key')), cert: fs.readFileSync(f('server.crt')), caFile: f('ca.crt') };
  } catch (err) {
    log.warn(`Indirizzo https non disponibile (serve openssl): ${err.message}`);
    return null;
  }
}
