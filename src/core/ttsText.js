/**
 * Pulisce il testo prima di leggerlo: niente link, parole vietate sostituite,
 * lettere ripetute accorciate, cheermote (Cheer100…) tolti, lunghezza massima.
 */
export function cleanText(text, { maxLength = 200, bannedWords = [], skipLinks = true } = {}) {
  let t = String(text ?? '');
  if (skipLinks) t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, 'link');
  t = t.replace(/\b[a-z]+\d{1,6}\b/gi, (w) => (/^(cheer|biblethump|cheerwhal|corgo|uni|showlove|party|seemsgood|pride|kappa|frankerz|heyguys|dansgame|elegiggle|trihard|kreygasm|4head|swiftrage|notlikethis|failfish|vohiyo|pjsalt|mrdestructoid|bday|ripcheer|shamrock|streamlabs|doodlecheer|anon)\d+$/i.test(w) ? '' : w));
  for (const word of bannedWords) {
    const w = String(word).trim();
    if (!w) continue;
    t = t.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'bip');
  }
  t = t.replace(/(.)\1{3,}/gu, '$1$1$1').replace(/\s+/g, ' ').trim();
  t = t.replace(/[\s:,;-]+$/u, '').trim();
  if (t.length > maxLength) t = `${t.slice(0, maxLength).replace(/\s+\S*$/, '')}…`;
  return t;
}
