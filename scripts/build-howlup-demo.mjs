// Costruisce la demo di Howl-UP (un solo file, gira tutta nel browser) in dist-howlup/index.html.
// Uso: npm run build:howlup-demo
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = path.join(ROOT, 'howlup');
const OUT = path.join(ROOT, 'dist-howlup');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const js = await build({
  entryPoints: [path.join(H, 'demo', 'entry.js')], bundle: true, format: 'iife', target: 'es2022', write: false, legalComments: 'none',
  // nel programma vero la pagina prende l'agenda da /core/ (servita dal Raspberry)
  plugins: [{ name: 'core', setup(b) { b.onResolve({ filter: /^\.\/core\/agenda\.js$/ }, () => ({ path: path.join(H, 'src', 'core', 'agenda.js') })); } }],
});
const icon = `data:image/svg+xml,${encodeURIComponent(fs.readFileSync(path.join(H, 'public', 'icon.svg'), 'utf8'))}`;
const css = fs.readFileSync(path.join(H, 'public', 'app.css'), 'utf8').replace(/@font-face[^\n]*\n/g, '');
let html = fs.readFileSync(path.join(H, 'public', 'index.html'), 'utf8')
  .replace(/<!doctype html>\s*/i, '').replace(/<\/?html[^>]*>\s*/gi, '').replace(/<\/?head>\s*/gi, '').replace(/<\/?body>\s*/gi, '')
  .replace(/<meta [^>]*>\s*/gi, '')
  .replace('<title>Howl-UP</title>', '<title>Howl-UP Demo</title>')
  .replace(/<link rel="manifest"[^>]*>\s*/, '').replace(/<link rel="apple-touch-icon"[^>]*>\s*/, '')
  .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="${icon}">`)
  .replace('<link rel="stylesheet" href="app.css">', `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;800&family=Bungee&family=Share+Tech+Mono&family=Outfit:wght@400;600;800&display=swap">\n<style>${css}</style>`)
  .replaceAll('src="icon.svg"', `src="${icon}"`)
  .replace('<script type="module" src="app.js"></script>', `<script>${js.outputFiles[0].text.replaceAll('</script', '<\\/script').replaceAll('src: "icon.svg"', `src: ${JSON.stringify(icon)}`)}</script>`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`Demo di Howl-UP pronta in dist-howlup/index.html (${Math.round(html.length / 1024)} KB)`);
