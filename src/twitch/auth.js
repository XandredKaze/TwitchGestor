import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createLogger } from '../logger.js';

const log = createLogger('twitch-auth');
const OAUTH = 'https://id.twitch.tv/oauth2';

export const SCOPES = [
  'moderator:read:followers', // follow
  'channel:read:subscriptions', // abbonamenti, rinnovi, regali
  'bits:read', // bits
  'channel:read:redemptions', // punti canale
  'channel:read:charity', // donazioni benefiche Twitch
  'user:write:chat', // ringraziamenti in chat (se non c'è un account bot)
  'moderation:read', // titoli di coda: moderatori
  'channel:read:vips', // titoli di coda: VIP
  'moderator:read:chatters', // titoli di coda: chi era in chat
  'user:read:chat', // comandi della chat (!discord, !uptime...)
];

/** Permessi dell'account bot: gli serve solo scrivere in chat. */
export const BOT_SCOPES = ['user:write:chat'];

/**
 * Accesso con il tuo account Twitch (Authorization Code Flow).
 * I token vengono salvati in data/tokens.json e rinnovati automaticamente.
 */
export class TwitchAuth extends EventEmitter {
  #file;
  #tokens = null;
  #pendingStates = new Set();
  #validateTimer = null;

  constructor({ clientId, clientSecret, redirectUri, tokenFile, scopes = SCOPES }) {
    super();
    this.scopes = scopes;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.#file = tokenFile;
    if (fs.existsSync(tokenFile)) {
      try {
        this.#tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      } catch {
        log.warn('tokens.json non valido, serve un nuovo accesso');
      }
    }
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  get user() {
    return this.#tokens ? { id: this.#tokens.user_id, login: this.#tokens.login } : null;
  }

  get accessToken() {
    return this.#tokens?.access_token ?? null;
  }

  get missingScopes() {
    const granted = this.#tokens?.scopes ?? [];
    return this.scopes.filter((s) => !granted.includes(s));
  }

  authorizeUrl() {
    const state = randomBytes(16).toString('hex');
    this.#pendingStates.add(state);
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      state,
      force_verify: 'true',
    });
    return `${OAUTH}/authorize?${params}`;
  }

  /** Vero se questo accesso è stato avviato da qui (serve a distinguere account principale e bot). */
  ownsState(state) {
    return Boolean(state) && this.#pendingStates.has(state);
  }

  async handleCallback({ code, state, error, error_description: description }) {
    if (error) throw new Error(`Twitch ha rifiutato l'accesso: ${description ?? error}`);
    if (!state || !this.#pendingStates.delete(state)) throw new Error('Parametro state non valido, riprova ad accedere');
    const data = await this.#tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri });
    await this.#store(data);
    this.emit('authorized', this.user);
  }

  /** Controlla il token (Twitch richiede una verifica almeno ogni ora). */
  async validate() {
    if (!this.#tokens) return false;
    const res = await fetch(`${OAUTH}/validate`, { headers: { Authorization: `OAuth ${this.#tokens.access_token}` } });
    if (res.ok) {
      const info = await res.json();
      this.#tokens.scopes = info.scopes;
      return true;
    }
    if (res.status === 401) return this.refresh();
    throw new Error(`Verifica token fallita (${res.status})`);
  }

  async refresh() {
    if (!this.#tokens?.refresh_token) return false;
    try {
      const data = await this.#tokenRequest({ grant_type: 'refresh_token', refresh_token: this.#tokens.refresh_token });
      await this.#store(data);
      log.info('Token Twitch rinnovato');
      return true;
    } catch (err) {
      log.error(`Rinnovo token fallito, serve un nuovo accesso: ${err.message}`);
      this.#tokens = null;
      fs.rmSync(this.#file, { force: true });
      this.emit('unauthorized');
      return false;
    }
  }

  startPeriodicValidation() {
    clearInterval(this.#validateTimer);
    this.#validateTimer = setInterval(() => {
      this.validate().catch((err) => log.warn(err.message));
    }, 55 * 60 * 1000);
    this.#validateTimer.unref();
  }

  logout() {
    this.#tokens = null;
    fs.rmSync(this.#file, { force: true });
    this.emit('unauthorized');
  }

  async #tokenRequest(params) {
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...params });
    const res = await fetch(`${OAUTH}/token`, { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
    return data;
  }

  async #store(data) {
    const res = await fetch(`${OAUTH}/validate`, { headers: { Authorization: `OAuth ${data.access_token}` } });
    if (!res.ok) throw new Error('Token appena ottenuto non valido');
    const info = await res.json();
    this.#tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      scopes: info.scopes,
      user_id: info.user_id,
      login: info.login,
    };
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    fs.writeFileSync(this.#file, JSON.stringify(this.#tokens, null, 2), { mode: 0o600 });
  }
}
