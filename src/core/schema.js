/**
 * Validazione delle impostazioni modificate dalla dashboard.
 * Si parte sempre dai valori predefiniti e si copiano solo i campi conosciuti e validi:
 * tutto il resto viene ignorato, così un valore sbagliato non può rompere l'overlay.
 */

import { PERMISSIONS, ACTIONS } from './commands.js';
import { MOD_ACTIONS, normalizeText } from './moderation.js';
import { CHAT_STYLES, CHAT_ANIMATIONS } from './chatOverlay.js';
import { cleanLogin } from './shoutout.js';

export const ANIMATIONS = ['pop', 'fade', 'slide-down', 'slide-up', 'slide-left', 'slide-right', 'zoom', 'bounce', 'flip', 'shake', 'window'];
export const POSITIONS = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'];
/** Temi della dashboard (scheda Tema). */
export const UI_THEMES = ['default', 'brutal'];
/** Stili degli alert in OBS. */
export const ALERT_STYLES = ['classic', 'brutal', 'errore'];
export const SOUND_PRESETS = ['chime', 'coin', 'pop', 'fanfare', 'bell', 'levelup', 'laser'];

const HEX = /^#[0-9a-f]{6}$/i;
const FONT = /^[\w .\-']{1,60}$/u;

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const text = (max) => (v) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (min, max) => (v) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined;
};
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
const color = (v) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined);
const font = (v) => (typeof v === 'string' && FONT.test(v) ? v : undefined);

/** Suoni e immagini: un preset, un file del programma o caricato, oppure un URL http(s). */
export function isSafeMedia(v) {
  if (v === '') return true;
  if (typeof v !== 'string' || v.length > 400) return false;
  if (SOUND_PRESETS.includes(v)) return true;
  if (/^https?:\/\/[^\s"'<>]+$/i.test(v)) return true;
  if (/^blob:https?:\/\/[^\s"'<>]+$/i.test(v)) return true; // file caricato nella versione demo
  return /^\/?(sounds|images|media)\/[^\s"'<>\\]+$/.test(v) && !v.includes('..');
}
const media = (v) => (isSafeMedia(v) ? v : undefined);

const STYLE_FIELDS = {
  duration: num(1000, 60000),
  sound: media,
  volume: num(0, 1),
  image: media,
  color,
  textColor: color,
  background: color,
  backgroundOpacity: num(0, 1),
  font,
  fontSize: num(12, 120),
  titleSize: num(12, 200),
  messageSize: num(10, 120),
  animation: oneOf(ANIMATIONS),
  alertStyle: oneOf(ALERT_STYLES),
  title: text(200),
  text: text(300),
  chatReply: text(450),
};

const TYPE_FIELDS = {
  ...STYLE_FIELDS,
  label: text(40),
  enabled: bool,
  alert: bool,
  showMessage: bool,
  ignoreGifted: bool,
  minAmount: num(0, 1e9),
};

const VARIANT_FIELDS = {
  ...STYLE_FIELDS,
  minAmount: num(0, 1e9),
  maxAmount: num(0, 1e9),
  reward: text(60),
};

const OVERLAY_FIELDS = {
  position: oneOf(POSITIONS),
  font,
  fontSize: num(12, 120),
  titleSize: num(12, 200),
  messageSize: num(10, 120),
  textColor: color,
  background: color,
  backgroundOpacity: num(0, 1),
  animation: oneOf(ANIMATIONS),
  alertStyle: oneOf(ALERT_STYLES),
};

/** Stile ERRORE_DI_SISTEMA: colori, sfondo a bit, effetti, tempi e misure dell'alert in-game. */
const ERRORE_FIELDS = {
  red: color, accent: color, name: color, title: color, bg: color, text: color, muted: color,
  bitsImage: media, bitsOpacity: num(0, 1), bitsBleed: num(0, 200), ca: num(0, 20), glitchDx: num(0, 40),
  windows: num(0, 40), spawnMs: num(10, 1000), offset: num(0, 100), holdMs: num(1000, 60000), igHoldMs: num(1000, 60000),
  igW: num(300, 1920), igH: num(80, 600), igTop: num(0, 1000), normalScenes: text(600),
};
/** Per ogni tipo: icona, colore dell'icona e testi (con i segnaposto come {amount}). */
const ERRORE_TYPE_FIELDS = {
  icon: media, color, tag: text(80), tag2: text(120), title: text(80), igTitle: text(80), msg: text(120), amount: text(80),
};

function pick(input, fields, base = {}) {
  const out = { ...base };
  if (!isObject(input)) return out;
  for (const [key, check] of Object.entries(fields)) {
    if (!(key in input)) continue;
    if (input[key] === null) {
      delete out[key];
      continue;
    }
    const value = check(input[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const WORD = /^[\p{L}\p{N}_-]{1,30}$/u;
const cmdWord = (v) => (typeof v === 'string' && WORD.test(v.trim().replace(/^!+/, '')) ? v.trim().replace(/^!+/, '').toLowerCase() : undefined);
const id = (v) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : undefined);

const COMMAND_FIELDS = {
  id,
  name: cmdWord,
  action: oneOf(ACTIONS),
  response: text(450),
  permission: oneOf(PERMISSIONS),
  cooldown: num(0, 3600),
  userCooldown: num(0, 3600),
  enabled: bool,
};
const TIMER_FIELDS = { id, message: text(450), interval: num(1, 240), minLines: num(0, 200), enabled: bool };

/** Comandi della chat: nomi unici (anche tra i nomi alternativi), al massimo 100 comandi e 20 messaggi a tempo. */
function sanitizeCommands(input, base) {
  const out = { ...base };
  if (!isObject(input)) return out;
  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (typeof input.prefix === 'string' && /^[!?#$%&*+.~-]$/.test(input.prefix)) out.prefix = input.prefix;
  if (Array.isArray(input.list)) {
    const used = new Set();
    out.list = input.list.filter(isObject).slice(0, 100).map((c, i) => {
      const cmd = pick(c, COMMAND_FIELDS, { action: 'reply', permission: 'everyone', cooldown: 5, userCooldown: 0, enabled: true, response: '' });
      cmd.id ??= `c${i}`;
      cmd.aliases = (Array.isArray(c.aliases) ? c.aliases : []).map(cmdWord).filter(Boolean).slice(0, 10);
      return cmd;
    }).filter((cmd) => {
      if (!cmd.name || used.has(cmd.name) || used.has(cmd.id)) return false;
      cmd.aliases = cmd.aliases.filter((a) => a !== cmd.name && !used.has(a));
      used.add(cmd.name).add(cmd.id);
      cmd.aliases.forEach((a) => used.add(a));
      return true;
    });
  }
  if (Array.isArray(input.timers)) {
    out.timers = input.timers.filter(isObject).slice(0, 20)
      .map((t, i) => ({ ...pick(t, TIMER_FIELDS, { interval: 15, minLines: 5, enabled: true, message: '' }), id: id(t.id) ?? `t${i}` }));
  }
  return out;
}

const CHAT_OVERLAY_FIELDS = {
  style: oneOf(CHAT_STYLES),
  font,
  fontSize: num(10, 80),
  textColor: color,
  nameColorMode: oneOf(['twitch', 'fixed']),
  nameColor: color,
  background: color,
  backgroundOpacity: num(0, 1),
  showBadges: bool,
  textShadow: bool,
  maxMessages: num(1, 100),
  lifetime: num(0, 3600),
  newestOnTop: bool,
  align: oneOf(['left', 'right']),
  animation: oneOf(CHAT_ANIMATIONS),
  hideBot: bool,
  hideCommands: bool,
};
function sanitizeChatOverlay(input, base) {
  const out = pick(input, CHAT_OVERLAY_FIELDS, base);
  if (isObject(input) && Array.isArray(input.hiddenUsers)) {
    out.hiddenUsers = [...new Set(input.hiddenUsers.map((u) => String(u ?? '').trim().replace(/^@/, '').toLowerCase()).filter((u) => /^\w{2,25}$/.test(u)))].slice(0, 100);
  }
  return out;
}

/** Parole bannate: al massimo 500, senza doppioni (anche scritte in modo diverso). */
function sanitizeModeration(input, base) {
  const out = { ...base };
  if (!isObject(input)) return out;
  for (const k of ['enabled', 'exemptVip', 'exemptSubs']) if (typeof input[k] === 'boolean') out[k] = input[k];
  if (typeof input.warning === 'string') out.warning = input.warning.slice(0, 300);
  if (Array.isArray(input.words)) {
    const seen = new Set();
    out.words = input.words.filter(isObject).map((w) => ({
      text: typeof w.text === 'string' ? w.text.trim().slice(0, 60) : '',
      action: oneOf(MOD_ACTIONS)(w.action) ?? 'delete',
      duration: num(1, 1209600)(w.duration) ?? 600,
      inside: w.inside === true,
    })).filter((w) => {
      const key = normalizeText(w.text);
      if (!key || key === '*' || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 500);
  }
  return out;
}

/** Shoutout automatici: persone (nome del canale) e testo del messaggio, anche diverso per persona. */
function sanitizeShoutouts(input, base) {
  const out = { ...base };
  if (!isObject(input)) return out;
  for (const k of ['enabled', 'onlyLive', 'official', 'chatMessage', 'obsCard']) if (typeof input[k] === 'boolean') out[k] = input[k];
  if (typeof input.message === 'string') out.message = input.message.slice(0, 400);
  if (Array.isArray(input.users)) {
    const seen = new Set();
    out.users = input.users.map((u) => (typeof u === 'string' ? { login: u } : u)).filter(isObject).map((u) => {
      const entry = { login: cleanLogin(u.login) };
      if (typeof u.message === 'string' && u.message.trim()) entry.message = u.message.trim().slice(0, 400);
      return entry;
    }).filter((u) => u.login && !seen.has(u.login) && seen.add(u.login)).slice(0, 300);
  }
  return out;
}

/** Telegram: bot, chat privata (riepiloghi e avvisi per te) e canale pubblico (per la community). */
function sanitizeTelegram(input, base) {
  const out = { ...base, texts: { ...base.texts } };
  if (!isObject(input)) return out;
  for (const k of ['enabled', 'sendRecap', 'sendLiveStart', 'alertRaid', 'alertDonation', 'alertBits', 'alertStream',
    'channelLiveStart', 'channelReminder', 'channelWeekly', 'channelLiveEnd']) if (typeof input[k] === 'boolean') out[k] = input[k];
  if (typeof input.token === 'string' && (input.token === '' || /^\d+:[\w-]{20,}$/.test(input.token.trim()))) out.token = input.token.trim();
  for (const k of ['chatId', 'channelId']) if (typeof input[k] === 'string' && /^-?\d{1,20}$|^$/.test(input[k].trim())) out[k] = input[k].trim();
  for (const k of ['chatName', 'channelName']) if (typeof input[k] === 'string') out[k] = input[k].slice(0, 80);
  const n = (v, min, max) => { const x = Number(v); return Number.isFinite(x) ? Math.min(Math.max(Math.round(x), min), max) : undefined; };
  out.donationMin = n(input.donationMin, 0, 100000) ?? out.donationMin;
  out.bitsMin = n(input.bitsMin, 1, 1000000) ?? out.bitsMin;
  out.reminderMin = n(input.reminderMin, 5, 240) ?? out.reminderMin;
  out.weeklyDay = n(input.weeklyDay, 1, 7) ?? out.weeklyDay;
  out.weeklyHour = n(input.weeklyHour, 0, 23) ?? out.weeklyHour;
  if (isObject(input.texts)) {
    for (const k of Object.keys(out.texts)) if (typeof input.texts[k] === 'string') out.texts[k] = input.texts[k].slice(0, 1000);
  }
  return out;
}

/** Goal (barra in OBS): follower, abbonati, bits o donazioni. */
const GOAL_KINDS = ['subs', 'followers', 'bits', 'donations'];
function sanitizeGoals(input, base) {
  if (!Array.isArray(input)) return base;
  const seen = new Set();
  return input.filter(isObject).slice(0, 10).map((g) => ({
    id: /^[\w-]{1,30}$/.test(String(g.id ?? '')) ? String(g.id) : `g${Math.random().toString(36).slice(2, 8)}`,
    type: GOAL_KINDS.includes(g.type) ? g.type : 'subs',
    title: String(g.title ?? '').slice(0, 40),
    target: Math.min(Math.max(Math.round(Number(g.target) * 100) / 100 || 1, 1), 10_000_000),
    mode: g.mode === 'new' ? 'new' : 'total',
    showPercent: g.showPercent !== false,
  })).filter((g) => !seen.has(g.id) && seen.add(g.id));
}

/** Musica: abbassa il volume durante gli alert. */
function sanitizeMusic(input, base) {
  const out = { ...base };
  if (!isObject(input)) return out;
  if (typeof input.duck === 'boolean') out.duck = input.duck;
  const level = Number(input.duckLevel);
  if (Number.isFinite(level)) out.duckLevel = Math.min(1, Math.max(0, Math.round(level * 100) / 100));
  return out;
}

/** Ritorna la configurazione completa e valida, partendo dai predefiniti. */
export function sanitizeConfig(input, defaults) {
  const out = structuredClone(defaults);
  if (!isObject(input)) return out;

  out.overlay = pick(input.overlay, OVERLAY_FIELDS, out.overlay);
  if (out.overlay.errore) out.overlay.errore = pick(input.overlay?.errore, ERRORE_FIELDS, out.overlay.errore);
  if (isObject(input.queue)) out.queue.gapMs = num(0, 10000)(input.queue.gapMs) ?? out.queue.gapMs;
  if (isObject(input.chat)) out.chat.enabled = bool(input.chat.enabled) ?? out.chat.enabled;
  if (out.ui && isObject(input.ui)) out.ui.theme = oneOf(UI_THEMES)(input.ui.theme) ?? out.ui.theme;
  if (out.commands) out.commands = sanitizeCommands(input.commands, out.commands);
  if (out.moderation) out.moderation = sanitizeModeration(input.moderation, out.moderation);
  if (out.shoutouts) out.shoutouts = sanitizeShoutouts(input.shoutouts, out.shoutouts);
  if (out.telegram) out.telegram = sanitizeTelegram(input.telegram, out.telegram);
  if (out.music) out.music = sanitizeMusic(input.music, out.music);
  if (out.goals) out.goals = sanitizeGoals(input.goals, out.goals);
  if (out.chatOverlay) out.chatOverlay = sanitizeChatOverlay(input.chatOverlay, out.chatOverlay);

  for (const type of Object.keys(out.types)) {
    const src = input.types?.[type];
    if (!isObject(src)) continue;
    const t = pick(src, TYPE_FIELDS, out.types[type]);
    if (t.errore) t.errore = pick(src.errore, ERRORE_TYPE_FIELDS, t.errore);
    if (Array.isArray(src.variants)) {
      t.variants = src.variants.slice(0, 20).filter(isObject).map((v) => pick(v, VARIANT_FIELDS));
    }
    if (Array.isArray(src.ignoreRewards)) {
      t.ignoreRewards = src.ignoreRewards.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.slice(0, 60)).slice(0, 50);
    }
    out.types[type] = t;
  }
  return out;
}

/** JSON con le chiavi ordinate: due oggetti uguali danno lo stesso testo anche se le chiavi sono in ordine diverso. */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Solo le differenze rispetto ai predefiniti: è ciò che finisce in config/config.json. */
export function diffConfig(value, defaults) {
  if (isObject(value) && isObject(defaults)) {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const d = diffConfig(v, defaults[key]);
      if (d !== undefined) out[key] = d;
    }
    // Chiavi presenti nei predefiniti ma rimosse dall'utente (es. immagine tolta): salvate come vuote.
    for (const key of Object.keys(defaults)) {
      if (!(key in value) && typeof defaults[key] === 'string') out[key] = '';
    }
    return Object.keys(out).length ? out : undefined;
  }
  return stableJson(value) === stableJson(defaults) ? undefined : value;
}
