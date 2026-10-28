/**
 * Lettore musicale: la musica sta nella cartella "music" (anche quella condivisa sul Raspberry),
 * le sottocartelle sono le playlist. La riproduce la pagina /music aggiunta in OBS come sorgente browser,
 * così l'audio va in live e si regola dal mixer di OBS.
 * Non dipende da Node: lo usa anche la versione demo nel browser.
 *
 * Chi usa questo modulo fornisce:
 *   getLibrary()  brani: [{ id: "Chill/Artista - Titolo.mp3", url, folder: "Chill", name }]
 *   send(msg)     messaggio per le pagine /music (cosa suonare, volume, pausa)
 *   store         { load(), save(data) } per ricordare volume, playlist e casuale
 */

export const ALL = '*';

/** "Artista - Titolo.mp3" → { artist, title }. */
export function trackInfo(name) {
  const base = String(name).replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').trim();
  const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(base);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
}

/** Artista e titolo di un brano: quelli scritti dentro il file se ci sono, altrimenti dal nome del file. */
export function infoOf(t) {
  const fromName = trackInfo(t.name);
  return { artist: t.artist || fromName.artist, title: t.title || fromName.title };
}

export class MusicPlayer {
  constructor({ getLibrary, send, store, onChange, random = Math.random } = {}) {
    Object.assign(this, { getLibrary, send, store, onChange, random });
    this.state = { playlist: ALL, shuffle: true, volume: 0.6, playing: false, order: [], index: -1, position: 0, duration: 0 };
    try {
      const saved = store?.load?.();
      if (saved) Object.assign(this.state, { playlist: saved.playlist ?? ALL, shuffle: saved.shuffle !== false, volume: Number.isFinite(saved.volume) ? saved.volume : 0.6 });
    } catch { /* prima volta */ }
  }

  get library() {
    return this.getLibrary?.() ?? [];
  }

  /** Playlist: "Tutta la musica" più una per ogni sottocartella. */
  playlists() {
    const lib = this.library;
    const folders = new Map();
    for (const t of lib) if (t.folder) folders.set(t.folder, (folders.get(t.folder) ?? 0) + 1);
    return [{ id: ALL, name: 'Tutta la musica', count: lib.length }, ...[...folders].sort(([a], [b]) => a.localeCompare(b)).map(([id, count]) => ({ id, name: id, count }))];
  }

  tracksOf(playlist = this.state.playlist) {
    return this.library.filter((t) => playlist === ALL || t.folder === playlist);
  }

  get current() {
    const id = this.state.order[this.state.index];
    return this.library.find((t) => t.id === id) ?? null;
  }

  #shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  #buildOrder(startId) {
    let ids = this.tracksOf().map((t) => t.id);
    if (this.state.shuffle) ids = this.#shuffle(ids);
    if (startId && ids.includes(startId)) ids = [startId, ...ids.filter((id) => id !== startId)];
    this.state.order = ids;
    this.state.index = ids.length ? 0 : -1;
  }

  /** Suona una playlist (dall'inizio o da un brano). */
  play({ playlist, trackId } = {}) {
    if (playlist !== undefined && playlist !== this.state.playlist) this.state.playlist = this.playlists().some((p) => p.id === playlist) ? playlist : ALL;
    if (trackId && !this.tracksOf().some((t) => t.id === trackId)) this.state.playlist = ALL;
    if (trackId || playlist !== undefined || !this.current) this.#buildOrder(trackId);
    this.state.playing = Boolean(this.current);
    this.state.position = 0;
    this.#push(true);
  }

  toggle() {
    if (!this.current) return this.play();
    this.state.playing = !this.state.playing;
    this.#push(false);
  }

  pause() {
    if (!this.state.playing) return;
    this.state.playing = false;
    this.#push(false);
  }

  next() {
    if (!this.state.order.length) return this.play();
    this.state.index += 1;
    if (this.state.index >= this.state.order.length) this.#buildOrder(); // fine della playlist: si ricomincia
    this.state.playing = true;
    this.state.position = 0;
    this.#push(true);
  }

  prev() {
    if (!this.state.order.length) return this.play();
    // come i lettori normali: dopo 5 secondi "indietro" ricomincia il brano
    if (this.state.position < 5) this.state.index = Math.max(0, this.state.index - 1);
    this.state.playing = true;
    this.state.position = 0;
    this.#push(true);
  }

  /**
   * Dopo che dei brani sono stati spostati, rinominati o tolti: la playlist sparita diventa "Tutta la musica"
   * e dall'ordine escono i brani che non ci sono più. Quello che sta suonando non si interrompe.
   */
  libraryChanged() {
    if (this.state.playlist !== ALL && !this.playlists().some((p) => p.id === this.state.playlist)) this.state.playlist = ALL;
    const ids = new Set(this.library.map((t) => t.id));
    const cur = this.state.order[this.state.index];
    const before = this.state.order.slice(0, Math.max(0, this.state.index)).filter((id) => ids.has(id)).length;
    this.state.order = this.state.order.filter((id) => ids.has(id));
    this.state.index = ids.has(cur) ? this.state.order.indexOf(cur) : Math.min(before, this.state.order.length) - 1;
    this.onChange?.(false);
  }

  setVolume(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    this.state.volume = Math.min(1, Math.max(0, n));
    this.#push(false);
  }

  setShuffle(on) {
    this.state.shuffle = Boolean(on);
    const id = this.current?.id;
    if (this.state.order.length) this.#buildOrder(id);
    this.#push(false);
  }

  /** Messaggi dalla pagina /music. */
  fromPage(msg = {}) {
    if (msg.type === 'ended' && msg.id === this.current?.id) this.next();
    else if (msg.type === 'error' && msg.id === this.current?.id) this.next(); // file rovinato: passa al successivo
    else if (msg.type === 'progress' && msg.id === this.current?.id) {
      this.state.position = Number(msg.position) || 0;
      this.state.duration = Number(msg.duration) || 0;
      this.onChange?.(false);
    }
  }

  /** Cosa deve fare la pagina /music. */
  pageState() {
    const t = this.current;
    return { type: 'music', track: t ? { id: t.id, url: t.url, ...infoOf(t) } : null, playing: this.state.playing, volume: this.state.volume };
  }

  /** Per la dashboard. */
  snapshot() {
    const t = this.current;
    const lib = this.library;
    const upNext = this.state.order.slice(this.state.index + 1, this.state.index + 6).map((id) => lib.find((x) => x.id === id)).filter(Boolean);
    return {
      track: t ? { id: t.id, folder: t.folder, ...infoOf(t) } : null,
      playing: this.state.playing, volume: this.state.volume, shuffle: this.state.shuffle, playlist: this.state.playlist,
      position: this.state.position, duration: this.state.duration,
      upNext: upNext.map((x) => ({ id: x.id, ...infoOf(x) })),
    };
  }

  /** Testo per la chat (comando !song). */
  songText() {
    const t = this.current;
    if (!t || !this.state.playing) return 'nessuna canzone in riproduzione';
    const i = infoOf(t);
    return i.artist ? `${i.artist} – ${i.title}` : i.title;
  }

  #push(newTrack) {
    if (newTrack) this.state.duration = 0;
    this.send?.(this.pageState());
    try { this.store?.save?.({ playlist: this.state.playlist, shuffle: this.state.shuffle, volume: this.state.volume }); } catch { /* non importante */ }
    this.onChange?.(true);
  }
}
