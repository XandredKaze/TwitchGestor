// Costruisce la demo di Musicante (un solo file, gira tutta nel browser) in dist-musicante/index.html.
// Uso: npm run build:musicante-demo
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M = path.join(ROOT, 'musicante');
const OUT = path.join(ROOT, 'dist-musicante');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const js = await build({
  entryPoints: [path.join(M, 'demo', 'entry.js')], bundle: true, format: 'iife', target: 'es2022', write: false, legalComments: 'none',
  // nel programma vero la pagina prende ytdlp.js da /core/ (servito dal Raspberry)
  plugins: [{ name: 'core', setup(b) { b.onResolve({ filter: /^\.\/core\/ytdlp\.js$/ }, () => ({ path: path.join(M, 'src', 'core', 'ytdlp.js') })); } }],
});
const icon = `data:image/svg+xml,${encodeURIComponent(fs.readFileSync(path.join(M, 'public', 'icon.svg'), 'utf8'))}`;
const css = fs.readFileSync(path.join(M, 'public', 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(M, 'public', 'index.html'), 'utf8')
  .replace(/<!doctype html>\s*/i, '').replace(/<\/?html[^>]*>\s*/gi, '').replace(/<\/?head>\s*/gi, '').replace(/<\/?body>\s*/gi, '')
  .replace(/<meta [^>]*>\s*/gi, '')
  .replace('<title>Musicante</title>', '<title>Musicante Demo</title>')
  .replace(/<link rel="manifest"[^>]*>\s*/, '')
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}">`)
  .replace('<link rel="stylesheet" href="app.css">', `<style>${css}</style>`)
  .replace('<script type="module" src="app.js"></script>', `<script>${js.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`Demo di Musicante pronta in dist-musicante/index.html (${Math.round(html.length / 1024)} KB)`);
