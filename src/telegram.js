/**
 * Messaggi su Telegram (gratuito): riepilogo di fine live e, se vuoi, l'avviso di inizio live.
 * Serve un bot creato con @BotFather (token) e la chat dove scrivere (chatId): la dashboard la trova da sola.
 */

const API = 'https://api.telegram.org';

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
  return call(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

/** L'ultima chat che ha scritto al bot (scrivigli /start e poi premi "Trova la chat"). */
export async function findTelegramChat(token) {
  const bot = await call(token, 'getMe');
  const updates = await call(token, 'getUpdates', { limit: 50 });
  const chat = updates.map((u) => u.message?.chat ?? u.channel_post?.chat ?? u.my_chat_member?.chat).filter(Boolean).at(-1);
  if (!chat) throw Object.assign(new Error(`Scrivi un messaggio (es. /start) al bot @${bot.username} su Telegram e riprova`), { status: 400 });
  return { chatId: String(chat.id), name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'chat', bot: bot.username };
}
