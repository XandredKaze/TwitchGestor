/**
 * Legge artista e titolo dai dati dentro un MP3 (tag ID3v2, quelli che scrive anche yt-dlp con --embed-metadata).
 * Basta l'inizio del file (i tag stanno lì). Non dipende da Node.
 */

const decoders = {};
const decode = (bytes, enc) => {
  const name = ['latin1', 'utf-16', 'utf-16be', 'utf-8'][enc] ?? 'latin1';
  decoders[name] ??= new TextDecoder(name);
  return decoders[name].decode(bytes);
};

function textFrame(data) {
  if (!data.length) return '';
  const enc = data[0];
  let body = data.subarray(1);
  // UTF-16 senza BOM: si legge come big endian
  if (enc === 1 && !(body[0] === 0xff && body[1] === 0xfe) && !(body[0] === 0xfe && body[1] === 0xff)) return decode(body, 2).replace(/\0+$/, '').split('\0')[0].trim();
  if (enc === 1 && body[0] === 0xfe) { body = body.subarray(2); return decode(body, 2).replace(/\0+$/, '').split('\0')[0].trim(); }
  return decode(body, enc).replace(/^﻿/, '').replace(/\0+$/, '').split('\0')[0].trim();
}

const synchsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);

/** bytes: inizio del file. Ritorna { artist, albumArtist, title } (stringhe vuote se mancano). */
export function readId3(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const out = { artist: '', albumArtist: '', title: '' };
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return out; // "ID3"
  const ver = b[3];
  const flags = b[5];
  const end = Math.min(b.length, 10 + synchsafe(b, 6));
  let i = 10;
  if (flags & 0x40) i += ver === 4 ? synchsafe(b, 10) : ((b[10] << 24) | (b[11] << 16) | (b[12] << 8) | b[13]) + 4; // intestazione estesa
  const want = ver === 2 ? { TP1: 'artist', TP2: 'albumArtist', TT2: 'title' } : { TPE1: 'artist', TPE2: 'albumArtist', TIT2: 'title' };
  const idLen = ver === 2 ? 3 : 4;
  const headLen = ver === 2 ? 6 : 10;
  while (i + headLen <= end) {
    const id = String.fromCharCode(...b.subarray(i, i + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // spazio vuoto in fondo ai tag
    const size = ver === 2 ? (b[i + 3] << 16) | (b[i + 4] << 8) | b[i + 5]
      : ver === 4 ? synchsafe(b, i + 4) : ((b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7]) >>> 0;
    const start = i + headLen;
    if (size <= 0 || start + size > b.length) break;
    if (want[id] && !out[want[id]]) out[want[id]] = textFrame(b.subarray(start, start + size));
    i = start + size;
  }
  return out;
}
