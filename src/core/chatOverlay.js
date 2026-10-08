/**
 * Chat da mettere a schermo in OBS (pagina /chat).
 * Non dipende da Node: lo usa anche la versione demo nel browser.
 */

export const CHAT_STYLES = ['classic', 'boxes', 'brutal'];
export const CHAT_ANIMATIONS = ['slide', 'fade', 'none'];

/** Messaggio della chat di Twitch (EventSub channel.chat.message) nel formato della pagina /chat. */
export function toChatMessage(e, { botId } = {}) {
  const fragments = (e.message?.fragments ?? []).map((f) => (f.type === 'emote' && f.emote?.id
    ? { type: 'emote', text: f.text, id: f.emote.id }
    : { type: 'text', text: f.text ?? '' }));
  return {
    id: e.message_id,
    userId: e.chatter_user_id,
    login: e.chatter_user_login,
    name: e.chatter_user_name || e.chatter_user_login,
    color: /^#[0-9a-f]{6}$/i.test(e.color ?? '') ? e.color : '',
    badges: (e.badges ?? []).map((b) => ({ set: b.set_id, id: b.id })),
    fragments: fragments.length ? fragments : [{ type: 'text', text: e.message?.text ?? '' }],
    text: e.message?.text ?? '',
    highlighted: e.message_type === 'channel_points_highlighted',
    bot: Boolean(botId && e.chatter_user_id === botId),
    at: Date.now(),
  };
}

/** Il messaggio va mostrato? (bot nascosti, comandi, utenti esclusi) */
export function shouldShow(msg, settings = {}, { commandPrefix = '!' } = {}) {
  if (settings.hideBot !== false && msg.bot) return false;
  const login = String(msg.login ?? '').toLowerCase();
  if ((settings.hiddenUsers ?? []).some((u) => u.toLowerCase() === login)) return false;
  if (settings.hideCommands && String(msg.text ?? '').trim().startsWith(commandPrefix || '!')) return false;
  return Boolean(String(msg.text ?? '').trim());
}

/** Ultimi messaggi mostrati (per chi apre la pagina dopo) e notifiche verso le pagine aperte. */
export class ChatFeed {
  constructor({ send, keep = 50 }) {
    this.send = send; // (messaggio per le pagine /chat)
    this.keep = keep;
    this.messages = [];
  }

  push(msg) {
    this.messages.push(msg);
    if (this.messages.length > this.keep) this.messages.shift();
    this.send({ type: 'message', message: msg });
  }

  /** Messaggio cancellato (da un moderatore, dal bot o da Twitch). */
  remove(id) {
    this.messages = this.messages.filter((m) => m.id !== id);
    this.send({ type: 'remove', id });
  }

  /** Timeout o ban: spariscono tutti i messaggi di quella persona. */
  removeUser(userId) {
    this.messages = this.messages.filter((m) => m.userId !== userId);
    this.send({ type: 'remove-user', userId });
  }

  clear() {
    this.messages = [];
    this.send({ type: 'clear' });
  }
}

/** Badge di Twitch (GET /chat/badges/global e /chat/badges) → { "set/versione": url }. */
export function badgeMap(...responses) {
  const map = {};
  for (const r of responses) {
    for (const set of r?.data ?? []) {
      for (const v of set.versions ?? []) map[`${set.set_id}/${v.id}`] = v.image_url_2x || v.image_url_1x;
    }
  }
  return map;
}
