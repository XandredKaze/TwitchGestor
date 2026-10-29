package main

// Silver collegato a Gestor: avvisi (follow, donazioni… quando NON sei in live), la prossima live
// (tra 30 e tra 5 minuti), i promemoria. Niente di Windows qui (assistant_test.go).

import (
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"time"
)

type Feed struct {
	Live   bool `json:"live"`
	Seq    int  `json:"seq"`
	Events []struct {
		ID   int    `json:"id"`
		Text string `json:"text"`
	} `json:"events"`
	NextLive *struct {
		ID    string `json:"id"`
		At    int64  `json:"at"`
		Title string `json:"title"`
		Game  string `json:"game"`
	} `json:"nextLive"`
	Scenes []string `json:"scenes"`
	Scene  string   `json:"scene"`
	Song   string   `json:"song"`
}

type Reminder struct {
	ID   string `json:"id"`
	At   int64  `json:"at"` // millisecondi
	Text string `json:"text"`
}

func (r Reminder) Time() time.Time { return time.UnixMilli(r.At) }

// Watch: ricorda cosa ha già detto
type Watch struct {
	seq       int
	started   bool
	announced map[string]bool
}

var eventTails = []string{"", " Non farlo aspettare.", " Ricambia, almeno.", " Bene così.", " Qualcuno ti apprezza. Sorprendente."}

// Lines: cosa dire per questo aggiornamento di Gestor. alerts: importanti (la live che sta per iniziare).
func (w *Watch) Lines(f Feed, now time.Time, rnd *rand.Rand) (events, alerts []string) {
	if w.announced == nil {
		w.announced = map[string]bool{}
	}
	if !w.started { // la prima volta non ripete gli avvisi vecchi
		w.started, w.seq = true, f.Seq
	}
	for _, e := range f.Events {
		if e.ID <= w.seq {
			continue
		}
		w.seq = max(w.seq, e.ID)
		if !f.Live {
			events = append(events, e.Text+eventTails[rnd.Intn(len(eventTails))])
		}
	}
	w.seq = max(w.seq, f.Seq)
	if n := f.NextLive; n != nil && !f.Live {
		left := time.UnixMilli(n.At).Sub(now)
		title := ""
		if n.Title != "" {
			title = ": " + n.Title
		}
		switch {
		case left > 0 && left <= 5*time.Minute && !w.announced["5:"+n.ID]:
			w.announced["5:"+n.ID], w.announced["30:"+n.ID] = true, true
			alerts = append(alerts, fmt.Sprintf("Tra %d minuti sei in live%s. Acqua, microfono, scena. Muoviti.", max(1, int(left.Round(time.Minute).Minutes())), title))
		case left > 5*time.Minute && left <= 30*time.Minute && !w.announced["30:"+n.ID]:
			w.announced["30:"+n.ID] = true
			alerts = append(alerts, fmt.Sprintf("Tra %d minuti vai in live%s.", int(left.Round(time.Minute).Minutes()), title))
		}
	}
	return events, alerts
}

// nextLiveText: "giovedì 30/10 alle 21:00 — Titolo (Gioco)" oppure ""
func nextLiveText(f *Feed, now time.Time) string {
	if f == nil || f.NextLive == nil {
		return ""
	}
	n := f.NextLive
	at := time.UnixMilli(n.At)
	s := weekdays[at.Weekday()] + " " + at.Format("02/01") + " alle " + at.Format("15:04")
	if at.Sub(now) < 24*time.Hour && at.Day() == now.Day() {
		s = "oggi alle " + at.Format("15:04")
	}
	if n.Title != "" {
		s += " — " + n.Title
	}
	if n.Game != "" {
		s += " (" + n.Game + ")"
	}
	return s
}

// dueReminders: quelli arrivati (e quelli che restano)
func dueReminders(list []Reminder, now time.Time) (due, rest []Reminder) {
	for _, r := range list {
		if !r.Time().After(now) {
			due = append(due, r)
		} else {
			rest = append(rest, r)
		}
	}
	return due, rest
}

func remindersText(list []Reminder, now time.Time) string {
	if len(list) == 0 {
		return "Nessun promemoria. Una volta tanto sei in pari."
	}
	sorted := append([]Reminder(nil), list...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].At < sorted[j].At })
	var b strings.Builder
	b.WriteString("Promemoria:")
	for _, r := range sorted {
		b.WriteString("\n• " + whenText(r.Time(), now) + ": " + r.Text)
	}
	return b.String()
}

// short: per il fumetto (il resto si legge nella finestra)
func short(text string, n int) string {
	r := []rune(strings.TrimSpace(text))
	if len(r) <= n {
		return string(r)
	}
	cut := string(r[:n])
	if i := strings.LastIndexAny(cut, ".!?\n"); i > n/2 {
		cut = cut[:i+1]
	} else if i := strings.LastIndex(cut, " "); i > 0 {
		cut = cut[:i] + "…"
	}
	return strings.TrimSpace(cut) + " (il resto è nella finestra)"
}
