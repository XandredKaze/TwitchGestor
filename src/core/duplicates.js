/**
 * Doppioni nella musica:
 *   - identici: stesso file (stessa dimensione e stessa "impronta" del contenuto)
 *   - stesso brano: stesso artista e titolo, tolte le aggiunte tipo "(Official Video)", "[HD]", "(2)"
 * Non dipende da Node: l'impronta la calcola chi usa il modulo.
 */

import { infoOf } from './music.js';

const NOISE = /\s*[([](?:[^)\]]*?\b(?:official|video|audio|lyrics?|testo|hd|hq|4k|visuali[sz]er|remaster(?:ed)?|mv|clip|music video|full|extended)\b[^)\]]*|\d{1,2})[)\]]/gi;

/** Chiave per "stesso brano" ('' se il titolo è troppo generico per dirlo, es. "Intro"). */
export function songKey(t) {
  const { artist, title } = infoOf(t);
  const clean = (s) => String(s ?? '')
    .replace(NOISE, ' ')
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const a = clean(artist);
  const ti = clean(title);
  if (!ti || (!a && ti.replace(/ /g, '').length < 6)) return '';
  return `${a}|${ti}`;
}

/**
 * tracks: [{ id, folder, name, artist, title, size, print }] (print: impronta del contenuto).
 * Ritorna i gruppi: [{ kind: 'identici' | 'stesso brano', tracks: [...] }], prima gli identici.
 */
export function findDuplicates(tracks) {
  const groups = [];
  const byPrint = new Map();
  for (const t of tracks) {
    if (!t.print) continue;
    const k = `${t.size}:${t.print}`;
    byPrint.set(k, [...(byPrint.get(k) ?? []), t]);
  }
  const exact = new Set();
  for (const list of byPrint.values()) {
    if (list.length < 2) continue;
    groups.push({ kind: 'identici', tracks: list });
    for (const t of list.slice(1)) exact.add(t.id); // le copie: il primo resta per "stesso brano"
  }
  const byKey = new Map();
  for (const t of tracks) {
    if (exact.has(t.id)) continue;
    const k = songKey(t);
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), t]);
  }
  for (const list of byKey.values()) if (list.length > 1) groups.push({ kind: 'stesso brano', tracks: list });
  for (const g of groups) g.tracks.sort((x, y) => x.id.localeCompare(y.id, 'it'));
  return groups;
}
