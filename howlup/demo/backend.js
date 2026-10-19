/**
 * Howl-UP – versione demo che gira tutta nel browser: sostituisce il Raspberry rispondendo alle
 * chiamate della pagina (/api/...) con lo stesso codice dell'agenda vera. I dati restano in questo browser.
 */
import { Agenda, toICS, today, addDays, weekday, livesToEvents } from '../src/core/agenda.js';
import { cleanEntry, generateWeeks } from '../../src/core/schedule.js';
import { Notifier, cleanSettings } from '../src/core/notifier.js';
import { Announcements, cleanAnnounceSettings } from '../src/core/announce.js';

const KEY = 'howlup-demo-2';
const t = today();
const nextWeekday = (n) => { let d = t; while (weekday(d) !== n) d = addDays(d, 1); return d; };
const sample = () => ({
  events: [
    { title: 'Turno al lavoro', category: 'work', date: addDays(t, -weekday(t) + 1), time: '09:00', endTime: '13:00', repeat: { freq: 'weekly', days: [1, 2, 3, 4, 5] } },
    { title: 'Palestra', category: 'personal', date: t, time: '18:30', endTime: '19:30', repeat: { freq: 'weekly', days: [1, 3] } },
    { title: 'Cena con gli amici', category: 'personal', date: addDays(t, 2), time: '20:00' },
    { title: 'Compleanno di Marta', category: 'personal', date: addDays(t, 5), allDay: true, repeat: { freq: 'yearly' } },
  ],
  tasks: [
    { title: 'Preparare la grafica della live', due: t, category: 'live' },
    { title: 'Pagare la bolletta', due: addDays(t, -1) },
    { title: 'Rispondere alle mail dello sponsor', due: addDays(t, 2), category: 'work' },
    { title: 'Comprare il microfono nuovo' },
  ],
});

const store = {
  load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* niente */ } },
};
let rev = Date.now();
const agenda = new Agenda({ store, onChange: () => { rev = Date.now(); } });
if (!store.load()) {
  for (const e of sample().events) agenda.saveEvent(e);
  for (const x of sample().tasks) agenda.saveTask(x);
}

// la Programmazione di TwitchGestor finta (nella versione vera le live stanno lì)
const LIVE_KEY = 'howlup-demo-lives';
let lives;
try { lives = JSON.parse(localStorage.getItem(LIVE_KEY)); } catch { lives = null; }
if (!Array.isArray(lives)) {
  const monday = addDays(t, -weekday(t) + 1);
  lives = [
    ...generateWeeks({ from: monday, weeks: 4, days: [2, 4], time: '21:00', durationMin: 150, title: 'Elden Ring alla cieca', game: 'Elden Ring', gameId: '512953' }),
    ...generateWeeks({ from: monday, weeks: 4, days: [6], time: '18:30', durationMin: 120, title: 'Chiacchiere e caffè con la chat', game: 'Just Chatting', gameId: '509658' }),
  ].filter((e) => e.start.slice(0, 10) >= t);
}
// annunci: nella demo si preparano davvero (spostando una live), ma non partono
let announceSettings = {};
let announceState = null;
const announcements = new Announcements({
  store: { load: () => announceState, save: (d) => { announceState = d; } },
  getSettings: () => announceSettings,
  getContext: () => ({ login: 'xandred_kaze' }),
  onChange: () => { rev = Date.now(); },
  send: async () => ({ telegram: 'nella demo non si invia davvero' }),
});
const saveLives = () => { try { localStorage.setItem(LIVE_KEY, JSON.stringify(lives)); } catch { /* niente */ } rev = Date.now(); announcements.observe(lives); };
announcements.observe(lives);
const livesState = () => ({ ok: true, error: '', canPublish: false, entries: lives });
const GAMES = ['Just Chatting', 'Elden Ring', 'Minecraft', 'Fortnite', 'Valorant', 'Art', 'Music', 'League of Legends'];

// notifiche: nella demo non partono davvero, ma "Manda una prova" crea quella da confermare
let notifySettings = {};
try { notifySettings = JSON.parse(localStorage.getItem('howlup-demo-notify')) ?? {}; } catch { /* niente */ }
const notifyView = () => { const x = cleanSettings(notifySettings); if (!x.channels.ntfy.topic) x.channels.ntfy.topic = 'howlup-demo00000'; return x; };
let notifyState = null;
const notifier = new Notifier({
  getSettings: notifyView,
  getData: () => ({ ...agenda.state(), events: [...agenda.events, ...livesToEvents(lives)] }),
  store: { load: () => notifyState, save: (d) => { notifyState = d; rev = Date.now(); } },
  send: () => {},
});

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const i = url.pathname.indexOf('/api/');
  if (url.pathname.endsWith('/calendar/demo.ics')) return new Response(toICS([...agenda.events, ...livesToEvents(lives)], { categories: agenda.categories }), { headers: { 'Content-Type': 'text/calendar' } });
  if (i === -1) return realFetch(input, init);
  const path = url.pathname.slice(i);
  const method = (init.method ?? 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : {};
  await new Promise((r) => setTimeout(r, 40));
  try {
    if (method === 'GET' && path === '/api/state') {
      if (url.searchParams.get('rev') === String(rev)) return json(200, { rev, unchanged: true });
      return json(200, { rev, ...agenda.state(), lives: livesState(), pending: notifier.pending(), announce: announcements.drafts.filter((d) => d.status === 'draft').length, calendarPath: '/calendar/demo.ics' });
    }
    if (method === 'PUT' && path === '/api/events') return json(200, { rev, event: agenda.saveEvent(body.event) });
    let m = /^\/api\/events\/([\w-]+)(\/occurrence)?$/.exec(path);
    if (m && method === 'POST' && m[2]) return json(200, { rev, event: agenda.saveOccurrence(m[1], body.day, body.event) });
    if (m && method === 'DELETE') return json(200, { rev, ok: agenda.deleteEvent(m[1], url.searchParams.get('only') || '') });
    if (method === 'PUT' && path === '/api/tasks') return json(200, { rev, task: agenda.saveTask(body.task) });
    m = /^\/api\/tasks\/([\w-]+)$/.exec(path);
    if (m && method === 'DELETE') return json(200, { rev, ok: agenda.deleteTask(m[1]) });
    if (path === '/api/announce/mascot') return json(400, { error: 'Nella demo non si può caricare l\'immagine: nel programma vero sì.' });
    if (method === 'GET' && path === '/api/announce') return json(200, { settings: cleanAnnounceSettings(announceSettings), drafts: announcements.drafts, login: 'xandred_kaze', telegramChannel: '' });
    if (method === 'PUT' && path === '/api/announce') { announceSettings = cleanAnnounceSettings(body.settings); return json(200, { settings: announceSettings }); }
    const am = /^\/api\/announce\/([\w-]+)\/(send|hold|dismiss|text)$/.exec(path);
    if (am && method === 'POST') {
      if (am[2] === 'text') return json(200, { rev, draft: announcements.update(am[1], { text: body.text }) });
      if (am[2] === 'hold') return json(200, { rev, draft: announcements.hold(am[1]) });
      if (am[2] === 'dismiss') return json(200, { rev, draft: announcements.dismiss(am[1]) });
      if (typeof body.text === 'string') announcements.update(am[1], { text: body.text });
      return json(200, { rev, draft: await announcements.sendNow(am[1], {}) });
    }
    if (method === 'GET' && path === '/api/notify') return json(200, { settings: notifyView(), pending: notifier.pending(), linkBase: 'http://twitchgestor.local:3100', telegram: null });
    if (method === 'PUT' && path === '/api/notify') {
      notifySettings = cleanSettings(body.settings);
      try { localStorage.setItem('howlup-demo-notify', JSON.stringify(notifySettings)); } catch { /* niente */ }
      return json(200, { settings: notifyView() });
    }
    if (method === 'POST' && path === '/api/notify/test') { await notifier.test(); return json(200, { rev, pending: notifier.pending() }); }
    if (method === 'POST' && path === '/api/notify/ack') { notifier.ack(body.id ? String(body.id) : ''); return json(200, { rev, pending: notifier.pending() }); }
    if (method === 'PUT' && path === '/api/lives') {
      const e = cleanEntry(body.live);
      if (!e) return json(400, { error: 'Servono giorno e ora della live' });
      lives = lives.some((x) => x.id === e.id) ? lives.map((x) => (x.id === e.id ? e : x)) : [...lives, e];
      saveLives();
      return json(200, { rev, live: e, lives: livesState() });
    }
    if (method === 'POST' && path === '/api/lives/weeks') {
      const added = generateWeeks(body).filter(Boolean);
      lives = [...lives, ...added];
      saveLives();
      return json(200, { rev, added: added.length, lives: livesState() });
    }
    if (method === 'GET' && path === '/api/lives/categories') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      return json(200, { categories: GAMES.map((name, i) => ({ id: String(i + 1), name })).filter((g) => g.name.toLowerCase().includes(q)) });
    }
    m = /^\/api\/lives\/([\w-]+)$/.exec(path);
    if (m && method === 'DELETE') { lives = lives.filter((x) => x.id !== m[1]); saveLives(); return json(200, { rev, lives: livesState() }); }
    if (method === 'PUT' && path === '/api/categories') return json(200, { rev, categories: agenda.saveCategories(body.categories) });
    return json(404, { error: 'Non disponibile nella demo' });
  } catch (err) {
    return json(err.status ?? 500, { error: err.message });
  }
};
