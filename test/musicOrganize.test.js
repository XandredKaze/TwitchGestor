import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readId3 } from '../src/core/id3.js';
import { cleanArtist, planByArtist, summarizePlan } from '../src/core/musicOrganize.js';
import { createMusicFolder, placeNewTrack } from '../src/musicFolder.js';

/** Un finto MP3 con i tag ID3v2.4 (come lo scrive yt-dlp). */
function mp3({ artist, title }) {
  const frame = (id, text) => {
    const body = Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]); // 3 = UTF-8
    const size = Buffer.from([(body.length >> 21) & 0x7f, (body.length >> 14) & 0x7f, (body.length >> 7) & 0x7f, body.length & 0x7f]);
    return Buffer.concat([Buffer.from(id), size, Buffer.from([0, 0]), body]);
  };
  const frames = Buffer.concat([artist ? frame('TPE1', artist) : Buffer.alloc(0), title ? frame('TIT2', title) : Buffer.alloc(0), Buffer.alloc(20)]);
  const n = frames.length;
  const head = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, (n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
  return Buffer.concat([head, frames, Buffer.from('audio finto')]);
}

test('musica: legge artista e titolo dai tag degli MP3', () => {
  assert.deepEqual(readId3(mp3({ artist: 'Lofi Girl', title: 'Pioggia è sui tetti' })), { artist: 'Lofi Girl', albumArtist: '', title: 'Pioggia è sui tetti' });
  assert.deepEqual(readId3(Buffer.from('niente tag')), { artist: '', albumArtist: '', title: '' });
});

test('musica: nomi degli artisti puliti per le playlist', () => {
  assert.equal(cleanArtist('Lofi Girl - Topic'), 'Lofi Girl');
  assert.equal(cleanArtist('TaylorSwiftVEVO'), 'TaylorSwift');
  assert.equal(cleanArtist('Daft Punk feat. Pharrell'), 'Daft Punk');
  assert.equal(cleanArtist('Artista A, Artista B'), 'Artista A');
  assert.equal(cleanArtist('Simon & Garfunkel'), 'Simon & Garfunkel');
  assert.equal(cleanArtist('AC/DC'), 'AC DC');
});

test('musica: riordino per artista (almeno 2 brani, gli altri in Varie)', () => {
  const plan = planByArtist([
    { id: 'Musicante/a.mp3', name: 'a.mp3', folder: 'Musicante', tags: { artist: 'Lofi Girl' } },
    { id: 'Musicante/b.mp3', name: 'b.mp3', folder: 'Musicante', tags: { artist: 'lofi girl - Topic' } },
    { id: 'Musicante/Pixel Hero - Boss.mp3', name: 'Pixel Hero - Boss.mp3', folder: 'Musicante', tags: {} },
    { id: 'Musicante/solo.mp3', name: 'solo.mp3', folder: 'Musicante', tags: { artist: 'Uno Solo' } },
    { id: 'Musicante/x.mp3', name: 'x.mp3', folder: 'Musicante', tags: {} },
  ], { existing: ['Pixel Hero'] });
  assert.deepEqual(plan.map((p) => p.to), ['Lofi Girl', 'Lofi Girl', 'Pixel Hero', 'Varie', 'Varie']);
  assert.deepEqual(summarizePlan(plan), [{ folder: 'Lofi Girl', count: 2 }, { folder: 'Pixel Hero', count: 1 }, { folder: 'Varie', count: 2 }]);
});

test('musica: sposta, rinomina, elimina e riordina i file (il brano che suona resta)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-music-'));
  const put = (rel, tags) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), mp3(tags)); };
  try {
    put('Musicante/uno.mp3', { artist: 'Lofi Girl' });
    put('Musicante/due.mp3', { artist: 'Lofi Girl' });
    put('Musicante/tre.mp3', { artist: 'Altro' });
    put('Musicante/quattro.mp3', { artist: 'Altro2' });
    const music = createMusicFolder({ dir });
    const pre = music.preview('Musicante');
    assert.equal(pre.total, 4);
    const r = music.organize('Musicante', { skip: ['Musicante/quattro.mp3'] });
    assert.equal(r.moved, 3);
    assert.deepEqual(r.skipped, ['Musicante/quattro.mp3']);
    assert.ok(fs.existsSync(path.join(dir, 'Lofi Girl', 'uno.mp3')));
    assert.ok(fs.existsSync(path.join(dir, 'Varie', 'tre.mp3')));
    assert.ok(fs.existsSync(path.join(dir, 'Musicante', 'quattro.mp3'))); // quello che suonava
    music.move(['Varie/tre.mp3'], 'Chill');
    assert.ok(fs.existsSync(path.join(dir, 'Chill', 'tre.mp3')));
    assert.ok(!fs.existsSync(path.join(dir, 'Varie'))); // playlist vuota: sparisce
    music.renameFolder('Chill', 'Rilassante');
    assert.ok(fs.existsSync(path.join(dir, 'Rilassante', 'tre.mp3')));
    assert.throws(() => music.move(['../../etc/passwd'], 'x'), /non valido/);
    music.remove(['Rilassante/tre.mp3']);
    assert.ok(!fs.existsSync(path.join(dir, 'Rilassante')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('musicante: un brano nuovo va nella playlist del suo artista (o in Varie)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-music-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-work-'));
  const nuovo = (name, artist) => { const f = path.join(work, name); fs.writeFileSync(f, mp3({ artist })); return f; };
  try {
    assert.equal(placeNewTrack(dir, nuovo('a.mp3', 'Nuovo')), path.join(dir, 'Varie')); // primo brano: Varie
    fs.mkdirSync(path.join(dir, 'Varie'));
    fs.renameSync(path.join(work, 'a.mp3'), path.join(dir, 'Varie', 'a.mp3'));
    // secondo brano dello stesso artista: nasce la sua playlist e il primo ci si sposta
    assert.equal(placeNewTrack(dir, nuovo('b.mp3', 'Nuovo')), path.join(dir, 'Nuovo'));
    assert.ok(fs.existsSync(path.join(dir, 'Nuovo', 'a.mp3')));
    fs.mkdirSync(path.join(dir, 'Pixel Hero'));
    assert.equal(placeNewTrack(dir, nuovo('c.mp3', 'pixel hero')), path.join(dir, 'Pixel Hero'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
});
