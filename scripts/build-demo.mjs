// Costruisce la versione demo di TwitchGestor (gira tutta nel browser, senza server) in dist-demo/.
// Uso: npm run build:demo
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-demo');
const shim = (name) => path.join(ROOT, 'demo', 'shims', `${name}.js`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1. Il "server finto" con il codice vero di TwitchGestor.
await build({
  entryPoints: [path.join(ROOT, 'demo', 'backend.js')],
  outfile: path.join(OUT, 'demo.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: false,
  legalComments: 'none',
  alias: {
    'node:fs': shim('fs'), 'node:path': shim('path'), 'node:events': shim('events'),
    'node:crypto': shim('crypto'), 'node:url': shim('url'), 'node:util': shim('util'),
  },
  define: {
    'process.env.NODE_TEST_CONTEXT': '"demo"',
    'process.env.LOG_LEVEL': 'undefined',
    'import.meta.url': '"file:///demo/src/logger.js"',
  },
  logLevel: 'warning',
});

// 2. Le pagine vere, con percorsi relativi (la demo non sta alla radice di un sito).
const relative = (text) => text
  .replaceAll('src="/', 'src="')
  .replaceAll('href="/', 'href="')
  .replaceAll('overlay?preview', 'overlay.html?preview')
  .replaceAll('`/credits?pannello', '`credits.html?pannello')
  .replaceAll('`/credits?anteprima', '`credits.html?anteprima');

const DEMO_TAG = '<script src="demo.js"></script>';
const PUBLIC = path.join(ROOT, 'public');
for (const file of fs.readdirSync(PUBLIC)) {
  const src = path.join(PUBLIC, file);
  if (!fs.statSync(src).isFile()) continue;
  let text = relative(fs.readFileSync(src, 'utf8'));
  if (file === 'dashboard.html') {
    // Pagina principale: il visualizzatore aggiunge da solo doctype, <head> e <body>.
    text = text
      .replace(/<!doctype html>\s*/i, '')
      .replace(/<\/?html[^>]*>\s*/gi, '')
      .replace(/<\/?head>\s*/gi, '')
      .replace(/<\/?body>\s*/gi, '')
      .replace(/<meta [^>]*>\s*/gi, '')
      .replace('<title>TwitchGestor</title>', `<title>TwitchGestor Demo</title>\n${DEMO_TAG}`);
    fs.writeFileSync(path.join(OUT, 'index.html'), text);
    continue;
  }
  if (file.endsWith('.html')) text = text.replace(/<head>/i, `<head>\n${DEMO_TAG}`);
  fs.writeFileSync(path.join(OUT, file), text);
}

const files = fs.readdirSync(OUT);
const size = files.reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`Demo pronta in dist-demo/ (${files.length} file, ${Math.round(size / 1024)} KB)`);
