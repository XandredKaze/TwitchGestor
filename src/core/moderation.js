/**
 * Parole bannate: il bot cancella il messaggio, dà un timeout o banna chi le scrive.
 * Non dipende da Node: lo usa anche la versione demo nel browser.
 *
 * Il confronto non si lascia ingannare facilmente: maiuscole, accenti, lettere sostituite da
 * numeri o simboli (5tup1d0, $tupido) e lettere ripetute (stuuupido) contano come la parola.
 */

export const MOD_ACTIONS = ['delete', 'timeout', 'ban'];
const RANK = { everyone: 0, subscriber: 1, vip: 2, moderator: 3, broadcaster: 4 };

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '€': 'e', '!': 'i', '|': 'i', '+': 't' };

/**
 * Testo "pulito" per il confronto: minuscolo, senza accenti e caratteri invisibili, punteggiatura → spazio,
 * lettere ripetute una volta sola. Con leet anche numeri e simboli diventano lettere (5tup1d0 → stupido).
 */
export function normalizeText(text, { leet = false } = {}) {
  let t = String(text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accenti
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, ''); // caratteri invisibili
  if (leet) {
    // i numeri sempre, i simboli solo dentro una parola: "$tupido" sì, il "!" di "stupido!" no
    t = t.replace(/[0134578]/g, (c) => LEET[c] ?? c).replace(/[@$€!|+](?=[\p{L}\p{N}])/gu, (c) => LEET[c]);
  }
  return t
    .replace(/[^\p{L}\p{N}*]+/gu, ' ') // punteggiatura → spazio
    .replace(/(\p{L})\1+/gu, '$1') // stuuupido → stupido
    .trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Espressione per una parola bannata. "parola*" = anche le parole che iniziano così. */
export function termPattern(entry) {
  const t = normalizeText(entry.text);
  if (!t || t === '*') return null;
  const body = t.split('*').map((p) => escapeRe(p).replace(/ /g, ' ?')).join('\\p{L}*');
  return entry.inside
    ? new RegExp(body, 'u')
    : new RegExp(`(?:^| )${body}(?= |$)`, 'u');
}

/** Prima parola bannata trovata nel messaggio (oppure null). */
export function findBanned(text, words = []) {
  // due letture del messaggio: così "stupido!" e "5tup1d0" vengono riconosciuti entrambi
  const variants = [...new Set([normalizeText(text), normalizeText(text, { leet: true })])].filter(Boolean);
  if (!variants.length) return null;
  for (const entry of words) {
    const re = termPattern(entry);
    if (!re) continue;
    for (const v of variants) {
      if (re.test(v) || (entry.inside && re.test(v.replace(/ /g, '').replace(/(\p{L})\1+/gu, '$1')))) return entry; // anche "s t u p i d o"
    }
  }
  return null;
}

export function userRank(badges = []) {
  const ids = new Set(badges.map((b) => b.set_id ?? b));
  if (ids.has('broadcaster')) return RANK.broadcaster;
  if (ids.has('moderator')) return RANK.moderator;
  if (ids.has('vip')) return RANK.vip;
  if (ids.has('subscriber') || ids.has('founder')) return RANK.subscriber;
  return RANK.everyone;
}

export function describeAction(entry) {
  if (entry.action === 'ban') return 'ban';
  if (entry.action === 'timeout') {
    const s = entry.duration ?? 600;
    return `timeout ${s >= 86400 ? `${Math.round(s / 86400)} g` : s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`}`;
  }
  return 'messaggio cancellato';
}

export class ChatModerator {
  #lastWarn = -Infinity; // ultimo avviso scritto in chat

  /**
   * getConfig()  impostazioni (config.moderation)
   * act          { delete(messageId), timeout(userId, seconds, reason), ban(userId, reason), unban(userId) }
   * warn(text)   scrive l'avviso in chat
   */
  constructor({ getConfig, act = {}, warn, now = () => Date.now(), log = console, onAction }) {
    this.getConfig = getConfig;
    this.act = act;
    this.warn = warn;
    this.now = now;
    this.log = log;
    this.onAction = onAction;
    this.history = []; // ultime azioni, per la dashboard
  }

  /** Chi non viene mai moderato: tu e i moderatori sempre, VIP e abbonati se scelto. */
  exempt(badges) {
    const cfg = this.getConfig() ?? {};
    const rank = userRank(badges);
    if (rank >= RANK.moderator) return true;
    if (cfg.exemptVip && rank === RANK.vip) return true;
    if (cfg.exemptSubs && rank === RANK.subscriber) return true;
    return false;
  }

  /** Controlla un messaggio. Ritorna l'azione fatta ({ entry, ... }) oppure null se il messaggio va bene. */
  async handle(msg, { dryRun = false } = {}) {
    const cfg = this.getConfig() ?? {};
    if (!dryRun && !cfg.enabled) return null;
    if (this.exempt(msg.badges)) return dryRun ? { exempt: true } : null;
    const entry = findBanned(msg.text, cfg.words);
    if (!entry) return null;
    const result = { entry, word: entry.text, action: entry.action ?? 'delete', label: describeAction(entry) };
    if (dryRun) return result;

    const reason = `Parola non permessa (${entry.text})`;
    const record = {
      at: this.now(), userId: msg.user?.id, user: msg.user?.name || msg.user?.login, word: entry.text,
      action: result.action, label: result.label, text: String(msg.text ?? '').slice(0, 200), error: null, undone: false,
    };
    try {
      if (result.action === 'ban') await this.act.ban?.(msg.user.id, reason);
      else if (result.action === 'timeout') await this.act.timeout?.(msg.user.id, entry.duration ?? 600, reason);
      else await this.act.delete?.(msg.id);
    } catch (err) {
      record.error = err.message;
      this.log.warn?.(`Moderazione non riuscita (${record.user}): ${err.message}`);
    }
    this.history.unshift(record);
    if (this.history.length > 50) this.history.pop();
    this.onAction?.(record);

    // avviso in chat, al massimo uno ogni 10 secondi per non riempire la chat
    if (!record.error && cfg.warning && this.now() - this.#lastWarn > 10000) {
      this.#lastWarn = this.now();
      const text = cfg.warning.replace(/\{user\}/gi, record.user ?? '').replace(/\{action\}/gi, record.label);
      Promise.resolve(this.warn?.(text)).catch(() => {});
    }
    return { ...result, record };
  }

  /** Toglie timeout o ban dati dal bot (dal registro della dashboard). */
  async undo(index) {
    const r = this.history[index];
    if (!r || r.undone || r.action === 'delete') throw Object.assign(new Error('Niente da annullare'), { status: 400 });
    await this.act.unban?.(r.userId);
    r.undone = true;
    this.onAction?.(r);
    return r;
  }
}
