#!/usr/bin/env node
// finto yt-dlp per i test: risponde come quello vero (versione, anteprima, download con avanzamento)
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const url = args.at(-1);
if (args.includes('--version')) { console.log('2026.10.01'); process.exit(0); }
if (args.includes('-U')) { console.log('yt-dlp is up to date'); process.exit(0); }
if (url.includes('errore')) { console.error('ERROR: [youtube] abc: Video unavailable'); process.exit(1); }
const playlist = args.includes('--yes-playlist') && url.includes('list=');
const songs = playlist ? ['Primo brano', 'Secondo brano'] : ['Brano singolo'];
if (args.includes('-J')) {
  console.log(JSON.stringify(playlist ? { title: 'La mia playlist', uploader: 'Xandred', entries: songs.map((t, i) => ({ title: t, duration: 120 + i })) } : { title: songs[0], uploader: 'Xandred', duration: 200 }));
  process.exit(0);
}
const out = args[args.indexOf('-o') + 1];
const slow = url.includes('lento');
let i = 0;
const next = () => {
  if (i >= songs.length) process.exit(0);
  const t = songs[i];
  for (const p of ['10.0%', '55.5%', '100%']) console.log(`MUSICANTE_PROGRESS ${p}|${playlist ? i + 1 : 'NA'}|${playlist ? songs.length : 'NA'}|${t}`);
  const file = out.replace('%(title).150B.%(ext)s', `${t}.mp3`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'mp3');
  console.log(`MUSICANTE_FILE ${file}`);
  i += 1;
  setTimeout(next, slow ? 5000 : 10);
};
next();
