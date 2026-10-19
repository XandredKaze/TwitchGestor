# Howl-UP

L'agenda di Xandred Kaze: impegni di live, lavoro e vita personale, cose da fare e (presto) automatismi.
Gira sullo stesso Raspberry di TwitchGestor, si aggiorna insieme a lui e usa la stessa password.

- **Pagina:** `http://twitchgestor.local:3100` (fuori casa: l'indirizzo `100.x` di Tailscale, porta 3100).
- **Come app (telefono e PC):** i browser la installano solo da un indirizzo https. Howl-UP lo chiede a Tailscale
  (`tailscale serve`, gratis, certificato vero): `https://<raspberry>.<rete>.ts.net:8443`, dai dispositivi con
  Tailscale attivo. La prima volta Tailscale chiede di attivare i certificati https della rete (link in Altro).
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

- **Notifiche** (Altro → Notifiche):
  - 🌅 **buongiorno** all'ora e nei giorni che scegli: impegni di oggi, cose da fare (anche in ritardo), prossima live
    e com'è andata l'ultima (dal riepilogo di TwitchGestor);
  - 🗓️ **riepilogo della settimana** nel giorno e all'ora che scegli;
  - ⏰ **promemoria** prima degli impegni (quanto prima lo scegli in ogni impegno; le live 30 minuti);
  - 🔁 **ripetute finché non tocchi "✅ Ho visto"**: ogni quanto, al massimo quante volte, non di notte.
    "Ho visto" c'è nella notifica e nel riquadro "Da confermare" della schermata Oggi.
  - Arrivano con l'app gratuita **ntfy** (ti iscrivi al nome segreto che trovi in Howl-UP) e/o su **Telegram**
    con il bot di TwitchGestor (chat privata). Il pulsante "Ho visto" funziona quando il telefono raggiunge il
    Raspberry (a casa o con Tailscale attivo).

- **📣 Annunci:** quando una live viene aggiunta, spostata, annullata o cambiata (da Howl-UP o da TwitchGestor)
  compare un annuncio pronto: testo per Telegram e Discord (modificabile) e **storia Instagram** 1080×1920
  con l'estetica del canale (nero con linee topografiche, titolo a blocchi lilla e bianco, cornici bianche,
  "STAY CONNECTED", ストリーマー) e, se lo carichi, il tuo lupo. "📤 Invia con la storia" lo manda al canale Telegram (quello di TwitchGestor) e a Discord
  (webhook del canale); "⬇ Storia Instagram" scarica l'immagine da pubblicare. Facoltativo: invio automatico
  del testo dopo 5–60 minuti, fermabile. La pubblicazione automatica su Instagram (account Business) richiede
  un'app di Meta e verrà valutata più avanti.

Dati: `data/howlup/agenda.json` (nelle copie di sicurezza di TwitchGestor). Avvio a mano: `npm run howlup`.

