import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { render, templateVars } from './templates.js';
import { cleanText } from './ttsText.js';
import { createLogger } from '../logger.js';

const log = createLogger('notifiche');

/**
 * Cuore del gestore: riceve le notifiche normalizzate, le filtra secondo la configurazione,
 * le salva nello storico, aggiorna le statistiche e mette gli alert in coda uno alla volta.
 *
 * Eventi emessi:
 *   'notification' (n)      nuova notifica registrata (per la dashboard)
 *   'alert'        (alert)  alert da mostrare adesso sull'overlay
 *   'queue'        (state)  la coda è cambiata
 *   'chat'         (text,n) messaggio di ringraziamento da scrivere in chat
 */
export class NotificationManager extends EventEmitter {
  #config;
  #historyFile;
  #seen = new Set();
  #queue = [];
  #current = null;
  #timer = null;
  #paused = false;
  #saveTimer = null;

  constructor({ config, historyFile = null }) {
    super();
    this.#config = config;
    this.#historyFile = historyFile;
    this.history = [];
    this.stats = emptyStats();
    this.#loadHistory();
  }

  setConfig(config) {
    this.#config = config;
  }

  typeConfig(type) {
    return this.#config.types?.[type] ?? {};
  }

  /** Punto d'ingresso unico per tutte le sorgenti. Ritorna true se la notifica è stata accettata. */
  ingest(n) {
    if (this.#seen.has(n.id)) {
      log.debug(`Duplicato ignorato: ${n.id}`);
      return false;
    }
    this.#remember(n.id);

    const cfg = this.typeConfig(n.type);
    if (cfg.enabled === false) return false;

    const skip = this.#skipReason(n, cfg);
    const entry = { ...n, alerted: !skip, skipReason: skip ?? undefined };
    delete entry.raw;

    this.history.unshift(entry);
    this.history.length = Math.min(this.history.length, this.#config.history?.maxItems ?? 500);
    if (!n.test) this.#updateStats(n);
    this.#scheduleSave();

    log.info(`${cfg.label ?? n.type}: ${n.user?.name ?? 'Anonimo'}${n.amount ? ` (${n.amount})` : ''}${skip ? ` [${skip}]` : ''}`);
    this.emit('notification', entry);

    if (!skip) {
      this.#enqueue(this.buildAlert(n));
      const reply = this.#chatReply(n, cfg);
      if (reply) this.emit('chat', reply, n);
    }
    return true;
  }

  #skipReason(n, cfg) {
    if (cfg.alert === false) return 'alert disattivato';
    if (n.type === 'sub' && n.isGift && cfg.ignoreGifted !== false) return 'sub regalata (già mostrata come regalo)';
    if (typeof cfg.minAmount === 'number' && (n.amount ?? 0) < cfg.minAmount) return `sotto il minimo (${cfg.minAmount})`;
    if (n.type === 'redemption' && n.reward) {
      const ignored = (cfg.ignoreRewards ?? []).map((r) => r.toLowerCase());
      if (ignored.includes(n.reward.title.toLowerCase())) return 'ricompensa ignorata';
    }
    return null;
  }

  /** Sceglie la variante più specifica: prima quelle legate a una ricompensa, poi la soglia più alta. */
  resolveStyle(n, typeConfig = this.typeConfig(n.type)) {
    const { variants = [], ...cfg } = typeConfig;
    const amount = n.amount ?? 0;
    const rewardTitle = n.reward?.title?.toLowerCase();
    const matching = variants
      .filter((v) => (v.minAmount === undefined || amount >= v.minAmount)
        && (v.maxAmount === undefined || amount <= v.maxAmount)
        && (v.reward === undefined || v.reward.toLowerCase() === rewardTitle))
      .sort((a, b) => (a.reward ? 1 : 0) - (b.reward ? 1 : 0) || (a.minAmount ?? 0) - (b.minAmount ?? 0));
    return { ...cfg, ...(matching.at(-1) ?? {}) };
  }

  /** @param typeConfig facoltativo: impostazioni non ancora salvate (anteprima e prova dalla dashboard). */
  buildAlert(n, typeConfig) {
    const style = this.resolveStyle(n, typeConfig);
    const overlay = this.#config.overlay ?? {};
    const vars = templateVars(n);
    return {
      id: n.id,
      type: n.type,
      title: render(style.title, vars),
      text: render(style.text, vars),
      message: style.showMessage ? n.message ?? '' : '',
      duration: style.duration ?? 5000,
      sound: style.sound ?? '',
      volume: style.volume ?? 0.5,
      image: style.image ?? '',
      color: style.color ?? '#9146ff',
      font: style.font || overlay.font || 'Poppins',
      fontSize: style.fontSize ?? overlay.fontSize ?? 26,
      textColor: style.textColor ?? overlay.textColor ?? '#ffffff',
      background: style.background ?? overlay.background ?? '#121218',
      backgroundOpacity: style.backgroundOpacity ?? overlay.backgroundOpacity ?? 0.88,
      animation: style.animation || overlay.animation || 'pop',
      ...this.#tts(n, style, vars),
    };
  }

  /** Testo da leggere ad alta voce (solo se la voce è attiva in generale e per questo alert). */
  #tts(n, style, vars) {
    const cfg = this.#config.tts;
    if (!cfg?.enabled || !style.tts) return {};
    const text = cleanText(render(style.ttsText ?? '{message}', vars), cfg);
    if (!text) return {};
    return { tts: { text, rate: cfg.rate ?? 0, volume: (cfg.volume ?? 100) / 100 } };
  }

  #chatReply(n, cfg) {
    if (!this.#config.chat?.enabled || n.test) return '';
    const style = this.resolveStyle(n);
    return render(style.chatReply ?? cfg.chatReply, templateVars(n));
  }

  // ---------- Coda ----------

  #enqueue(alert, { front = false } = {}) {
    const max = this.#config.queue?.maxLength ?? 100;
    if (this.#queue.length >= max) {
      log.warn(`Coda piena (${max}), alert scartato: ${alert.title}`);
      return;
    }
    // Preparazione facoltativa (es. creare l'audio della voce) mentre l'alert aspetta in coda.
    if (this.prepareAlert && alert.tts) {
      const ready = Promise.race([
        Promise.resolve().then(() => this.prepareAlert(alert)),
        new Promise((resolve) => { setTimeout(resolve, 10000); }),
      ]).catch((err) => log.warn(`Preparazione dell'alert non riuscita: ${err.message}`));
      Object.defineProperty(alert, 'ready', { value: ready, enumerable: false });
    }
    front ? this.#queue.unshift(alert) : this.#queue.push(alert);
    this.#emitQueue();
    this.#next();
  }

  #next() {
    if (this.#current || this.#paused || this.#queue.length === 0) return;
    const alert = this.#queue.shift();
    this.#current = alert;
    const start = () => {
      if (this.#current !== alert) return; // saltato mentre si preparava
      this.emit('alert', alert);
      this.#emitQueue();
      const gap = this.#config.queue?.gapMs ?? 800;
      this.#timer = setTimeout(() => this.#finish(), alert.duration + gap);
    };
    if (alert.ready) alert.ready.then(start);
    else start();
  }

  #finish() {
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#current = null;
    this.#emitQueue();
    this.#next();
  }

  replay(id) {
    const entry = this.history.find((h) => h.id === id);
    if (!entry) return false;
    this.#enqueue({ ...this.buildAlert(entry), id: `${id}:replay:${Date.now()}` }, { front: true });
    return true;
  }

  /** @param draftConfig facoltativo: impostazioni non ancora salvate, per provare un alert dalla dashboard. */
  test(n, draftConfig) {
    const builder = draftConfig ? new NotificationManager({ config: draftConfig }) : this;
    this.#enqueue(builder.buildAlert(n));
    this.emit('notification', { ...n, alerted: true });
  }

  skip() {
    if (!this.#current) return;
    this.emit('skip', this.#current);
    this.#finish();
  }

  pause() {
    this.#paused = true;
    this.#emitQueue();
  }

  resume() {
    this.#paused = false;
    this.#emitQueue();
    this.#next();
  }

  clearQueue() {
    this.#queue = [];
    this.#emitQueue();
  }

  queueState() {
    return { paused: this.#paused, current: this.#current, pending: this.#queue };
  }

  #emitQueue() {
    this.emit('queue', this.queueState());
  }

  // ---------- Statistiche e storico ----------

  #updateStats(n) {
    const s = this.stats;
    s.counts[n.type] = (s.counts[n.type] ?? 0) + 1;
    if (n.type === 'cheer') s.bits += n.amount ?? 0;
    if (n.type === 'giftsub') s.giftedSubs += n.amount ?? 0;
    if (n.type === 'donation') {
      s.donations[n.currency] = round2((s.donations[n.currency] ?? 0) + (n.amount ?? 0));
      const name = n.user?.name ?? 'Anonimo';
      const key = `${name}|${n.currency}`;
      s.donors[key] = round2((s.donors[key] ?? 0) + (n.amount ?? 0));
    }
  }

  resetStats() {
    this.stats = emptyStats();
  }

  topDonors(limit = 5) {
    return Object.entries(this.stats.donors)
      .map(([key, amount]) => {
        const [name, currency] = key.split('|');
        return { name, currency, amount };
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, limit);
  }

  #remember(id) {
    this.#seen.add(id);
    if (this.#seen.size > 2000) this.#seen.delete(this.#seen.values().next().value);
  }

  #loadHistory() {
    if (!this.#historyFile || !fs.existsSync(this.#historyFile)) return;
    try {
      this.history = JSON.parse(fs.readFileSync(this.#historyFile, 'utf8'));
      for (const h of this.history) this.#seen.add(h.id);
    } catch (err) {
      log.warn(`Storico non leggibile, riparto da zero: ${err.message}`);
    }
  }

  #scheduleSave() {
    if (!this.#historyFile || this.#saveTimer) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.saveNow();
    }, 1000);
  }

  saveNow() {
    if (!this.#historyFile) return;
    fs.mkdirSync(path.dirname(this.#historyFile), { recursive: true });
    fs.writeFileSync(this.#historyFile, JSON.stringify(this.history, null, 2));
  }

  stop() {
    clearTimeout(this.#timer);
    clearTimeout(this.#saveTimer);
    this.saveNow();
  }
}

function emptyStats() {
  return { since: new Date().toISOString(), counts: {}, bits: 0, giftedSubs: 0, donations: {}, donors: {} };
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
