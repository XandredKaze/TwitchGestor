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
  }).catch((err) => { throw new Error(`il Raspberry non raggiunge ${server} (${err.cause?.code ?? err.message})`); });
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

/** Annuncio sul canale Telegram (quello impostato in TwitchGestor): con la storia come foto, se c'è. */
export async function announceTelegram({ token, chatId }, text, image, { fetchFn = fetch } = {}) {
  if (!token || !chatId) throw new Error('canale Telegram non collegato in TwitchGestor');
  let res;
  if (image) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', text.slice(0, 1000));
    form.append('photo', new Blob([image], { type: 'image/png' }), 'live.png');
    res = await fetchFn(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
  } else {
    res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }), signal: AbortSignal.timeout(15000),
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram: ${data.description ?? res.status}`);
}

/** Annuncio su Discord con il webhook del canale (gratis, senza bot): testo e, se c'è, l'immagine. */
export async function announceDiscord(webhook, text, image, { fetchFn = fetch } = {}) {
  if (!webhook) throw new Error('webhook di Discord non impostato');
  const payload = { content: text.slice(0, 1900), username: 'Howl-UP', allowed_mentions: { parse: [] } };
  let res;
  if (image) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(payload));
    form.append('files[0]', new Blob([image], { type: 'image/png' }), 'live.png');
    res = await fetchFn(`${webhook}?wait=true`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
  } else {
    res = await fetchFn(`${webhook}?wait=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
  }
  if (!res.ok) throw new Error(`Discord ha risposto ${res.status}`);
}
