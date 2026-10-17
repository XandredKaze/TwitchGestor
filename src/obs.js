import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { createLogger } from './logger.js';
import { summarizeStream } from './core/streamHealth.js';

export { summarizeStream, connectionQuality } from './core/streamHealth.js';

const log = createLogger('obs');

/**
 * Collegamento a OBS tramite "OBS WebSocket" (già incluso in OBS 28 e successivi:
 * Strumenti → Impostazioni server WebSocket). Serve per vedere e cambiare le scene dalla dashboard.
 * Protocollo v5: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 * Eventi: 'status' (stato), 'scenes' (stato)
 */
const OP = { Hello: 0, Identify: 1, Identified: 2, Event: 5, Request: 6, RequestResponse: 7 };
const EVENTS_SCENES = 1 << 2;
const STATS_EVERY = 2000; // ms tra una lettura e l'altra di bitrate e statistiche
const HISTORY = 90; // punti del grafico del bitrate (3 minuti)
const HOST = /^[a-z0-9.\-]{1,100}$|^\[?[0-9a-f:]{2,45}\]?$/i;

export const OBS_DEFAULTS = { enabled: false, host: '127.0.0.1', port: 4455, password: '' };

/** Risposta alla "sfida" di OBS: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export function obsAuth(password, { salt, challenge }) {
  const secret = createHash('sha256').update(password + salt).digest('base64');
  return createHash('sha256').update(secret + challenge).digest('base64');
}

/** Valida le impostazioni arrivate dalla dashboard (la password vuota o assente non cambia quella salvata). */
export function sanitizeObsSettings(input, current = OBS_DEFAULTS) {
  const out = { ...OBS_DEFAULTS, ...current };
  if (!input || typeof input !== 'object') return out;
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (typeof input.host === 'string' && HOST.test(input.host.trim())) out.host = input.host.trim();
  const port = Number(input.port);
  if (Number.isInteger(port) && port > 0 && port < 65536) out.port = port;
  if (typeof input.password === 'string' && input.password) out.password = input.password.slice(0, 200);
  if (input.clearPassword === true) out.password = '';
  return out;
}

export class ObsClient extends EventEmitter {
  #ws = null;
  #timer = null;
  #pending = new Map();
  #retry = 0;

  /** @param file dove salvare host, porta e password (data/obs.json) */
  constructor({ file, WebSocketImpl = WebSocket } = {}) {
    super();
    this.file = file;
    this.WebSocket = WebSocketImpl;
    this.settings = { ...OBS_DEFAULTS };
    try {
      if (file && fs.existsSync(file)) this.settings = sanitizeObsSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      log.warn(`Impostazioni OBS non leggibili (${err.message}): uso quelle predefinite`);
    }
    this.status = 'disattivato';
    this.error = '';
    this.scenes = [];
    this.current = '';
    this.stream = null; // stato della diretta (bitrate, connessione...), aggiornato ogni 2 secondi
    this.samples = [];
    this.history = [];
  }

  /** Stato per la dashboard (la password non esce mai dal programma). */
  state() {
    const { enabled, host, port, password } = this.settings;
    return { enabled, host, port, hasPassword: Boolean(password), status: this.status, error: this.error, scenes: this.scenes, current: this.current, stream: this.stream };
  }

  start() {
    if (this.settings.enabled) this.#connect();
  }

  stop() {
    this.#stopStats();
    clearTimeout(this.#timer);
    this.#timer = null;
    const ws = this.#ws;
    this.#ws = null;
    ws?.removeAllListeners();
    ws?.on('error', () => {});
    ws?.terminate();
    this.#rejectPending(new Error('Collegamento a OBS chiuso'));
    this.scenes = [];
    this.current = '';
  }

  /** Salva le nuove impostazioni e si ricollega. */
  configure(input) {
    this.settings = sanitizeObsSettings(input, this.settings);
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.settings, null, 2));
    }
    this.stop();
    this.#retry = 0;
    if (this.settings.enabled) this.#connect();
    else this.#setStatus('disattivato');
    return this.state();
  }

  async setScene(name) {
    if (this.status !== 'connesso') throw Object.assign(new Error('OBS non è collegato'), { status: 409 });
    if (!this.scenes.includes(name)) throw Object.assign(new Error(`Scena sconosciuta: ${name}`), { status: 400 });
    await this.request('SetCurrentProgramScene', { sceneName: name });
    // OBS manda anche l'evento, ma aggiornare subito rende il pulsante più reattivo.
    this.#setCurrent(name);
    return this.state();
  }

  request(requestType, requestData) {
    const ws = this.#ws;
    if (!ws || ws.readyState !== ws.OPEN) return Promise.reject(new Error('OBS non è collegato'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error('OBS non ha risposto'));
      }, 5000);
      this.#pending.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({ op: OP.Request, d: { requestType, requestId, requestData } }));
    });
  }

  #connect() {
    const { host, port } = this.settings;
    const url = `ws://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
    this.#setStatus('connessione…');
    const ws = new this.WebSocket(url);
    this.#ws = ws;
    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      this.#handle(ws, msg);
    });
    ws.on('error', (err) => {
      this.error = /ECONNREFUSED/.test(err.message)
        ? 'OBS è chiuso oppure il server WebSocket non è attivo'
        : err.message;
    });
    ws.on('close', (code, reason) => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#stopStats();
      this.#rejectPending(new Error('Collegamento a OBS chiuso'));
      this.scenes = [];
      this.current = '';
      if (code === 4009) {
        // Password sbagliata: inutile riprovare finché non la cambi.
        this.error = 'Password errata: copiala da OBS (Strumenti → Impostazioni server WebSocket → Mostra informazioni di connessione)';
        log.warn(`OBS: ${this.error}`);
        this.#setStatus('password errata');
        return;
      }
      if (code === 4010) this.error = 'Versione di OBS WebSocket non compatibile: aggiorna OBS';
      else if (reason?.length) this.error = String(reason);
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect() {
    if (!this.settings.enabled) return;
    if (this.status !== 'non raggiungibile') log.info(`OBS non raggiungibile (${this.error || 'collegamento chiuso'}): riprovo automaticamente`);
    this.#setStatus('non raggiungibile');
    const delay = Math.min(30000, 3000 * 2 ** Math.min(this.#retry++, 4));
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#connect(), delay);
  }

  #handle(ws, { op, d }) {
    if (op === OP.Hello) {
      const identify = { rpcVersion: 1, eventSubscriptions: EVENTS_SCENES };
      if (d?.authentication) {
        if (!this.settings.password) {
          this.error = 'OBS chiede una password: scrivila nelle impostazioni del collegamento';
          this.#setStatus('password errata');
          this.#ws = null;
          ws.removeAllListeners();
          ws.on('error', () => {});
          ws.close();
          return;
        }
        identify.authentication = obsAuth(this.settings.password, d.authentication);
      }
      ws.send(JSON.stringify({ op: OP.Identify, d: identify }));
    } else if (op === OP.Identified) {
      this.#retry = 0;
      this.error = '';
      log.info(`Collegato a OBS (${this.settings.host}:${this.settings.port})`);
      this.#setStatus('connesso');
      this.#loadScenes();
      this.#startStats();
    } else if (op === OP.RequestResponse) {
      const p = this.#pending.get(d?.requestId);
      if (!p) return;
      this.#pending.delete(d.requestId);
      clearTimeout(p.timer);
      if (d.requestStatus?.result) p.resolve(d.responseData ?? {});
      else p.reject(Object.assign(new Error(d.requestStatus?.comment || `OBS ha rifiutato la richiesta (${d.requestStatus?.code})`), { status: 400 }));
    } else if (op === OP.Event) {
      const type = d?.eventType;
      if (type === 'CurrentProgramSceneChanged') this.#setCurrent(d.eventData?.sceneName ?? '');
      else if (['SceneListChanged', 'SceneCreated', 'SceneRemoved', 'SceneNameChanged'].includes(type)) this.#loadScenes();
    }
  }

  // --- bitrate e salute della diretta: GetStreamStatus + GetStats ogni 2 secondi
  #statsTimer = null;
  #startStats() {
    this.#stopStats();
    this.samples = [];
    this.history = [];
    const read = async () => {
      if (this.status !== 'connesso') return;
      try {
        const [st, stats] = await Promise.all([this.request('GetStreamStatus'), this.request('GetStats')]);
        this.samples.push({
          t: Date.now(),
          active: st.outputActive, reconnecting: st.outputReconnecting,
          bytes: st.outputBytes ?? 0, skipped: st.outputSkippedFrames ?? 0, total: st.outputTotalFrames ?? 0,
          congestion: st.outputCongestion ?? 0, durationMs: st.outputDuration ?? 0,
          fps: stats.activeFps ?? 0, cpu: stats.cpuUsage ?? 0,
          renderSkipped: stats.renderSkippedFrames ?? 0, renderTotal: stats.renderTotalFrames ?? 0,
        });
        if (this.samples.length > 10) this.samples.shift();
        const last = this.samples.at(-1);
        // una diretta nuova riparte da zero: i dati della precedente non contano
        if (!last.active) this.history = [];
        const s = summarizeStream(this.samples, this.history);
        if (last.active && this.samples.at(-2)?.active) {
          this.history.push(s.bitrateKbps);
          if (this.history.length > HISTORY) this.history.shift();
        }
        this.stream = { ...s, history: [...this.history] };
        this.emit('stream', this.stream);
      } catch (err) {
        if (this.status === 'connesso') this.error = `Statistiche di OBS non disponibili: ${err.message}`;
      }
    };
    read();
    this.#statsTimer = setInterval(read, STATS_EVERY);
    this.#statsTimer.unref?.();
  }

  #stopStats() {
    clearInterval(this.#statsTimer);
    this.#statsTimer = null;
    this.stream = null;
  }

  async #loadScenes() {
    try {
      const data = await this.request('GetSceneList');
      // OBS restituisce le scene dal basso verso l'alto: le mettiamo nell'ordine della sua lista.
      this.scenes = [...(data.scenes ?? [])].sort((a, b) => b.sceneIndex - a.sceneIndex).map((s) => s.sceneName);
      this.current = data.currentProgramSceneName ?? '';
      this.emit('scenes', this.state());
    } catch (err) {
      log.warn(`Impossibile leggere le scene di OBS: ${err.message}`);
    }
  }

  #setCurrent(name) {
    if (this.current === name) return;
    this.current = name;
    this.emit('scenes', this.state());
  }

  #setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', this.state());
  }

  #rejectPending(err) {
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.#pending.clear();
  }
}
