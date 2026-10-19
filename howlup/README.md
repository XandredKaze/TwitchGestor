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
- **Calendario del telefono:** in Altro c'è un link `.ics` da aggiungere a Google Calendar (con l'app ICSx⁵: gratis da F-Droid, a pagamento su Google Play)
  o al calendario dell'iPhone: impegni e promemoria compaiono lì e si aggiornano da soli.

- **Live di TwitchGestor:** le live della Programmazione compaiono nell'agenda (🔴 Live · 🎮 gioco · da TwitchGestor).
  Toccandone una la modifichi (giorno, ora, durata, titolo, categoria di Twitch, titolo automatico) e cambia anche
  in TwitchGestor e, se era pubblicata, sul calendario di Twitch. Una live nuova creata in Howl-UP (tipo "Live",
  una volta o ogni settimana) va direttamente nella Programmazione. Le modifiche fatte in TwitchGestor arrivano
  in Howl-UP entro 15 secondi. Le live restano salvate solo in TwitchGestor: le due app non vanno mai in disaccordo.

Dati: `data/howlup/agenda.json` (nelle copie di sicurezza di TwitchGestor). Avvio a mano: `npm run howlup`.

In arrivo: buongiorno e riepiloghi automatici, messaggi pronti per Telegram, Discord e storie Instagram.
