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
- **Voce (text-to-speech)** gratuita e locale: legge gli alert e i messaggi degli spettatori con le voci di Windows, e la voce va in live tramite OBS.
- **Anteprima della live e chat di Twitch** direttamente nella dashboard (scheda Live).
- **Cambio scena di OBS** con un clic dalla dashboard (tramite OBS WebSocket, già incluso in OBS).
- **Titoli di coda animati** (credit roll) con abbonati, gift e follower scaricati in automatico, musica e pannello di controllo.
- **Editor degli alert nella dashboard** con anteprima dal vivo: testi, suoni, font, colori, sfondo, immagini e animazioni.
- **Overlay per OBS** con animazioni, colori per tipo, immagini/GIF/video e suoni (4 suoni integrati o i tuoi file).
- **Varianti**: alert diversi in base all'importo (es. donazioni sopra i 50 €, bits sopra i 1000, 10+ sub regalate) o alla ricompensa dei punti canale.
- **Filtri**: disattiva un tipo, imposta un minimo, ignora ricompense specifiche. Le sub regalate non generano un doppio alert.
- **Storico e statistiche** della sessione: conteggi, bits totali, donazioni per valuta, top donatori. Lo storico viene salvato su disco.
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

## Anteprima della live e chat

Nella scheda **📡 Live** della dashboard trovi il player della tua live (senza audio, per evitare l'eco) e la chat di Twitch, accanto a coda, statistiche e notifiche. Il canale è quello con cui hai fatto l'accesso; se non l'hai ancora fatto puoi scriverne il nome.

- Apri la dashboard da **`http://localhost:3000`**: Twitch mostra player e chat solo su `localhost` (non su `127.0.0.1`).
- Per scrivere in chat devi essere collegato a twitch.tv nello stesso browser; se il riquadro non te lo permette usa **Finestra ↗**.
- Con **Nascondi** togli player o chat e risparmi risorse del PC durante la live.
- La chat si adatta all'altezza della finestra. Per sceglierla tu, **trascina la maniglia** sotto la chat (o usala con le frecce ↑ ↓ della tastiera); doppio clic sulla maniglia per tornare all'altezza automatica. Ogni PC o browser ricorda la sua.

## Cambiare scena di OBS

Nella scheda **📡 Live** il riquadro **Scene OBS** mostra tutte le tue scene: quella in onda è rossa, clicca su un'altra per mandarla in onda. La lista si aggiorna da sola se aggiungi, rinomini o cambi scena da OBS.

Serve una sola configurazione:

1. In OBS (versione 28 o successiva) apri **Strumenti → Impostazioni server WebSocket** e spunta **Abilita server WebSocket**.
2. Premi **Mostra informazioni di connessione** e copia la password.
3. Nella dashboard clicca **⚙ Collegamento** nel riquadro Scene OBS, incolla la password (la porta di solito è 4455) e premi **Salva e collega**.

Il collegamento resta su questo PC; la password è salvata solo in `data/obs.json`. Se OBS è chiuso TwitchGestor riprova da solo finché non lo riapri. In alto, il pallino **OBS** dice se è collegato.

## Voce (text-to-speech)

TwitchGestor può leggere ad alta voce gli alert, per esempio "Mario ha donato 5 €. Continua così!". È gratuito e funziona senza Internet. L'audio viene creato dal programma e suonato dall'overlay, quindi **va in live tramite OBS** come gli altri suoni. Voci disponibili:

- **Voci di Windows**, classiche (es. "Microsoft Elsa Desktop") e moderne (es. "Microsoft Cosimo", "Microsoft Elsa" e quelle aggiunte da *Impostazioni → Ora e lingua → Voce → Aggiungi voci*; poi riavvia TwitchGestor).
- **Voci naturali Piper** (open source): in *Impostazioni generali → Voce* clicca **⬇ Scarica** accanto a **Paola** (femminile) o **Riccardo** (maschile). Il programma Piper (circa 20 MB) e la voce si scaricano una volta sola in `data/piper/`, poi funzionano senza Internet. Altre voci Piper (file `.onnx` + `.onnx.json` dal catalogo [piper-voices](https://huggingface.co/rhasspy/piper-voices)) si possono copiare a mano in `data/piper/voices/`.

1. Dashboard → **🎨 Personalizza alert → ⚙️ Impostazioni generali → Voce**: attiva la voce e scegli voce, velocità, volume, lunghezza massima e **parole vietate** (lette come "bip"). I link non vengono letti.
2. In ogni alert, sezione **Voce**: attiva "Leggi ad alta voce" e scegli il testo da leggere (con i segnaposto, es. `{user} ha donato {amountFormatted}. {message}`). **▶ Ascolta con dati di prova** ti fa sentire il risultato.
3. Per leggere solo sopra una soglia (es. bits da 100 in su) o solo per un premio dei punti canale (es. "Leggi il mio messaggio"), usa la voce negli **alert speciali**.

Su Linux funzionano Piper ed `espeak-ng` (se installato); senza nessuna voce viene usata quella del browser, che però dentro OBS non si sente.

## Titoli di coda (credit roll)

Titoli di coda animati per la fine della live con **abbonati** (paganti e regalati), **chi ha regalato sub** (con badge dorato al Top Gifter) e **follower**. I nomi li scarica TwitchGestor con l'account del canale: all'avvio, ogni N minuti e poco dopo ogni follow, sub o gift ricevuto in live.

1. In OBS, nella scena dei titoli di coda: **+ → Browser**, URL `http://localhost:3000/credits`, 1920×1080, spunta **Controlla l'audio tramite OBS** (per la musica) e, se vuoi, **Aggiorna il browser quando la scena diventa attiva** (così ripartono dall'inizio).
2. Si configurano dalla scheda **🎬 Titoli di coda** della dashboard: testi, categorie, velocità, zona di comparsa dei nomi, colori, font, particelle, musica (trascina il brano), nomi da escludere (es. i bot), nomi di prova e anteprima. In più:
   - **Sezioni**: ordine con le frecce ↑↓, **sezioni tue** con testo libero e, per ogni sezione, **stile proprio** (colori, font, dimensioni, colonne, allineamento) e un'**icona** accanto ai nomi. I nomi di una sezione aggiunta possono venire da:
     - **nomi scritti a mano**;
     - **Twitch**: abbonati Tier 1 / Tier 2 / Tier 3 (i Prime contano come Tier 1), moderatori, VIP, classifica bits (oggi, settimana, mese, anno, sempre), chi era in chat (controllato ogni 5 minuti, ultime 12 ore);
     - **questa live** (eventi ricevuti da TwitchGestor dall'inizio della live, o nelle ultime 12 ore): nuovi follower, nuovi abbonati, rinnovi, chi ha regalato sub, chi ha inviato bits, chi ha donato, chi ha fatto raid, chi ha riscattato premi (anche un premio preciso). Con la quantità accanto al nome, se vuoi.

     Moderatori, VIP e chat richiedono permessi Twitch aggiuntivi: dopo l'aggiornamento esci e accedi di nuovo dalla dashboard.
   - **Immagini e sfondo**: logo in cima, immagine finale, immagine o video di sfondo (opacità, adattamento, sfocatura), particelle con colore, forma (luci, stelle, cuori, neve), quantità e velocità.
   - **Nomi**: allineamento, spaziatura, spessore, maiuscolo, spaziatura delle lettere ed **effetto di comparsa** (dissolvenza, sale dal basso, zoom, scivola, bagliore).
   - **Fine dello scorrimento**: ricomincia da capo oppure **si ferma sul testo finale**.
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
  tts.js                       voce: voci di Windows (classiche e moderne), espeak-ng e file audio
  piper.js                     voci naturali Piper: download, elenco e sintesi
public/                        overlay, dashboard e titoli di coda (credits.html)
demo/                          "server finto" della versione demo (usa il codice vero di src/core)
```
