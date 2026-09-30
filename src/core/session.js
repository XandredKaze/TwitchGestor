/**
 * Riassunto degli eventi di una live, ricavato dallo storico delle notifiche di TwitchGestor.
 * Serve ai titoli di coda per le sezioni "Nuovi follower della live", "Chi ha donato", ecc.
 * Usato sia dal server sia dalla versione demo.
 */

const nameOf = (h) => h.user?.name ?? 'Anonimo';

/** Nomi senza ripetizioni, nell'ordine in cui sono arrivati. */
function uniqueNames(items) {
  return [...new Set(items.map(nameOf))];
}

/** Somma un valore per persona, dalla più alta alla più bassa. */
function totals(items, valueOf, keyOf = nameOf) {
  const map = new Map();
  for (const h of items) {
    const key = keyOf(h);
    const prev = map.get(key) ?? { name: nameOf(h), value: 0, currency: h.currency };
    prev.value += Number(valueOf(h)) || 0;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

/**
 * @param history notifiche normalizzate (le più recenti per prime, come nello storico)
 * @param since   inizio della live (Date, ISO o millisecondi)
 */
export function liveSession(history, since) {
  const t0 = new Date(since).getTime();
  const items = history
    .filter((h) => h.source !== 'test' && new Date(h.timestamp).getTime() >= t0)
    .reverse(); // dalla più vecchia alla più recente
  const of = (type) => items.filter((h) => h.type === type);

  const resubs = new Map();
  for (const h of of('resub')) resubs.set(nameOf(h), Math.max(resubs.get(nameOf(h)) ?? 0, Number(h.months) || 0));

  return {
    since: new Date(t0).toISOString(),
    follows: uniqueNames(of('follow')),
    subs: uniqueNames(of('sub').filter((h) => !h.isGift)),
    resubs: [...resubs].map(([name, value]) => ({ name, value })),
    gifters: totals(of('giftsub'), (h) => h.amount),
    cheers: totals(of('cheer'), (h) => h.amount),
    donations: totals(of('donation'), (h) => h.amount, (h) => `${nameOf(h)}|${h.currency}`)
      .map((d) => ({ ...d, value: Math.round(d.value * 100) / 100 })),
    raids: of('raid').map((h) => ({ name: nameOf(h), value: Number(h.amount) || 0 })),
    redemptions: of('redemption').map((h) => ({ name: nameOf(h), reward: h.reward?.title ?? '' })),
  };
}
