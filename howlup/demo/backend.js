/**
 * Howl-UP – versione demo che gira tutta nel browser: sostituisce il Raspberry rispondendo alle
 * chiamate della pagina (/api/...) con lo stesso codice dell'agenda vera. I dati restano in questo browser.
 */
import { Agenda, toICS, today, addDays, weekday } from '../src/core/agenda.js';

const KEY = 'howlup-demo';
const t = today();
const nextWeekday = (n) => { let d = t; while (weekday(d) !== n) d = addDays(d, 1); return d; };
const sample = () => ({
  events: [
    { title: 'Live: Elden Ring alla cieca', category: 'live', date: nextWeekday(2), time: '21:00', endTime: '23:30', remindMin: 30, repeat: { freq: 'weekly', days: [2, 4] } },
    { title: 'Chiacchiere e caffè con la chat', category: 'live', date: nextWeekday(6), time: '18:30', endTime: '20:30', remindMin: 30, repeat: { freq: 'weekly', days: [6] } },
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

const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  const i = url.pathname.indexOf('/api/');
  if (url.pathname.endsWith('/calendar/demo.ics')) return new Response(toICS(agenda.events, { categories: agenda.categories }), { headers: { 'Content-Type': 'text/calendar' } });
  if (i === -1) return realFetch(input, init);
  const path = url.pathname.slice(i);
  const method = (init.method ?? 'GET').toUpperCase();
  const body = init.body ? JSON.parse(init.body) : {};
  await new Promise((r) => setTimeout(r, 40));
  try {
    if (method === 'GET' && path === '/api/state') {
      if (url.searchParams.get('rev') === String(rev)) return json(200, { rev, unchanged: true });
      return json(200, { rev, ...agenda.state(), calendarPath: '/calendar/demo.ics' });
    }
    if (method === 'PUT' && path === '/api/events') return json(200, { rev, event: agenda.saveEvent(body.event) });
    let m = /^\/api\/events\/([\w-]+)(\/occurrence)?$/.exec(path);
    if (m && method === 'POST' && m[2]) return json(200, { rev, event: agenda.saveOccurrence(m[1], body.day, body.event) });
    if (m && method === 'DELETE') return json(200, { rev, ok: agenda.deleteEvent(m[1], url.searchParams.get('only') || '') });
    if (method === 'PUT' && path === '/api/tasks') return json(200, { rev, task: agenda.saveTask(body.task) });
    m = /^\/api\/tasks\/([\w-]+)$/.exec(path);
    if (m && method === 'DELETE') return json(200, { rev, ok: agenda.deleteTask(m[1]) });
    if (method === 'PUT' && path === '/api/categories') return json(200, { rev, categories: agenda.saveCategories(body.categories) });
    return json(404, { error: 'Non disponibile nella demo' });
  } catch (err) {
    return json(err.status ?? 500, { error: err.message });
  }
};
