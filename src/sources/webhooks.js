import { donation } from '../core/normalize.js';

/** Ko-fi invia un form con un campo "data" contenente JSON. */
export function parseKofi(body, verificationToken) {
  const payload = typeof body.data === 'string' ? JSON.parse(body.data) : body;
  if (!verificationToken || payload.verification_token !== verificationToken) {
    const err = new Error('verification_token Ko-fi non valido');
    err.status = 401;
    throw err;
  }
  if (!['Donation', 'Subscription', 'Commission', 'Shop Order'].includes(payload.type)) return null;
  return donation({
    id: payload.kofi_transaction_id ?? payload.message_id,
    source: 'kofi',
    name: payload.is_public === false ? null : payload.from_name,
    amount: payload.amount,
    currency: payload.currency,
    message: payload.is_public === false ? '' : payload.message,
    raw: payload,
  });
}

/** Webhook generico: { name, amount, currency?, message?, id? } */
export function parseGenericDonation(body) {
  if (body.amount === undefined || Number.isNaN(Number(body.amount))) {
    const err = new Error('Campo "amount" mancante o non numerico');
    err.status = 400;
    throw err;
  }
  return donation({
    id: body.id,
    source: body.source ? String(body.source).slice(0, 30) : 'webhook',
    name: body.name ?? body.username,
    amount: body.amount,
    currency: body.currency,
    message: body.message,
    raw: body,
  });
}
