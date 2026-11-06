import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { songKey, findDuplicates } from '../src/core/duplicates.js';
import { createMusicFolder } from '../src/musicFolder.js';

test('stesso brano: tolte le aggiunte tipo (Official Video), [HD], (2), feat.', () => {
  const k = (name, tags = {}) => songKey({ name, ...tags });
  assert.equal(k('Linkin Park - Numb.mp3'), k('linkin park - Numb (Official Video).mp3'));
  assert.equal(k('Linkin Park - Numb.mp3'), k('Linkin Park - Numb (2).mp3'));
  assert.equal(k('Linkin Park - Numb.mp3'), k('Linkin Park - Numb [HD].mp3'));
  assert.equal(k('Linkin Park - Numb.mp3'), k('Linkin Park - Numb feat. Qualcuno.mp3'));
  assert.equal(k('x.mp3', { artist: 'Linkin Park', title: 'Numb' }), k('Linkin Park - Numb.mp3'));
  assert.notEqual(k('Linkin Park - Numb.mp3'), k('Linkin Park - In the End.mp3'));
  assert.equal(k('Intro.mp3'), ''); // troppo generico
  assert.notEqual(k('Remix (Club Mix).mp3'), '');
});

test('doppioni: identici (stesso contenuto) e stesso brano; su disco con l\'impronta', () => {
  const g = findDuplicates([
    { id: 'A/a.mp3', name: 'Uno - Due.mp3', size: 10, print: 'x' },
    { id: 'B/a.mp3', name: 'Altro nome.mp3', size: 10, print: 'x' },
    { id: 'C/c.mp3', name: 'Uno - Due (Official Audio).mp3', size: 20, print: 'y' },
    { id: 'D/d.mp3', name: 'Tre - Quattro.mp3', size: 30, print: 'z' },
  ]);
  assert.deepEqual(g.map((x) => [x.kind, x.tracks.map((t) => t.id)]), [['identici', ['A/a.mp3', 'B/a.mp3']], ['stesso brano', ['A/a.mp3', 'C/c.mp3']]]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-dup-'));
  try {
    const put = (rel, body) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
    put('Chill/Uno - Due.mp3', Buffer.alloc(300000, 1));
    put('Varie/Copia.mp3', Buffer.alloc(300000, 1));
    put('Varie/Diverso.mp3', Buffer.alloc(300000, 2));
    const r = createMusicFolder({ dir }).duplicates([
      { id: 'Chill/Uno - Due.mp3', folder: 'Chill', name: 'Uno - Due.mp3' },
      { id: 'Varie/Copia.mp3', folder: 'Varie', name: 'Copia.mp3' },
      { id: 'Varie/Diverso.mp3', folder: 'Varie', name: 'Diverso.mp3' },
    ]);
    assert.deepEqual(r.map((x) => [x.kind, x.tracks.map((t) => t.id)]), [['identici', ['Chill/Uno - Due.mp3', 'Varie/Copia.mp3']]]);
    assert.equal(r[0].tracks[0].size, 300000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
