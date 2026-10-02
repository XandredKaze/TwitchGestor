/**
 * Validazione delle impostazioni modificate dalla dashboard.
 * Si parte sempre dai valori predefiniti e si copiano solo i campi conosciuti e validi:
 * tutto il resto viene ignorato, così un valore sbagliato non può rompere l'overlay.
 */

import { PERMISSIONS, ACTIONS } from './commands.js';

export const ANIMATIONS = ['pop', 'fade', 'slide-down', 'slide-up', 'slide-left', 'slide-right', 'zoom', 'bounce', 'flip', 'shake'];
export const POSITIONS = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'];
/** Temi della dashboard (scheda Tema). */
export const UI_THEMES = ['default', 'brutal'];
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
  title: text(200),
  text: text(300),
  chatReply: text(450),
};

const TTS_ALERT_FIELDS = {
  tts: bool,
  ttsText: text(300),
};

const TTS_FIELDS = {
  enabled: bool,
  voice: text(120),
  rate: num(-10, 10),
  volume: num(0, 100),
  maxLength: num(20, 500),
  skipLinks: bool,
};

const TYPE_FIELDS = {
  ...STYLE_FIELDS,
  ...TTS_ALERT_FIELDS,
  label: text(40),
  enabled: bool,
  alert: bool,
  showMessage: bool,
  ignoreGifted: bool,
  minAmount: num(0, 1e9),
};

const VARIANT_FIELDS = {
  ...STYLE_FIELDS,
  ...TTS_ALERT_FIELDS,
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

/** Ritorna la configurazione completa e valida, partendo dai predefiniti. */
export function sanitizeConfig(input, defaults) {
  const out = structuredClone(defaults);
  if (!isObject(input)) return out;

  out.overlay = pick(input.overlay, OVERLAY_FIELDS, out.overlay);
  if (isObject(input.queue)) out.queue.gapMs = num(0, 10000)(input.queue.gapMs) ?? out.queue.gapMs;
  if (isObject(input.chat)) out.chat.enabled = bool(input.chat.enabled) ?? out.chat.enabled;
  if (out.ui && isObject(input.ui)) out.ui.theme = oneOf(UI_THEMES)(input.ui.theme) ?? out.ui.theme;
  if (out.commands) out.commands = sanitizeCommands(input.commands, out.commands);
  if (out.tts) {
    out.tts = pick(input.tts, TTS_FIELDS, out.tts);
    if (Array.isArray(input.tts?.bannedWords)) {
      out.tts.bannedWords = input.tts.bannedWords.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim().slice(0, 40)).slice(0, 200);
    }
  }

  for (const type of Object.keys(out.types)) {
    const src = input.types?.[type];
    if (!isObject(src)) continue;
    const t = pick(src, TYPE_FIELDS, out.types[type]);
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
