import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, cleanFolder, downloadArgs, parseLine, parseProbe, friendlyError, formatDuration } from '../src/core/ytdlp.js';

test('link e cartelle ripuliti', () => {
  assert.equal(cleanUrl(' https://www.youtube.com/watch?v=abc '), 'https://www.youtube.com/watch?v=abc');
  assert.equal(cleanUrl('file:///etc/passwd'), '');
  assert.equal(cleanUrl('--exec rm'), '');
  assert.equal(cleanFolder('../../etc'), 'etc');
  assert.equal(cleanFolder('Lo-fi: per la live?'), 'Lo-fi per la live');
  assert.equal(cleanFolder('  '), '');
});

test('argomenti di yt-dlp: MP3, playlist sì o no, il link sempre dopo --', () => {
  const a = downloadArgs({ url: 'https://x.y/z', playlist: true, dir: '/m/Lofi', archive: '/d/a.txt' });
  assert.deepEqual(a.slice(-2), ['--', 'https://x.y/z']);
  assert.ok(a.includes('--yes-playlist') && a.includes('mp3') && a.includes('/d/a.txt'));
  assert.equal(a[a.indexOf('-o') + 1], '/m/Lofi/%(title).150B.%(ext)s');
  assert.ok(downloadArgs({ url: 'https://x.y', dir: '/m' }).includes('--no-playlist'));
});

test('righe di yt-dlp: avanzamento, file salvati, già scaricati, errori', () => {
  assert.deepEqual(parseLine('MUSICANTE_PROGRESS  42.5%|3|12|Titolo | con barra'), { type: 'progress', percent: 42.5, index: 3, total: 12, title: 'Titolo | con barra' });
  assert.deepEqual(parseLine('MUSICANTE_PROGRESS 100%|NA|NA|NA'), { type: 'progress', percent: 100, index: null, total: null, title: '' });
  assert.deepEqual(parseLine('MUSICANTE_FILE /m/Lofi/Brano.mp3'), { type: 'file', path: '/m/Lofi/Brano.mp3' });
  assert.deepEqual(parseLine('[download] Brano has already been recorded in the archive'), { type: 'skip' });
  assert.deepEqual(parseLine('ERROR: [youtube] abc: Private video. Sign in'), { type: 'error', text: 'Il video è privato' });
  assert.equal(parseLine('[youtube] Extracting URL'), null);
  assert.match(friendlyError('[generic] Unsupported URL: https://x'), /non è supportato/);
  assert.equal(formatDuration(3723), '1:02:03');
});

test('anteprima: brano singolo e playlist', () => {
  assert.deepEqual(parseProbe({ title: 'Brano', uploader: 'X', duration: 200 }), { title: 'Brano', uploader: 'X', isPlaylist: false, count: 1, duration: 200, entries: [] });
  const p = parseProbe(JSON.stringify({ title: 'Lista', entries: [{ title: 'A', duration: 60 }, null, { title: 'B', duration: 30 }] }));
  assert.deepEqual([p.isPlaylist, p.count, p.duration, p.entries.map((e) => e.title)], [true, 2, 90, ['A', 'B']]);
});
