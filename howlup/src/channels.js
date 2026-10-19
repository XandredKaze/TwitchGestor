/**
 * Dove arrivano le notifiche di Howl-UP:
 *   - ntfy (app gratuita per Android e iPhone): notifica con i pulsanti "✅ Ho visto" e "Apri Howl-UP";
 *   - Telegram: lo stesso bot di TwitchGestor, nella tua chat privata, con il pulsante "✅ Ho visto".
 */

export async function sendNtfy({ server, topic }, msg, { ackUrl, openUrl, fetchFn = fetch } = {}) {
  if (!topic) throw new Error('ntfy: manca il nome dell\'argomento');
  const actions = [];
  if (ackUrl) actions.push({ action: 'http', label: '✅ Ho visto', url: ackUrl, method: 'POST', clear: true });
  if (openUrl) actions.push({ action: 'view', label: 'Apri Howl-UP', url: openUrl });
  const res = await fetchFn(server.replace(/\/$/, ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic, title: msg.title, message: msg.text.slice(0, 3800), tags: ['wolf'],
      priority: msg.repeat ? 4 : 3, click: openUrl || undefined, actions,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`ntfy ha risposto ${res.status}`);
}

export async function sendTelegramMsg({ token, chatId }, msg, { ackUrl, openUrl, fetchFn = fetch } = {}) {
  if (!token || !chatId) throw new Error('Telegram non collegato in TwitchGestor');
  const buttons = [];
  if (ackUrl) buttons.push({ text: '✅ Ho visto', url: ackUrl });
  if (openUrl) buttons.push({ text: 'Apri Howl-UP', url: openUrl });
  const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text: `${msg.title}\n\n${msg.text}`.slice(0, 4000), disable_web_page_preview: true,
      ...(buttons.length ? { reply_markup: { inline_keyboard: [buttons] } } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  // Telegram rifiuta i pulsanti con indirizzi che non gli piacciono: si riprova senza
  if (!data.ok && buttons.length && /button|URL/i.test(data.description ?? '')) {
    return sendTelegramMsg({ token, chatId }, { ...msg, text: `${msg.text}${ackUrl ? `\n\n✅ Ho visto: ${ackUrl}` : ''}` }, { fetchFn });
  }
  if (!data.ok) throw new Error(`Telegram: ${data.description ?? res.status}`);
}
