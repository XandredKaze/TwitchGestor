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
	Agenda *Agenda  `json:"agenda"` // da Howl-UP
	Scenes []string `json:"scenes"`
	Scene  string   `json:"scene"`
	Song   string   `json:"song"`
}

// Agenda: i prossimi giorni di Howl-UP (impegni, anche quelli che si ripetono, e cose da fare)
type Agenda struct {
	Today      string     `json:"today"`
	Categories []Category `json:"categories"`
	Events     []struct {
		Day      string `json:"day"`
		Time     string `json:"time"` // "" = tutto il giorno
		EndTime  string `json:"endTime"`
		Title    string `json:"title"`
		Category string `json:"category"`
	} `json:"events"`
	Tasks []struct {
		Title string `json:"title"`
		Due   string `json:"due"`
	} `json:"tasks"`
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
	// impegni dell'agenda: 15 minuti prima (le live le avvisa già la parte sopra)
	if f.Agenda != nil {
		for _, e := range f.Agenda.Events {
			at, ok := eventTime(e.Day, e.Time)
			if !ok || strings.EqualFold(e.Category, "live") {
				continue
			}
			key := "ev:" + e.Day + e.Time + e.Title
			if left := at.Sub(now); left > 0 && left <= 15*time.Minute && !w.announced[key] {
				w.announced[key] = true
				alerts = append(alerts, fmt.Sprintf("Tra %d minuti: %s.", max(1, int(left.Round(time.Minute).Minutes())), e.Title))
			}
		}
	}
	return events, alerts
}

// eventTime: giorno e ora dell'agenda (ora del PC); ok=false per gli impegni di tutto il giorno
func eventTime(day, hm string) (time.Time, bool) {
	if hm == "" {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("2006-01-02 15:04", day+" "+hm, time.Local)
	return t, err == nil
}

func dayName(day string, now time.Time) string {
	d, err := time.ParseInLocation("2006-01-02", day, time.Local)
	if err != nil {
		return day
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	switch int(d.Sub(today).Hours() / 24) {
	case 0:
		return "oggi"
	case 1:
		return "domani"
	}
	return weekdays[d.Weekday()] + " " + d.Format("02/01")
}

func eventLine(day, hm, end, title string, now time.Time, withDay bool) string {
	s := ""
	if withDay {
		s = dayName(day, now) + " "
	}
	switch {
	case hm == "":
		s += "(tutto il giorno)"
	case end != "":
		s += hm + "–" + end
	default:
		s += "alle " + hm
	}
	return strings.TrimSpace(s) + ": " + title
}

// agendaText: risposta a "prossimo impegno", "impegni di oggi/domani/della settimana", "cose da fare"
func agendaText(a *Agenda, now time.Time, what string) string {
	if a == nil {
		return "Non vedo la tua agenda: Howl-UP non risponde (o non sono collegato a TwitchGestor)."
	}
	if what == "tasks" {
		if len(a.Tasks) == 0 {
			return "Niente da fare in lista. Goditela finché dura."
		}
		var b strings.Builder
		b.WriteString("Da fare:")
		for i, t := range a.Tasks {
			if i == 8 {
				fmt.Fprintf(&b, "\n…e altre %d.", len(a.Tasks)-8)
				break
			}
			b.WriteString("\n• " + t.Title)
			if t.Due != "" {
				b.WriteString(" (entro " + dayName(t.Due, now) + ")")
			}
		}
		return b.String()
	}
	todayKey := now.Format("2006-01-02")
	tomorrowKey := now.AddDate(0, 0, 1).Format("2006-01-02")
	var lines []string
	for _, e := range a.Events {
		at, timed := eventTime(e.Day, e.Time)
		switch what {
		case "next":
			if (timed && at.After(now)) || (!timed && e.Day > todayKey) {
				return "Prossimo impegno: " + eventLine(e.Day, e.Time, e.EndTime, e.Title, now, true) + "."
			}
		case "today":
			if e.Day == todayKey {
				lines = append(lines, eventLine(e.Day, e.Time, e.EndTime, e.Title, now, false))
			}
		case "tomorrow":
			if e.Day == tomorrowKey {
				lines = append(lines, eventLine(e.Day, e.Time, e.EndTime, e.Title, now, false))
			}
		default: // la settimana
			lines = append(lines, eventLine(e.Day, e.Time, e.EndTime, e.Title, now, true))
		}
	}
	label := map[string]string{"today": "Oggi", "tomorrow": "Domani", "week": "Nei prossimi 7 giorni"}[what]
	if what == "next" {
		return "Nessun impegno in vista nei prossimi 7 giorni."
	}
	if len(lines) == 0 {
		return label + " niente in agenda."
	}
	if len(lines) > 12 {
		lines = append(lines[:12], fmt.Sprintf("…e altri %d.", len(lines)-12))
	}
	return label + ":\n• " + strings.Join(lines, "\n• ")
}

// agendaBrief: l'agenda in poche righe per l'IA (oggi, domani, cose da fare)
func agendaBrief(a *Agenda, now time.Time) string {
	if a == nil {
		return ""
	}
	var b strings.Builder
	for _, w := range []string{"today", "tomorrow"} {
		b.WriteString(agendaText(a, now, w) + "\n")
	}
	b.WriteString(agendaText(a, now, "next") + "\n")
	b.WriteString(agendaText(a, now, "tasks"))
	return b.String()
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
