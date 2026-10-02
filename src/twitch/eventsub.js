import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createLogger } from '../logger.js';

const log = createLogger('eventsub');

/** Eventi Twitch a cui ci iscriviamo. */
export function subscriptionsFor(userId) {
  const me = { broadcaster_user_id: userId };
  return [
    { type: 'channel.follow', version: '2', condition: { ...me, moderator_user_id: userId } },
    { type: 'channel.subscribe', version: '1', condition: me },
    { type: 'channel.subscription.message', version: '1', condition: me },
    { type: 'channel.subscription.gift', version: '1', condition: me },
    { type: 'channel.cheer', version: '1', condition: me },
    { type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: userId } },
    { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: me },
    { type: 'channel.charity_campaign.donate', version: '1', condition: me },
    // messaggi della chat, letti con il tuo account: servono per i comandi (!discord, !uptime...)
    { type: 'channel.chat.message', version: '1', condition: { ...me, user_id: userId } },
  ];
}

/**
 * Client EventSub via WebSocket: nessun server pubblico necessario.
 * Gestisce keepalive, messaggi di riconnessione di Twitch e riconnessione automatica con backoff.
 *
 * Eventi: 'event' (type, payload, messageId), 'status' (stato)
 */
export class EventSubClient extends EventEmitter {
  #ws = null;
  #keepaliveTimer = null;
  #keepaliveMs = 15000;
  #retry = 0;
  #reconnectTimer = null;
  #stopped = true;
  #seen = new Set();

  constructor({ helix, userId, url = 'wss://eventsub.wss.twitch.tv/ws' }) {
    super();
    this.helix = helix;
    this.userId = userId;
    this.url = url;
    this.status = 'disconnesso';
    this.failedSubscriptions = [];
  }

  start() {
    this.#stopped = false;
    this.#connect(this.url, false);
  }

  stop() {
    this.#stopped = true;
    clearTimeout(this.#keepaliveTimer);
    clearTimeout(this.#reconnectTimer);
    this.#ws?.close();
    this.#ws = null;
    this.#setStatus('disconnesso');
  }

  #setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  #connect(url, isTwitchReconnect) {
    this.#setStatus('connessione…');
    const ws = new WebSocket(url);
    const previous = this.#ws;
    if (!isTwitchReconnect) this.#ws = ws;

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (ws !== this.#ws && !(isTwitchReconnect && msg.metadata?.message_type === 'session_welcome')) return;
      this.#handle(ws, msg, isTwitchReconnect ? previous : null);
    });

    ws.on('close', (code) => {
      if (ws !== this.#ws) return;
      clearTimeout(this.#keepaliveTimer);
      if (this.#stopped) return;
      this.#setStatus('disconnesso');
      if (code === 4003) log.warn('Twitch ha chiuso la connessione: nessuna iscrizione attiva');
      this.#scheduleReconnect();
    });

    ws.on('error', (err) => log.warn(`Errore WebSocket: ${err.message}`));
  }

  #scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.#retry, 60000);
    this.#retry += 1;
    log.info(`Riconnessione tra ${Math.round(delay / 1000)}s`);
    this.#reconnectTimer = setTimeout(() => this.#connect(this.url, false), delay);
  }

  #resetKeepalive() {
    clearTimeout(this.#keepaliveTimer);
    this.#keepaliveTimer = setTimeout(() => {
      log.warn('Nessun keepalive da Twitch, riconnessione');
      this.#ws?.terminate();
    }, this.#keepaliveMs + 5000);
  }

  async #handle(ws, msg, oldSocket) {
    const type = msg.metadata?.message_type;
    switch (type) {
      case 'session_welcome': {
        const session = msg.payload.session;
        this.#keepaliveMs = (session.keepalive_timeout_seconds ?? 10) * 1000;
        this.#retry = 0;
        if (oldSocket) {
          // Riconnessione chiesta da Twitch: le iscrizioni si spostano da sole sulla nuova sessione.
          this.#ws = ws;
          oldSocket.close();
          log.info('Sessione EventSub migrata');
        } else {
          await this.#subscribeAll(session.id);
        }
        this.#resetKeepalive();
        this.#setStatus('connesso');
        break;
      }
      case 'session_keepalive':
        this.#resetKeepalive();
        break;
      case 'session_reconnect':
        log.info('Twitch chiede di riconnettersi');
        this.#connect(msg.payload.session.reconnect_url, true);
        break;
      case 'notification': {
        this.#resetKeepalive();
        const id = msg.metadata.message_id;
        if (this.#seen.has(id)) return;
        this.#seen.add(id);
        if (this.#seen.size > 1000) this.#seen.delete(this.#seen.values().next().value);
        this.emit('event', msg.payload.subscription.type, msg.payload.event, id);
        break;
      }
      case 'revocation':
        log.warn(`Iscrizione revocata da Twitch: ${msg.payload.subscription.type} (${msg.payload.subscription.status})`);
        break;
      default:
        break;
    }
  }

  async #subscribeAll(sessionId) {
    this.failedSubscriptions = [];
    const results = await Promise.allSettled(
      subscriptionsFor(this.userId).map((sub) => this.helix.createEventSubSubscription({ ...sub, sessionId })),
    );
    results.forEach((r, i) => {
      const { type } = subscriptionsFor(this.userId)[i];
      if (r.status === 'rejected') {
        this.failedSubscriptions.push({ type, error: r.reason.message });
        log.warn(`Iscrizione a ${type} fallita: ${r.reason.message}`);
      }
    });
    const ok = results.length - this.failedSubscriptions.length;
    log.info(`Iscritto a ${ok}/${results.length} tipi di evento Twitch`);
  }
}
