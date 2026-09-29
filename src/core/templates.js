/**
 * Testi con segnaposto:
 *   {user} {login} {amount} {amountFormatted} {currency} {tier} {months} {streak}
 *   {message} {reward} {cost} {source}
 * Plurale semplice: {amount|o|i} -> "o" se amount = 1, altrimenti "i".
 */
export function formatAmount(amount, currency) {
  if (!currency) return String(amount);
  try {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function templateVars(n) {
  return {
    user: n.user?.name ?? 'Anonimo',
    login: n.user?.login ?? '',
    amount: n.amount ?? '',
    amountFormatted: formatAmount(n.amount ?? 0, n.currency),
    currency: n.currency ?? '',
    tier: n.tier ?? '',
    months: n.months ?? '',
    streak: n.streak ?? '',
    message: n.message ?? '',
    reward: n.reward?.title ?? '',
    cost: n.reward?.cost ?? '',
    source: n.source ?? '',
  };
}

export function render(template, vars) {
  if (!template) return '';
  return String(template).replace(/\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g, (match, key, one, many) => {
    if (!(key in vars)) return match;
    if (one !== undefined) return Number(vars[key]) === 1 ? one : many;
    return String(vars[key]);
  });
}
