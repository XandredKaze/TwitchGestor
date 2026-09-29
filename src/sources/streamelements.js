import { EventEmitter } from 'node:events';
import { io } from 'socket.io-client';
import { donation } from '../core/normalize.js';
import { createLogger } from '../logger.js';

const log = createLogger('streamelements');

/**
 * Donazioni (tips) da StreamElements tramite la loro API realtime.
 * Gli altri eventi (follow, sub, ...) arrivano già da Twitch, quindi qui prendiamo solo i tip.
 * Eventi: 'notification' (n), 'status' (stato)
 */
export class StreamElementsSource extends EventEmitter {
  #socket = null;

  constructor({ jwt, url = 'https://realtime.streamelements.com' }) {
    super();
    this.jwt = jwt;
    this.url = url;
    this.status = 'disattivato';
  }

  start() {
    this.#setStatus('connessione…');
    this.#socket = io(this.url, { transports: ['websocket'] });
    this.#socket.on('connect', () => this.#socket.emit('authenticate', { method: 'jwt', token: this.jwt }));
    this.#socket.on('authenticated', () => {
      log.info('Connesso a StreamElements');
      this.#setStatus('connesso');
    });
    this.#socket.on('unauthorized', (err) => {
      log.error(`JWT StreamElements non valido: ${err?.message ?? err}`);
      this.#setStatus('token non valido');
      this.#socket.disconnect();
    });
    this.#socket.on('disconnect', () => {
      if (this.status === 'connesso') this.#setStatus('disconnesso');
    });
    this.#socket.on('connect_error', (err) => log.warn(`Connessione fallita: ${err.message}`));
    this.#socket.on('event', (event) => this.#handle(event));
  }

  stop() {
    this.#socket?.disconnect();
    this.#setStatus('disattivato');
  }

  #setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  #handle(event) {
    if (event?.type !== 'tip') return;
    const d = event.data ?? {};
    this.emit('notification', donation({
      id: event._id ?? d.tipId,
      source: 'streamelements',
      name: d.displayName || d.username,
      amount: d.amount,
      currency: d.currency,
      message: d.message,
      raw: event,
    }));
  }
}
