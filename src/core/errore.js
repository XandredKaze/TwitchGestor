/**
 * Stile degli alert "ERRORE_DI_SISTEMA" (grafica di un amico di Xandred): finestre di errore a cascata
 * nella scena normale, barra in alto nelle scene di gioco. Qui solo quello che serve al programma
 * (tipi che lo usano, scena in-game, durata); la grafica sta in public/alert-errore.js e .css.
 */

/** Tipi di alert che hanno la grafica di questo stile (Bits e Raid restano classici finché non arrivano le loro). */
export const ERRORE_TYPES = ['sub', 'giftsub', 'follow', 'resub', 'donation', 'redemption'];

/** "game, gioco" → ['game', 'gioco'] */
export const sceneWords = (s) => String(s ?? '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);

/** Una scena è "in-game" se il nome contiene una delle parole scelte. */
export function isIngameScene(name, words) {
  const n = String(name ?? '').toLowerCase();
  return Boolean(n) && sceneWords(words).some((w) => n.includes(w));
}

/** Quanto dura tutto l'alert (entrata + attesa + uscita), come nell'animazione della pagina. */
export function erroreDuration(cfg = {}, mode = 'normal') {
  if (mode === 'ingame') return 900 + 250 + 300 + (cfg.igHoldMs ?? 3500) + 400;
  return (cfg.windows ?? 14) * (cfg.spawnMs ?? 70) + 400 + 250 + 200 + 100 + (cfg.holdMs ?? 6000) + 450;
}
