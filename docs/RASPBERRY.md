# TwitchGestor su Raspberry Pi

Con TwitchGestor sul Raspberry il bot, i comandi, le parole bannate e gli shoutout funzionano sempre, anche a PC spento. La dashboard si apre da qualsiasi dispositivo di casa. Gli aggiornamenti arrivano da soli: non devi reinserire niente.

La stessa guida, da stampare: [a colori](TwitchGestor-Raspberry-guida.pdf) o [in bianco e nero](TwitchGestor-Raspberry-guida-bianco-nero.pdf).

Va bene un **Raspberry Pi 3** o più recente. Serve una microSD da almeno 16 GB. Il cavo di rete è consigliato.

## 1. Prepara la microSD (una volta)

1. Sul PC installa **Raspberry Pi Imager** da raspberrypi.com/software.
2. Scegli il dispositivo, poi **Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit)**, poi la microSD.
3. Quando chiede se vuoi personalizzare, scegli **Modifica impostazioni**:
   - **Nome host:** `twitchgestor`
   - **Nome utente e password:** scegli tu e ricordali.
   - **Wi-Fi:** solo se non usi il cavo.
   - Scheda **Servizi:** attiva **SSH** con autenticazione tramite password.
4. Scrivi la microSD, mettila nel Raspberry e accendilo. Aspetta un paio di minuti.

Consiglio: nel router assegna un **IP fisso** al Raspberry (di solito si chiama "DHCP statico" o "prenotazione indirizzo"). Così gli indirizzi in OBS non cambiano mai.

## 2. Installa TwitchGestor (una volta)

Sul PC apri **Terminale** (oppure PowerShell) e collegati al Raspberry:

```
ssh tuonome@twitchgestor.local
```

La prima volta rispondi `yes`, poi scrivi la password. Incolla questo comando e premi Invio:

```
curl -fsSL https://raw.githubusercontent.com/XandredKaze/TwitchGestor/main/scripts/raspberry/install.sh | bash
```

Ci vogliono alcuni minuti. Alla fine lo script mostra:

- l'indirizzo della **dashboard**, già con la password: aprilo una volta da ogni dispositivo e la password resta salvata;
- gli indirizzi da mettere in **OBS**.

Da qui in poi TwitchGestor parte da solo ogni volta che accendi il Raspberry, e si riavvia da solo se si blocca.

## 3. Porta tutto dal PC (una volta)

1. Sul PC aggiorna TwitchGestor all'ultima versione e avvialo.
2. Se te l'avevamo chiesto, **ricollega Wolfery** adesso, sul PC. Per esempio serve per il permesso degli shoutout.
3. Nella dashboard del PC: **⚙ Sistema → Esporta tutto**. Scarica un file `twitchgestor-….tar.gz`. Contiene i tuoi accessi a Twitch: tienilo per te.
4. Apri la dashboard del **Raspberry** dal PC dove gira OBS: **⚙ Sistema → Importa** e scegli quel file.

Vengono trasferiti:
- impostazioni e accessi a Twitch e al bot;
- immagini e suoni;
- storico, titoli di coda, comandi, shoutout;
- chiavi di Twitch, Ko-fi e StreamElements.

Indirizzo e password della dashboard del Raspberry restano i suoi. Se importi dal PC dove gira OBS, il collegamento a OBS si imposta da solo sull'indirizzo di quel PC. TwitchGestor si riavvia da solo e riparte con tutto com'era sul PC.

## 4. Sistema OBS (una volta)

- **Strumenti → Impostazioni server WebSocket:** deve essere attivo, con la password (come già facevi).
- **Sorgenti browser:** cambia `localhost` con l'indirizzo del Raspberry, per esempio:
  - `http://192.168.1.50:3000/overlay`
  - `http://192.168.1.50:3000/chat`
  - `http://192.168.1.50:3000/credits`
  - `http://192.168.1.50:3000/goal?id=sub` per la barra del goal (facoltativa, scheda 🎯 Goal)
  - `http://192.168.1.50:3000/music` per la musica (nuova, facoltativa: spunta **Controlla l'audio tramite OBS**)
- **Dock dei titoli di coda:** `http://192.168.1.50:3000/credits?pannello&token=LA-PASSWORD`.
- Se avevi lo script `twitchgestor.lua` in **Strumenti → Script** (quello che avviava TwitchGestor insieme a OBS), toglilo: ora TwitchGestor è sempre acceso sul Raspberry.
- Sul PC non avviare più TwitchGestor.

## Aggiornamenti: non devi fare niente

- **Ogni notte alle 5** il Raspberry controlla se c'è una versione nuova e, se c'è, si aggiorna. **Mai durante la live:** se sei in diretta riprova la notte dopo.
- Vuoi aggiornare subito? Apri **⚙ Sistema** nella dashboard: vedi cosa cambia e premi **⬆ Aggiorna ora**.
- Prima di ogni aggiornamento salva una **copia di sicurezza** di impostazioni e dati (tiene le ultime 5, in `data/backups`).
- Se la versione nuova non riuscisse a partire, **torna da sola a quella di prima**. In ⚙ Sistema vedi com'è andata.
- Impostazioni, accessi, immagini, suoni e dati **non vengono mai toccati** dagli aggiornamenti. Le opzioni nuove partono con il loro valore predefinito.
- Overlay, chat e titoli di coda in OBS **si ricaricano da soli** dopo l'aggiornamento: non serve "Aggiorna la cache". Anche la dashboard si ricarica da sola, a meno che tu non stia modificando qualcosa senza aver salvato.

## La scheda Live: anteprima e chat di Twitch (una volta)

Twitch mostra il suo player e la sua chat solo su pagine **https**. Il Raspberry ha anche un indirizzo https, `https://twitchgestor.local/dashboard`; per usarlo, il PC deve fidarsi del suo certificato. Si fa una volta sola:

1. Apri la dashboard del Raspberry. Nel riquadro **Anteprima live** premi **Scarica il certificato di TwitchGestor** e aprilo con doppio clic.
2. Premi **Installa certificato…**, poi:
   - **Utente corrente** → Avanti;
   - **Colloca tutti i certificati nel seguente archivio** → Sfoglia → **Autorità di certificazione radice attendibili** → OK;
   - Avanti → Fine → **Sì**.
3. Chiudi e riapri il browser e apri la dashboard come sempre: passa da sola all'indirizzo https. Lì trovi il player e la chat di Twitch come sul PC, con tutti gli strumenti di moderazione.

**Con Firefox**, che usa un archivio dei certificati suo, i punti 1 e 2 cambiano:
- Premi **Scarica il certificato di TwitchGestor**. Se Firefox apre la finestra "Scaricamento certificato", spunta **Considera attendibile questa CA per l'identificazione di siti web** e premi OK.
- Altrimenti salva il file. Poi apri **Impostazioni → Privacy e sicurezza → Certificati → Mostra certificati…**, scheda **Autorità**, **Importa…**: scegli il file, spunta la stessa casella e premi OK.

Il certificato vale solo per TwitchGestor nella rete di casa e non può essere usato per altri siti. In OBS gli indirizzi restano quelli normali (`http://…:3000`).

## La cartella condivisa: musica, immagini e suoni

Il Raspberry ha una **cartella condivisa** in rete, così copi i file dal PC come in una chiavetta. Si attiva da sola con l'installazione o con un aggiornamento.

1. Sul PC apri **Esplora file**, scrivi `\\twitchgestor\TwitchGestor` nella barra in alto e premi Invio.
2. Se chiede le credenziali: **nome utente** e **password** li trovi nella dashboard, scheda **🎵 Musica → Cartella condivisa** (la password è la stessa della dashboard). Spunta **Memorizza credenziali**.
3. Dentro trovi:
   - `music`: la musica, una sottocartella per ogni playlist;
   - `images`: immagini, GIF e video degli alert;
   - `sounds`: i suoni degli alert.
4. Consiglio: clic destro su **TwitchGestor** → **Connetti unità di rete…** per averla sempre in Esplora file.

Se `\\twitchgestor` non risponde, usa l'indirizzo del Raspberry, per esempio `\\192.168.1.50\TwitchGestor`. La cartella si vede solo nella rete di casa. Le copie di sicurezza non contengono la musica (pesa troppo): tienine una copia anche sul PC.

## Accesso da fuori casa (facoltativo)

Per aprire la dashboard quando non sei a casa (dal telefono o da un portatile) TwitchGestor usa **Tailscale**: una rete privata gratuita tra i tuoi dispositivi. Non si apre nessuna porta sul router: entra solo chi usa il tuo account Tailscale. Si fa **una volta, da casa**:

1. Nella dashboard apri **⚙ Sistema → Accesso da fuori casa** e premi **🌍 Attiva l'accesso da fuori casa**. Il Raspberry installa Tailscale (1–3 minuti).
2. Premi **🔗 Collega** e poi **🔑 Apri il link e accedi a Tailscale**: accedi (anche con Google o Microsoft) e premi **Connect**.
3. Sul telefono installa l'app **Tailscale** e accedi con lo **stesso account**.
4. Fuori casa, con l'app Tailscale attiva, apri l'indirizzo che trovi in ⚙ Sistema (es. `http://twitchgestor.tailXXXX.ts.net:3000/dashboard`). La prima volta chiede la password della dashboard.

Funziona tutto; anteprima e chat di Twitch nella scheda Live funzionano su un PC o portatile con il certificato installato. Attivando l'accesso da fuori casa il certificato cambia (ora vale anche per Tailscale): **reinstallalo una volta** sui PC dove l'avevi già messo (link in ⚙ Sistema, stessi passaggi della scheda Live). Dal telefono, per la chat usa l'app di Twitch. Anche la cartella condivisa funziona da fuori casa, con l'indirizzo `\\100.x.x.x\TwitchGestor` indicato in ⚙ Sistema.

## Accedere a Twitch (raramente)

Twitch accetta l'accesso solo da "localhost". Quindi, quando serve un nuovo accesso (un permesso nuovo, oppure ricollegare il bot), si fa così:

1. Nella dashboard premi come sempre **Accedi con Twitch** o **Collega account bot**.
2. TwitchGestor ti fa scaricare un piccolo file per Windows. Aprilo con doppio clic.
3. Se te la chiede, scrivi la password del Raspberry.
4. Si apre la pagina di Twitch: accedi come sempre.
5. Alla fine chiudi la finestra nera.

## Se qualcosa non va

Collegati con `ssh tuonome@twitchgestor.local` e usa:

- `sudo systemctl status twitchgestor` per vedere se è acceso;
- `journalctl -u twitchgestor -f` per i messaggi del programma in tempo reale (Ctrl+C per uscire);
- `sudo systemctl restart twitchgestor` per riavviarlo;
- di nuovo il comando di installazione, se vuoi reinstallarlo: non cancella impostazioni e dati.
