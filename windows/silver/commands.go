package main

// Cosa gli hai scritto: un comando (promemoria, timer, nota, musica, scena…) o una domanda per l'IA.
// Niente di Windows qui: si prova anche altrove (commands_test.go).

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Command struct {
	Kind  string    // remind | reminders | clear | note | music | scene | open | nextlive | agenda | time | help | ask
	At    time.Time // remind: quando
	Where string    // music: "live" = la musica della live (Gestor/OBS); "" = Musicante Player sul PC (se è aperto)
	Arg   string    // music find: cosa cercare; music volume: 0-100
	Text  string    // remind: cosa; note: il testo; music: play|pause|toggle|next|prev; scene: nome; open: gestor|howlup|musicante; ask: la domanda
}

var (
	reRemind     = regexp.MustCompile(`(?i)^(?:ricordami|ricordarmi|promemoria|avvisami|dimmi)\b\s*(.*)$`)
	reIn         = regexp.MustCompile(`(?i)\btra\s+(?:(un|una|mezz|\d+(?:[.,]\d+)?)\s*'?\s*)(secondi|secondo|sec|s|minuti|minuto|min|m|ore|ora|h)\b`)
	reInHalf     = regexp.MustCompile(`(?i)\btra\s+mezz\s*'?\s*ora\b`)
	reAt         = regexp.MustCompile(`(?i)\b(?:(domani)\s+)?(?:alle|all'|alle ore|a)\s*(\d{1,2})(?:[:.](\d{2}))?\b`)
	reTimer      = regexp.MustCompile(`(?i)^(?:(?:metti|imposta|fai partire|avvia)\s+(?:un\s+)?)?(?:timer|countdown|conto alla rovescia)\s*(?:di\s+)?(\d+(?:[.,]\d+)?)?\s*(secondi|secondo|sec|s|minuti|minuto|min|m|ore|ora|h)?\s*(.*)$`)
	reNote       = regexp.MustCompile(`(?i)^(?:nota|note|appunta|appuntati|annota|segna|segnati)\b\s*(?:che\s+)?:?\s*(.+)$`)
	reScene      = regexp.MustCompile(`(?i)^(?:scena|passa alla scena|vai alla scena|metti la scena|cambia scena(?: in| a)?)\s+(.+)$`)
	reOpen       = regexp.MustCompile(`(?i)^(?:apri|avvia|lancia)\s+(?:il\s+|la\s+)?(musicante\s*player|il player|player|twitch\s*gestor|gestor|howl[\s-]?up|musicante|ollama)\b`)
	reVolume     = regexp.MustCompile(`^(?:musica\s+)?(?:volume|vol)\s*(?:a|al)?\s*(\d{1,3})\s*%?$`)
	reFind       = regexp.MustCompile(`(?i)^(?:metti|suona|ascolta|riproduci|fammi sentire|voglio sentire|play)\s+(?:un po' di\s+|qualcosa di\s+|la playlist\s+|le canzoni di\s+|i brani di\s+|musica di\s+|la canzone\s+)?(.+)$`)
	rePlaylist   = regexp.MustCompile(`(?:dalla|della|nella|alla|la|una|sulla|mia|dalle)\s+playlist\s+(.+)$`)
	reSong       = regexp.MustCompile(`\b(canzone|canzoni|brano|brani|traccia|pezzo|musica|song)\b`)
	reNextWords  = regexp.MustCompile(`\b(cambia|cambiare|passa|passare|salta|saltare|altra|altro|prossim[ao]|successiv[ao]|avanti|skippa|skip)\b`)
	rePrevWords  = regexp.MustCompile(`\b(precedente|prima|indietro|torna)\b`)
	rePauseWords = regexp.MustCompile(`\b(ferma|fermare|pausa|stop|basta|spegni|zitta)\b`)
	rePlayWords  = regexp.MustCompile(`\b(metti|suona|accendi|fai partire|riprendi|play|ascoltare|ascolta)\b`)
	reVolUp      = regexp.MustCompile(`^(?:alza|alzare|aumenta|più alto|piu alto|più forte|piu forte)(?: il volume| la musica| un po'?)*$`)
	reVolDown    = regexp.MustCompile(`^(?:abbassa|abbassare|diminuisci|più basso|piu basso|più piano|piu piano)(?: il volume| la musica| un po'?)*$`)
	reOtherPl    = regexp.MustCompile(`\b(?:altra|un'altra|un altra|nuova|diversa|prossima|cambia(?:re)?|cambiami)\s+(?:la\s+)?playlist\b|\bplaylist\s+(?:diversa|nuova|differente)\b|\bcambia(?:re)?\s+(?:la\s+)?playlist\b`)
	reAnyPl      = regexp.MustCompile(`\b(?:qualsiasi|qualunque|a caso|casuale|random)\b.*\bplaylist\b|\bplaylist\b.*\b(?:qualsiasi|qualunque|a caso|casuale|random)\b|\b(?:musica|qualcosa|canzoni|brani)\s+(?:a caso|qualsiasi|qualunque|random)\b`)
	reNotMusic   = regexp.MustCompile(`(?i)\b(timer|promemoria|sveglia|scena|nota)\b`)
	reBriefing   = regexp.MustCompile(`^(?:buongiorno|buondì|buon giorno|briefing|riepilogo(?: della giornata| di oggi)?|com'è la giornata|come sarà la giornata|cosa mi aspetta oggi|cosa c'è oggi|che si fa oggi|aggiornami|fammi il punto)(?:\s+silver)?$`)
	reWeather    = regexp.MustCompile(`(?:che tempo fa|che tempo farà|che tempo fara|meteo|piove|pioverà|piovera|fa freddo|fa caldo|farà freddo|farà caldo|temperatura fuori|serve l'ombrello)`)
	reCity       = regexp.MustCompile(`(?i)^(?:la mia città è|la mia citta è|la mia città|abito a|vivo a|sono di|imposta la città(?: a)?|città:)\s+(.+)$`)
	reModeDef    = regexp.MustCompile(`(?i)^(?:crea|definisci|imposta|salva|nuova)\s+(?:la\s+)?modalit[aà]\s+(.+?)\s*[:,]\s*(.+)$`)
	reModeDel    = regexp.MustCompile(`(?i)^(?:cancella|elimina|togli|rimuovi)\s+(?:la\s+)?modalit[aà]\s+(.+)$`)
	reModeList   = regexp.MustCompile(`^(?:che|quali) modalit[aà] (?:ho|ci sono|conosci)|^modalit[aà]$|^le mie modalit[aà]$`)
	reModeRun    = regexp.MustCompile(`(?i)^(?:attiva|avvia|metti|passa a|passa alla|vai in|entra in)?\s*(?:la\s+)?modalit[aà]\s+(.+?)[\s.!?]*$`)
	reWebSearch  = regexp.MustCompile(`(?i)^(?:cerca(?:mi)?|ricerca|guarda|controlla)\s+(?:su\s+internet|online|in\s+rete|sul\s+web|su\s+google|in\s+internet|su\s+duckduckgo)\s*:?\s*(.+)$|^(?:googla|googlami|ultime\s+notizie\s+su|notizie\s+(?:su|di|sul|sulla|sugli)|news\s+su)\s*:?\s*(.+)$`)
	reRemember   = regexp.MustCompile(`(?i)^(?:silver[,\s]+)?(?:ricordati|ricorda|tieni a mente|memorizza|impara|segnati in memoria)\s+(?:che\s+|questo:\s*)?(.+)$`)
	reMemories   = regexp.MustCompile(`^(?:cosa|che cosa|che) (?:sai di me|ti ricordi(?: di me)?|ricordi di me|hai in memoria)`)
	reForget     = regexp.MustCompile(`(?i)^(?:dimentica|dimenticati|scordati|cancella dalla memoria)\s+(?:che\s+|di\s+)?(.+)$`)
	reFolder     = regexp.MustCompile(`^(?:apri|aprimi|mostrami|vai (?:nella|alla))\s+(?:la\s+)?cartella\s+(?:dei\s+|delle\s+|degli\s+|di\s+|del\s+|della\s+|dello\s+)?(.+?)[\s.!?]*$`)
	reLastFile   = regexp.MustCompile(`(?:^|\s)(?:l'|l )?ultim[oa]\s+(video|registrazione|screenshot|foto|immagine|download|file scaricato|file)(?:\s|$|[.!?])`)
	reWebAny     = regexp.MustCompile(`(?i)^(?:cerca(?:mi)?|ricerca|ricercami|informati\s+(?:su|sul|sulla|di)|fai\s+una\s+ricerca\s+(?:su|sul|sulla)|trova(?:mi)?\s+(?:info|informazioni|notizie|news))\s+(.+)$`)
	reFindFile   = regexp.MustCompile(`(?i)^(?:trova(?:mi)?|cerca(?:mi)?|dov'è|dove sta|dove si trova|apri)\s+(?:il\s+|la\s+|lo\s+|l'|i\s+|le\s+)?(file|documento|foto|immagine|video|grafica|pdf|cartella)\s+(?:di\s+|del\s+|della\s+|chiamat[oa]\s+|con\s+)?(.+)$`)
	reClose      = regexp.MustCompile(`(?i)^(?:chiudi|chiudimi|termina|esci da|chiudere)\s+(?:il\s+|la\s+|lo\s+|l'|i\s+|gli\s+)?(?:programma\s+|gioco\s+|app\s+)?(.+?)[\s.!?]*$`)
	reLaunch     = regexp.MustCompile(`(?i)^(?:apri|aprimi|apriti|avvia|avviami|lancia|lanciami|fai partire|esegui|accendi|fammi partire)\s+(?:il\s+|la\s+|lo\s+|l'|i\s+|gli\s+)?(?:programma\s+|gioco\s+|app\s+|applicazione\s+)?(.+?)[\s.!?]*$`)
	reNotLaunch  = regexp.MustCompile(`(?i)(timer|promemoria|sveglia|musica|playlist|canzone|brano|scena|nota|finestra di silver)`)
	reLead       = regexp.MustCompile(`(?i)^\s*(?:di|che|a|:|-)\s+`)
)

func unitDur(n float64, unit string) time.Duration {
	switch strings.ToLower(unit) {
	case "secondi", "secondo", "sec", "s":
		return time.Duration(n * float64(time.Second))
	case "ore", "ora", "h":
		return time.Duration(n * float64(time.Hour))
	}
	return time.Duration(n * float64(time.Minute))
}

func num(s string) float64 {
	switch strings.ToLower(s) {
	case "un", "una", "":
		return 1
	case "mezz":
		return 0.5
	}
	f, _ := strconv.ParseFloat(strings.ReplaceAll(s, ",", "."), 64)
	return f
}

func cleanWhat(s string) string {
	s = strings.TrimSpace(reLead.ReplaceAllString(strings.TrimSpace(s), ""))
	return strings.TrimRight(s, " .!")
}

func ParseCommand(text string, now time.Time) Command {
	t := strings.TrimSpace(text)
	low := strings.ToLower(strings.Trim(t, " ?!."))
	switch {
	case low == "":
		return Command{Kind: "help"}
	case low == "aiuto" || low == "help" || low == "cosa sai fare" || low == "comandi":
		return Command{Kind: "help"}
	case low == "promemoria" || low == "i miei promemoria" || low == "che promemoria ho" || low == "timer attivi":
		return Command{Kind: "reminders"}
	case low == "cancella promemoria" || low == "cancella i promemoria" || low == "togli i promemoria" || low == "ferma timer" || low == "ferma il timer" || low == "cancella timer":
		return Command{Kind: "clear"}
	case parseAway(low).Kind != "":
		return parseAway(low)
	case parseUpdate(low).Kind != "":
		return parseUpdate(low)
	case reBriefing.MatchString(low):
		return Command{Kind: "briefing"}
	case reWeather.MatchString(low) && len(strings.Fields(low)) <= 8:
		if strings.Contains(low, "domani") {
			return Command{Kind: "weather", Text: "tomorrow"}
		}
		return Command{Kind: "weather"}
	case low == "diagnosi musica" || low == "diagnosi" || low == "controlla la musica" || low == "diagnosi player":
		return Command{Kind: "diag"}
	case low == "diagnosi programmi" || low == "diagnosi app":
		return Command{Kind: "appdiag"}
	case low == "che programmi conosci" || low == "quali programmi conosci" || low == "che app conosci" || low == "elenco programmi" || low == "lista programmi" || low == "che giochi conosci" || low == "quali giochi ho":
		return Command{Kind: "applist"}
	case low == "che ore sono" || low == "che ora è" || low == "ora":
		return Command{Kind: "time"}
	case strings.Contains(low, "prossima live") || strings.Contains(low, "quando vado in live") || low == "live":
		return Command{Kind: "nextlive"}
	}
	// modalità (sequenze di comandi) e la live a comando
	if g := reModeDef.FindStringSubmatch(t); g != nil {
		return Command{Kind: "modedef", Text: modeKey(g[1]), Arg: g[2]}
	}
	if g := reModeDel.FindStringSubmatch(t); g != nil {
		return Command{Kind: "modedel", Text: modeKey(g[1])}
	}
	if regexp.MustCompile(`^(?:fine live|fine della live|finisco la live|chiudo la live|chiudiamo la live)$`).MatchString(low) {
		return Command{Kind: "mode", Text: "fine live"}
	}
	if regexp.MustCompile(`^(?:si va in live|vado in live|andiamo in live|inizio la live|iniziamo la live|prepara la live|prepariamo la live)$`).MatchString(low) {
		return Command{Kind: "mode", Text: "live"}
	}
	if reModeList.MatchString(low) {
		return Command{Kind: "modelist"}
	}
	if g := reModeRun.FindStringSubmatch(t); g != nil {
		return Command{Kind: "mode", Text: modeKey(g[1])}
	}
	if tw := parseTwitch(t); tw.Kind != "" {
		return tw
	}
	// creare un impegno, una cosa da fare o una live in Howl-UP ("domani alle 15 ho il dentista")
	if IsCreateRequest(t, now) {
		return Command{Kind: "create", Text: t}
	}
	if g := reCity.FindStringSubmatch(t); g != nil {
		return Command{Kind: "city", Text: strings.TrimSpace(strings.Trim(g[1], " .!?"))}
	}
	// memoria personale: "ricordati che il mio gioco preferito è…" (non "ricordami", che è un promemoria)
	if g := reRemember.FindStringSubmatch(t); g != nil {
		return Command{Kind: "remember", Text: strings.TrimSpace(strings.TrimRight(g[1], " .!"))}
	}
	if reMemories.MatchString(low) {
		return Command{Kind: "memories"}
	}
	if g := reForget.FindStringSubmatch(t); g != nil {
		return Command{Kind: "forget", Text: strings.TrimSpace(strings.TrimRight(g[1], " .!"))}
	}
	// il PC: volume di Windows, screenshot, blocca, spegni/riavvia/sospendi
	if pc := parsePC(low); pc.Kind != "" {
		return pc
	}
	// agenda di Howl-UP (fatti non domande lunghe: "impegni di domani", "cosa ho oggi", "cose da fare")
	if len([]rune(low)) <= 45 {
		has := func(w ...string) bool {
			for _, x := range w {
				if strings.Contains(low, x) {
					return true
				}
			}
			return false
		}
		when := "today"
		if has("domani") {
			when = "tomorrow"
		} else if has("settimana", "prossimi giorni") {
			when = "week"
		}
		switch {
		case has("prossimo impegno", "prossimo appuntamento", "il prossimo evento"):
			return Command{Kind: "agenda", Text: "next"}
		case has("cose da fare", "cosa devo fare", "da fare", "lista delle cose", "to do", "todo") && !has("oggi", "domani", "settimana"):
			return Command{Kind: "agenda", Text: "tasks"}
		case has("impegni", "impegno", "agenda", "appuntamenti", "calendario", "cosa ho ", "che ho ", "cosa devo fare") || low == "cosa ho" || low == "che ho":
			return Command{Kind: "agenda", Text: when}
		}
	}
	// musica: Musicante Player sul PC, oppure quella della live se lo dici ("pausa la musica della live")
	where := ""
	m := low
	for _, w := range []string{" della live", " in live", " della diretta", " su obs", " di gestor", " della stream", " live"} {
		if strings.Contains(m, w) {
			where, m = "live", strings.TrimSpace(strings.Replace(m, w, "", 1))
		}
	}
	m = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(m, "musica:"), "musica "), "player "))
	m = strings.TrimSuffix(strings.TrimSuffix(m, " la musica"), " musica")
	music := map[string]string{"pausa": "pause", "stop": "pause", "ferma": "pause", "ferma la musica": "pause", "metti in pausa": "pause", "metti pausa": "pause", "fermati": "pause", "stoppa": "pause", "fermala": "pause", "skippa": "next", "skip": "next", "next": "next", "rimetti": "play", "riparti": "play", "fai ripartire": "play", "play": "play", "riprendi": "play", "metti": "play", "suona": "play", "metti la musica": "play", "fai partire": "play", "avanti": "next", "prossima": "next", "salta": "next", "prossimo brano": "next", "prossima canzone": "next", "brano successivo": "next", "cambia canzone": "next", "indietro": "prev", "precedente": "prev", "brano precedente": "prev", "canzone precedente": "prev"}
	if v, ok := music[m]; ok {
		return Command{Kind: "music", Text: v, Where: where}
	}
	if low == "musica" {
		return Command{Kind: "music", Text: "toggle"}
	}
	// un'altra playlist / una a caso
	if !reNotMusic.MatchString(m) {
		switch {
		case reOtherPl.MatchString(m):
			return Command{Kind: "music", Text: "otherPlaylist", Where: where}
		case reAnyPl.MatchString(m):
			return Command{Kind: "music", Text: "randomPlaylist", Where: where}
		}
	}
	// frasi più libere: "cambia canzone dalla playlist Alf", "metti qualcosa della playlist Chill", "un'altra canzone"
	if g := rePlaylist.FindStringSubmatch(m); g != nil && !reNotMusic.MatchString(m) {
		return Command{Kind: "music", Text: "find", Arg: "playlist " + strings.TrimSpace(strings.Trim(g[1], " .!?\"'")), Where: where}
	}
	if reSong.MatchString(m) && !reNotMusic.MatchString(m) {
		switch {
		case reNextWords.MatchString(m):
			return Command{Kind: "music", Text: "next", Where: where}
		case rePrevWords.MatchString(m):
			return Command{Kind: "music", Text: "prev", Where: where}
		case rePauseWords.MatchString(m):
			return Command{Kind: "music", Text: "pause", Where: where}
		case rePlayWords.MatchString(m) && len([]rune(m)) <= 30:
			return Command{Kind: "music", Text: "play", Where: where}
		}
	}
	switch {
	case reVolUp.MatchString(m):
		return Command{Kind: "music", Text: "volume", Arg: "+15", Where: where}
	case reVolDown.MatchString(m):
		return Command{Kind: "music", Text: "volume", Arg: "-15", Where: where}
	}
	if g := reVolume.FindStringSubmatch(low); g != nil {
		return Command{Kind: "music", Text: "volume", Arg: g[1], Where: where}
	}
	if low == "che canzone è" || low == "che brano è" || low == "cosa sta suonando" || low == "cosa suona" || low == "che musica è" || low == "cosa stai suonando" || low == "che canzone sta suonando" {
		return Command{Kind: "music", Text: "now", Where: where}
	}
	if g := reFind.FindStringSubmatch(t); g != nil && !reNotMusic.MatchString(g[1]) {
		arg := strings.TrimSpace(g[1])
		switch strings.ToLower(strings.Trim(arg, " .!?")) {
		case "musica", "la musica", "qualcosa", "un po' di musica", "un po di musica", "della musica", "una canzone", "un brano":
			return Command{Kind: "music", Text: "play"}
		}
		return Command{Kind: "music", Text: "find", Arg: arg}
	}
	if g := reScene.FindStringSubmatch(t); g != nil {
		return Command{Kind: "scene", Text: strings.TrimSpace(g[1])}
	}
	if g := reOpen.FindStringSubmatch(t); g != nil {
		w := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(g[1], " ", ""), "-", ""))
		switch {
		case strings.Contains(w, "player"):
			w = "player"
		case strings.Contains(w, "gestor"):
			w = "gestor"
		case strings.HasPrefix(w, "howl"):
			w = "howlup"
		}
		return Command{Kind: "open", Text: w}
	}
	// cercare su internet ("cerca su internet …", "notizie su …", e le domande su cose recenti)
	if g := reWebSearch.FindStringSubmatch(t); g != nil {
		q := g[1]
		if q == "" {
			q = g[2]
		}
		return Command{Kind: "web", Text: strings.TrimSpace(strings.Trim(q, " .!?:"))}
	}
	// cartelle e file
	if g := reFolder.FindStringSubmatch(low); g != nil {
		return Command{Kind: "folder", Text: strings.TrimSpace(g[1])}
	}
	if g := reLastFile.FindStringSubmatch(low); g != nil {
		return Command{Kind: "lastfile", Text: g[1]}
	}
	if g := reFindFile.FindStringSubmatch(t); g != nil {
		return Command{Kind: "findfile", Text: strings.TrimSpace(strings.TrimRight(g[2], " .!?")), Arg: strings.ToLower(g[1])}
	}
	// "cerca …" detto in qualsiasi modo (dopo i file: "cerca la foto del gatto" resta sul PC)
	if g := reWebAny.FindStringSubmatch(t); g != nil {
		return Command{Kind: "web", Text: strings.TrimSpace(strings.Trim(g[1], " .!?:"))}
	}
	if g := reClose.FindStringSubmatch(t); g != nil && !reNotLaunch.MatchString(g[1]) {
		return Command{Kind: "close", Text: cleanAppQuery(strings.TrimSpace(g[1]))}
	}
	// qualsiasi altro programma o gioco del PC: "apri Discord", "avvia OBS", "lancia lol"
	if g := reLaunch.FindStringSubmatch(t); g != nil && !reNotLaunch.MatchString(g[1]) {
		return Command{Kind: "launch", Text: strings.TrimSpace(g[1])}
	}
	if g := reNote.FindStringSubmatch(t); g != nil {
		return Command{Kind: "note", Text: strings.TrimSpace(g[1])}
	}
	if g := reTimer.FindStringSubmatch(t); g != nil && g[1] != "" {
		d := unitDur(num(g[1]), g[2])
		what := cleanWhat(g[3])
		if what == "" {
			what = "Tempo scaduto."
		}
		return Command{Kind: "remind", At: now.Add(d), Text: what}
	}
	if g := reRemind.FindStringSubmatch(t); g != nil {
		rest := g[1]
		var at time.Time
		if loc := reInHalf.FindStringIndex(rest); loc != nil {
			at = now.Add(30 * time.Minute)
			rest = rest[:loc[0]] + rest[loc[1]:]
		} else if sm := reIn.FindStringSubmatchIndex(rest); sm != nil {
			n := num(rest[sm[2]:sm[3]])
			at = now.Add(unitDur(n, rest[sm[4]:sm[5]]))
			rest = rest[:sm[0]] + rest[sm[1]:]
		} else if sm := reAt.FindStringSubmatchIndex(rest); sm != nil {
			h, _ := strconv.Atoi(rest[sm[4]:sm[5]])
			mi := 0
			if sm[6] >= 0 {
				mi, _ = strconv.Atoi(rest[sm[6]:sm[7]])
			}
			if h < 24 && mi < 60 {
				at = time.Date(now.Year(), now.Month(), now.Day(), h, mi, 0, 0, now.Location())
				if sm[2] >= 0 {
					at = at.AddDate(0, 0, 1)
				} else if !at.After(now) {
					// "alle 9" quando sono già le 10: le 21 se è ancora oggi, altrimenti domani
					if h < 12 && at.Add(12*time.Hour).After(now) {
						at = at.Add(12 * time.Hour)
					} else {
						at = at.AddDate(0, 0, 1)
					}
				}
				rest = rest[:sm[0]] + rest[sm[1]:]
			}
		}
		if !at.IsZero() {
			what := cleanWhat(rest)
			if what == "" {
				what = "Mi avevi chiesto di ricordartelo. Ecco."
			}
			return Command{Kind: "remind", At: at, Text: what}
		}
	}
	if WantsWeb(t) {
		return Command{Kind: "web", Text: t}
	}
	return Command{Kind: "ask", Text: t}
}

// quando, detto bene: "tra 20 minuti", "alle 18:30", "domani alle 9:00"
func whenText(at, now time.Time) string {
	d := at.Sub(now)
	switch {
	case d < 90*time.Second:
		return fmt.Sprintf("tra %d secondi", int(d.Round(time.Second).Seconds()))
	case d < 90*time.Minute:
		return fmt.Sprintf("tra %d minuti", int(d.Round(time.Minute).Minutes()))
	}
	y1, m1, d1 := now.Date()
	y2, m2, d2 := at.Date()
	if y1 == y2 && m1 == m2 && d1 == d2 {
		return "alle " + at.Format("15:04")
	}
	if at.Sub(time.Date(y1, m1, d1, 0, 0, 0, 0, now.Location())) < 48*time.Hour {
		return "domani alle " + at.Format("15:04")
	}
	return at.Format("02/01 alle 15:04")
}

const helpText = `Posso:
• "ricordami tra 20 minuti di bere" · "ricordami alle 18:30 la riunione" · "timer 10 minuti"
• "promemoria" (li vedi) · "cancella promemoria"
• "nota: idea per la live…" (finisce nelle note di Howl-UP)
• Musicante Player: "pausa" · "play" · "avanti" · "indietro" · "metti Linkin Park" · "metti la playlist Chill" · "volume 40" · "che canzone è?" · "apri il player"
• La musica della live: aggiungi "della live" (es. "pausa della live", "avanti in live")
• "scena Gioco" (cambia scena in OBS)
• "prossimo impegno" · "impegni di oggi" / "di domani" / "della settimana" · "cose da fare" (da Howl-UP)
• Nuovi impegni come li diresti a una persona: "domani alle 15 ho il dentista", "cena con Marco venerdì dalle 20 alle 23, avvisami un'ora prima", "ogni martedì alle 18 palestra fino a dicembre", "tra le cose da fare: comprare il microfono entro sabato", "live di Elden Ring venerdì alle 21". Ti mostro la scheda: Salva, Annulla o correggi ("no, alle 17").
• Programmi e giochi del PC: "apri Discord" · "avvia OBS" · "lancia lol" · "apri Baldur's Gate 3"
• Sparire: "sparisci" · "vattene" · "nasconditi" (resto acceso: mi richiami con "Ehi Silver" o Ctrl+Alt+S) · "torna" · "fatti vedere"
• Aggiornamenti: "aggiornati" · "aggiorna il player" · "aggiorna tutto" · "che versione sei?"
• Internet: "cerca …" (o "cerca su internet …") · "notizie su …" · e le domande su cose recenti ("chi ha vinto ieri…", "quando esce…"): leggo i risultati e ti rispondo con le fonti
• Live: "cambia il titolo in …" · "cambia il gioco in Elden Ring" · "shoutout a nome" · "scrivi in chat: …" · "fai un annuncio: …" · "metti un segnalibro" · "clippa questo" · "quanti spettatori ho?" · "raid a nome"
• Modalità: "modalità live" · "fine live" · "crea la modalità studio: apri Discord, apri Spotify e metti la playlist Alf" · "che modalità ho?"
• "buongiorno" (meteo, agenda, live, promemoria) · "che tempo fa?" · "che tempo farà domani?" · "la mia città è Roma"
• Il PC: "alza/abbassa il volume del pc" · "volume del pc al 30" · "metti il pc in muto" · "fai uno screenshot" · "blocca il pc" · "chiudi Discord" · "spegni/riavvia/sospendi il pc" (con conferma)
• File: "apri la cartella download" · "apri la cartella condivisa" · "trova il file grafica halloween" · "cerca la foto del gatto" · "apri l'ultimo video" / "l'ultimo screenshot"
• Memoria: "ricordati che…" · "cosa sai di me?" · "dimentica che…"
• "prossima live" · "apri Gestor" · "apri Howl-UP" · "apri Musicante"
• Con la voce: tieni premuto Ctrl+Alt+V e parla (o premi il microfono qui sotto), oppure chiamami con "Ehi Silver" (si attiva dal mio menu)
• Qualsiasi altra cosa: ti rispondo io (con l'IA sul tuo PC).`

var (
	rePCVolWord = regexp.MustCompile(`(?:^|[\s'])(?:volume|audio)(?:\s|$)`)
	rePCWord    = regexp.MustCompile(`(?:^|\s)(?:pc|computer|sistema|windows|generale|casse)(?:\s|$)`)
	rePCVolMax  = regexp.MustCompile(`(?:al|a)\s+(?:massimo|tutto|max)`)
	rePCVolMin  = regexp.MustCompile(`(?:al|a)\s+(?:minimo|zero|min)`)
	rePCVolBy   = regexp.MustCompile(`(?:^|\s)di\s+(\d{1,3})\s*%?(?:\s|$)`)
	rePCVolTo   = regexp.MustCompile(`(?:^|\s)(?:al|a|allo)\s+(\d{1,3})\s*%?(?:\s|$)`)
	rePCVolUp   = regexp.MustCompile(`^(?:alza|aumenta|più alto|piu alto)\s+(?:il\s+|l')?(?:volume|audio)\s+(?:del|di|al)\s+(?:pc|computer|sistema|windows)`)
	rePCVolDown = regexp.MustCompile(`^(?:abbassa|diminuisci|più basso|piu basso)\s+(?:il\s+|l')?(?:volume|audio)\s+(?:del|di|al)\s+(?:pc|computer|sistema|windows)`)
	rePCVolSet  = regexp.MustCompile(`^(?:metti\s+)?(?:il\s+)?volume\s+(?:del|di)\s+(?:pc|computer|sistema|windows)\s+(?:a|al)\s+(\d{1,3})`)
	rePCMute    = regexp.MustCompile(`^(?:metti\s+(?:il\s+)?(?:pc|computer)\s+(?:in|a)\s+muto|muta (?:il\s+)?(?:pc|computer)|silenzia(?:\s+il)?\s+(?:pc|computer)|togli (?:l')?audio(?: del pc)?|riattiva (?:l')?audio(?: del pc)?|muto)[\s.!]*$`)
	rePCShot    = regexp.MustCompile(`(?:screenshot|cattura(?: lo| dello)? schermo|foto (?:allo|dello) schermo|stampa schermo|screen dello schermo)`)
	rePCLock    = regexp.MustCompile(`^(?:blocca|bloccami)\s+(?:il\s+|lo\s+)?(?:pc|computer|schermo)`)
	rePCOff     = regexp.MustCompile(`^(?:spegni|spegnimi|arresta)\s+(?:il\s+)?(?:pc|computer)`)
	rePCRestart = regexp.MustCompile(`^(?:riavvia|riavviami)\s+(?:il\s+)?(?:pc|computer)`)
	rePCSleep   = regexp.MustCompile(`^(?:sospendi|metti in sospensione|metti a dormire|manda in sospensione)\s+(?:il\s+)?(?:pc|computer)`)
)

// parsePC: comandi per il PC (Kind "pc", Text: volup | voldown | volset | mute | screenshot | lock | shutdown | restart | sleep)
func parsePC(low string) Command {
	low = strings.TrimSpace(strings.Trim(low, " .!?"))
	// volume di Windows: serve dire "del pc / computer / sistema / windows" (senza, è la musica del Player)
	if rePCVolWord.MatchString(low) && rePCWord.MatchString(low) {
		switch {
		case rePCVolMax.MatchString(low):
			return Command{Kind: "pc", Text: "volset", Arg: "100"}
		case rePCVolMin.MatchString(low):
			return Command{Kind: "pc", Text: "volset", Arg: "0"}
		}
		if g := rePCVolBy.FindStringSubmatch(low); g != nil { // "alza il volume del pc di 20"
			if regexp.MustCompile(`^(?:abbassa|diminuisci|riduci)`).MatchString(low) {
				return Command{Kind: "pc", Text: "voldown", Arg: g[1]}
			}
			return Command{Kind: "pc", Text: "volup", Arg: g[1]}
		}
		if g := rePCVolTo.FindStringSubmatch(low); g != nil { // "… al 100", "… a 30%"
			return Command{Kind: "pc", Text: "volset", Arg: g[1]}
		}
		switch {
		case regexp.MustCompile(`^(?:alza|aumenta|più alto|piu alto|più forte|piu forte)`).MatchString(low):
			return Command{Kind: "pc", Text: "volup"}
		case regexp.MustCompile(`^(?:abbassa|diminuisci|riduci|più basso|piu basso|più piano|piu piano)`).MatchString(low):
			return Command{Kind: "pc", Text: "voldown"}
		}
	}
	switch {
	case rePCMute.MatchString(low):
		return Command{Kind: "pc", Text: "mute"}
	case rePCShot.MatchString(low) && len(strings.Fields(low)) <= 6:
		return Command{Kind: "pc", Text: "screenshot"}
	case rePCLock.MatchString(low):
		return Command{Kind: "pc", Text: "lock"}
	case rePCOff.MatchString(low):
		return Command{Kind: "pc", Text: "shutdown"}
	case rePCRestart.MatchString(low):
		return Command{Kind: "pc", Text: "restart"}
	case rePCSleep.MatchString(low):
		return Command{Kind: "pc", Text: "sleep"}
	}
	return Command{}
}

var (
	reTwTitle    = regexp.MustCompile(`(?i)^(?:cambia|metti|imposta|aggiorna|modifica)\s+(?:il\s+)?titolo(?:\s+della\s+(?:live|diretta))?\s*(?:in|a|con|:)?\s*["“]?(.+?)["”]?$`)
	reTwGame     = regexp.MustCompile(`(?i)^(?:cambia|metti|imposta|aggiorna)\s+(?:il\s+gioco|la\s+categoria)(?:\s+della\s+(?:live|diretta))?\s*(?:in|a|con|:)?\s+(.+?)[\s.!]*$`)
	reTwShout    = regexp.MustCompile(`(?i)^(?:fai\s+(?:uno\s+|lo\s+)?)?shout\s*-?\s*out\s+(?:a\s+|per\s+)?@?([\w]+)`)
	reTwRaid     = regexp.MustCompile(`(?i)^(?:fai\s+(?:un\s+|il\s+)?)?raid\s+(?:a|ad|verso|su|da)\s+@?([\w]+)`)
	reTwChat     = regexp.MustCompile(`(?i)^(?:scrivi|manda|invia|di'|dì|di)\s+(?:in|nella|alla)\s+chat\s*:?\s*(.+)$`)
	reTwAnnounce = regexp.MustCompile(`(?i)^(?:fai\s+un\s+annuncio|annuncio|annuncia)(?:\s+in\s+chat)?\s*:?\s*(.+)$`)
	reTwMarker   = regexp.MustCompile(`(?i)^(?:(?:metti|segna|aggiungi|fai)\s+un\s+)?(?:segnalibro|marker)(?:\s+(?:qui|adesso))?(?:\s*:\s*(.+))?$`)
	reTwClip     = regexp.MustCompile(`(?i)^(?:clippa(?:\s+questo|\s+quello|\s+ora)?|(?:fai|crea)\s+(?:una\s+)?clip(?:\s+di questo|\s+ora)?)[\s.!]*$`)
	reTwViewers  = regexp.MustCompile(`(?i)(?:quanti\s+(?:spettatori|viewer|viewers)|quante persone (?:mi )?(?:stanno guardando|guardano|ci sono)|quanti mi (?:stanno guardando|guardano)|quanta gente c'è)`)
)

// parseTwitch: la live a comando (Kind "twitch", Text: title | game | shoutout | raid | chat | announce | marker | clip | viewers)
func parseTwitch(t string) Command {
	t = strings.TrimSpace(t)
	if g := reTwTitle.FindStringSubmatch(t); g != nil {
		return Command{Kind: "twitch", Text: "title", Arg: strings.TrimSpace(g[1])}
	}
	if g := reTwGame.FindStringSubmatch(t); g != nil {
		return Command{Kind: "twitch", Text: "game", Arg: strings.TrimSpace(g[1])}
	}
	if g := reTwShout.FindStringSubmatch(t); g != nil {
		return Command{Kind: "twitch", Text: "shoutout", Arg: g[1]}
	}
	if g := reTwRaid.FindStringSubmatch(t); g != nil {
		return Command{Kind: "twitch", Text: "raid", Arg: g[1]}
	}
	if g := reTwChat.FindStringSubmatch(t); g != nil {
		return Command{Kind: "twitch", Text: "chat", Arg: strings.TrimSpace(g[1])}
	}
	if g := reTwAnnounce.FindStringSubmatch(t); g != nil {
		return Command{Kind: "twitch", Text: "announce", Arg: strings.TrimSpace(g[1])}
	}
	if g := reTwMarker.FindStringSubmatch(t); g != nil {
		return Command{Kind: "twitch", Text: "marker", Arg: strings.TrimSpace(g[1])}
	}
	if reTwClip.MatchString(t) {
		return Command{Kind: "twitch", Text: "clip"}
	}
	if reTwViewers.MatchString(t) {
		return Command{Kind: "twitch", Text: "viewers"}
	}
	return Command{}
}
