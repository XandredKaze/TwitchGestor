package main

// Creare impegni, cose da fare e live di Howl-UP parlando normalmente:
//   "domani alle 15 ho il dentista", "cena con Marco venerdì dalle 20 alle 23, avvisami un'ora prima",
//   "ogni martedì e giovedì alle 18 palestra fino a dicembre", "segna tra le cose da fare il microfono entro sabato",
//   "live di Elden Ring venerdì alle 21 per 3 ore".
// Regole scritte a mano (niente IA): le date vengono sempre giuste e funziona anche senza Ollama.
// Silver mostra la scheda prima di salvare; le correzioni ("no, alle 17", "spostalo a venerdì") la aggiornano.
// Niente di Windows qui (agendaparse_test.go).

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type Repeat struct {
	Freq     string `json:"freq"` // none | daily | weekly | monthly | yearly
	Interval int    `json:"interval"`
	Days     []int  `json:"days"` // 1 = lunedì … 7 = domenica
	Until    string `json:"until"`
}

type Draft struct {
	Kind        string // event | task | live
	Title       string
	Category    string // id della categoria di Howl-UP
	Date        string // "2026-10-30"
	Time        string // "16:00" ("" = tutto il giorno)
	EndTime     string
	DurationMin int
	AllDay      bool
	Notes       string
	RemindMin   int // -1 = non detto (vale quello della categoria)
	Repeat      Repeat
	Due         string // cose da fare: entro quando
	Game        string // live: il gioco
	found       map[string]bool
}

type Category struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

var defaultCategories = []Category{{"live", "Live"}, {"work", "Lavoro"}, {"personal", "Personale"}, {"cube", "Cube"}}

const (
	reWD   = `(lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)`
	reWDnc = `(?:lunedì|lunedi|martedì|martedi|mercoledì|mercoledi|giovedì|giovedi|venerdì|venerdi|sabato|domenica)`
	reMon  = `(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)`
	reNum  = `(\d+|un|una|uno|un'|mezz'|mezza|mezzo|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|quindici|venti|trenta|quaranta|quarantacinque|novanta)`
	// fine parola anche dopo le lettere accentate (in RE2 \b vale solo per le lettere senza accento)
	end   = `(?:[\s,.;:!?]|$)`
	reHM  = `(\d{1,2})(?:[:.](\d{2}))?(?:\s+e\s+(mezza|mezzo|un quarto|quarto|tre quarti|\d{1,2}))?`
	rePOD = `(?:\s+(?:di|del|della|dell'|in)\s*(mattina|mattino|pomeriggio|sera|notte))?`
)

var (
	wdNum  = map[string]int{"lunedì": 1, "lunedi": 1, "martedì": 2, "martedi": 2, "mercoledì": 3, "mercoledi": 3, "giovedì": 4, "giovedi": 4, "venerdì": 5, "venerdi": 5, "sabato": 6, "domenica": 7}
	monNum = map[string]int{"gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6, "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12}
	words  = map[string]float64{"un": 1, "una": 1, "uno": 1, "un'": 1, "mezz'": 0.5, "mezza": 0.5, "mezzo": 0.5, "due": 2, "tre": 3, "quattro": 4, "cinque": 5, "sei": 6, "sette": 7, "otto": 8, "nove": 9, "dieci": 10, "undici": 11, "dodici": 12, "quindici": 15, "venti": 20, "trenta": 30, "quaranta": 40, "quarantacinque": 45, "novanta": 90}
	weekIT = []string{"", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"}
	monIT  = []string{"", "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"}
)

func numOf(s string) float64 {
	s = strings.TrimSpace(s)
	if v, ok := words[s]; ok {
		return v
	}
	f, _ := strconv.ParseFloat(strings.ReplaceAll(s, ",", "."), 64)
	return f
}

// minuti da "un'ora", "30 minuti", "2 giorni", "mezz'ora"
func minutesOf(n, unit string) int {
	v := numOf(n)
	switch {
	case strings.HasPrefix(unit, "minut") || unit == "min":
		return int(v)
	case strings.HasPrefix(unit, "or"):
		return int(v * 60)
	case strings.HasPrefix(unit, "giorn"):
		return int(v * 1440)
	case strings.HasPrefix(unit, "settiman"):
		return int(v * 10080)
	}
	return 0
}

// --- il testo da leggere: si "consumano" i pezzi riconosciuti; quello che resta è il titolo ---

type scan struct {
	orig string // testo originale (per titolo e note con le maiuscole)
	work string // minuscolo, con i pezzi già usati cancellati (stessa lunghezza)
}

func newScan(text string) *scan {
	low := strings.ToLower(text)
	if len(low) != len(text) { // lettere che cambiano lunghezza: si lavora sul minuscolo
		text = low
	}
	return &scan{orig: text, work: low}
}

// take: la prima corrispondenza (gruppi in minuscolo), e la cancella
func (s *scan) take(re *regexp.Regexp) []string {
	loc := re.FindStringSubmatchIndex(s.work)
	if loc == nil {
		return nil
	}
	g := make([]string, len(loc)/2)
	for i := range g {
		if loc[2*i] >= 0 {
			g[i] = s.work[loc[2*i]:loc[2*i+1]]
		}
	}
	s.blank(loc[0], loc[1])
	return g
}

// takeOrig: come take, ma il gruppo 1 dal testo originale (maiuscole comprese)
func (s *scan) takeOrig(re *regexp.Regexp) (string, bool) {
	loc := re.FindStringSubmatchIndex(s.work)
	if loc == nil || loc[2] < 0 {
		return "", false
	}
	var b strings.Builder
	for i := loc[2]; i < loc[3]; i++ { // dal testo originale, ma senza i pezzi già usati
		if s.work[i] == ' ' {
			b.WriteByte(' ')
		} else {
			b.WriteByte(s.orig[i])
		}
	}
	s.blank(loc[0], loc[1])
	return strings.Join(strings.Fields(b.String()), " "), true
}

func (s *scan) blank(a, b int) {
	s.work = s.work[:a] + strings.Repeat(" ", b-a) + s.work[b:]
}

func (s *scan) rest() string {
	var b strings.Builder
	for i := 0; i < len(s.work); i++ {
		if s.work[i] == ' ' && s.orig[i] != ' ' {
			b.WriteByte(' ')
		} else {
			b.WriteByte(s.orig[i])
		}
	}
	return b.String()
}

// --- date e ore ---

func dayKey(t time.Time) string { return t.Format("2006-01-02") }

func midnight(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func weekdayNum(t time.Time) int { return (int(t.Weekday())+6)%7 + 1 }

// il prossimo giorno della settimana (oggi compreso, se non è già passato; "prossimo" lo salta)
func nextWD(now time.Time, wd int, skipToday bool) time.Time {
	d := (wd - weekdayNum(now) + 7) % 7
	if d == 0 && skipToday {
		d = 7
	}
	return midnight(now).AddDate(0, 0, d)
}

func dayMonth(now time.Time, d, m, y int) (time.Time, bool) {
	if d < 1 || d > 31 || m < 1 || m > 12 {
		return time.Time{}, false
	}
	if y == 0 {
		y = now.Year()
		t := time.Date(y, time.Month(m), d, 0, 0, 0, 0, now.Location())
		if t.Before(midnight(now)) {
			t = t.AddDate(1, 0, 0) // già passato: l'anno prossimo
		}
		return t, t.Day() == d
	}
	if y < 100 {
		y += 2000
	}
	t := time.Date(y, time.Month(m), d, 0, 0, 0, 0, now.Location())
	return t, t.Day() == d
}

var (
	reDateTomorrow2 = regexp.MustCompile(`(?:^|\s)dopodomani` + end)
	reDateTomorrow  = regexp.MustCompile(`(?:^|\s)(?:per\s+)?domani` + end)
	reDateToday     = regexp.MustCompile(`(?:^|\s)(oggi|stamattina|stamani|stasera|stanotte|stanotte)` + end)
	reDateIn        = regexp.MustCompile(`(?:^|\s)(?:tra|fra)\s+` + reNum + `\s*(giorni|giorno|settimane|settimana|mesi|mese)` + end)
	reDateDM        = regexp.MustCompile(`(?:^|\s)(?:` + reWDnc + `\s+)?(?:il\s+|l'|per il\s+)?(\d{1,2}|primo)\s*(?:di\s+)?` + reMon + `(?:\s+(\d{4}))?` + end)
	reDateNum       = regexp.MustCompile(`(?:^|\s)(?:` + reWDnc + `\s+)?(?:il\s+|l')?(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?` + end)
	reDateWD        = regexp.MustCompile(`(?:^|\s)(?:per\s+|di\s+)?(?:il\s+|la\s+|questo\s+|questa\s+)?(prossimo\s+|prossima\s+)?` + reWD + `(\s+prossimo|\s+prossima|\s+della prossima settimana)?` + end)
	reDateDay       = regexp.MustCompile(`(?:^|\s)(?:il|per il)\s+(\d{1,2})` + end)
	reNextWeek      = regexp.MustCompile(`(?:^|\s)(?:la\s+)?(?:prossima settimana|settimana prossima)` + end)
	rePOD2          = regexp.MustCompile(`(?:^|\s)(?:di\s+|in\s+|nel\s+|nella\s+)?(mattina|mattino|pomeriggio|sera|serata|notte)` + end)
)

// takeDate: un giorno detto in qualsiasi modo ("" se non c'è); pod = parte del giorno se detta (stasera → sera)
func (s *scan) takeDate(now time.Time) (date string, pod string) {
	if g := s.take(reDateTomorrow2); g != nil {
		return dayKey(midnight(now).AddDate(0, 0, 2)), ""
	}
	if g := s.take(reDateToday); g != nil {
		switch g[1] {
		case "stamattina", "stamani":
			pod = "mattina"
		case "stasera":
			pod = "sera"
		case "stanotte":
			pod = "notte"
		}
		return dayKey(now), pod
	}
	if g := s.take(reDateTomorrow); g != nil {
		return dayKey(midnight(now).AddDate(0, 0, 1)), ""
	}
	if g := s.take(reDateIn); g != nil {
		n := int(numOf(g[1]))
		t := midnight(now)
		switch {
		case strings.HasPrefix(g[2], "giorn"):
			t = t.AddDate(0, 0, n)
		case strings.HasPrefix(g[2], "settiman"):
			t = t.AddDate(0, 0, 7*n)
		default:
			t = t.AddDate(0, n, 0)
		}
		return dayKey(t), ""
	}
	if g := s.take(reDateDM); g != nil {
		d := 1
		if g[1] != "primo" {
			d, _ = strconv.Atoi(g[1])
		}
		y, _ := strconv.Atoi(g[3])
		if t, ok := dayMonth(now, d, monNum[g[2]], y); ok {
			return dayKey(t), ""
		}
	}
	if g := s.take(reDateNum); g != nil {
		d, _ := strconv.Atoi(g[1])
		m, _ := strconv.Atoi(g[2])
		y, _ := strconv.Atoi(g[3])
		if t, ok := dayMonth(now, d, m, y); ok {
			return dayKey(t), ""
		}
	}
	if g := s.take(reDateWD); g != nil {
		skip := strings.Contains(g[3], "settimana")
		t := nextWD(now, wdNum[g[2]], skip || strings.TrimSpace(g[1]+g[3]) != "")
		if skip && t.Sub(midnight(now)) < 7*24*time.Hour { // "della prossima settimana": nella settimana dopo
			for weekdayNum(t) != wdNum[g[2]] || t.Sub(nextWD(now, 1, true)) < 0 {
				t = t.AddDate(0, 0, 7)
			}
		}
		return dayKey(t), ""
	}
	if s.take(reNextWeek) != nil {
		return dayKey(nextWD(now, 1, true)), ""
	}
	if g := s.take(reDateDay); g != nil {
		d, _ := strconv.Atoi(g[1])
		t, ok := dayMonth(now, d, int(now.Month()), now.Year())
		if ok && t.Before(midnight(now)) {
			t, ok = dayMonth(now, d, int(now.Month())%12+1, now.Year()+int(now.Month())/12)
		}
		if ok {
			return dayKey(t), ""
		}
	}
	return "", ""
}

// hm: "15", "15:30", "3 e mezza" + parte del giorno → "15:30"
func hm(h, m, extra, pod string) (string, bool) {
	hh, err := strconv.Atoi(h)
	if err != nil || hh > 24 {
		return "", false
	}
	mm, _ := strconv.Atoi(m)
	switch extra {
	case "mezza", "mezzo":
		mm = 30
	case "un quarto", "quarto":
		mm = 15
	case "tre quarti":
		mm = 45
	case "":
	default:
		mm, _ = strconv.Atoi(extra)
	}
	switch pod {
	case "pomeriggio", "sera":
		if hh < 12 {
			hh += 12
		}
	case "notte":
		if hh >= 7 && hh < 12 {
			hh += 12
		}
	case "mattina", "mattino":
	default:
		if hh >= 1 && hh <= 6 { // "alle 3": di solito il pomeriggio
			hh += 12
		}
	}
	if hh == 24 {
		hh = 0
	}
	if mm > 59 {
		return "", false
	}
	return fmt.Sprintf("%02d:%02d", hh, mm), true
}

var (
	reRange    = regexp.MustCompile(`(?:^|\s)(?:dalle|dall'|dalla|da)\s*` + reHM + rePOD + `\s*(?:alle|all'|a|fino alle|fino all'|-)\s*` + reHM + rePOD + end)
	reRange2   = regexp.MustCompile(`(?:^|\s)(\d{1,2})(?:[:.](\d{2}))?\s*-\s*(\d{1,2})(?:[:.](\d{2}))?` + end)
	reEvAt     = regexp.MustCompile(`(?:^|\s)(?:alle|all'|ore|alle ore|verso le|per le|dalle)\s*` + reHM + rePOD + end)
	reAtBare   = regexp.MustCompile(`(?:^|\s)(\d{1,2})[:.](\d{2})` + end)
	reNoon     = regexp.MustCompile(`(?:^|\s)(?:a\s+|alle\s+|verso\s+)?(mezzogiorno|mezzanotte)` + end)
	reDur      = regexp.MustCompile(`(?:^|\s)(?:per|dura|durata(?: di)?)\s+(?:` + reNum + `\s*'?\s*(ore|ora|minuti|minuto|min)(?:\s+e\s+(mezza|mezzo))?)` + end)
	reAllDay   = regexp.MustCompile(`(?:^|\s)(tutto il giorno|tutta la giornata|giornata intera|intera giornata)` + end)
	reEvRemind = regexp.MustCompile(`(?:^|\s)(?:e\s+)?(?:avvisami|avvertimi|ricordamelo|ricordamela|notificami|mandami (?:un )?promemoria|con (?:un )?promemoria|promemoria)\s+(?:(?:di|da|a)\s+)?(?:` + reNum + `\s*'?\s*(minuti|minuto|min|ore|ora|giorni|giorno|settimane|settimana)|(il giorno|la sera|la mattina))\s+prima` + end)
	reNoRem    = regexp.MustCompile(`(?:^|\s)(?:senza promemoria|non avvisarmi|niente promemoria|nessun promemoria)` + end)
	reNotes    = regexp.MustCompile(`(?:^|[\s,;])(?:note|nota|con la nota|con nota|dettagli|descrizione|appunti)\s*[:\-]\s*(.+)$`)
	reNotes2   = regexp.MustCompile(`(?:^|[\s,;])(?:con (?:la )?nota|annota che|scrivi nelle note)\s+(.+)$`)
	reTitle    = regexp.MustCompile(`(?:^|\s)(?:titolo|chiamalo|chiamala|intitolalo|intitolala|il nome è|nome)\s*[:\-]?\s*["“']?([^"”',;]+)["”']?`)
	reUntil    = regexp.MustCompile(`(?:^|\s)(?:fino al|fino alla|fino a|fino all'|fino a tutto|finché non arriva)\s+(?:(fine anno|fine mese)|(?:fine\s+)?` + reMon + `(?:\s+(\d{4}))?|(\d{1,2}|primo)\s*(?:di\s+)?` + reMon + `(?:\s+(\d{4}))?|(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?)` + end)
	reForN     = regexp.MustCompile(`(?:^|\s)per\s+` + reNum + `\s+(settimane|mesi)` + end)
	reRepN     = regexp.MustCompile(`(?:^|\s)ogni\s+` + reNum + `\s+(settimane|giorni|mesi)` + end)
	reDaily    = regexp.MustCompile(`(?:^|\s)(?:ogni giorno|tutti i giorni|tutti i santi giorni|quotidianamente|giornalmente)` + end)
	reWeekday  = regexp.MustCompile(`(?:^|\s)(?:dal lunedì al venerdì|dal lunedi al venerdi|nei giorni feriali|i giorni feriali|giorni feriali|ogni giorno feriale)` + end)
	reEveryWD  = regexp.MustCompile(`(?:^|\s)(?:ogni|tutti i|tutte le|ogni settimana il|ogni settimana la|di)\s+` + reWD + `((?:\s*(?:,|e)\s*(?:il\s+|la\s+|ogni\s+)?` + reWD + `)*)` + end)
	reMultiWD  = regexp.MustCompile(`(?:^|\s)(?:il|la)\s+` + reWD + `((?:\s*(?:,|e)\s*(?:il\s+|la\s+)?` + reWD + `)+)` + end)
	reWeekly   = regexp.MustCompile(`(?:^|\s)(?:ogni settimana|settimanale|settimanalmente|una volta a settimana|una volta alla settimana)` + end)
	reMonthly  = regexp.MustCompile(`(?:^|\s)(?:ogni mese|mensile|mensilmente|una volta al mese)` + end)
	reYearly   = regexp.MustCompile(`(?:^|\s)(?:ogni anno|annuale|annualmente|una volta all'anno)` + end)
	reDue      = regexp.MustCompile(`(?:^|\s)(?:entro|per|prima di)\s+(?:il\s+|la\s+|l')?`)
	reWDany    = regexp.MustCompile(reWD)
)

// --- tipo, categoria e parole che non fanno parte del titolo ---

var (
	reTask       = regexp.MustCompile(`(?:^|\s)(?:cose da fare|cosa da fare|da fare|to do|todo|lista|task|compito|compiti|attività)` + end)
	reLive       = regexp.MustCompile(`(?:^|\s)(live|diretta|in streaming|stream|streaming)` + end)
	reGame       = regexp.MustCompile(`(?:^|\s)(?:live|diretta|stream|streaming)\s+(?:di|su|a|giocando a)\s+(.+)$`)
	reGameSay    = regexp.MustCompile(`(?:^|[\s,;])(?:gioco|giochiamo a|giocando a|si gioca a)\s*:?\s*([^,;]+)`)
	reWork       = regexp.MustCompile(`(?:^|\s)(lavoro|riunione|meeting|call|ufficio|cliente|colloquio|consegna|scadenza di lavoro)` + end)
	reShift      = regexp.MustCompile(`(?:^|\s)(turno|cube)` + end)
	reCatSay     = regexp.MustCompile(`(?:^|\s)(?:categoria|tipo|nella categoria|in categoria|come)\s+([\p{L}\d]+)` + end)
	reEvLead     = regexp.MustCompile(`^(?:\s|[,.:;!-])*(?:silver[,\s]+)?(?:(?:ehi|ok)\s+)?(?:per favore\s+|perfavore\s+)?(?:puoi\s+|potresti\s+|mi\s+)?(?:aggiungermi|aggiungimi|aggiungere|aggiungi|crearmi|creami|creare|crea|segnarmi|segnami|segnare|segna|mettermi|mettimi|mettere|metti|inserirmi|inseriscimi|inserire|inserisci|programmarmi|programmami|programmare|programma|fissarmi|fissami|fissare|fissa|salvare|salva|registrare|registra|annotare|annota|pianificare|pianifica|ricordati|ricorda|nuovo|nuova)?\s*(?:che\s+)?(?:un\s+|una\s+|un'|il\s+|lo\s+|la\s+|l')?(?:nuovo\s+|nuova\s+)?(?:impegno|appuntamento|evento|cosa da fare|attività|task|compito|live|diretta)?\s*(?:in agenda|in howl-?up|nel calendario|nell'agenda|alle cose da fare|nelle cose da fare|tra le cose da fare|fra le cose da fare|nella lista(?: delle cose da fare)?|in lista|da fare)?\s*[:,\-]?\s*`)
	reEvLeadLive = regexp.MustCompile(strings.Replace(reEvLead.String(), "|live|diretta)", ")", 1))
	reHave       = regexp.MustCompile(`(?:^|\s)(?:ho|abbiamo|c'è|ce|c'e|devo andare|devo|dobbiamo|vado|andiamo)(?:\s+(?:un|una|un'|il|lo|la|l'|i|gli|le))?(?:\s+(?:appuntamento|impegno))?(?:\s+(?:con|dal|dalla|dallo|dai|al|alla|allo|a|in))?` + end)
	reEdgeWord   = regexp.MustCompile(`^(?:e|ed|di|del|della|il|lo|la|i|gli|le|un|uno|una|un'|per|a|al|alla|che|con|in|da|dal|dalla|ore|alle|poi|anche|devo|ho)\s+|\s+(?:e|ed|di|del|della|il|lo|la|i|gli|le|un|uno|una|per|a|al|alla|che|con|in|da|dal|dalla|alle|ore|poi|anche)$`)
	reTaskVerb   = regexp.MustCompile(`^(?:devo|dovrei|bisogna|ricordarsi di|ricordarmi di)\s+`)
)

// IsCreateRequest: vuoi creare un impegno, una cosa da fare o una live? (non una domanda sugli impegni)
func IsCreateRequest(text string, now time.Time) bool {
	low := strings.ToLower(strings.TrimSpace(text))
	if strings.HasSuffix(low, "?") && !regexp.MustCompile(`^(?:puoi|potresti|mi)\s`).MatchString(low) {
		return false // "quando ho il dentista?" è una domanda
	}
	if regexp.MustCompile(`^(?:ricordami|ricordarmi|avvisami|timer|promemoria|metti un timer|imposta un timer)` + end).MatchString(low) {
		return false // promemoria e timer di Silver (sul PC), non impegni dell'agenda
	}
	if regexp.MustCompile(`^(?:che|quali|quale|qual|quando|cosa|dove|come|quanti|quante|chi|perché|perche|ho\s+(?:qualche|degli|impegni))` + end).MatchString(low) {
		return false // "che impegni ho domani", "quando ho il dentista"
	}
	verb := regexp.MustCompile(`^(?:silver[,\s]+)?(?:per favore\s+)?(?:puoi\s+|potresti\s+|mi\s+)?(?:aggiungi|aggiungimi|aggiungere|aggiungermi|crea|creami|creare|crearmi|segna|segnami|segnare|segnarmi|metti|mettimi|mettere|mettermi|inserisci|inseriscimi|inserire|inserirmi|programma|programmami|programmare|programmarmi|fissa|fissami|fissare|fissarmi|salva|salvare|registra|registrare|annota|annotare|pianifica|pianificare|nuovo|nuova)` + end).MatchString(low)
	noun := regexp.MustCompile(`(?:impegno|appuntamento|evento|in agenda|agenda|calendario|cose da fare|cosa da fare|da fare|to do|todo|in lista|nella lista|task|compito|riunione|turno|scadenza|live|diretta)`).MatchString(low)
	s := newScan(low)
	date, _ := s.takeDate(now)
	hasTime := reEvAt.MatchString(low) || reRange.MatchString(low) || reAtBare.MatchString(low) || reNoon.MatchString(low)
	have := reHave.MatchString(low)
	switch {
	case verb && (noun || date != "" || hasTime):
		return true
	case noun && regexp.MustCompile(`^(?:nuovo|nuova)\s`).MatchString(low):
		return true
	case date != "" && have && !strings.Contains(low, "?"): // "domani alle 15 ho il dentista"
		return true
	case reEveryWD.MatchString(low) || reDaily.MatchString(low): // "ogni martedì alle 18 palestra"
		return hasTime || noun
	case date != "" && (reYearly.MatchString(low) || reMonthly.MatchString(low) || reWeekly.MatchString(low)): // "compleanno di Ada il 12/11, ogni anno"
		return true
	case noun && date != "" && hasTime: // "live di Elden Ring venerdì alle 21", "turno sabato dalle 23"
		return true
	case date != "" && hasTime && len(strings.Fields(low)) <= 10: // "dentista il 3/12 alle 11"
		return true
	}
	return false
}

// ParseDraft: tutti i dettagli dell'impegno (o della cosa da fare, o della live) dalla frase
func ParseDraft(text string, now time.Time, cats []Category) Draft {
	if len(cats) == 0 {
		cats = defaultCategories
	}
	d := Draft{RemindMin: -1, found: map[string]bool{}}
	s := newScan(strings.TrimSpace(text))
	low := s.work
	set := func(k string) { d.found[k] = true }

	// note e titolo detti apertamente (prima di tutto: dentro ci può essere qualsiasi cosa)
	if v, ok := s.takeOrig(reNotes); ok {
		d.Notes = strings.TrimSpace(v)
		set("notes")
	} else if v, ok := s.takeOrig(reNotes2); ok {
		d.Notes = strings.TrimSpace(v)
		set("notes")
	}
	if v, ok := s.takeOrig(reTitle); ok {
		d.Title = cleanTitle(v)
		set("title")
		set("titlesay") // detto apertamente: "chiamalo …"
	}

	// tipo (senza guardare dentro le note)
	low = s.work
	switch {
	case reTask.MatchString(low):
		d.Kind = "task"
	case reLive.MatchString(low):
		d.Kind = "live"
	default:
		d.Kind = "event"
	}
	if d.Kind != "event" {
		set("kind")
	}

	// promemoria
	if g := s.take(reEvRemind); g != nil {
		switch {
		case g[3] == "il giorno":
			d.RemindMin = 1440
		case g[3] == "la sera":
			d.RemindMin = 720
		case g[3] == "la mattina":
			d.RemindMin = 1440
		default:
			d.RemindMin = minutesOf(g[1], g[2])
		}
		set("remind")
	} else if s.take(reNoRem) != nil {
		d.RemindMin = 0
		set("remind")
	}

	// ripetizione (prima delle date: "ogni lunedì" non è "lunedì")
	if g := s.take(reUntil); g != nil {
		var t time.Time
		var ok bool
		switch {
		case g[1] == "fine anno":
			t, ok = time.Date(now.Year(), 12, 31, 0, 0, 0, 0, now.Location()), true
		case g[1] == "fine mese":
			t, ok = time.Date(now.Year(), now.Month()+1, 0, 0, 0, 0, 0, now.Location()), true
		case g[2] != "": // "fino a dicembre": tutto il mese
			y, _ := strconv.Atoi(g[3])
			if y == 0 {
				y = now.Year()
				if monNum[g[2]] < int(now.Month()) {
					y++
				}
			}
			t, ok = time.Date(y, time.Month(monNum[g[2]]+1), 0, 0, 0, 0, 0, now.Location()), true
		case g[5] != "":
			dd := 1
			if g[4] != "primo" {
				dd, _ = strconv.Atoi(g[4])
			}
			y, _ := strconv.Atoi(g[6])
			t, ok = dayMonth(now, dd, monNum[g[5]], y)
		default:
			dd, _ := strconv.Atoi(g[7])
			mm, _ := strconv.Atoi(g[8])
			y, _ := strconv.Atoi(g[9])
			t, ok = dayMonth(now, dd, mm, y)
		}
		if ok {
			d.Repeat.Until = dayKey(t)
			set("until")
		}
	}
	forN := s.take(reForN)
	if g := s.take(reRepN); g != nil {
		n := max(1, int(numOf(g[1])))
		switch g[2] {
		case "settimane":
			d.Repeat = Repeat{Freq: "weekly", Interval: n, Until: d.Repeat.Until}
		case "giorni":
			d.Repeat = Repeat{Freq: "daily", Interval: n, Until: d.Repeat.Until}
		default:
			d.Repeat = Repeat{Freq: "monthly", Interval: n, Until: d.Repeat.Until}
		}
		set("repeat")
	}
	if s.take(reWeekday) != nil {
		d.Repeat.Freq, d.Repeat.Days = "weekly", []int{1, 2, 3, 4, 5}
		set("repeat")
	}
	if g := s.take(reMultiWD); g != nil { // "il martedì e il venerdì": tutte le settimane
		days := []int{wdNum[g[1]]}
		for _, w := range reWDany.FindAllString(g[2], -1) {
			days = append(days, wdNum[w])
		}
		sort.Ints(days)
		d.Repeat.Freq, d.Repeat.Days = "weekly", uniq(days)
		set("repeat")
	}
	if g := s.take(reEveryWD); g != nil {
		days := []int{wdNum[g[1]]}
		for _, w := range reWDany.FindAllString(g[2], -1) {
			days = append(days, wdNum[w])
		}
		sort.Ints(days)
		d.Repeat.Freq, d.Repeat.Days = "weekly", uniq(days)
		set("repeat")
	}
	switch {
	case s.take(reDaily) != nil:
		d.Repeat.Freq = "daily"
		set("repeat")
	case s.take(reWeekly) != nil:
		if d.Repeat.Freq == "" {
			d.Repeat.Freq = "weekly"
		}
		set("repeat")
	case s.take(reMonthly) != nil:
		d.Repeat.Freq = "monthly"
		set("repeat")
	case s.take(reYearly) != nil:
		d.Repeat.Freq = "yearly"
		set("repeat")
	}
	if d.Repeat.Interval == 0 && d.Repeat.Freq != "" {
		d.Repeat.Interval = 1
	}

	// ore: "dalle 15 alle 17", "15-17", "alle 15 e mezza", "a mezzogiorno"
	if g := s.take(reRange); g != nil {
		if a, ok := hm(g[1], g[2], g[3], g[4]); ok {
			pod := g[8]
			if pod == "" && g[4] != "" {
				pod = g[4]
			}
			if b, ok := hm(g[5], g[6], g[7], pod); ok {
				d.Time, d.EndTime = a, b
				set("time")
				set("end")
			}
		}
	} else if g := s.take(reRange2); g != nil {
		if a, ok := hm(g[1], g[2], "", ""); ok {
			if b, ok := hm(g[3], g[4], "", ""); ok {
				d.Time, d.EndTime = a, b
				set("time")
				set("end")
			}
		}
	}
	if d.Time == "" {
		if g := s.take(reEvAt); g != nil {
			if a, ok := hm(g[1], g[2], g[3], g[4]); ok {
				d.Time = a
				set("time")
			}
		} else if g := s.take(reNoon); g != nil {
			d.Time = map[string]string{"mezzogiorno": "12:00", "mezzanotte": "00:00"}[g[1]]
			set("time")
		} else if g := s.take(reAtBare); g != nil {
			if a, ok := hm(g[1], g[2], "", "mattina"); ok {
				d.Time = a
				set("time")
			}
		}
	}
	if g := s.take(reDur); g != nil {
		m := minutesOf(g[1], g[2])
		if g[3] != "" {
			m += 30
		}
		d.DurationMin = m
		set("duration")
	}
	if s.take(reAllDay) != nil {
		d.AllDay, d.Time, d.EndTime = true, "", ""
		set("allday")
		set("time")
	}

	// giorno ("entro" per le cose da fare)
	dueAt := -1
	if d.Kind == "task" {
		if loc := reDue.FindStringIndex(s.work); loc != nil {
			dueAt = loc[0]
		}
	}
	date, pod := s.takeDate(now)
	if date != "" {
		if d.Kind == "task" {
			d.Due = date
			set("due")
			if dueAt >= 0 { // "entro" / "per" non fa parte del titolo
				if loc := reDue.FindStringIndex(s.work); loc != nil && loc[0] == dueAt {
					s.blank(loc[0], loc[1])
				}
			}
		} else {
			d.Date = date
			set("date")
		}
	}
	if pod == "" {
		if g := s.take(rePOD2); g != nil {
			pod = g[1]
		}
	}
	if d.Time == "" && pod != "" && d.Kind != "task" { // "domani sera": un orario di massima
		d.Time = map[string]string{"mattina": "09:00", "mattino": "09:00", "pomeriggio": "15:00", "sera": "20:00", "serata": "20:00", "notte": "23:00"}[pod]
		set("time")
	}
	if d.Time != "" && pod != "" && !d.found["podfixed"] { // "alle 9 di sera" detto separato: "domani sera alle 9"
		if h, _ := strconv.Atoi(d.Time[:2]); h < 12 && (pod == "sera" || pod == "pomeriggio" || pod == "serata") {
			d.Time = fmt.Sprintf("%02d:%s", h+12, d.Time[3:])
		}
	}
	// ripetizione settimanale senza giorno di partenza: il primo dei giorni detti
	if d.Date == "" && d.Repeat.Freq == "weekly" && len(d.Repeat.Days) > 0 {
		first := nextWD(now, d.Repeat.Days[0], false)
		for _, wd := range d.Repeat.Days {
			if t := nextWD(now, wd, false); t.Before(first) {
				first = t
			}
		}
		d.Date = dayKey(first)
		set("date")
	} else if d.Date == "" && d.Repeat.Freq != "" {
		d.Date = dayKey(now)
		set("date")
	}
	if forN != nil && d.Date != "" && d.Repeat.Until == "" { // "per 6 settimane"
		start, _ := time.ParseInLocation("2006-01-02", d.Date, now.Location())
		n := int(numOf(forN[1]))
		if forN[2] == "settimane" {
			d.Repeat.Until = dayKey(start.AddDate(0, 0, 7*n-1))
		} else {
			d.Repeat.Until = dayKey(start.AddDate(0, n, -1))
		}
		set("until")
		if d.Repeat.Freq == "" {
			d.Repeat.Freq, d.Repeat.Interval = "weekly", 1
		}
	}
	if d.DurationMin > 0 && d.Time != "" && d.EndTime == "" && d.Kind != "live" {
		t, _ := time.Parse("15:04", d.Time)
		d.EndTime = t.Add(time.Duration(d.DurationMin) * time.Minute).Format("15:04")
		set("end")
	}
	if d.Kind == "live" && d.EndTime != "" && d.Time != "" && d.DurationMin == 0 {
		a, _ := time.Parse("15:04", d.Time)
		b, _ := time.Parse("15:04", d.EndTime)
		if b.Before(a) {
			b = b.Add(24 * time.Hour)
		}
		d.DurationMin = int(b.Sub(a).Minutes())
	}

	// categoria
	if g := s.take(reCatSay); g != nil {
		for _, c := range cats {
			if strings.EqualFold(c.Name, g[1]) || strings.EqualFold(c.ID, g[1]) {
				d.Category = c.ID
				set("category")
			}
		}
	}
	if d.Category == "" {
		switch {
		case d.Kind == "live":
			d.Category = catID(cats, "live", "Live")
		case reShift.MatchString(low):
			d.Category = catID(cats, "cube", "Cube")
		case reWork.MatchString(low):
			d.Category = catID(cats, "work", "Lavoro")
		}
		if d.Category != "" {
			set("category")
		}
	}

	// gioco della live
	if d.Kind == "live" {
		if v, ok := s.takeOrig(reGameSay); ok {
			d.Game = cleanTitle(v)
			set("game")
		} else if v, ok := s.takeOrig(reGame); ok {
			d.Game = cleanTitle(v)
			set("game")
		}
	}

	// titolo: quello che resta, senza le parole di comando
	if !d.found["title"] {
		r := s.rest()
		appt := regexp.MustCompile(`(?i)(?:^|\s)(appuntamento|incontro)\s+con\s`).FindStringSubmatch(r)
		r = regexp.MustCompile(`(?i)(?:^|[\s,])(?:mettilo|mettila|segnalo|segnala|aggiungilo|aggiungila|salvalo|salvala|segnatelo|mettimelo)(?:\s+(?:nelle|nella|tra le|fra le|in)\s+(?:cose da fare|lista|agenda))?`).ReplaceAllString(r, " ")
		if d.Kind == "live" { // per le live "live" resta nel titolo
			r = reEvLeadLive.ReplaceAllString(r, "")
		} else {
			r = reEvLead.ReplaceAllString(r, "")
		}
		low := strings.ToLower(r)
		if loc := reHave.FindStringIndex(low); loc != nil {
			r = r[:loc[0]] + " " + r[loc[1]:]
		}
		r = regexp.MustCompile(`(?i)(?:^|\s)(?:tra|fra|nelle|alle|nella|in) (?:le )?(?:cose da fare|lista|agenda)`).ReplaceAllString(r, " ")
		if d.Kind == "live" { // "live con la community": il titolo resta "Live con la community"
			r = regexp.MustCompile(`(?i)(?:^|\s)(?:impegno|appuntamento)(?:\s|$)`).ReplaceAllString(" "+r+" ", " ")
		} else {
			r = regexp.MustCompile(`(?i)(?:^|\s)(?:impegno|appuntamento|live|diretta|stream)(?:\s|$)`).ReplaceAllString(" "+r+" ", " ")
		}
		if d.Kind == "task" {
			r = reTaskVerb.ReplaceAllString(strings.TrimSpace(r), "")
		}
		t := cleanTitle(r)
		if appt != nil && t != "" && !strings.HasPrefix(strings.ToLower(t), strings.ToLower(appt[1])) { // "appuntamento con Giulia"
			t = cleanTitle(appt[1] + " con " + t)
		}
		if t != "" {
			d.Title = t
			set("title")
		}
	}
	if d.Kind == "live" && (d.Title == "" || d.Title == "Live") {
		d.Title = "Live"
		if d.Game != "" {
			d.Title = "Live di " + d.Game
		}
	}
	if d.Kind != "task" && d.Date != "" && d.Time == "" && !d.AllDay {
		d.AllDay = true
	}
	if d.Category == "" {
		d.Category = catID(cats, "personal", "Personale")
		if d.Kind == "task" {
			d.Category = ""
		}
	}
	return d
}

func catID(cats []Category, id, name string) string {
	for _, c := range cats {
		if c.ID == id || strings.EqualFold(c.Name, name) {
			return c.ID
		}
	}
	for _, c := range cats { // la categoria che non è "live"
		if c.ID != "live" {
			return c.ID
		}
	}
	return ""
}

func uniq(a []int) []int {
	var out []int
	for i, v := range a {
		if i == 0 || v != a[i-1] {
			out = append(out, v)
		}
	}
	return out
}

// cleanTitle: senza parole di collegamento ai bordi, spazi e punteggiatura in più; prima lettera maiuscola
func cleanTitle(t string) string {
	t = strings.Join(strings.Fields(t), " ")
	for i := 0; i < 6; i++ {
		t = strings.Trim(t, " ,.;:!?-\"'“”")
		n := reEdgeWord.ReplaceAllString(strings.ToLower(t), "")
		if len(n) == len(t) {
			break
		}
		// stessa operazione sul testo con le maiuscole (le parole tolte sono ai bordi)
		low := strings.ToLower(t)
		if strings.HasPrefix(low, n) {
			t = t[:len(n)]
		} else if strings.HasSuffix(low, n) {
			t = t[len(t)-len(n):]
		} else {
			t = n
		}
	}
	t = strings.Trim(t, " ,.;:!?-\"'“”")
	if t == "" {
		return ""
	}
	r := []rune(t)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// Merge: la correzione cambia solo quello che dice ("no, alle 17", "spostalo a venerdì", "categoria lavoro")
func (d Draft) Merge(c Draft) Draft {
	f := c.found
	if f["titlesay"] { // il titolo cambia solo se lo dici ("chiamalo …"): "pausa" non rinomina l'impegno
		d.Title = c.Title
	}
	if f["kind"] {
		d.Kind = c.Kind
	}
	if f["date"] {
		d.Date = c.Date
	}
	if f["due"] {
		d.Due = c.Due
	}
	if f["time"] {
		d.Time, d.AllDay = c.Time, c.AllDay
		if !f["end"] {
			d.EndTime = ""
		}
	}
	if f["end"] {
		d.EndTime = c.EndTime
	}
	if f["duration"] {
		d.DurationMin = c.DurationMin
	}
	if f["category"] {
		d.Category = c.Category
	}
	if f["remind"] {
		d.RemindMin = c.RemindMin
	}
	if f["repeat"] {
		until := d.Repeat.Until
		d.Repeat = c.Repeat
		if !f["until"] {
			d.Repeat.Until = until
		}
	}
	if f["until"] {
		d.Repeat.Until = c.Repeat.Until
	}
	if f["notes"] {
		d.Notes = c.Notes
	}
	if f["game"] {
		d.Game = c.Game
	}
	if d.Time != "" {
		d.AllDay = false
	}
	return d
}

// Changes: la correzione ha detto qualcosa?
func (d Draft) Changes() bool {
	for k := range d.found {
		if k != "kind" && k != "title" {
			return true
		}
	}
	return false
}

// Missing: cosa manca per salvare ("" = si può salvare)
func (d Draft) Missing() string {
	switch {
	case d.Title == "":
		return "il titolo (es. \"chiamalo Dentista\")"
	case d.Kind == "live" && (d.Date == "" || d.Time == ""):
		return "giorno e ora della live"
	case d.Kind == "event" && d.Date == "":
		return "il giorno"
	}
	return ""
}

func niceDate(k string) string {
	t, err := time.Parse("2006-01-02", k)
	if err != nil {
		return k
	}
	return weekIT[weekdayNum(t)] + " " + strconv.Itoa(t.Day()) + " " + monIT[t.Month()]
}

func minutesText(m int) string {
	switch {
	case m == 0:
		return "senza promemoria"
	case m%1440 == 0:
		if m == 1440 {
			return "promemoria il giorno prima"
		}
		return fmt.Sprintf("promemoria %d giorni prima", m/1440)
	case m%60 == 0:
		if m == 60 {
			return "promemoria un'ora prima"
		}
		return fmt.Sprintf("promemoria %d ore prima", m/60)
	}
	return fmt.Sprintf("promemoria %d minuti prima", m)
}

// Summary: la scheda da confermare
func (d Draft) Summary(cats []Category) string {
	if len(cats) == 0 {
		cats = defaultCategories
	}
	var b strings.Builder
	kind := map[string]string{"event": "Impegno", "task": "Cosa da fare", "live": "Live"}[d.Kind]
	b.WriteString(kind + ": " + d.Title)
	if d.Kind == "task" {
		if d.Due != "" {
			b.WriteString("\nEntro " + niceDate(d.Due))
		}
	} else {
		if d.Date != "" {
			b.WriteString("\n" + strings.ToUpper(niceDate(d.Date)[:1]) + niceDate(d.Date)[1:])
		}
		switch {
		case d.AllDay || d.Time == "":
			b.WriteString(", tutto il giorno")
		case d.EndTime != "":
			b.WriteString(", " + d.Time + "–" + d.EndTime)
		default:
			b.WriteString(", alle " + d.Time)
		}
		if d.Kind == "live" {
			dur := d.DurationMin
			if dur == 0 {
				dur = 120
			}
			fmt.Fprintf(&b, " (%s)", durText(dur))
			if d.Game != "" {
				b.WriteString("\nGioco: " + d.Game)
			}
		}
	}
	if d.Repeat.Freq != "" && d.Repeat.Freq != "none" {
		b.WriteString("\nSi ripete " + repeatText(d.Repeat))
	}
	if d.Category != "" && d.Kind != "live" {
		for _, c := range cats {
			if c.ID == d.Category {
				b.WriteString("\nCategoria: " + c.Name)
			}
		}
	}
	if d.RemindMin >= 0 && d.Kind == "event" {
		b.WriteString("\n" + strings.ToUpper(minutesText(d.RemindMin)[:1]) + minutesText(d.RemindMin)[1:])
	}
	if d.Notes != "" {
		b.WriteString("\nNote: " + d.Notes)
	}
	return b.String()
}

func durText(m int) string {
	if m%60 == 0 {
		if m == 60 {
			return "1 ora"
		}
		return fmt.Sprintf("%d ore", m/60)
	}
	return fmt.Sprintf("%d h %02d min", m/60, m%60)
}

func repeatText(r Repeat) string {
	var s string
	switch r.Freq {
	case "daily":
		s = "ogni giorno"
		if r.Interval > 1 {
			s = fmt.Sprintf("ogni %d giorni", r.Interval)
		}
	case "weekly":
		s = "ogni settimana"
		if r.Interval > 1 {
			s = fmt.Sprintf("ogni %d settimane", r.Interval)
		}
		if len(r.Days) == 5 && r.Days[0] == 1 && r.Days[4] == 5 {
			s += ", dal lunedì al venerdì"
		} else if len(r.Days) > 0 {
			var names []string
			for _, d := range r.Days {
				names = append(names, weekIT[d])
			}
			if len(names) > 1 {
				s += ", " + strings.Join(names[:len(names)-1], ", ") + " e " + names[len(names)-1]
			} else {
				s += ", il " + names[0]
			}
		}
	case "monthly":
		s = "ogni mese"
		if r.Interval > 1 {
			s = fmt.Sprintf("ogni %d mesi", r.Interval)
		}
	case "yearly":
		s = "ogni anno"
	}
	if r.Until != "" {
		s += " fino a " + niceDate(r.Until)
	}
	return s
}

// Payload: quello che si manda a Howl-UP (via Gestor)
func (d Draft) Payload() (action string, body map[string]any) {
	switch d.Kind {
	case "task":
		return "task", map[string]any{"title": d.Title, "category": d.Category, "due": d.Due, "notes": d.Notes}
	case "live":
		dur := d.DurationMin
		if dur == 0 {
			dur = 120
		}
		return "live", map[string]any{"start": d.Date + "T" + d.Time, "durationMin": dur, "title": d.Title, "game": d.Game, "notes": d.Notes}
	}
	ev := map[string]any{"title": d.Title, "category": d.Category, "date": d.Date, "time": d.Time, "endTime": d.EndTime, "allDay": d.AllDay || d.Time == "", "notes": d.Notes}
	if d.RemindMin >= 0 {
		ev["remindMin"] = d.RemindMin
	}
	if d.Repeat.Freq != "" {
		ev["repeat"] = map[string]any{"freq": d.Repeat.Freq, "interval": max(1, d.Repeat.Interval), "days": d.Repeat.Days, "until": d.Repeat.Until}
	} else {
		ev["repeat"] = map[string]any{"freq": "none"}
	}
	return "event", ev
}

var (
	reYes = regexp.MustCompile(`^(?:sì|si|ok|okay|va bene|salva|salvalo|salvala|conferma|confermo|perfetto|esatto|giusto|vai|procedi|sì salva|si salva|certo)[\s.!]*$`)
	reNo  = regexp.MustCompile(`^(?:no|annulla|lascia stare|lascia perdere|niente|non salvare|cancella)[\s.!]*$`)
)

func isYes(t string) bool { return reYes.MatchString(strings.ToLower(strings.TrimSpace(t))) }
func isNo(t string) bool  { return reNo.MatchString(strings.ToLower(strings.TrimSpace(t))) }
