/**
 * Messaggi su Telegram (gratuito): riepilogo di fine live e, se vuoi, l'avviso di inizio live.
 * Serve un bot creato con @BotFather (token) e la chat dove scrivere (chatId): la dashboard la trova da sola.
 */

const API = process.env.TELEGRAM_API_URL || 'https://api.telegram.org'; // diverso solo per le prove

async function call(token, method, body) {
  if (!/^\d+:[\w-]{20,}$/.test(String(token ?? ''))) throw Object.assign(new Error('Token del bot Telegram non valido'), { status: 400 });
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw Object.assign(new Error(`Telegram: ${data.description ?? `errore ${res.status}`}`), { status: 400 });
  return data.result;
}

export function sendTelegram({ token, chatId }, text) {
  if (!chatId) throw Object.assign(new Error('Chat di Telegram non ancora trovata'), { status: 400 });
  return call(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: false });
}

/** Manda un'immagine PNG (es. la programmazione della settimana) con una didascalia. */
export async function sendTelegramPhoto({ token, chatId }, png, caption = '') {
  if (!chatId) throw Object.assign(new Error('Chat di Telegram non ancora trovata'), { status: 400 });
  if (!/^\d+:[\w-]{20,}$/.test(String(token ?? ''))) throw Object.assign(new Error('Token del bot Telegram non valido'), { status: 400 });
  const form = new FormData();
  form.append('chat_id', chatId);
  if (caption) { form.append('caption', caption.slice(0, 1000)); form.append('parse_mode', 'HTML'); }
  form.append('photo', new Blob([png], { type: 'image/png' }), 'programmazione.png');
  const res = await fetch(`${API}/bot${token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw Object.assign(new Error(`Telegram: ${data.description ?? `errore ${res.status}`}`), { status: 400 });
  return data.result;
}

const chatName = (chat) => chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'chat';

/**
 * Trova la chat dagli ultimi messaggi ricevuti dal bot.
 *   kind 'private': la chat con te (scrivi /start al bot);
 *   kind 'channel': il canale (o gruppo) dove il bot è amministratore (pubblica un messaggio lì).
 */
export async function findTelegramChat(token, kind = 'private') {
  const bot = await call(token, 'getMe');
  const updates = await call(token, 'getUpdates', { limit: 100 });
  const chats = updates.map((u) => u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat).filter(Boolean);
  const chat = chats.filter((c) => (kind === 'channel' ? c.type !== 'private' : c.type === 'private')).at(-1);
  if (!chat) {
    throw Object.assign(new Error(kind === 'channel'
      ? `Aggiungi il bot @${bot.username} come amministratore del canale (con il permesso di pubblicare), pubblica un messaggio nel canale e riprova`
      : `Scrivi un messaggio (es. /start) al bot @${bot.username} su Telegram e riprova`), { status: 400 });
  }
  return { chatId: String(chat.id), name: chatName(chat), type: chat.type, bot: bot.username };
}
