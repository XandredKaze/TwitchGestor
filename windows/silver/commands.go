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
	Kind string    // remind | reminders | clear | note | music | scene | open | nextlive | time | help | ask
	At   time.Time // remind: quando
	Text string    // remind: cosa; note: il testo; music: play|pause|toggle|next|prev; scene: nome; open: gestor|howlup|musicante; ask: la domanda
}

var (
	reRemind = regexp.MustCompile(`(?i)^(?:ricordami|ricordarmi|promemoria|avvisami|dimmi)\b\s*(.*)$`)
	reIn     = regexp.MustCompile(`(?i)\btra\s+(?:(un|una|mezz|\d+(?:[.,]\d+)?)\s*'?\s*)(secondi|secondo|sec|s|minuti|minuto|min|m|ore|ora|h)\b`)
	reInHalf = regexp.MustCompile(`(?i)\btra\s+mezz\s*'?\s*ora\b`)
	reAt     = regexp.MustCompile(`(?i)\b(?:(domani)\s+)?(?:alle|all'|alle ore|a)\s*(\d{1,2})(?:[:.](\d{2}))?\b`)
	reTimer  = regexp.MustCompile(`(?i)^(?:timer|countdown|conto alla rovescia)\s*(?:di\s+)?(\d+(?:[.,]\d+)?)?\s*(secondi|secondo|sec|s|minuti|minuto|min|m|ore|ora|h)?\s*(.*)$`)
	reNote   = regexp.MustCompile(`(?i)^(?:nota|note|appunta|appuntati|annota|segna|segnati)\b\s*(?:che\s+)?:?\s*(.+)$`)
	reScene  = regexp.MustCompile(`(?i)^(?:scena|passa alla scena|vai alla scena|metti la scena|cambia scena(?: in| a)?)\s+(.+)$`)
	reOpen   = regexp.MustCompile(`(?i)^apri\s+(?:il\s+|la\s+)?(twitch\s*gestor|gestor|howl[\s-]?up|musicante|ollama)\b`)
	reLead   = regexp.MustCompile(`(?i)^\s*(?:di|che|a|:|-)\s+`)
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
	case low == "che ore sono" || low == "che ora è" || low == "ora":
		return Command{Kind: "time"}
	case strings.Contains(low, "prossima live") || strings.Contains(low, "quando vado in live") || low == "live":
		return Command{Kind: "nextlive"}
	}
	// musica
	music := map[string]string{"pausa": "pause", "stop": "pause", "ferma la musica": "pause", "metti in pausa": "pause", "play": "play", "riprendi": "play", "metti musica": "play", "metti la musica": "play", "avanti": "next", "prossima": "next", "salta": "next", "prossimo brano": "next", "brano successivo": "next", "indietro": "prev", "precedente": "prev", "brano precedente": "prev"}
	m := strings.TrimPrefix(strings.TrimPrefix(low, "musica "), "musica: ")
	if v, ok := music[m]; ok {
		return Command{Kind: "music", Text: v}
	}
	if low == "musica" {
		return Command{Kind: "music", Text: "toggle"}
	}
	if g := reScene.FindStringSubmatch(t); g != nil {
		return Command{Kind: "scene", Text: strings.TrimSpace(g[1])}
	}
	if g := reOpen.FindStringSubmatch(t); g != nil {
		w := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(g[1], " ", ""), "-", ""))
		switch {
		case strings.Contains(w, "gestor"):
			w = "gestor"
		case strings.HasPrefix(w, "howl"):
			w = "howlup"
		}
		return Command{Kind: "open", Text: w}
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
• "pausa" · "play" · "avanti" · "indietro" (la musica di Gestor)
• "scena Gioco" (cambia scena in OBS)
• "prossima live" · "apri Gestor" · "apri Howl-UP" · "apri Musicante"
• Qualsiasi altra cosa: ti rispondo io (con l'IA sul tuo PC).`
