// Silver (il compagno sul desktop del PC) collegato a Gestor: il PC chiede il permesso, tu premi "Consenti"
// in ⚙ Sistema → 🧰 Tools e Silver riceve una chiave sua. Con la chiave: avvisi (follow, donazioni, prossima live)
// e piccoli comandi (musica, scena di OBS, appunti in Howl-UP). Niente password della dashboard sul PC.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';
import { fromLocal } from './core/schedule.js';

const KEYS_FILE = path.join(DATA_DIR, 'silver', 'keys.json');
const hash = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');

// cosa dice Silver per ogni avviso (in live no: lì ci pensa l'overlay)
export function eventText(n) {
  const who = n.user?.name || 'Qualcuno';
  const money = n.amount ? `${Number(n.amount).toLocaleString('it-IT', { maximumFractionDigits: 2 })} ${n.currency ?? ''}`.trim() : '';
  switch (n.type) {
    case 'follow': return `Nuovo follower: ${who}.`;
    case 'sub': return `${who} si è abbonato.`;
    case 'resub': return `${who} rinnova l'abbonamento${n.months ? ` (${n.months} mesi)` : ''}.`;
    case 'giftsub': return `${who} ha regalato ${n.amount || 1} abbonament${n.amount > 1 ? 'i' : 'o'}.`;
    case 'cheer': return `${who} ha mandato ${n.amount} bits.`;
    case 'raid': return `Raid di ${who} con ${n.amount} spettatori.`;
    case 'donation': return `${who} ha donato ${money}.`;
    case 'redemption': return `${who} ha riscattato "${n.reward?.title ?? 'un premio'}".`;
    default: return '';
  }
}

export function createSilverLink(app, { file = KEYS_FILE, howlupPort = Number(process.env.HOWLUP_PORT) || 3100, fetchFn = fetch } = {}) {
  let keys = [];
  try { keys = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* nessun PC collegato */ }
  const saveKeys = () => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(keys, null, 2)); };
  const requests = new Map(); // id → { pc, ip, at, status, key }
  const events = []; // ultimi avvisi { id, text, at }
  let seq = 0;

  app.manager?.on?.('notification', (n) => {
    if (n.test) return;
    const text = eventText(n);
    if (!text) return;
    events.push({ id: ++seq, text, at: Date.now() });
    if (events.length > 30) events.shift();
  });

  const prune = () => { for (const [id, r] of requests) if (Date.now() - r.at > 10 * 60000) requests.delete(id); };

  return {
    // --- collegamento ---
    request(pc, ip) {
      prune();
      if (requests.size >= 5) throw Object.assign(new Error('Troppe richieste: riprova tra qualche minuto'), { status: 429 });
      const id = crypto.randomBytes(12).toString('hex');
      requests.set(id, { pc: String(pc ?? 'PC').slice(0, 60), ip: String(ip ?? '').replace(/^::ffff:/, ''), at: Date.now(), status: 'pending' });
      return { id };
    },
    poll(id) {
      prune();
      const r = requests.get(id);
      if (!r) return { status: 'gone' };
      if (r.status === 'ok') { requests.delete(id); return { status: 'ok', key: r.key }; } // la chiave si dà una volta sola
      return { status: r.status };
    },
    pending: () => { prune(); return [...requests].filter(([, r]) => r.status === 'pending').map(([id, r]) => ({ id, pc: r.pc, ip: r.ip, at: r.at })); },
    devices: () => keys.map(({ id, pc, at }) => ({ id, pc, at })),
    allow(id) {
      const r = requests.get(id);
      if (!r || r.status !== 'pending') throw Object.assign(new Error('Richiesta scaduta: riapri Silver sul PC'), { status: 404 });
      r.key = crypto.randomBytes(24).toString('hex');
      r.status = 'ok';
      keys = keys.filter((k) => k.pc !== r.pc); // stesso PC: sostituisce la chiave vecchia
      keys.push({ id: crypto.randomBytes(6).toString('hex'), pc: r.pc, at: Date.now(), hash: hash(r.key) });
      saveKeys();
    },
    deny(id) { const r = requests.get(id); if (r) r.status = 'denied'; },
    unpair(id) { keys = keys.filter((k) => k.id !== id); saveKeys(); },
    check(key) {
      if (!key) return false;
      const h = Buffer.from(hash(key));
      return keys.some((k) => k.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(k.hash), h));
    },

    // --- avvisi: nuovi da "since", prossima live, scene di OBS ---
    async feed(since) {
      const n = app.schedule?.state().next;
      const t = app.music?.player?.current;
      return {
        live: Boolean(await app.isLive?.()),
        seq,
        events: events.filter((e) => e.id > since && Date.now() - e.at < 10 * 60000),
        nextLive: n ? { id: n.id, at: fromLocal(n.start), title: n.title, game: n.game } : null,
        scenes: app.obs?.state().scenes ?? [],
        scene: app.obs?.state().current ?? '',
        song: t ? t.name.replace(/\.[a-z0-9]+$/i, '') : '',
        playing: Boolean(app.music?.player?.state?.playing),
      };
    },

    // --- comandi: risponde con la frase che dice Silver ---
    async run(body = {}) {
      const p = app.music?.player;
      switch (body.action) {
        case 'music': {
          if (!p) throw Object.assign(new Error('La musica non è disponibile'), { status: 400 });
          const what = String(body.what ?? '');
          if (what === 'next') p.next();
          else if (what === 'prev') p.prev();
          else if (what === 'pause') { if (p.state.playing) p.toggle(); } else if (what === 'play') { if (!p.state.playing) p.toggle(); } else p.toggle();
          await new Promise((r) => setTimeout(r, 300));
          const t = p.current;
          const name = t ? t.name.replace(/\.[a-z0-9]+$/i, '') : '';
          return { text: p.state.playing ? (name ? `Suona: ${name}.` : 'Musica partita.') : 'Musica in pausa.' };
        }
        case 'scene': {
          if (!app.obs) throw Object.assign(new Error('OBS non è collegato'), { status: 400 });
          const scenes = app.obs.state().scenes ?? [];
          const want = String(body.scene ?? '').toLowerCase().trim();
          const found = scenes.find((s) => s.toLowerCase() === want) ?? scenes.find((s) => s.toLowerCase().includes(want));
          if (!want || !found) return { text: scenes.length ? `Non trovo la scena "${body.scene}". Ho: ${scenes.join(', ')}.` : 'OBS non risponde o non ha scene.' };
          await app.obs.setScene(found);
          return { text: `Scena: ${found}.` };
        }
        case 'note': {
          const text = String(body.text ?? '').trim().slice(0, 2000);
          if (!text) return { text: 'Cosa devo scrivere?' };
          const title = text.length > 60 ? `${text.slice(0, 57)}…` : text;
          const res = await fetchFn(`http://127.0.0.1:${howlupPort}/api/notes`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'x-howlup': '1', ...(process.env.DASHBOARD_TOKEN ? { 'x-dashboard-token': process.env.DASHBOARD_TOKEN } : {}) },
            body: JSON.stringify({ note: { title, subtitle: 'da Silver', body: text } }),
            signal: AbortSignal.timeout(5000),
          }).catch(() => null);
          if (!res?.ok) return { text: 'Howl-UP non risponde: la nota non è salvata.' };
          return { text: 'Segnato nelle note di Howl-UP.' };
        }
        default:
          throw Object.assign(new Error('Comando sconosciuto'), { status: 400 });
      }
    },
  };
}
