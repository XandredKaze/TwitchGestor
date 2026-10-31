package main

// Il comportamento di Silver (senza niente di Windows, così si prova anche altrove): cosa dice e quando,
// la scrittura lettera per lettera, l'idle, la domanda sui giochi, la live.

import (
	"fmt"
	"math/rand"
	"strings"
	"time"
)

// Context: il programma in primo piano. ID sceglie frasi e posa; Name compare nel fumetto;
// Key identifica il gioco (per ricordare la scelta).
type Context struct {
	ID   string
	Name string
	Key  string
}

type Action struct {
	Label  string
	Choice string // "hide" | "quiet" | "talk"
}

type Bubble struct {
	Text          string
	Source        string
	Label         string
	Actions       []Action
	Remember      bool
	RememberLabel string
	Alert         bool // promemoria e avvisi importanti: si vedono anche se l'hai fatto sparire, e restano finché non clicchi

	runes  []rune   // la pagina che si sta scrivendo
	pages  []string // risposte lunghe: a pagine, come i dialoghi dei videogiochi
	page   int
	nextAt time.Time // quando passa da sola alla pagina dopo
	start  time.Time
	typed  int
	doneAt time.Time
	hideAt time.Time
	shown  time.Time // per l'animazione di comparsa
}

const charEvery = 34 * time.Millisecond

func (b *Bubble) Typed() string { return string(b.runes[:b.typed]) }

// More: dopo questa pagina ce n'è un'altra
func (b *Bubble) More() bool { return b.page < len(b.pages)-1 }

// Page: "2/3" (vuoto se c'è una sola pagina)
func (b *Bubble) Page() string {
	if len(b.pages) < 2 {
		return ""
	}
	return itoaInt(b.page+1) + "/" + itoaInt(len(b.pages))
}

const pageRunes = 170 // quanto sta in una pagina del fumetto

// newBubble: il fumetto con il testo diviso in pagine
func newBubble(text string, now time.Time) *Bubble {
	pages := paginate(text, pageRunes)
	return &Bubble{Text: text, pages: pages, runes: []rune(pages[0]), start: now, shown: now}
}

// nextPage: si svuota e continua da dove era arrivato
func (b *Bubble) nextPage(now time.Time) {
	if !b.More() {
		return
	}
	b.page++
	b.runes, b.typed, b.start, b.doneAt, b.nextAt = []rune(b.pages[b.page]), 0, now, time.Time{}, time.Time{}
}

// paginate: divide il testo in pagine da circa n lettere (gli a capo contano come una riga intera),
// tagliando alla fine di una frase quando si può, mai a metà parola
func paginate(text string, n int) []string {
	cost := func(s string) int { return len([]rune(s)) + strings.Count(s, "\n")*28 }
	var pages []string
	cur := ""
	for _, line := range strings.SplitAfter(text, "\n") {
		for i, w := range strings.Split(line, " ") {
			if w == "" && i > 0 {
				continue
			}
			next := w
			if cur != "" && !strings.HasSuffix(cur, "\n") {
				next = cur + " " + w
			} else if cur != "" {
				next = cur + w
			}
			if cost(next) <= n || cur == "" {
				cur = next
				continue
			}
			// troppo: si chiude la pagina, possibilmente a fine frase
			cut := -1
			for j := len(cur) - 1; j > len(cur)/2; j-- {
				if c := cur[j]; c == '\n' || ((c == '.' || c == '!' || c == '?') && j+1 < len(cur) && cur[j+1] == ' ') {
					cut = j + 1
					break
				}
			}
			if cut > 0 {
				pages = append(pages, strings.TrimSpace(cur[:cut]))
				cur = strings.TrimSpace(cur[cut:]) + " " + w
			} else {
				pages = append(pages, strings.TrimSpace(cur))
				cur = w
			}
		}
	}
	if t := strings.TrimSpace(cur); t != "" || len(pages) == 0 {
		pages = append(pages, t)
	}
	return pages
}
func (b *Bubble) Done() bool   { return b.typed >= len(b.runes) }
func (b *Bubble) Full() string { return string(b.runes) }

type Brain struct {
	Enabled    bool
	Away       bool // gli hai detto "sparisci": acceso ma non si vede (finché non dici "torna")
	Voice      bool
	Chattiness float64 // 0..1: quanto parla da solo
	Live       bool
	Ctx        Context

	GameChoices map[string]string // gioco → "hide" | "quiet" | "talk"
	GameMode    string

	Bubble    *Bubble
	Idle      bool
	IdleTask  string
	IdleKind  string        // "work" (finge di lavorare) | "sleep" | "read" | "meditate"
	IdleAfter time.Duration // dopo quanto che non tocchi niente parte la scenetta (0: 4 minuti)
	NoIdle    bool          // scenette spente dal menu

	Thinking string    // "Ci penso…": mentre l'IA risponde
	actUntil time.Time // posa "in azione" (comandi, follow, donazioni)

	OnChoicesChanged func()
	OnAction         func(choice string) // pulsanti dei promemoria e degli avvisi (scelte che non sono dei giochi)

	rnd        *rand.Rand
	lastSpoke  time.Time
	nextCheck  time.Time
	pending    func(now time.Time)
	pendingAt  time.Time
	lastIdleIn time.Duration
}

func NewBrain(seed int64) *Brain {
	return &Brain{Enabled: true, Voice: true, Chattiness: 0.4, Ctx: Context{ID: "desktop"}, GameChoices: map[string]string{}, GameMode: "talk", rnd: rand.New(rand.NewSource(seed))}
}

func (b *Brain) pick(list []string) string { return list[b.rnd.Intn(len(list))] }

// Hidden: in un gioco hai chiesto di farlo sparire
func (b *Brain) Hidden() bool { return b.GameMode == "hide" || b.Away }

// Visible: si disegna? (un promemoria si vede sempre, anche se è spento o nascosto)
func (b *Brain) Visible() bool {
	if (b.Bubble != nil && b.Bubble.Alert) || b.Thinking != "" {
		return true
	}
	return b.Enabled && !b.Hidden()
}

// Alert: promemoria o avviso importante (passa sopra a tutto; actions: i pulsanti, es. Fatto / Tra 10 minuti)
func (b *Brain) Alert(now time.Time, text string, actions []Action) {
	b.exitIdle()
	b.Bubble = newBubble(noEmoji(text), now)
	b.Bubble.Label, b.Bubble.Actions, b.Bubble.Alert = "promemoria", actions, true
	b.lastSpoke = now
}

// Reply: risposta a quello che gli hai scritto (si vede anche se è spento: gliel'hai chiesto tu)
func (b *Brain) Reply(now time.Time, text string) {
	b.exitIdle()
	label := ""
	if b.Live {
		label = "live"
	}
	b.Bubble = newBubble(noEmoji(text), now)
	b.Bubble.Label, b.Bubble.Alert = label, !b.Enabled || b.Hidden()
	b.lastSpoke = now
}

// Act: Silver "fa qualcosa" (ha eseguito un comando, è arrivato un follow…): la posa d'azione per un po'
func (b *Brain) Act(now time.Time) { b.actUntil = now.Add(2500 * time.Millisecond) }

// Frame: quale posa del foglio usare (n = quante sono): 1 normale, 1 e 2 alternate mentre parla,
// 3 mentre ascolta o pensa, 4 in azione
func (b *Brain) Frame(now time.Time, mono float64, n int) int {
	pick := func(i int) int {
		if i < n {
			return i
		}
		return 0
	}
	switch {
	case b.Thinking != "":
		return pick(2)
	case now.Before(b.actUntil):
		return pick(3)
	case b.Talking() && int(mono*6)%2 == 1:
		return pick(1)
	}
	return 0
}

// Pose: l'atteggiamento di Silver (in live vince la live)
func (b *Brain) Pose() string {
	if b.Live {
		return "live"
	}
	return b.Ctx.ID
}

func (b *Brain) Say(now time.Time, text, source, note string, actions []Action) {
	if !b.Enabled || b.Hidden() {
		return
	}
	b.exitIdle()
	full := text
	if note != "" {
		full += " " + note
	}
	label := ""
	if b.Live {
		label = "live"
	} else if b.Ctx.ID != "desktop" {
		label = b.Ctx.Name
	}
	b.Bubble = newBubble(noEmoji(full), now)
	b.Bubble.Source, b.Bubble.Label, b.Bubble.Actions = source, label, actions
	b.lastSpoke = now
}

func (b *Brain) Hide() { b.Bubble = nil }

// Talk: una frase sul programma in primo piano, o una citazione (asked: l'hai cliccato tu)
func (b *Brain) Talk(now time.Time, asked bool) {
	if b.Ctx.ID == "game" && b.GameMode == "quiet" && !asked {
		return
	}
	if b.Live && b.rnd.Float64() < 0.7 {
		b.Say(now, b.pick(liveLines), "", "", nil)
		return
	}
	// stai giocando a uno dei giochi delle citazioni: spesso cita proprio quello
	if gq := gameQuotes(b.Ctx); len(gq) > 0 && b.rnd.Float64() < 0.6 {
		q := gq[b.rnd.Intn(len(gq))]
		b.Say(now, "“"+q.text+"”", q.source, q.note, nil)
		return
	}
	if b.rnd.Float64() < 0.4 {
		q := quotes[b.rnd.Intn(len(quotes))]
		b.Say(now, "“"+q.text+"”", q.source, q.note, nil)
		return
	}
	list, ok := lines[b.Ctx.ID]
	if !ok {
		list = lines["random"]
	}
	b.Say(now, b.pick(list), "", "", nil)
}

func (b *Brain) later(now time.Time, after time.Duration, f func(now time.Time)) {
	b.pending, b.pendingAt = f, now.Add(after)
}

// SetContext: è cambiato il programma in primo piano
func (b *Brain) SetContext(now time.Time, c Context) {
	if c.ID == b.Ctx.ID && c.Key == b.Ctx.Key {
		return
	}
	b.Ctx = c
	if c.ID == "game" {
		if choice, ok := b.GameChoices[c.Key]; ok {
			b.applyGame(choice)
			return
		}
		b.applyGame("talk")
		b.later(now, 700*time.Millisecond, b.askAboutGame)
		return
	}
	b.applyGame("talk")
	b.pending = nil
	if now.Sub(b.lastSpoke) > 15*time.Second && b.rnd.Float64() < b.Chattiness {
		b.later(now, 900*time.Millisecond, func(now time.Time) { b.Talk(now, false) })
	}
}

func (b *Brain) applyGame(mode string) {
	b.GameMode = mode
	if mode == "hide" {
		b.Bubble = nil
		b.exitIdle()
	}
}

func (b *Brain) askAboutGame(now time.Time) {
	if b.Ctx.ID != "game" {
		return
	}
	b.Say(now, fmt.Sprintf(gameQuestion, b.Ctx.Name), "", "", []Action{{"Sparisci", "hide"}, {"Resta, ma zitto", "quiet"}, {"Resta e parla", "talk"}})
	if b.Bubble != nil {
		b.Bubble.Remember = true
		b.Bubble.RememberLabel = "Ricordalo per " + b.Ctx.Name
	}
}

// Choose: risposta alla domanda sui giochi
func (b *Brain) Choose(now time.Time, i int) {
	bb := b.Bubble
	if bb == nil || i < 0 || i >= len(bb.Actions) || bb.More() {
		return
	}
	choice := bb.Actions[i].Choice
	if strings.HasPrefix(choice, "x:") { // non è la domanda sui giochi
		b.Bubble = nil
		if b.OnAction != nil {
			b.OnAction(choice)
		}
		return
	}
	if bb.Remember && b.Ctx.Key != "" {
		b.GameChoices[b.Ctx.Key] = choice
		if b.OnChoicesChanged != nil {
			b.OnChoicesChanged()
		}
	}
	b.Bubble = nil
	b.applyGame(choice)
	switch choice {
	case "quiet":
		b.later(now, 400*time.Millisecond, func(now time.Time) { b.Say(now, gameQuiet, "", "", nil) })
	case "talk":
		b.later(now, 400*time.Millisecond, func(now time.Time) { b.Say(now, gameTalk, "", "", nil) })
	}
}

func (b *Brain) ToggleRemember() {
	if b.Bubble != nil {
		b.Bubble.Remember = !b.Bubble.Remember
	}
}

// ClickSilver: un clic su Silver dice sempre qualcosa (o ferma la frase in corso)
func (b *Brain) ClickSilver(now time.Time) {
	if b.Bubble != nil && !b.Bubble.Done() {
		b.Bubble = nil
		return
	}
	b.Talk(now, true)
}

// ClickBubble: un clic sul fumetto lo chiude (non quello con la domanda: lì si sceglie)
// ClickBubble: un clic sul fumetto: finisce di scrivere la pagina, poi passa alla pagina dopo, poi lo chiude
// (non quello con la domanda: lì si sceglie)
func (b *Brain) ClickBubble(now time.Time) {
	bb := b.Bubble
	switch {
	case bb == nil:
	case !bb.Done():
		bb.start = now.Add(-time.Duration(len(bb.runes)+1) * charEvery) // tutta la pagina subito
	case bb.More():
		bb.nextPage(now)
	case len(bb.Actions) == 0:
		b.Bubble = nil
	}
}

func (b *Brain) SetLive(now time.Time, live bool) {
	if live == b.Live {
		return
	}
	b.Live = live
	if live {
		b.Say(now, liveOn, "", "", nil)
	}
}

// SetAway: sparisce (resta acceso: promemoria, avvisi, "Ehi Silver" e Ctrl+Alt+S funzionano) o torna
func (b *Brain) SetAway(away bool) {
	b.Away = away
	b.Bubble = nil
	b.exitIdle()
}

func (b *Brain) SetEnabled(on bool) {
	b.Enabled = on
	if !on {
		b.Bubble = nil
		b.exitIdle()
	}
}

func (b *Brain) enterIdle(now time.Time) {
	if b.Idle || b.Bubble != nil || b.Hidden() {
		return
	}
	b.Idle = true
	b.IdleKind = b.pick([]string{"work", "work", "sleep", "read", "meditate"})
	switch b.IdleKind {
	case "sleep":
		b.IdleTask = "Dormo"
	case "read":
		b.IdleTask = b.pick(idleReads) + "…"
	case "meditate":
		b.IdleTask = b.pick(idleMeditate) + "…"
	default:
		b.IdleTask = b.pick(idleTasks) + "…"
	}
}

func (b *Brain) exitIdle() { b.Idle = false }

// Tick: da chiamare a ogni fotogramma. userIdle: da quanto non tocchi mouse e tastiera.
func (b *Brain) Tick(now time.Time, userIdle time.Duration) {
	if b.pending != nil && !now.Before(b.pendingAt) {
		f := b.pending
		b.pending = nil
		f(now)
	}
	if bb := b.Bubble; bb != nil {
		if !bb.Done() {
			bb.typed = int(now.Sub(bb.start) / charEvery)
			if bb.typed < 0 { // orologio spostato indietro
				bb.typed = 0
			}
			if bb.typed >= len(bb.runes) {
				bb.typed = len(bb.runes)
				bb.doneAt = now
				if bb.More() { // il tempo di leggerla, poi la pagina dopo
					bb.nextAt = now.Add(min(7*time.Second, 1200*time.Millisecond+time.Duration(len(bb.runes))*40*time.Millisecond))
				} else if bb.Alert && len(bb.Actions) > 0 {
					bb.hideAt = now.Add(15 * time.Minute) // un promemoria aspetta che torni
				} else if len(bb.Actions) > 0 {
					bb.hideAt = now.Add(30 * time.Second)
				} else {
					bb.hideAt = now.Add(2500*time.Millisecond + time.Duration(len(bb.runes))*45*time.Millisecond)
				}
			}
		} else if bb.More() {
			if !bb.nextAt.IsZero() && now.After(bb.nextAt) {
				bb.nextPage(now)
			}
		} else if now.After(bb.hideAt) {
			b.Bubble = nil
		}
	}
	// idle: dopo qualche minuto senza toccare niente fa una scenetta (lavora, dorme, legge, medita);
	// appena muovi il mouse torna normale
	after := b.IdleAfter
	if after <= 0 {
		after = 4 * time.Minute
	}
	if b.Enabled && !b.NoIdle {
		if userIdle > after {
			b.enterIdle(now)
		} else if b.Idle && userIdle < b.lastIdleIn {
			b.exitIdle()
		}
	}
	b.lastIdleIn = userIdle
	if b.Idle && b.NoIdle {
		b.exitIdle()
	}
	// ogni tanto parla da solo (raramente; non appena acceso, quando saluta)
	if b.nextCheck.IsZero() {
		b.nextCheck = now.Add(30 * time.Second)
	}
	if now.After(b.nextCheck) {
		b.nextCheck = now.Add(30 * time.Second)
		if b.Enabled && !b.Idle && b.Bubble == nil && now.Sub(b.lastSpoke) > 90*time.Second && b.rnd.Float64() < b.Chattiness*0.5 {
			b.Talk(now, false)
		}
	}
}

// Talking: si muove la bocca (lo schiacciamento) — sulle lettere e sugli spazi, non sulla punteggiatura
func (b *Brain) Talking() bool {
	bb := b.Bubble
	if bb == nil || bb.Done() || bb.typed == 0 {
		return false
	}
	return !strings.ContainsRune(".,!?…—\"“”", bb.runes[bb.typed-1])
}

// Speaking: si sente la voce — solo sulle lettere (non in live, non se l'hai zittita)
func (b *Brain) Speaking() bool {
	bb := b.Bubble
	if !b.Voice || b.Live || bb == nil || bb.Done() || bb.typed == 0 {
		return false
	}
	return !strings.ContainsRune(" .,!?…—\"“”'", bb.runes[bb.typed-1])
}

// noEmoji: il carattere del fumetto non ha emoji e simboli (⏰ ⚙ 🧰…): si tolgono (le frecce restano)
func noEmoji(s string) string {
	var out []rune
	for _, r := range s {
		if (r >= 0x2300 && r <= 0x23FF) || (r >= 0x2600 && r <= 0x27BF) || r >= 0x1F000 || r == 0xFE0F || r == 0x200D {
			continue
		}
		out = append(out, r)
	}
	lines := strings.Split(string(out), "\n")
	for i, l := range lines {
		lines[i] = strings.Join(strings.Fields(l), " ")
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}
