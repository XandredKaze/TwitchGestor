/**
 * Comandi della chat ("!discord", "!uptime", ...) e messaggi a tempo.
 * Non dipende da Node: lo usa anche la versione demo nel browser.
 *
 * Chi usa questo modulo fornisce:
 *   getConfig()           impostazioni correnti (config.commands)
 *   send(text)            scrive in chat (con il bot, se collegato)
 *   vars                  funzioni (anche async) per le variabili che richiedono dati esterni:
 *                         uptime(), followage(userId), game(), title(), lastfollow(), scene()
 *   actions               azioni speciali: scene(name) → nome della scena attivata, credits()
 *   counts                { get(id), set(id, n) } per i contatori {count}
 */

export const PERMISSIONS = ['everyone', 'subscriber', 'vip', 'moderator', 'broadcaster'];
export const ACTIONS = ['reply', 'list', 'scene', 'credits'];
const RANK = { everyone: 0, subscriber: 1, vip: 2, moderator: 3, broadcaster: 4 };

/** Livello di chi scrive, dai badge della chat di Twitch. */
export function userRank(badges = []) {
  const ids = new Set(badges.map((b) => b.set_id ?? b));
  if (ids.has('broadcaster')) return RANK.broadcaster;
  if (ids.has('moderator')) return RANK.moderator;
  if (ids.has('vip')) return RANK.vip;
  if (ids.has('subscriber') || ids.has('founder')) return RANK.subscriber;
  return RANK.everyone;
}

/** "3 ore e 12 minuti", "2 anni, 3 mesi" ... */
export function humanDuration(ms, { precise = false } = {}) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const units = [
    [365 * 86400, 'anno', 'anni'], [30 * 86400, 'mese', 'mesi'], [86400, 'giorno', 'giorni'],
    [3600, 'ora', 'ore'], [60, 'minuto', 'minuti'], [1, 'secondo', 'secondi'],
  ];
  const parts = [];
  let rest = s;
  for (const [size, one, many] of units) {
    const n = Math.floor(rest / size);
    if (!n) continue;
    rest -= n * size;
    parts.push(`${n} ${n === 1 ? one : many}`);
    if (parts.length === (precise ? 3 : 2)) break;
  }
  if (!parts.length) return 'pochi secondi';
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} e ${parts.at(-1)}`;
}

const VAR = /\{([a-z0-9]+)(?::([^}]*))?\}/gi;

export class ChatCommands {
  #lastUse = new Map(); // "id" e "id:utente" → ultimo uso (ms)
  #linesSinceTimer = new Map(); // timer → righe di chat dall'ultimo invio
  #lastTimer = new Map(); // timer → ultimo invio (ms)
  #recent = []; // ultimi messaggi inviati, per non rispondere a sé stessi

  constructor({ getConfig, send, vars = {}, actions = {}, counts, now = () => Date.now(), log = console }) {
    this.getConfig = getConfig;
    this.send = send;
    this.vars = vars;
    this.actions = actions;
    this.counts = counts ?? (() => { const m = new Map(); return { get: (k) => m.get(k) ?? 0, set: (k, v) => m.set(k, v) }; })();
    this.now = now;
    this.log = log;
  }

  get settings() {
    return this.getConfig() ?? {};
  }

  /** Trova il comando scritto (nome o nome alternativo), anche se disattivato. */
  find(word) {
    const w = word.toLowerCase();
    return (this.settings.list ?? []).find((c) => c.name === w || (c.aliases ?? []).includes(w)) ?? null;
  }

  /**
   * Gestisce un messaggio della chat. Ritorna la risposta (già inviata, se send è attivo) oppure null.
   * msg = { text, user: { id, login, name }, badges, self }
   * dryRun: prova dalla dashboard, senza cooldown né invio
   */
  async handle(msg, { dryRun = false } = {}) {
    const cfg = this.settings;
    const text = String(msg.text ?? '').trim();
    if (!dryRun) {
      if (!cfg.enabled) return null;
      if (this.#isOwnMessage(text)) return null;
      this.#countLine();
    }
    const prefix = cfg.prefix || '!';
    if (!text.startsWith(prefix)) return null;
    const [word, ...args] = text.slice(prefix.length).trim().split(/\s+/);
    if (!word) return null;
    const cmd = this.find(word);
    if (!cmd || cmd.enabled === false) return null;
    if (userRank(msg.badges) < (RANK[cmd.permission] ?? 0)) return dryRun ? '(non hai il permesso per questo comando)' : null;

    if (!dryRun) {
      const now = this.now();
      const userKey = `${cmd.id}:${msg.user?.id ?? msg.user?.login}`;
      // il canale e i moderatori non hanno attese
      if (userRank(msg.badges) < RANK.moderator) {
        if (now - (this.#lastUse.get(cmd.id) ?? -Infinity) < (cmd.cooldown ?? 0) * 1000) return null;
        if (now - (this.#lastUse.get(userKey) ?? -Infinity) < (cmd.userCooldown ?? 0) * 1000) return null;
      }
      this.#lastUse.set(cmd.id, now);
      this.#lastUse.set(userKey, now);
    }

    const ctx = { cmd, args, user: msg.user ?? {}, dryRun };
    let actionResult = '';
    try {
      if (cmd.action === 'scene') {
        const wanted = args.join(' ');
        if (!wanted) return this.#reply(`Scrivi ${prefix}${cmd.name} seguito dal nome della scena`, dryRun);
        actionResult = dryRun ? `${wanted} (prova: la scena non cambia)` : await this.actions.scene?.(wanted);
      } else if (cmd.action === 'credits') {
        if (!dryRun) await this.actions.credits?.();
      } else if (cmd.action === 'list') {
        actionResult = (cfg.list ?? []).filter((c) => c.enabled !== false && (c.permission ?? 'everyone') === 'everyone')
          .map((c) => prefix + c.name).join(' ');
      }
    } catch (err) {
      this.log.warn?.(`Comando ${prefix}${cmd.name}: ${err.message}`);
      return this.#reply(`⚠️ ${err.message}`, dryRun);
    }
    if (!cmd.response) return null;
    if (/\{count\}/i.test(cmd.response) && !dryRun) this.counts.set(cmd.id, this.counts.get(cmd.id) + 1);
    const reply = await this.render(cmd.response, { ...ctx, result: actionResult });
    return this.#reply(reply, dryRun);
  }

  /** Compila le variabili del testo. Quelle che chiedono dati a Twitch si calcolano solo se servono. */
  async render(template, { cmd, args = [], user = {}, result = '', dryRun = false } = {}) {
    const target = (args[0] ?? '').replace(/^@/, '') || user.name || user.login || '';
    const values = {
      user: () => user.name || user.login || '',
      target: () => target,
      args: () => args.join(' '),
      channel: () => this.vars.channel?.() ?? '',
      count: () => this.counts.get(cmd?.id) + (dryRun && cmd ? 1 : 0),
      result: () => result ?? '',
      scene: () => result || this.vars.scene?.() || '',
      uptime: () => this.vars.uptime?.(),
      followage: () => this.vars.followage?.(user),
      game: () => this.vars.game?.(),
      title: () => this.vars.title?.(),
      lastfollow: () => this.vars.lastfollow?.(),
      random: (range) => {
        const [a, b] = String(range || '1-100').split('-').map(Number);
        const lo = Number.isFinite(a) ? a : 1;
        const hi = Number.isFinite(b) ? b : 100;
        return lo + Math.floor(Math.random() * (Math.max(lo, hi) - lo + 1));
      },
    };
    for (let i = 1; i <= 9; i++) values[String(i)] = () => args[i - 1] ?? '';
    const found = [...String(template).matchAll(VAR)];
    const resolved = await Promise.all(found.map(async ([, name, param]) => {
      const fn = values[name.toLowerCase()];
      if (!fn) return null;
      try {
        const v = await fn(param);
        return v === undefined || v === null ? '' : String(v);
      } catch (err) {
        this.log.warn?.(`Variabile {${name}}: ${err.message}`);
        return '?';
      }
    }));
    let i = 0;
    return String(template).replace(VAR, (whole) => {
      const v = resolved[i++];
      return v === null ? whole : v;
    }).replace(/\s{2,}/g, ' ').trim().slice(0, 500);
  }

  // --- messaggi a tempo: ogni N minuti, ma solo se in chat si è scritto abbastanza dall'ultimo invio
  tick() {
    const cfg = this.settings;
    if (!cfg.enabled) return;
    const now = this.now();
    for (const t of cfg.timers ?? []) {
      if (t.enabled === false || !t.message) continue;
      if (!this.#lastTimer.has(t.id)) { this.#lastTimer.set(t.id, now); continue; } // non appena acceso
      if (now - this.#lastTimer.get(t.id) < (t.interval ?? 15) * 60000) continue;
      if ((this.#linesSinceTimer.get(t.id) ?? 0) < (t.minLines ?? 0)) continue;
      this.#lastTimer.set(t.id, now);
      this.#linesSinceTimer.set(t.id, 0);
      this.render(t.message, {}).then((text) => this.#reply(text, false)).catch(() => {});
    }
  }

  #countLine() {
    for (const t of this.settings.timers ?? []) this.#linesSinceTimer.set(t.id, (this.#linesSinceTimer.get(t.id) ?? 0) + 1);
  }

  #isOwnMessage(text) {
    const i = this.#recent.indexOf(text);
    if (i === -1) return false;
    this.#recent.splice(i, 1);
    return true;
  }

  #reply(text, dryRun) {
    if (!text) return null;
    if (!dryRun) {
      this.#recent.push(text);
      if (this.#recent.length > 20) this.#recent.shift();
      Promise.resolve(this.send(text)).catch((err) => this.log.warn?.(`Risposta in chat non inviata: ${err.message}`));
    }
    return text;
  }
}
