# Howl-UP

L'agenda di Xandred Kaze: impegni di live, lavoro e vita personale, cose da fare e (presto) automatismi.
Gira sullo stesso Raspberry di TwitchGestor, si aggiorna insieme a lui e usa la stessa password.

- **Pagina:** `http://twitchgestor.local:3100` (fuori casa: l'indirizzo `100.x` di Tailscale, porta 3100).
  Sul telefono: "Aggiungi a schermata Home" e si apre come un'app.
- **Oggi:** prossimo impegno, impegni di oggi e domani, cose da fare in scadenza, prossimi giorni.
- **Calendario:** mese con i pallini colorati per tipo; tocca un giorno per vedere e aggiungere.
- **Da fare:** in ritardo, oggi, prossimi giorni, senza scadenza; le cose fatte si tolgono da sole dopo 30 giorni.
- **Impegni:** tipo (Live, Lavoro, Personale o categorie tue), tutto il giorno o con orario, si ripete
  (ogni giorno, settimana con i giorni scelti, mese, anno, ogni N, fino al), promemoria, note.
  Per gli impegni che si ripetono puoi modificare o eliminare solo un giorno o tutta la serie.
- **Calendario del telefono:** in Altro c'è un link `.ics` da aggiungere a Google Calendar (con l'app ICSx⁵)
  o al calendario dell'iPhone: impegni e promemoria compaiono lì e si aggiornano da soli.

Dati: `data/howlup/agenda.json` (nelle copie di sicurezza di TwitchGestor). Avvio a mano: `npm run howlup`.

In arrivo: le live di TwitchGestor dentro Howl-UP (modificabili dalle due parti), buongiorno e riepiloghi
automatici, messaggi pronti per Telegram, Discord e storie Instagram.
