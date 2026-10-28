/**
 * Riordino della musica in playlist (= cartelle) per artista.
 * Non dipende da Node: lo usano TwitchGestor (scheda Musica) e Musicante (download nuovi).
 */

import { trackInfo } from './music.js';

export const VARIE = 'Varie';

/** Nome di una playlist (cartella) sicuro: niente barre, "..", caratteri che Windows non accetta. */
export function cleanPlaylist(input) {
  return String(input ?? '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\.{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 60)
    .trim();
}

/**
 * Artista "pulito" per il nome della cartella: senza " - Topic" e "VEVO" dei canali YouTube,
 * e con solo il primo artista ("A feat. B", "A x B", "A, B" → "A"; "Simon & Garfunkel" e "AC/DC" restano interi).
 */
export function cleanArtist(raw) {
  let a = String(raw ?? '').trim();
  a = a.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').replace(/\s*\(?official[^)]*\)?$/i, '');
  a = a.split(/\s+(?:feat\.?|ft\.?|featuring|x|vs\.?)\s+|\s*[,;]\s*/i)[0];
  return cleanPlaylist(a);
}

/** Artista di un brano: dai dati dentro il file (tags) oppure dal nome "Artista - Titolo.mp3". */
export function artistOf({ name, tags = {} }) {
  return cleanArtist(tags.artist || tags.albumArtist || trackInfo(name).artist);
}

/**
 * Piano del riordino: tracks [{ id, name, folder, tags }] → [{ id, to }] (to = cartella di destinazione).
 * Gli artisti con almeno `min` brani hanno la loro playlist, gli altri vanno in "Varie".
 * Se esiste già una playlist con il nome dell'artista (anche maiuscole diverse) si usa quella.
 */
export function planByArtist(tracks, { min = 2, existing = [] } = {}) {
  const count = new Map();
  const key = (a) => a.toLowerCase();
  for (const t of tracks) {
    const a = artistOf(t);
    if (a) count.set(key(a), (count.get(key(a)) ?? 0) + 1);
  }
  const folderFor = new Map(existing.map((f) => [key(f), f]));
  return tracks.map((t) => {
    const a = artistOf(t);
    const ok = a && (count.get(key(a)) >= min || folderFor.has(key(a)));
    const to = ok ? folderFor.get(key(a)) ?? a : VARIE;
    if (ok && !folderFor.has(key(a))) folderFor.set(key(a), a); // stesso nome per tutti i brani dell'artista
    return { id: t.id, name: t.name, from: t.folder ?? '', to, artist: a };
  });
}

/** Riassunto del piano per la pagina: [{ folder, count, artists }] in ordine di numero di brani. */
export function summarizePlan(plan) {
  const m = new Map();
  for (const p of plan) {
    if (p.from === p.to) continue;
    m.set(p.to, (m.get(p.to) ?? 0) + 1);
  }
  return [...m].map(([folder, count]) => ({ folder, count })).sort((a, b) => (a.folder === VARIE) - (b.folder === VARIE) || b.count - a.count || a.folder.localeCompare(b.folder, 'it'));
}
