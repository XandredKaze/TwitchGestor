# Musicante

Scarica la musica in **MP3** da un link (anche **playlist intere**) direttamente nella musica di TwitchGestor
(`data/media/music`: ogni sottocartella è una playlist del lettore della live). Gira sullo stesso Raspberry di
TwitchGestor e Howl-UP, si aggiorna insieme a loro e usa la stessa password.

- **Pagina:** `http://twitchgestor.local:3200` (fuori casa: l'indirizzo `100.x` di Tailscale, porta 3200).
  Link anche in TwitchGestor → ⚙ Sistema e nella scheda 🎵 Musica.
- **Scarica:** incolla il link, scegli se scaricare la playlist intera e in quale cartella, guarda l'anteprima
  (titolo e brani) e premi "Scarica MP3". I download vanno uno alla volta, con l'avanzamento brano per brano;
  si possono annullare. I brani già scaricati una volta non si riscaricano (archivio in `data/musicante`).
- **Capitoli:** con "Dividi per capitoli" un video con i minutaggi nella descrizione (es. un mix di un'ora)
  diventa un MP3 per capitolo, col titolo del capitolo. L'anteprima mostra i capitoli e attiva l'opzione da sola.
- **Mai file a metà:** yt-dlp scarica e converte in `data/musicante/lavoro`; nella musica arrivano solo gli MP3
  finiti (senza sovrascrivere quelli con lo stesso nome). Mentre scarica, l'aggiornamento automatico aspetta.
- **yt-dlp:** Musicante scarica da solo la versione ufficiale per Linux (in `data/musicante/bin`) e la aggiorna
  una volta al giorno. **ffmpeg** (per gli MP3) e **python3** li installa il servizio di aggiornamento di TwitchGestor.
- In live usa solo musica che puoi trasmettere: la musica protetta può far silenziare o segnalare i video su Twitch.

Codice: `src/core/ytdlp.js` (argomenti e risposte di yt-dlp), `src/core/downloads.js` (coda), `src/tool.js`
(yt-dlp sul Raspberry), `src/index.js` (server), `public/` (pagina), `demo/` (demo senza Raspberry).
