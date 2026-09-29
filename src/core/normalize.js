import { randomUUID } from 'node:crypto';

/**
 * Formato unico per tutte le notifiche, qualunque sia la sorgente:
 * {
 *   id, type, source, timestamp,
 *   user: { id, login, name } | null   (null = anonimo),
 *   amount, currency, tier, months, streak, message,
 *   reward: { id, title, cost } | undefined,
 *   isGift, raw
 * }
 * type: follow | sub | resub | giftsub | cheer | raid | redemption | donation
 */
export const NOTIFICATION_TYPES = ['follow', 'sub', 'resub', 'giftsub', 'cheer', 'raid', 'redemption', 'donation'];

function user(id, login, name) {
  if (!id && !login && !name) return null;
  return { id: id ?? null, login: login ?? null, name: name ?? login ?? null };
}

function tier(t) {
  return t ? String(Number(t) / 1000) : '1';
}

function base(type, source, extra) {
  return { id: randomUUID(), type, source, timestamp: new Date().toISOString(), ...extra };
}

/** Converte una notifica EventSub di Twitch. Ritorna null per i tipi non gestiti. */
export function fromEventSub(subscriptionType, e, messageId) {
  const id = messageId ?? randomUUID();
  switch (subscriptionType) {
    case 'channel.follow':
      return base('follow', 'twitch', { id, user: user(e.user_id, e.user_login, e.user_name), raw: e });

    case 'channel.subscribe':
      return base('sub', 'twitch', {
        id,
        user: user(e.user_id, e.user_login, e.user_name),
        tier: tier(e.tier),
        isGift: Boolean(e.is_gift),
        raw: e,
      });

    case 'channel.subscription.message':
      return base('resub', 'twitch', {
        id,
        user: user(e.user_id, e.user_login, e.user_name),
        tier: tier(e.tier),
        months: e.cumulative_months,
        amount: e.cumulative_months,
        streak: e.streak_months ?? null,
        message: e.message?.text ?? '',
        raw: e,
      });

    case 'channel.subscription.gift':
      return base('giftsub', 'twitch', {
        id,
        user: e.is_anonymous ? null : user(e.user_id, e.user_login, e.user_name),
        tier: tier(e.tier),
        amount: e.total,
        total: e.cumulative_total ?? null,
        raw: e,
      });

    case 'channel.cheer':
      return base('cheer', 'twitch', {
        id,
        user: e.is_anonymous ? null : user(e.user_id, e.user_login, e.user_name),
        amount: e.bits,
        message: e.message ?? '',
        raw: e,
      });

    case 'channel.raid':
      return base('raid', 'twitch', {
        id,
        user: user(e.from_broadcaster_user_id, e.from_broadcaster_user_login, e.from_broadcaster_user_name),
        amount: e.viewers,
        raw: e,
      });

    case 'channel.channel_points_custom_reward_redemption.add':
      return base('redemption', 'twitch', {
        id,
        user: user(e.user_id, e.user_login, e.user_name),
        reward: { id: e.reward?.id, title: e.reward?.title ?? '', cost: e.reward?.cost ?? 0 },
        amount: e.reward?.cost ?? 0,
        message: e.user_input ?? '',
        raw: e,
      });

    case 'channel.charity_campaign.donate': {
      const value = Number(e.amount?.value ?? 0) / 10 ** Number(e.amount?.decimal_places ?? 0);
      return base('donation', 'twitch-charity', {
        id,
        user: user(e.user_id, e.user_login, e.user_name),
        amount: value,
        currency: e.amount?.currency ?? 'EUR',
        message: e.charity_name ? `Beneficenza: ${e.charity_name}` : '',
        raw: e,
      });
    }

    default:
      return null;
  }
}

/** Donazione generica (StreamElements, Ko-fi, webhook). */
export function donation({ id, source, name, amount, currency, message, raw }) {
  return base('donation', source, {
    id: id ? `${source}:${id}` : randomUUID(),
    user: name ? user(null, null, name) : null,
    amount: Number(amount) || 0,
    currency: (currency || 'EUR').toUpperCase(),
    message: message ?? '',
    raw,
  });
}

const TEST_NAMES = ['PizzaConAnanas', 'LupoSolitario', 'GattoNinja', 'CaffèCorretto', 'MarioRossi92', 'SuperNonna'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const between = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Notifiche finte per provare overlay e suoni senza aspettare eventi reali. */
export function testNotification(type) {
  const name = pick(TEST_NAMES);
  const u = { id: null, login: name.toLowerCase(), name };
  const common = { user: u, test: true };
  switch (type) {
    case 'follow':
      return base('follow', 'test', common);
    case 'sub':
      return base('sub', 'test', { ...common, tier: pick(['1', '1', '2', '3']) });
    case 'resub': {
      const months = between(2, 36);
      return base('resub', 'test', { ...common, tier: '1', months, amount: months, streak: months, message: 'Sempre qui! 💜' });
    }
    case 'giftsub':
      return base('giftsub', 'test', { ...common, tier: '1', amount: pick([1, 5, 10, 20]) });
    case 'cheer':
      return base('cheer', 'test', { ...common, amount: pick([100, 500, 1000, 5000]), message: 'Cheer100 grande!' });
    case 'raid':
      return base('raid', 'test', { ...common, amount: between(3, 250) });
    case 'redemption': {
      const reward = pick([{ title: 'Idratati', cost: 500 }, { title: 'Scegli la prossima canzone', cost: 2000 }]);
      return base('redemption', 'test', { ...common, reward: { id: 'test', ...reward }, amount: reward.cost, message: 'Metti qualcosa di rock!' });
    }
    case 'donation':
      return base('donation', 'test', { ...common, amount: pick([2, 5, 10, 50, 100]), currency: 'EUR', message: 'Continua così!' });
    default:
      throw new Error(`Tipo di notifica sconosciuto: ${type}`);
  }
}
