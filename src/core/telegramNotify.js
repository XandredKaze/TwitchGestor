/**
 * Cosa manda TwitchGestor su Telegram, e dove:
 *   - chat privata (solo per te): riepilogo di fine live, avviso di inizio live, raid, donazioni e bits
 *     importanti, problemi della connessione durante la live;
 *   - canale pubblico (per la community): "in live!", promemoria prima di una live in programma,
 *     programmazione della settimana, saluto di fine live con la prossima live.
 * Non dipende da Node: lo usa anche la versione demo nel browser.
 *
 * Chi usa questo modulo fornisce:
 *   getConfig()           sezione "telegram" delle impostazioni
 *   send(where, text)     where = 'private' | 'channel' (il testo è già in HTML sicuro)
 *   store                 { load(), save(data) } per non mandare due volte la stessa cosa
 */

export const DEFAULT_TEXTS = {
  liveStart: '🔴 {channel} è in live!\n{title}\n🎮 {game}\n👉 {link}',
  reminder: '⏰ Tra {minutes} minuti si va in live!\n{title}\n🎮 {game}\n👉 {link}',
  liveEnd: '💜 Live finita, grazie a tutti!\n📅 Prossima live: {next}',
  weekly: '📅 Le live di questa settimana\n\n{list}\n\n👉 {link}',
};

export const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Riempie un testo con le variabili ({title}, {game}…). Tutto viene reso sicuro per Telegram. */
export function fillText(template, vars) {
  return esc(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? esc(vars[k]) : m));
}

const pad = (n) => String(n).padStart(2, '0');
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY = 86400000;

/** "martedì 21 ottobre alle 21:00" */
export function whenText(start) {
  const d = new Date(start);
  return `${d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} alle ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export class TelegramNotifier {
  constructor({ getConfig, send, store, now = () => Date.now(), log } = {}) {
    Object.assign(this, { getConfig, send, store, now, log });
    this.state = { weeklySent: '', reminded: [] };
    try { Object.assign(this.state, store?.load?.() ?? {}); } catch { /* prima volta */ }
    this.lastStreamAlert = 0;
    this.badSince = 0;
  }

  get cfg() {
    const t = this.getConfig?.() ?? {};
    return t.enabled && t.token ? t : null;
  }

  text(key) {
    const t = this.cfg?.texts?.[key];
    return typeof t === 'string' && t.trim() ? t : DEFAULT_TEXTS[key];
  }

  #to(where, text) {
    const c = this.cfg;
    if (!c || !(where === 'channel' ? c.channelId : c.chatId)) return null;
    return Promise.resolve(this.send(where, text)).catch((err) => this.log?.warn?.(`Telegram (${where === 'channel' ? 'canale' : 'chat privata'}): ${err.message}`));
  }

  #save() {
    try { this.store?.save?.(this.state); } catch { /* non importante */ }
  }

  /** Live iniziata. vars: { channel, title, game, link } */
  liveStart(vars) {
    const c = this.cfg;
    if (!c) return;
    if (c.sendLiveStart) this.#to('private', fillText(DEFAULT_TEXTS.liveStart, vars));
    if (c.channelLiveStart) this.#to('channel', fillText(this.text('liveStart'), vars));
  }

  /** Live finita. recapHtml: il riepilogo già pronto; vars: { channel, link, next } */
  liveEnd(recapHtml, vars) {
    const c = this.cfg;
    if (!c) return;
    if (c.sendRecap !== false && recapHtml) this.#to('private', recapHtml);
    if (c.channelLiveEnd) this.#to('channel', fillText(this.text('liveEnd'), vars));
  }

  /** Notifica arrivata (raid, donazione, bits…): avviso in privato se è importante. */
  notification(n) {
    const c = this.cfg;
    if (!c || !n || n.test) return;
    const who = n.user?.name ?? 'qualcuno';
    if (n.type === 'raid' && c.alertRaid !== false) {
      this.#to('private', `🚀 <b>Raid!</b> ${esc(who)} è arrivato con ${esc(n.amount ?? 0)} spettatori.`);
    } else if (n.type === 'donation' && c.alertDonation !== false && Number(n.amount) >= (Number(c.donationMin) || 0)) {
      this.#to('private', `💶 <b>Donazione</b> da ${esc(who)}: ${esc(n.amount)} ${esc(n.currency ?? '')}${n.message ? `\n«${esc(String(n.message).slice(0, 300))}»` : ''}`);
    } else if (n.type === 'cheer' && c.alertBits !== false && Number(n.amount) >= (Number(c.bitsMin) || 0)) {
      this.#to('private', `💎 <b>${esc(n.amount)} bits</b> da ${esc(who)}${n.message ? `\n«${esc(String(n.message).slice(0, 300))}»` : ''}`);
    }
  }

  /**
   * Stato della diretta da OBS (ogni 2 secondi): se la connessione resta pessima o in riconnessione
   * per 20 secondi, avviso in privato (al massimo uno ogni 10 minuti).
   */
  streamHealth(stream) {
    const c = this.cfg;
    const bad = Boolean(stream?.active && (stream.reconnecting || (stream.quality && stream.quality.level <= 1)));
    const now = this.now();
    if (!bad) { this.badSince = 0; return; }
    if (!this.badSince) this.badSince = now;
    if (!c || c.alertStream === false || now - this.badSince < 20000 || now - this.lastStreamAlert < 10 * 60000) return;
    this.lastStreamAlert = now;
    this.#to('private', stream.reconnecting
      ? '⚠️ <b>La live si è disconnessa</b>: OBS sta provando a ricollegarsi. Controlla la connessione.'
      : `⚠️ <b>Connessione della live pessima</b>: ${Math.round(stream.droppedPct ?? 0)}% di fotogrammi persi. Prova ad abbassare il bitrate o controlla la rete.`);
  }

  /**
   * Ogni minuto: promemoria prima delle live in programma e programmazione della settimana sul canale.
   * entries: live in programma [{ id, start (ms), title, game }] (dalla prima alla più lontana)
   */
  tick(entries, vars) {
    const c = this.cfg;
    if (!c?.channelId) return;
    const now = this.now();
    if (c.channelReminder) {
      const min = Math.min(Math.max(Number(c.reminderMin) || 30, 5), 240);
      for (const e of entries) {
        const left = e.start - now;
        if (left <= 0 || left > min * 60000 || this.state.reminded.includes(e.id)) continue;
        if (left < (min - 15) * 60000) { this.state.reminded.push(e.id); continue; } // TwitchGestor era spento: troppo tardi
        this.state.reminded = [...this.state.reminded, e.id].slice(-50);
        this.#save();
        this.#to('channel', fillText(this.text('reminder'), { ...vars, title: e.title || vars.title || '', game: e.game || '', minutes: Math.max(1, Math.round(left / 60000)), when: whenText(e.start) }));
      }
    }
    if (c.channelWeekly) {
      const d = new Date(now);
      const weekday = ((d.getDay() + 6) % 7) + 1;
      const key = localKey(d);
      if (weekday === Number(c.weeklyDay ?? 1) && d.getHours() >= Number(c.weeklyHour ?? 10) && this.state.weeklySent !== key) {
        this.state.weeklySent = key;
        this.#save();
        const week = entries.filter((e) => e.start > now && e.start < now + 7 * DAY);
        if (week.length) this.#to('channel', this.weeklyText(week, vars));
      }
    }
  }

  weeklyText(week, vars) {
    const list = week.map((e) => {
      const d = new Date(e.start);
      const day = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' }).replace(/^./, (x) => x.toUpperCase());
      return `• ${day}, ${pad(d.getHours())}:${pad(d.getMinutes())}${e.title ? ` — ${e.title}` : ''}${e.game ? ` (${e.game})` : ''}`;
    }).join('\n');
    return fillText(this.text('weekly'), { ...vars, list });
  }
}
