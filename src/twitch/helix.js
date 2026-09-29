import { createLogger } from '../logger.js';

const log = createLogger('twitch-api');

export class HelixClient {
  constructor({ auth, baseUrl = 'https://api.twitch.tv/helix', eventSubUrl }) {
    this.auth = auth;
    this.baseUrl = baseUrl;
    this.eventSubUrl = eventSubUrl ?? `${baseUrl}/eventsub/subscriptions`;
  }

  async request(method, url, body, retried = false) {
    const res = await fetch(url.startsWith('http') ? url : `${this.baseUrl}${url}`, {
      method,
      headers: {
        'Client-Id': this.auth.clientId,
        Authorization: `Bearer ${this.auth.accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried && (await this.auth.refresh())) {
      return this.request(method, url, body, true);
    }
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message ?? `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  createEventSubSubscription({ type, version, condition, sessionId }) {
    return this.request('POST', this.eventSubUrl, {
      type,
      version,
      condition,
      transport: { method: 'websocket', session_id: sessionId },
    });
  }

  async sendChatMessage(message) {
    const { id } = this.auth.user;
    const data = await this.request('POST', '/chat/messages', {
      broadcaster_id: id,
      sender_id: id,
      message: message.slice(0, 500),
    });
    const result = data.data?.[0];
    if (result && !result.is_sent) log.warn(`Messaggio in chat non inviato: ${result.drop_reason?.message ?? 'motivo sconosciuto'}`);
  }
}
