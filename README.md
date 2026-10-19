# TwitchGestor

Gestore di notifiche per il tuo canale Twitch. Raccoglie in un unico posto tutto quello che fanno i tuoi spettatori, lo mostra in live con un overlay per OBS e ti dà una dashboard per tenere tutto sotto controllo.

| Notifica | Sorgente |
|---|---|
| Follow | Twitch |
| Nuovi abbonamenti (Tier 1/2/3, Prime) | Twitch |
| Rinnovi abbonamento (mesi, serie, messaggio) | Twitch |
| Abbonamenti regalati (anche anonimi) | Twitch |
| Bits | Twitch |
| Raid | Twitch |
| Riscatti punti canale (con testo inserito dallo spettatore) | Twitch |
| Donazioni benefiche Twitch Charity | Twitch |
| Donazioni / tips | StreamElements, Ko-fi, webhook generico |

**Funzioni principali**

- **Coda degli alert**: le notifiche vengono mostrate una alla volta, mai sovrapposte. Dalla dashboard puoi mettere in pausa, saltare, svuotare la coda o **riproporre** un alert passato.
- **Anteprima della live e chat di Twitch** direttamente nella dashboard (scheda Live).
- **Cambio scena di OBS** con un clic dalla dashboard (tramite OBS WebSocket, già incluso in OBS).
- **Stato della diretta**: qualità della connessione, bitrate con grafico, fotogrammi persi, congestione, FPS e CPU, letti da OBS.
- **Chat per OBS** (scheda 💬 Chat): la chat della live da mettere a schermo, con 3 stili, emote e badge, senza i messaggi del bot (es. Wolfery), dei comandi e quelli moderati.
- **Parole bannate** (scheda 🤖 Comandi): il bot cancella il messaggio, dà un timeout o banna chi le scrive, anche se scritte con numeri, simboli o lettere ripetute.
- **Azioni rapide** come nel Gestore stream di Twitch (scheda Live): titolo e categoria, clip, segnalibro, raid, shoutout, annuncio, sondaggi, pronostici, pubblicità e impostazioni della chat.
- **Comandi della chat** (scheda 🤖 Comandi): `!discord`, `!uptime`, `!followage`, `!so`, `!scena`… con risposte, permessi, attese, contatori e messaggi a tempo; risponde il bot (es. Wolfery).
- **Temi** (scheda 🖌 Tema): aspetto predefinito o **Brutalism** (nero, bianco e lilla) per tutta la dashboard, e stile Classico o Brutalism per l'animazione dei titoli di coda.
- **Titoli di coda animati** (credit roll) con abbonati, gift e follower scaricati in automatico, musica e pannello di controllo.
- **Editor degli alert nella dashboard** con anteprima dal vivo: testi, suoni, font, colori, sfondo, immagini e animazioni.
- **Overlay per OBS** con animazioni, colori per tipo, immagini/GIF/video e suoni (4 suoni integrati o i tuoi file).
- **Varianti**: alert diversi in base all'importo (es. donazioni sopra i 50 €, bits sopra i 1000, 10+ sub regalate) o alla ricompensa dei punti canale.
- **Filtri**: disattiva un tipo, imposta un minimo, ignora ricompense specifiche. Le sub regalate non generano un doppio alert.
- **Storico e statistiche** della sessione: conteggi, bits totali, donazioni per valuta, top donatori. Lo storico viene salvato su disco.
- **Statistiche nel tempo** (scheda 📈 Statistiche): spettatori, follower, abbonati, ore di live e chat, settimana per settimana, spiegati in parole semplici.
- **Riepilogo di fine live** (scheda 📋 Riepiloghi): tutti i riepiloghi delle live passate, con il confronto con le precedenti.
- **Telegram** (gratis): riepiloghi e avvisi importanti in privato (raid, donazioni, bits, problemi di connessione) e un **canale per la community** con "in live!", promemoria, programmazione della settimana e saluto di fine live.
- **Programmazione delle live** (scheda 📅 Programmazione): le live in programma, titolo e categoria impostati da soli poco prima, calendario di Twitch e immagine della settimana da condividere.
- **Accesso da fuori casa** (sul Raspberry, ⚙ Sistema): apri la dashboard da telefono o portatile ovunque tu sia, con Tailscale (gratis, nessuna porta aperta sul router).
- **Goal** (scheda 🎯 Goal): la barra dell'obiettivo in live (abbonati, follower, bits o donazioni), con percentuale facoltativa; si aggiorna da sola.
- **Musica** (scheda 🎵 Musica): la musica di sottofondo con playlist, suonata da OBS e comandata dalla dashboard; si abbassa da sola durante gli alert. Sul Raspberry c'è una **cartella condivisa** per copiarci musica, immagini e suoni dal PC.
- **Ringraziamenti automatici in chat** (facoltativi) con testi personalizzabili, scritti dal tuo account o da un **account bot** (es. Wolfery).
- **Anti-duplicati**, riconnessione automatica a Twitch, rinnovo automatico del token.
- Le modifiche valgono **subito**, anche durante la live.
- Funziona **senza finestre** e può partire e spegnersi insieme a OBS.

## Provarlo senza installare nulla

C'è una **versione demo** che gira interamente nel browser: dashboard, editor degli alert con anteprima, overlay, titoli di coda con nomi di prova, alert di prova e una **live simulata** (eventi e chat finti). Non si collega a Twitch e le impostazioni restano solo nel browser che la apre.

La demo si ricostruisce dal codice con `npm run build:demo` (i file finiscono in `dist-demo/`).

## Requisiti

- [Node.js](https://nodejs.org/) 20.12 o superiore
- Un'applicazione Twitch (gratuita), per il collegamento al tuo canale

## Installazione

```bash
git clone https://github.com/XandredKaze/TwitchGestor.git
cd TwitchGestor
npm install
cp .env.example .env
```

### 1. Crea l'applicazione Twitch

1. Vai su <https://dev.twitch.tv/console/apps> e clicca **Registra la tua applicazione**.
2. **OAuth Redirect URL**: `http://localhost:3000/auth/callback`
3. **Categoria**: *Broadcaster Suite*. **Tipo di client**: *Riservato*.
4. Copia **ID client** e **Segreto client** nel file `.env` (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`).

### 2. Avvia

```bash
npm start
```

Apri <http://localhost:3000/dashboard>, clicca **Accedi con Twitch** e autorizza l'app con l'account del tuo canale. Da quel momento le notifiche arrivano in tempo reale (non serve aprire porte sul router: la connessione con Twitch è in uscita via WebSocket).

> Abbonamenti e bits sono disponibili solo per canali **Affiliate** o **Partner**; se il tuo canale non lo è ancora, la dashboard ti segnala quali eventi non sono attivi.

### Avvio senza finestre (Windows)

- **`Avvia TwitchGestor.vbs`** (doppio clic): avvia il programma in background, **senza nessuna finestra**, e apre la dashboard. La prima volta mostra una finestra solo per l'installazione.
- **`Avvia.bat`**: stessa cosa ma con la finestra dei messaggi visibile (utile se qualcosa non va).
- Per **spegnerlo**: pulsante **⏻ Spegni** in alto a destra nella dashboard, oppure chiudi OBS se usi lo script qui sotto.
- I messaggi del programma sono nella dashboard (scheda Live → **Registro del programma**) e nel file `data/twitchgestor.log`.

### Avvio automatico insieme a OBS (Windows)

1. In OBS apri **Strumenti → Script**.
2. Clicca **+** e scegli il file `obs/twitchgestor.lua` dentro la cartella del programma.

Da quel momento TwitchGestor parte da solo, senza finestre, quando apri OBS e si spegne quando chiudi OBS. Dopo l'avvio lo script ricarica l'overlay, così si collega anche se OBS lo ha aperto prima che il programma fosse pronto. Nel pannello dello script puoi cambiare la cartella, mostrare la finestra dei messaggi e usare i pulsanti **Avvia ora**, **Ricarica overlay** e **Spegni**.

### 3. Aggiungi l'overlay in OBS

1. In OBS: **Fonti → + → Browser**.
2. URL: `http://localhost:3000/overlay` — larghezza 1920, altezza 1080.
3. Spunta **Controlla l'audio tramite OBS** per regolare il volume degli alert dal mixer.

Usa i pulsanti **Prova gli alert** nella dashboard per vedere subito come appaiono.

## Howl-UP (agenda)

Sul Raspberry, accanto a TwitchGestor, c'è anche **Howl-UP**: l'agenda per live, lavoro e vita personale, pensata per il telefono. Si apre su `http://twitchgestor.local:3100` (o da **⚙ Sistema → Howl-UP**), usa la stessa password e si aggiorna insieme a TwitchGestor. Dettagli: [howlup/README.md](howlup/README.md).

## Su Raspberry Pi (sempre acceso, aggiornamenti automatici)

TwitchGestor può stare su un Raspberry Pi (dal 3 in su). Così bot, comandi, parole bannate e shoutout funzionano anche a PC spento, e la dashboard si apre da ogni dispositivo di casa. Si installa con un solo comando. Impostazioni e accessi si portano dal PC con **⚙ Sistema → Esporta / Importa**, e gli aggiornamenti arrivano da soli appena escono (controllo ogni 5 minuti, mai durante la live), con copia di sicurezza e ritorno automatico alla versione precedente se qualcosa non va. Guida passo passo: [docs/RASPBERRY.md](docs/RASPBERRY.md).

## Anteprima della live e chat

Nella scheda **📡 Live** della dashboard trovi il player della tua live (senza audio, per evitare l'eco) e la chat di Twitch, accanto a coda, statistiche e notifiche. Il canale è quello con cui hai fatto l'accesso; se non l'hai ancora fatto puoi scriverne il nome.

- Apri la dashboard da **`http://localhost:3000`**: Twitch mostra player e chat solo su `localhost` (non su `127.0.0.1`). Sul Raspberry la dashboard ha anche un indirizzo https (`https://twitchgestor.local`): dopo aver installato una volta il suo certificato sul PC, player e chat di Twitch funzionano come in locale (vedi [docs/RASPBERRY.md](docs/RASPBERRY.md)).
- Per scrivere in chat devi essere collegato a twitch.tv nello stesso browser; se il riquadro non te lo permette usa **Finestra ↗**.
- Con **Nascondi** togli player o chat e risparmi risorse del PC durante la live.
- La chat si adatta all'altezza della finestra. Per sceglierla tu, **trascina la maniglia** sotto la chat (o usala con le frecce ↑ ↓ della tastiera); doppio clic sulla maniglia per tornare all'altezza automatica. Ogni PC o browser ricorda la sua.

## Chat per OBS

Nella scheda **💬 Chat** prepari la chat della live da mettere a schermo. In OBS aggiungi una **Sorgente browser** con l'indirizzo `http://localhost:3000/chat` (es. 450×700; lo sfondo è trasparente).

- **Stile**: *Classico* (nome colorato e testo), *Riquadri* (ogni messaggio nel suo riquadro, nome sopra) o *Brutalism* (come il tema); entrata dei messaggi, allineamento, messaggi nuovi in alto o in basso.
- **Testo**: font, dimensione, colori (nomi con il colore scelto su Twitch o tutti uguali), ombra, badge (abbonato, moderatore, VIP…) ed emote come su Twitch.
- **Sfondo e durata**: colore e opacità dello sfondo dei messaggi, quanti messaggi restano a schermo e dopo quanto spariscono.
- **Cosa non mostrare**: i messaggi del **bot** (es. Wolfery: ringraziamenti, risposte ai comandi, avvisi) sono nascosti, come i **comandi** (`!…`) e gli account che scegli (Nightbot, StreamElements… già in elenco). I messaggi con **parole bannate** non compaiono, e quelli cancellati da un moderatore o di chi riceve un timeout/ban spariscono anche dallo schermo.

Le modifiche si salvano da sole e arrivano subito in OBS; l'anteprima mostra messaggi di prova.

## Parole bannate

Nella scheda **🤖 Comandi**, riquadro **Parole bannate**, scrivi le parole (o frasi) da non permettere in chat e per ognuna scegli cosa fa il bot:

- **cancella il messaggio**, **timeout** (da 10 secondi a 1 settimana) o **ban**;
- **anche dentro altre parole**: la trova anche attaccata ad altre parole e con spazi tra le lettere (`p a r o l a`);
- con `*` alla fine prende tutte le parole che iniziano così (es. `idiot*`).

Il bot non si lascia ingannare da maiuscole, accenti, numeri e simboli al posto delle lettere (`5tup1d0`, `$tupido`) e lettere ripetute (`stuuupido`). Tu e i moderatori non venite mai moderati; puoi escludere anche VIP e abbonati. Puoi scrivere un **avviso in chat** (`{user}` e `{action}`), **provare** un messaggio prima e vedere nel **registro** cosa ha fatto il bot, con **Annulla** per togliere un timeout o un ban.

Il bot deve essere **moderatore del canale** (scrivi `/mod NomeDelBot` nella tua chat) e la prima volta va **ricollegato** per i nuovi permessi (Personalizza alert → Impostazioni generali → Chat). Senza bot modera il tuo account.

## Azioni rapide

Nella scheda **📡 Live**, tra l'anteprima della live e la coda degli alert, ci sono le **Azioni rapide** del Gestore stream di Twitch:

- **Titolo e categoria** (con ricerca della categoria), **Crea clip** (con il link per modificarla), **Segnalibro** nel video;
- **Raid** (Twitch lo fa partire dopo circa 90 secondi, si può annullare), **Shoutout** ufficiale, **Annuncio** colorato in chat;
- **Sondaggio** e **Pronostico**: li crei, vedi voti e puntate, li chiudi o scegli il risultato vincente;
- **Pubblicità** (30–180 secondi);
- chat: **Solo emote**, **Solo follower** (con il tempo minimo), **Solo abbonati**, **Modalità lenta**, **Messaggi unici**, **Modalità scudo**, **Svuota chat** (doppio clic per sicurezza). Gli interruttori mostrano se sono attivi.

Con **⚙ Personalizza** scegli quali azioni mostrare. La prima volta servono nuovi permessi: **Esci** e **Accedi con Twitch**. Pubblicità, sondaggi, pronostici e clip Twitch li permette solo ai canali affiliate o partner.

## Storico dei titoli

TwitchGestor segna ogni live: data, ora, durata, titolo e categoria, compresi i cambi fatti durante la diretta. In **Azioni rapide → Titolo e categoria** trovi i **titoli usati nelle live**: un clic li rimette insieme alla loro categoria, poi premi **Salva**. Con **📜 Storico delle live** vedi l'elenco completo. Lo storico sta in `data/titles.json`.

## Statistiche nel tempo

La scheda **📈 Statistiche** raccoglie i dati di ogni live (da quando usi questa versione): media e picco di spettatori, follower e abbonati guadagnati, ore in diretta, messaggi in chat e chi scrive di più. Scegli il periodo (4 settimane, 3 mesi, 1 anno, tutto); ogni numero ha una frase che spiega cosa vuol dire. I dati stanno in `data/livestats.json`.

## Riepilogo di fine live

Quando la live finisce TwitchGestor prepara il **riepilogo**: durata, spettatori, nuovi follower, abbonamenti, bits, donazioni, raid, chat, titoli usati e il confronto con le live precedenti. Li trovi tutti nella scheda **📋 Riepiloghi**.

## Telegram: chat privata e canale

Nella scheda **📋 Riepiloghi → Telegram** colleghi un bot gratuito (creato con @BotFather). Scrive in due posti, ognuno con i suoi interruttori:

- **🔒 Chat privata** (solo per te; scrivi `/start` al bot e premi **Trova la chat**): riepilogo a fine live, avviso di inizio live, raid, donazioni e bits sopra la soglia che scegli, problemi di connessione durante la live (da OBS: connessione pessima o disconnessa per più di 20 secondi).
- **📣 Canale pubblico** (per la community; aggiungi il bot come amministratore del canale, pubblica un messaggio e premi **Trova il canale**):
  - 🔴 "in live!" quando inizi (con titolo, categoria e link);
  - ⏰ promemoria N minuti prima di una live in programma (scheda 📅 Programmazione);
  - 📅 programmazione della settimana nel giorno e all'ora che scegli;
  - 💜 saluto a fine live con la prossima live.

I testi del canale si personalizzano con le variabili (`{channel}`, `{title}`, `{game}`, `{link}`, `{minutes}`, `{when}`, `{list}`, `{next}`) e si provano con **✉ Prova sul canale**. Dalla scheda Programmazione, **📣 Manda al canale Telegram** pubblica l'immagine della settimana.

## Programmazione delle live

Nella scheda **📅 Programmazione** scrivi le prossime live (giorno, ora, durata, titolo, categoria) oppure le crei per **più settimane in un colpo** (es. martedì e giovedì alle 21 per 4 settimane). Per ogni live puoi far impostare **titolo e categoria da soli 10 minuti prima**. Con **Calendario di Twitch** le pubblichi sul tuo canale (la prima volta serve un permesso in più: **Esci** e **Accedi con Twitch**) e con **Immagine della settimana** scarichi un'immagine pronta per social e Discord. In chat `{nextlive}` dice quando è la prossima live (es. un comando `!prossima`).

## Goal

Nella scheda **🎯 Goal** crei le barre degli obiettivi da mettere in live (anche più di una):

- **Cosa conta**: abbonati, follower, bits o donazioni.
- **Abbonati e follower**: il totale del canale (letto da Twitch ogni 2 minuti e subito dopo ogni follow/sub) oppure **solo i nuovi** da quando premi **Azzera**.
- **Bits e donazioni**: la somma da quando premi **Azzera**.
- Scritta (es. `SUB GOAL`), obiettivo e **percentuale visibile o no**; i pulsanti **−/+** correggono il numero a mano.

In OBS aggiungi una **Sorgente browser** con l'indirizzo del goal (es. `http://localhost:3000/goal?id=sub`), larga 1800 × 260 (o 900 × 130: si adatta alla larghezza). Il font Nunito è incluso in TwitchGestor.

## Musica

La scheda **🎵 Musica** gestisce la musica di sottofondo. La musica sono **file audio** (mp3, ogg, m4a, flac, wav) nella cartella `data/media/music`: ogni **sottocartella è una playlist** (es. `Chill`, `Gaming`). Un brano mp3 occupa 3–5 MB: 500 brani stanno in 2–3 GB.

1. In OBS aggiungi una **Sorgente browser** con `http://localhost:3000/music` (sul Raspberry con il suo indirizzo) e spunta **Controlla l'audio tramite OBS**: la musica va in live e la regoli dal mixer.
2. Carica i brani dalla scheda Musica (**Aggiungi brani**) oppure copiali nella cartella.
3. Dalla scheda scegli playlist e brano, ⏮ ⏯ ⏭, volume e ordine casuale.

Facoltativo: `http://localhost:3000/music?widget` è un riquadro "in riproduzione" da mettere a schermo (`&style=brutal` per lo stile brutalista). Durante gli alert la musica si abbassa da sola (si regola in "Durante gli alert"). In chat `{song}` dice il brano che sta suonando (es. un comando `!song`). Usa musica di cui hai i diritti: quella protetta può far silenziare i VOD su Twitch.

## Comandi della chat

Nella scheda **🤖 Comandi** crei i comandi che gli spettatori scrivono in chat con il "!" (es. `!discord`): TwitchGestor legge la chat con il tuo account e risponde con il bot (es. Wolfery), oppure con il tuo account se il bot non è collegato.

1. **La prima volta** serve un permesso Twitch in più per leggere la chat: in alto a destra clicca **Esci** e poi **Accedi con Twitch** (Wolfery non va ricollegato).
2. Accendi l'interruttore **Attivi** e premi **Salva**.

Per ogni comando scegli:
- **nome** e **nomi alternativi** (es. `!discord` e `!dc`);
- **cosa fa**: risponde con un testo, elenca i comandi, **cambia scena di OBS** (`!scena gioco`, basta l'inizio del nome) o **fa ripartire i titoli di coda**;
- **chi può usarlo**: tutti, abbonati, VIP, moderatori o solo tu;
- **attese**: tra un uso e l'altro e per lo stesso spettatore (tu e i moderatori non avete attese);
- la **risposta**, con le variabili: `{user}` chi scrive, `{target}` il nome dopo il comando (es. `!so @nome`), `{args}`, `{1}`…`{9}`, `{channel}`, `{uptime}`, `{followage}`, `{game}`, `{title}`, `{lastfollow}`, `{nextlive}` (la prossima live in programma), `{song}` (il brano che sta suonando), `{count}` (quante volte è stato usato: salvato in `data/command-counts.json`), `{random:1-100}`, `{scene}`, `{result}`.

Ci sono già alcuni comandi pronti (`!comandi`, `!uptime`, `!followage`, `!social`, `!discord`, `!so`, `!scena`, `!titoli`) da modificare a piacere. Con **Prova un comando** vedi la risposta senza scrivere in chat. I **messaggi a tempo** il bot li scrive da solo ogni N minuti, ma solo se in chat sono stati scritti abbastanza messaggi.

## Stato della diretta (connessione e bitrate)

Con OBS collegato (vedi sopra), nella scheda **📡 Live** il riquadro **Stato della diretta** mostra, aggiornati ogni 2 secondi:

- **qualità della connessione** (ottima, buona, instabile, pessima, riconnessione) con le tacche del segnale e un consiglio quando qualcosa non va;
- **bitrate** in kbps con il grafico degli ultimi 3 minuti (passa il mouse sul grafico per vedere i valori);
- **fotogrammi persi per la rete** (negli ultimi secondi e in totale), **congestione**, **FPS** e **CPU** di OBS;
- da quanto sei **in diretta**: conta dal momento in cui Twitch ti mette in live (come il contatore di Twitch), non da quando OBS inizia a trasmettere. Nei primi secondi, quando OBS trasmette ma Twitch non ti mostra ancora in live, lo dice.

Durante la diretta in alto, accanto al nome, compare anche **LIVE · bitrate · connessione**, sempre visibile da qualsiasi scheda.

## Temi

Nella scheda **🖌 Tema** scegli con un clic:

- **Aspetto di TwitchGestor**: *Predefinito* (viola, segue il tema chiaro o scuro di Windows) oppure *Brutalism* in stile retro-computer: nero carbone con grana, linee bianche sottili, finestre "// TITOLO" con _ ▢ ✕, quadratini e croci, accento lilla; titoli in Bungee, etichette in Share Tech Mono, testi in Outfit. Vale per dashboard, editor degli alert e pannello dei titoli di coda, anche nel dock di OBS e su ogni browser con cui apri la dashboard.
- **Animazione dei titoli di coda**: *Classico* oppure *Brutalism* (titolo iniziale e testo finale a blocchi con la prima parola in lilla, titoli delle sezioni e sottotitoli come "▢ SUBSCRIBERS ────", senza riquadri). Con Brutalism colori e font scelti nel pannello non si usano. Si sceglie anche nel pannello dei titoli di coda (riquadro Stile), con l'anteprima.

Gli alert in live non cambiano con il tema: si personalizzano in "Personalizza alert".

## Cambiare scena di OBS

Nella scheda **📡 Live** il riquadro **Scene OBS** mostra tutte le tue scene: quella in onda è rossa, clicca su un'altra per mandarla in onda. La lista si aggiorna da sola se aggiungi, rinomini o cambi scena da OBS.

Serve una sola configurazione:

1. In OBS (versione 28 o successiva) apri **Strumenti → Impostazioni server WebSocket** e spunta **Abilita server WebSocket**.
2. Premi **Mostra informazioni di connessione** e copia la password.
3. Nella dashboard clicca **⚙ Collegamento** nel riquadro Scene OBS, incolla la password (la porta di solito è 4455) e premi **Salva e collega**.

Il collegamento resta su questo PC; la password è salvata solo in `data/obs.json`. Se OBS è chiuso TwitchGestor riprova da solo finché non lo riapri. In alto, il pallino **OBS** dice se è collegato.

## Titoli di coda (credit roll)

Titoli di coda animati per la fine della live con **abbonati** (paganti e regalati), **chi ha regalato sub** (con badge dorato al Top Gifter) e **follower**. I nomi li scarica TwitchGestor con l'account del canale: all'avvio, ogni N minuti e poco dopo ogni follow, sub o gift ricevuto in live.

1. In OBS, nella scena dei titoli di coda: **+ → Browser**, URL `http://localhost:3000/credits`, 1920×1080, spunta **Controlla l'audio tramite OBS** (per la musica). I titoli **ripartono da capo da soli quando la scena va in onda** e si fermano (musica compresa) quando esce: si può disattivare nel riquadro Animazione.
2. Si configurano dalla scheda **🎬 Titoli di coda** della dashboard: testi, categorie, velocità, zona di comparsa dei nomi, colori, font, particelle, musica (trascina il brano), nomi da escludere (es. i bot), nomi di prova e anteprima. In più:
   - **Sezioni**: ordine con le frecce ↑↓, **sezioni tue** con testo libero e, per ogni sezione, **stile proprio** (colori, font, dimensioni, colonne, allineamento) e un'**icona** accanto ai nomi. I nomi di una sezione aggiunta possono venire da:
     - **nomi scritti a mano**;
     - **Twitch**: abbonati Tier 1 / Tier 2 / Tier 3 (i Prime contano come Tier 1), moderatori, VIP, classifica bits (oggi, settimana, mese, anno, sempre), chi era in chat (controllato ogni 5 minuti, ultime 12 ore);
     - **questa live** (eventi ricevuti da TwitchGestor dall'inizio della live, o nelle ultime 12 ore): nuovi follower, nuovi abbonati, rinnovi, chi ha regalato sub, chi ha inviato bits, chi ha donato, chi ha fatto raid, chi ha riscattato premi (anche un premio preciso). Con la quantità accanto al nome, se vuoi.

     Moderatori, VIP e chat richiedono permessi Twitch aggiuntivi: dopo l'aggiornamento esci e accedi di nuovo dalla dashboard.
   - **Immagini e sfondo**: logo in cima, immagine finale, immagine o video di sfondo (opacità, adattamento, sfocatura), particelle con colore, forma (luci, stelle, cuori, neve), quantità e velocità.
   - **Nomi**: allineamento, spaziatura, spessore, maiuscolo, spaziatura delle lettere ed **effetto di comparsa** (dissolvenza, sale dal basso, zoom, scivola, bagliore).
   - **Fine dello scorrimento**: ricomincia da capo oppure **si ferma con il testo finale a metà schermo**. La **distanza del testo finale dai nomi** si sceglie in Testi (es. 500 px per farlo arrivare da solo).
   - **Musica che continua**: con "Continua la musica quando lo scorrimento finisce" il brano non sfuma e non si ferma alla fine dei titoli (e con "Ricomincia da capo" non riparte da zero a ogni giro).
   - **Font**: selettore con oltre 200 font di Google Fonts (con anteprima, ricerca e categorie: moderni, eleganti, decorativi, scritti a mano, monospazio, di sistema), per i font generali e per ogni sezione; qualsiasi altro font si aggiunge scrivendone il nome.
3. Facoltativo: il pannello si può aggiungere anche come dock di OBS (**Docks → Dock browser personalizzati**, URL `http://localhost:3000/credits?pannello`; se usi `DASHBOARD_TOKEN` aggiungi `&token=IL_TUO_TOKEN`).

L'elenco abbonati è disponibile solo per canali affiliate o partner: se non si scarica, l'errore compare nel pannello e i follower funzionano comunque.

**Arrivi dal vecchio progetto Credit Roll?** Non servono più `server.js`, `credit-roll.lua` né il Client ID a parte: togli `credit-roll.lua` da OBS (Strumenti → Script → –). Per tenere impostazioni e nomi esclusi copia il vecchio `state.json` in `data/credits.json` (a TwitchGestor spento); i vecchi token vengono ignorati. Il brano va ricaricato dal pannello.

## Ringraziamenti in chat con un account bot

1. Dashboard → **🎨 Personalizza alert → ⚙️ Impostazioni generali → Chat**: attiva i ringraziamenti.
2. Clicca **🤖 Collega account bot**. Su Twitch, se compare il tuo account, clicca **"Non sei tu?"** e accedi con l'account del bot (oppure apri il link in una finestra in incognito).
3. Consigliato: rendi il bot moderatore scrivendo in chat `/mod NomeDelBot`.

Il testo del messaggio si imposta in ogni alert (sezione **Messaggio in chat**). Se il bot non è collegato, scrive il tuo account. Gli alert di prova non scrivono in chat.

## Donazioni

### StreamElements
Copia il **JWT Token** (StreamElements → Account → Channels → *Show secrets*) in `STREAMELEMENTS_JWT`.

### Ko-fi
1. Imposta `KOFI_VERIFICATION_TOKEN` con il token che trovi in Ko-fi → Settings → API.
2. In Ko-fi imposta come webhook `https://<il-tuo-indirizzo-pubblico>/webhooks/kofi`.

Ko-fi deve poter raggiungere il tuo PC: usa un tunnel come [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) o [ngrok](https://ngrok.com/) e imposta `PUBLIC_URL` di conseguenza. Le donazioni private di Ko-fi vengono mostrate come anonime e senza messaggio.

### Webhook generico (PayPal, Streamlabs, Zapier, IFTTT…)
Imposta `DONATION_WEBHOOK_SECRET` e invia:

```bash
curl -X POST http://localhost:3000/webhooks/donation \
  -H "x-webhook-secret: IL_TUO_SEGRETO" \
  -H "content-type: application/json" \
  -d '{"name":"Mario","amount":5,"currency":"EUR","message":"Grande!","id":"facoltativo-per-evitare-duplicati"}'
```

## Personalizzazione

### Dalla dashboard (consigliato)

Apri la scheda **🎨 Personalizza alert**: per ogni tipo di notifica puoi cambiare testi, **suono** (7 integrati o i tuoi MP3/OGG/WAV), **font** (Google Fonts o di sistema), dimensione, **colori**, **sfondo** e trasparenza, **immagine/GIF/video**, **animazione** (10 tipi), durata, messaggio in chat e **alert speciali per importo o ricompensa**.

**Stile ERRORE_DI_SISTEMA** (predefinito, grafica di un amico di Xandred): finestre di errore rosse a cascata che con un glitch diventano l'alert; nelle scene di gioco (il nome contiene una parola scelta, es. *game*) una barra in alto più corta. Se cambi scena durante un alert, continua nell'altro layout per il tempo che resta. Testi (flavour text, titolo normale e in-game, messaggio, valore in grassetto), icona e colore si cambiano per ogni alert; colori, sfondo a bit, effetti, tempi e misure in Impostazioni generali, con le prove "normale" e "in-game". In OBS usa **un'unica Sorgente browser** dell'overlay condivisa tra le scene (nelle altre scene: Aggiungi → Sorgente browser → *Aggiungi esistente*).
L'anteprima si aggiorna mentre modifichi; **Prova in OBS** manda l'alert all'overlay anche prima di salvare. In **Impostazioni generali** scegli posizione sullo schermo e stile comune a tutti gli alert.

I file che carichi finiscono in `data/media/`. Le impostazioni vengono salvate in `config/config.json`: quando aggiorni il programma copia le cartelle `data` e `config/config.json` insieme al file `.env`.

### A mano

I valori predefiniti sono tra i file del programma (`src/core/defaults.json`, da non modificare). Le tue impostazioni stanno in `config/config.json`, che contiene solo quello che hai cambiato. Esempio (vedi anche `config/config.example.json`):

```json
{
  "overlay": { "position": "bottom-right", "font": "Bangers" },
  "chat": { "enabled": true },
  "types": {
    "follow": { "sound": "media/sounds/follow.mp3", "image": "media/images/follow.gif", "animation": "bounce" },
    "cheer": { "minAmount": 100 },
    "redemption": { "ignoreRewards": ["Evidenzia il mio messaggio"] },
    "donation": {
      "variants": [
        { "minAmount": 20, "title": "Grazie di cuore! 💚" },
        { "minAmount": 100, "title": "LEGGENDARIO! 👑", "sound": "fanfare", "duration": 15000 }
      ]
    }
  }
}
```

### Opzioni per ogni tipo di notifica

| Chiave | Significato |
|---|---|
| `enabled` | `false` = ignora del tutto questo tipo |
| `alert` | `false` = registra nello storico ma non mostra l'alert |
| `minAmount` | importo minimo per mostrare l'alert (bits, spettatori del raid, importo donazione…) |
| `duration` | durata dell'alert in millisecondi |
| `sound` | `chime`, `coin`, `pop`, `fanfare`, `bell`, `levelup`, `laser`, un file caricato (`media/sounds/...`) o un URL; vuoto = nessun suono |
| `volume` | da `0` a `1` |
| `image` | immagine, GIF o video (`.webm`/`.mp4`) caricato (`media/images/...`) o URL |
| `color` | colore del bordo e del titolo |
| `textColor`, `background`, `backgroundOpacity` | colore del testo, colore e opacità (0–1) dello sfondo |
| `font`, `fontSize` | nome del font e dimensione del testo in pixel |
| `animation` | `pop`, `fade`, `slide-down`, `slide-up`, `slide-left`, `slide-right`, `zoom`, `bounce`, `flip`, `shake` |
| `title`, `text` | testi dell'alert (vedi segnaposto sotto) |
| `showMessage` | mostra il messaggio dello spettatore |
| `chatReply` | messaggio in chat (serve `"chat": { "enabled": true }`); vuoto = nessun messaggio |
| `variants` | elenco di sostituzioni con `minAmount`, `maxAmount` e/o `reward` (nome ricompensa). Vince la più specifica |
| `ignoreGifted` | *(solo `sub`)* non mostrare le singole sub regalate (default `true`, c'è già l'alert del regalo) |
| `ignoreRewards` | *(solo `redemption`)* ricompense da non mostrare |

**Segnaposto nei testi**: `{user}` `{login}` `{amount}` `{amountFormatted}` `{currency}` `{tier}` `{months}` `{streak}` `{message}` `{reward}` `{cost}` `{source}`.
Plurale: `{amount|o|i}` scrive `o` se l'importo è 1, altrimenti `i` (es. `abbonament{amount|o|i}`).

**Posizioni overlay**: `top-left`, `top-center`, `top-right`, `center`, `bottom-left`, `bottom-center`, `bottom-right`.

## Se qualcosa non funziona

- In alto accanto a "TwitchGestor" c'è la **versione** del programma acceso. Se compare la fascia rossa **"Serve un riavvio"**, il programma acceso è più vecchio delle pagine: clicca **⏻ Spegni**, riapri OBS (o "Avvia TwitchGestor.vbs") e ricarica con Ctrl+F5.
- Se la pagina ha un errore compare un **riquadro rosso** con il dettaglio e il pulsante **Copia**: incollalo a chi ti aiuta.
- **Scene OBS "password errata"**: ricopia la password da OBS (Strumenti → Impostazioni server WebSocket → Mostra informazioni di connessione). **"non raggiungibile"**: OBS è chiuso oppure il server WebSocket non è abilitato.
- I messaggi del programma sono in **Live → Registro del programma** e in `data/twitchgestor.log`.

## Sicurezza

- Il server ascolta solo su `127.0.0.1` (questo PC) e rifiuta i comandi che arrivano da altri siti web aperti nel browser. Se lo esponi in rete o su Internet, imposta `DASHBOARD_TOKEN` e apri la dashboard con `/dashboard?token=IL_TUO_TOKEN`.
- I token Twitch sono salvati in `data/tokens.json`: non condividere quella cartella.

## Sviluppo

```bash
npm test            # test automatici
npm run dev         # riavvio automatico quando modifichi il codice
npm run build:demo  # versione demo per il browser, in dist-demo/
```

Per simulare eventi Twitch reali puoi usare la [Twitch CLI](https://dev.twitch.tv/docs/cli/): avvia `twitch event websocket start-server` e imposta `EVENTSUB_WS_URL` / `EVENTSUB_API_URL` nel `.env`.

```
src/
  index.js                     avvio e collegamento dei moduli
  server.js                    HTTP, API della dashboard, webhook, WebSocket
  config.js                    caricamento e ricarica della configurazione
  core/normalize.js            converte ogni sorgente in un formato unico
  core/NotificationManager.js  filtri, coda, storico, statistiche
  core/templates.js            testi con segnaposto
  twitch/                      accesso OAuth, API Helix, EventSub
  sources/                     StreamElements, Ko-fi, webhook generico
  credits.js                   titoli di coda: stato condiviso e download da Twitch
public/                        overlay, dashboard e titoli di coda (credits.html)
demo/                          "server finto" della versione demo (usa il codice vero di src/core)
```
