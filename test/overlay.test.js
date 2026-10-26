import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  cleanRelPath, cleanFileName, overlayType, sourceFile, classifySources, targetPath, relInside, linkSettings, readObsSources,
} from '../src/core/overlayFiles.js';
import { createOverlayFolder } from '../src/overlayFolder.js';

const ROOT = '\\\\twitchgestor\\TwitchGestor\\overlay';

test('overlay: nomi e percorsi sicuri', () => {
  assert.equal(cleanRelPath('Scena 1/sfondo.png'), 'Scena 1/sfondo.png');
  assert.equal(cleanRelPath('../../etc/passwd'), 'etc/passwd');
  assert.equal(cleanRelPath('a\\b\\c.png'), 'a/b/c.png');
  assert.equal(cleanRelPath('a/b/c/d/e.png'), ''); // troppe cartelle
  assert.equal(cleanFileName('C:\\Users\\me\\Desktop\\logo.PNG'), 'logo.PNG');
  assert.equal(cleanFileName('virus.exe'), '');
  assert.equal(overlayType('intro.webm'), 'video');
  assert.equal(overlayType('pagina.html'), 'web');
});

test('overlay: quale file usa una sorgente di OBS', () => {
  assert.equal(sourceFile('image_source', { file: 'C:/grafiche/logo.png' }), 'C:/grafiche/logo.png');
  assert.equal(sourceFile('ffmpeg_source', { local_file: 'C:/v.mp4' }), 'C:/v.mp4'); // "file locale" è attivo di serie
  assert.equal(sourceFile('ffmpeg_source', { is_local_file: false, input: 'rtmp://x', local_file: 'C:/v.mp4' }), '');
  assert.equal(sourceFile('browser_source', { url: 'http://x' }), ''); // pagina web, non un file
  assert.equal(sourceFile('browser_source', { is_local_file: true, local_file: 'C:/o/index.html' }), 'C:/o/index.html');
  assert.equal(sourceFile('text_gdiplus_v3', { file: 'x' }), '');
});

test('overlay: percorsi della cartella di Gestor visti da OBS', () => {
  assert.equal(targetPath(ROOT, 'Scena/logo.png'), '\\\\twitchgestor\\TwitchGestor\\overlay\\Scena\\logo.png');
  assert.equal(targetPath('/home/pi/tg/data/media/overlay', 'logo.png'), '/home/pi/tg/data/media/overlay/logo.png');
  assert.equal(relInside(ROOT, '\\\\TWITCHGESTOR\\TwitchGestor\\overlay\\Scena\\logo.png'), 'Scena/logo.png');
  assert.equal(relInside(ROOT, '//twitchgestor/TwitchGestor/overlay/logo.png'), 'logo.png'); // OBS a volte usa le barre /
  assert.equal(relInside(ROOT, 'C:/grafiche/logo.png'), null);
  assert.deepEqual(linkSettings('ffmpeg_source', 'X'), { local_file: 'X', is_local_file: true });
  assert.deepEqual(linkSettings('image_source', 'X'), { file: 'X' });
});

test('overlay: sorgenti sul PC, già su Gestor e file con lo stesso nome', () => {
  const inputs = [
    { name: 'Logo', kind: 'image_source', settings: { file: 'C:/grafiche/logo.png' }, scenes: ['Gioco'] },
    { name: 'Sfondo', kind: 'image_source', settings: { file: `${ROOT}\\Inizio\\sfondo.png` }, scenes: ['Inizio'] },
    { name: 'Vecchio', kind: 'image_source', settings: { file: `${ROOT}\\tolto.png` }, scenes: [] },
    { name: 'Intro', kind: 'ffmpeg_source', settings: { local_file: 'D:\\video\\intro.mp4' }, scenes: ['Inizio'] },
    { name: 'Chat', kind: 'browser_source', settings: { url: 'http://localhost:3000/chat' }, scenes: ['Gioco'] },
  ];
  const files = [
    { path: 'Inizio/sfondo.png', name: 'sfondo.png' },
    { path: 'logo.png', name: 'logo.png' },
    { path: 'Gioco/LOGO.png', name: 'LOGO.png' },
  ];
  const out = classifySources(inputs, { root: ROOT, files });
  const by = Object.fromEntries(out.map((s) => [s.name, s]));
  assert.equal(out.length, 4); // la chat (indirizzo web) non c'entra
  assert.equal(by.Logo.onGestor, false);
  assert.equal(by.Logo.match, 'Gioco/LOGO.png'); // preferita la cartella con il nome della scena
  assert.equal(by.Intro.match, null);
  assert.equal(by.Sfondo.onGestor, true);
  assert.equal(by.Sfondo.rel, 'Inizio/sfondo.png');
  assert.equal(by.Sfondo.missing, false);
  assert.equal(by.Vecchio.missing, true);
  assert.equal(out[0].onGestor, false); // prima quelle ancora sul PC
});

/** OBS finto: risponde alle richieste di obs-websocket che usa la scheda Overlay. */
function fakeObs(inputs, sceneItems) {
  const sent = [];
  return {
    status: 'connesso', error: '', sent,
    async request(type, data) {
      if (type === 'GetInputList') return { inputs: inputs.map((i) => ({ inputName: i.name, inputKind: `${i.kind}_v2`, unversionedInputKind: i.kind })) };
      if (type === 'GetSceneList') return { scenes: Object.keys(sceneItems).map((sceneName) => ({ sceneName })) };
      if (type === 'GetSceneItemList') return { sceneItems: (sceneItems[data.sceneName] ?? []).map((sourceName) => ({ sourceName })) };
      if (type === 'GetInputSettings') return { inputSettings: inputs.find((i) => i.name === data.inputName).settings };
      if (type === 'SetInputSettings') {
        sent.push(data);
        Object.assign(inputs.find((i) => i.name === data.inputName).settings, data.inputSettings);
        return {};
      }
      throw new Error(`richiesta inattesa ${type}`);
    },
  };
}

test('overlay: legge da OBS le sorgenti con un file e le loro scene', async () => {
  const obs = fakeObs([
    { name: 'Logo', kind: 'image_source', settings: { file: 'C:/logo.png' } },
    { name: 'Mic', kind: 'wasapi_input_capture', settings: {} },
  ], { Gioco: ['Logo', 'Mic'], Pausa: ['Logo'] });
  const list = await readObsSources((t, d) => obs.request(t, d));
  assert.deepEqual(list, [{ name: 'Logo', kind: 'image_source', settings: { file: 'C:/logo.png' }, scenes: ['Pausa', 'Gioco'] }]);
});

test('overlay: carica, collega a OBS, rinomina (OBS segue il file) e torna al PC', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-overlay-'));
  const inputs = [{ name: 'Logo', kind: 'image_source', settings: { file: 'C:\\grafiche\\logo.png' } }];
  const obs = fakeObs(inputs, { Gioco: ['Logo'] });
  const folder = createOverlayFolder({ dir: path.join(tmp, 'overlay'), linksFile: path.join(tmp, 'links.json'), obs, root: () => ROOT });
  try {
    const saved = await folder.save(Readable.from([Buffer.from('png')]), 'Gioco', 'logo.png');
    assert.equal(saved, 'Gioco/logo.png');
    assert.equal(await folder.save(Readable.from([Buffer.from('png')]), 'Gioco', 'logo.png'), 'Gioco/logo (2).png'); // mai sovrascritto
    await assert.rejects(folder.save(Readable.from([Buffer.from('x')]), '', 'virus.exe'), /Formato/);
    assert.equal(await folder.save(Readable.from([Buffer.from('x')]), '../..', 'a.png'), 'a.png'); // ".." tolto: resta dentro la cartella
    folder.remove('a.png');
    assert.deepEqual(folder.list().folders, ['Gioco']);

    let st = await folder.sources();
    assert.equal(st.sources[0].match, 'Gioco/logo.png');
    await folder.link('Logo');
    assert.equal(inputs[0].settings.file, `${ROOT}\\Gioco\\logo.png`);
    st = await folder.sources();
    assert.equal(st.sources[0].onGestor, true);
    assert.equal(st.sources[0].previous, 'C:\\grafiche\\logo.png');

    const r = await folder.rename('Gioco', 'Scena gioco');
    assert.equal(r.relinked, 1);
    assert.equal(inputs[0].settings.file, `${ROOT}\\Scena gioco\\logo.png`);
    await assert.rejects(folder.rename('Scena gioco/logo.png', 'Scena gioco/logo.exe'), /estensione/);

    await folder.restore('Logo');
    assert.equal(inputs[0].settings.file, 'C:\\grafiche\\logo.png');
    folder.remove('Scena gioco');
    assert.deepEqual(folder.list().folders, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('overlay: senza cartella condivisa non collega niente', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-overlay-'));
  const obs = fakeObs([{ name: 'Logo', kind: 'image_source', settings: { file: 'C:/logo.png' } }], {});
  const folder = createOverlayFolder({ dir: path.join(tmp, 'overlay'), linksFile: path.join(tmp, 'links.json'), obs, root: () => '' });
  try {
    await folder.save(Readable.from([Buffer.from('png')]), '', 'logo.png');
    await assert.rejects(folder.link('Logo'), /cartella condivisa/);
    assert.equal(obs.sent.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
