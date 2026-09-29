/**
 * Validazione delle impostazioni modificate dalla dashboard.
 * Si parte sempre dai valori predefiniti e si copiano solo i campi conosciuti e validi:
 * tutto il resto viene ignorato, così un valore sbagliato non può rompere l'overlay.
 */

export const ANIMATIONS = ['pop', 'fade', 'slide-down', 'slide-up', 'slide-left', 'slide-right', 'zoom', 'bounce', 'flip', 'shake'];
export const POSITIONS = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'];
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
  animation: oneOf(ANIMATIONS),
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

/** Ritorna la configurazione completa e valida, partendo dai predefiniti. */
export function sanitizeConfig(input, defaults) {
  const out = structuredClone(defaults);
  if (!isObject(input)) return out;

  out.overlay = pick(input.overlay, OVERLAY_FIELDS, out.overlay);
  if (isObject(input.queue)) out.queue.gapMs = num(0, 10000)(input.queue.gapMs) ?? out.queue.gapMs;
  if (isObject(input.chat)) out.chat.enabled = bool(input.chat.enabled) ?? out.chat.enabled;

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
