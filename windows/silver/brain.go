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

	runes  []rune
	start  time.Time
	typed  int
	doneAt time.Time
	hideAt time.Time
	shown  time.Time // per l'animazione di comparsa
}

const charEvery = 34 * time.Millisecond

func (b *Bubble) Typed() string { return string(b.runes[:b.typed]) }
func (b *Bubble) Done() bool    { return b.typed >= len(b.runes) }
func (b *Bubble) Full() string  { return string(b.runes) }

type Brain struct {
	Enabled    bool
	Voice      bool
	Chattiness float64 // 0..1: quanto parla da solo
	Live       bool
	Ctx        Context

	GameChoices map[string]string // gioco → "hide" | "quiet" | "talk"
	GameMode    string

	Bubble   *Bubble
	Idle     bool
	IdleTask string
	IdlePct  int

	Thinking string // "Ci penso…": mentre l'IA risponde

	OnChoicesChanged func()
	OnAction         func(choice string) // pulsanti dei promemoria e degli avvisi (scelte che non sono dei giochi)

	rnd        *rand.Rand
	lastSpoke  time.Time
	idlePctAt  time.Time
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
func (b *Brain) Hidden() bool { return b.GameMode == "hide" }

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
	text = noEmoji(text)
	b.Bubble = &Bubble{Text: text, Label: "promemoria", Actions: actions, Alert: true, runes: []rune(text), start: now, shown: now}
	b.lastSpoke = now
}

// Reply: risposta a quello che gli hai scritto (si vede anche se è spento: gliel'hai chiesto tu)
func (b *Brain) Reply(now time.Time, text string) {
	b.exitIdle()
	label := ""
	if b.Live {
		label = "live"
	}
	text = noEmoji(text)
	b.Bubble = &Bubble{Text: text, Label: label, Alert: !b.Enabled || b.Hidden(), runes: []rune(text), start: now, shown: now}
	b.lastSpoke = now
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
	full = noEmoji(full)
	b.Bubble = &Bubble{Text: full, Source: source, Label: label, Actions: actions, runes: []rune(full), start: now, shown: now}
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
	if b.rnd.Float64() < 0.3 {
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
	if bb == nil || i < 0 || i >= len(bb.Actions) {
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
func (b *Brain) ClickBubble() {
	if b.Bubble != nil && len(b.Bubble.Actions) == 0 {
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
	b.IdleTask = b.pick(idleTasks) + "…"
	b.IdlePct = b.rnd.Intn(30)
	b.idlePctAt = now
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
				if bb.Alert && len(bb.Actions) > 0 {
					bb.hideAt = now.Add(15 * time.Minute) // un promemoria aspetta che torni
				} else if len(bb.Actions) > 0 {
					bb.hideAt = now.Add(30 * time.Second)
				} else {
					bb.hideAt = now.Add(2500*time.Millisecond + time.Duration(len(bb.runes))*45*time.Millisecond)
				}
			}
		} else if now.After(bb.hideAt) {
			b.Bubble = nil
		}
	}
	// idle: dopo 40 secondi senza toccare niente finge di lavorare; appena muovi il mouse torna normale
	if b.Enabled {
		if userIdle > 40*time.Second {
			b.enterIdle(now)
		} else if b.Idle && userIdle < b.lastIdleIn {
			b.exitIdle()
		}
	}
	b.lastIdleIn = userIdle
	if b.Idle && now.Sub(b.idlePctAt) > 1400*time.Millisecond {
		b.idlePctAt = now
		if b.IdlePct += b.rnd.Intn(7); b.IdlePct > 99 {
			b.IdlePct = 99
		}
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
