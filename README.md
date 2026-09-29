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
- **Editor degli alert nella dashboard** con anteprima dal vivo: testi, suoni, font, colori, sfondo, immagini e animazioni.
- **Overlay per OBS** con animazioni, colori per tipo, immagini/GIF/video e suoni (4 suoni integrati o i tuoi file).
- **Varianti**: alert diversi in base all'importo (es. donazioni sopra i 50 €, bits sopra i 1000, 10+ sub regalate) o alla ricompensa dei punti canale.
- **Filtri**: disattiva un tipo, imposta un minimo, ignora ricompense specifiche. Le sub regalate non generano un doppio alert.
- **Storico e statistiche** della sessione: conteggi, bits totali, donazioni per valuta, top donatori. Lo storico viene salvato su disco.
- **Ringraziamenti automatici in chat** (facoltativi) con testi personalizzabili, scritti dal tuo account o da un **account bot** (es. Wolfery).
- **Anti-duplicati**, riconnessione automatica a Twitch, rinnovo automatico del token.
- Le modifiche valgono **subito**, anche durante la live.
- Funziona **senza finestre** e può partire e spegnersi insieme a OBS.

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

I valori predefiniti sono in `config/default.json`. **Non modificarlo**: crea `config/config.json` e scrivi solo quello che vuoi cambiare. Esempio (vedi anche `config/config.example.json`):

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

## Sicurezza

- Il server ascolta solo su `127.0.0.1` (questo PC) e rifiuta i comandi che arrivano da altri siti web aperti nel browser. Se lo esponi in rete o su Internet, imposta `DASHBOARD_TOKEN` e apri la dashboard con `/dashboard?token=IL_TUO_TOKEN`.
- I token Twitch sono salvati in `data/tokens.json`: non condividere quella cartella.

## Sviluppo

```bash
npm test          # test automatici
npm run dev       # riavvio automatico quando modifichi il codice
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
public/                        overlay e dashboard
```
