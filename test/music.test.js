import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MusicPlayer, trackInfo, ALL } from '../src/core/music.js';

const LIB = [
  { id: 'Chill/Lofi Girl - Pioggia.mp3', url: '/media/music/Chill/Lofi%20Girl%20-%20Pioggia.mp3', folder: 'Chill', name: 'Lofi Girl - Pioggia.mp3' },
  { id: 'Chill/Notte.mp3', url: 'u2', folder: 'Chill', name: 'Notte.mp3' },
  { id: 'Gaming/Boss_fight.ogg', url: 'u3', folder: 'Gaming', name: 'Boss_fight.ogg' },
  { id: 'intro.mp3', url: 'u4', folder: '', name: 'intro.mp3' },
];
function setup(opts = {}) {
  const sent = [];
  const p = new MusicPlayer({ getLibrary: () => LIB, send: (m) => sent.push(m), random: () => 0.5, ...opts });
  return { p, sent };
}

test('nome del brano: artista e titolo dal nome del file', () => {
  assert.deepEqual(trackInfo('Lofi Girl - Pioggia.mp3'), { artist: 'Lofi Girl', title: 'Pioggia' });
  assert.deepEqual(trackInfo('Boss_fight.ogg'), { artist: '', title: 'Boss fight' });
});

test('playlist dalle cartelle, play, avanti, indietro e fine della playlist', () => {
  const { p, sent } = setup();
  assert.deepEqual(p.playlists().map((x) => [x.id, x.count]), [[ALL, 4], ['Chill', 2], ['Gaming', 1]]);
  p.setShuffle(false);
  p.play({ playlist: 'Chill' });
  assert.equal(p.current.id, 'Chill/Lofi Girl - Pioggia.mp3');
  assert.equal(sent.at(-1).track.artist, 'Lofi Girl');
  assert.equal(sent.at(-1).playing, true);
  p.fromPage({ type: 'ended', id: 'Chill/Lofi Girl - Pioggia.mp3' });
  assert.equal(p.current.id, 'Chill/Notte.mp3');
  p.next();
  assert.equal(p.current.id, 'Chill/Lofi Girl - Pioggia.mp3', 'finita la playlist ricomincia');
  p.fromPage({ type: 'progress', id: p.current.id, position: 30, duration: 200 });
  p.prev();
  assert.equal(p.current.id, 'Chill/Lofi Girl - Pioggia.mp3', 'dopo 5 secondi "indietro" ricomincia il brano');
  p.toggle();
  assert.equal(sent.at(-1).playing, false);
  assert.match(p.songText(), /nessuna/);
  p.toggle();
  assert.equal(p.songText(), 'Lofi Girl – Pioggia');
});

test('un brano scelto parte subito; volume e impostazioni ricordati', () => {
  let saved = null;
  const { p } = setup({ store: { load: () => saved, save: (d) => { saved = d; } } });
  p.play({ trackId: 'Gaming/Boss_fight.ogg' });
  assert.equal(p.current.id, 'Gaming/Boss_fight.ogg');
  assert.equal(p.state.playlist, ALL, 'brano fuori dalla playlist scelta: si passa a tutta la musica');
  p.setVolume(2);
  assert.equal(p.state.volume, 1);
  const q = new MusicPlayer({ getLibrary: () => LIB, store: { load: () => saved, save() {} } });
  assert.equal(q.state.volume, 1);
  assert.equal(q.snapshot().track, null, 'non parte da sola');
});

test('libreria: i file audio della cartella, le sottocartelle diventano playlist', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { scanLibrary } = await import('../src/musiclib.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-music-'));
  fs.mkdirSync(path.join(dir, 'Chill'));
  fs.writeFileSync(path.join(dir, 'Chill', 'Artista - Brano uno.mp3'), 'x');
  fs.writeFileSync(path.join(dir, 'intro.ogg'), 'x');
  fs.writeFileSync(path.join(dir, 'note.txt'), 'x');
  const lib = scanLibrary(dir);
  assert.deepEqual(lib.map((t) => [t.id, t.folder]), [['Chill/Artista - Brano uno.mp3', 'Chill'], ['intro.ogg', '']]);
  assert.equal(lib[0].url, '/media/music/Chill/Artista%20-%20Brano%20uno.mp3');
  assert.deepEqual(scanLibrary(path.join(dir, 'non-esiste')), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('impostazioni della musica: abbassamento durante gli alert', async () => {
  const { sanitizeConfig } = await import('../src/core/schema.js');
  const fs = await import('node:fs');
  const defaults = JSON.parse(fs.readFileSync(new URL('../src/core/defaults.json', import.meta.url)));
  assert.deepEqual(sanitizeConfig({}, defaults).music, { duck: true, duckLevel: 0.3 });
  assert.deepEqual(sanitizeConfig({ music: { duck: false, duckLevel: 7 } }, defaults).music, { duck: false, duckLevel: 1 });
  assert.deepEqual(sanitizeConfig({ music: { duck: 'sì', duckLevel: 'x' } }, defaults).music, { duck: true, duckLevel: 0.3 });
});
