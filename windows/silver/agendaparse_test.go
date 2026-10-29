package main

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestCreaImpegni(t *testing.T) {
	// giovedì 29 ottobre 2026, ore 10
	now := time.Date(2026, 10, 29, 10, 0, 0, 0, time.Local)
	cats := []Category{{"live", "Live"}, {"work", "Lavoro"}, {"personal", "Personale"}, {"cube", "Cube"}}
	type want struct{ kind, title, date, time, end, cat string }
	cases := []struct {
		in string
		w  want
		ex func(Draft) string // controlli in più
	}{
		{"domani alle 15 ho il dentista", want{"event", "Dentista", "2026-10-30", "15:00", "", "personal"}, nil},
		{"aggiungi un impegno: cena con Marco venerdì dalle 20 alle 23, avvisami un'ora prima", want{"event", "Cena con Marco", "2026-10-30", "20:00", "23:00", "personal"}, func(d Draft) string {
			if d.RemindMin != 60 {
				return fmt.Sprint("promemoria ", d.RemindMin)
			}
			return ""
		}},
		{"ogni martedì e giovedì alle 18 palestra fino a dicembre", want{"event", "Palestra", "2026-10-29", "18:00", "", "personal"}, func(d Draft) string {
			if d.Repeat.Freq != "weekly" || fmt.Sprint(d.Repeat.Days) != "[2 4]" || d.Repeat.Until != "2026-12-31" {
				return fmt.Sprintf("%+v", d.Repeat)
			}
			return ""
		}},
		{"segna tra le cose da fare comprare il microfono entro sabato", want{"task", "Comprare il microfono", "", "", "", ""}, func(d Draft) string {
			if d.Due != "2026-10-31" {
				return "entro " + d.Due
			}
			return ""
		}},
		{"live di Elden Ring venerdì alle 21 per 3 ore", want{"live", "Live di Elden Ring", "2026-10-30", "21:00", "", "live"}, func(d Draft) string {
			if d.DurationMin != 180 || d.Game != "Elden Ring" {
				return fmt.Sprint(d.DurationMin, d.Game)
			}
			return ""
		}},
		{"crea un appuntamento dal commercialista il 5 novembre alle 9 e mezza", want{"event", "Commercialista", "2026-11-05", "09:30", "", "personal"}, nil},
		{"metti in agenda riunione con il cliente lunedì prossimo alle 3 del pomeriggio per un'ora", want{"event", "Riunione con il cliente", "2026-11-02", "15:00", "16:00", "work"}, nil},
		{"compleanno di Ada il 12/11, ogni anno", want{"event", "Compleanno di Ada", "2026-11-12", "", "", "personal"}, func(d Draft) string {
			if !d.AllDay || d.Repeat.Freq != "yearly" {
				return fmt.Sprint(d.AllDay, d.Repeat)
			}
			return ""
		}},
		{"nuovo impegno stasera cinema con gli amici", want{"event", "Cinema con gli amici", "2026-10-29", "20:00", "", "personal"}, nil},
		{"turno al Cube sabato dalle 23 alle 7", want{"event", "Turno al Cube", "2026-10-31", "23:00", "07:00", "cube"}, nil},
		{"aggiungi alle cose da fare chiamare la banca", want{"task", "Chiamare la banca", "", "", "", ""}, nil},
		{"fissa la visita medica tra 2 settimane alle 10, note: portare le analisi", want{"event", "Visita medica", "2026-11-12", "10:00", "", "personal"}, func(d Draft) string {
			if d.Notes != "portare le analisi" {
				return "note " + d.Notes
			}
			return ""
		}},
		{"programma corso di inglese dal lunedì al venerdì alle 19 per 6 settimane, senza promemoria", want{"event", "Corso di inglese", "2026-10-29", "19:00", "", "personal"}, func(d Draft) string {
			if d.Repeat.Freq != "weekly" || len(d.Repeat.Days) != 5 || d.Repeat.Until != "2026-12-09" || d.RemindMin != 0 {
				return fmt.Sprintf("%+v %d", d.Repeat, d.RemindMin)
			}
			return ""
		}},
		{"domani mattina devo andare in posta", want{"event", "Posta", "2026-10-30", "09:00", "", "personal"}, nil},
		{"aggiungi una live sabato 7 novembre alle 21:30 categoria live", want{"live", "Live", "2026-11-07", "21:30", "", "live"}, nil},
		{"segnami ogni 2 settimane il giovedì alle 17 la call con il team, avvisami 15 minuti prima", want{"event", "Call con il team", "2026-10-29", "17:00", "", "work"}, func(d Draft) string {
			if d.Repeat.Interval != 2 || d.RemindMin != 15 {
				return fmt.Sprintf("%+v %d", d.Repeat, d.RemindMin)
			}
			return ""
		}},
	}
	for _, c := range cases {
		if !IsCreateRequest(c.in, now) {
			t.Errorf("non riconosciuta come richiesta: %q", c.in)
		}
		d := ParseDraft(c.in, now, cats)
		got := want{d.Kind, d.Title, d.Date, d.Time, d.EndTime, d.Category}
		if d.Kind == "task" {
			got.date = ""
		}
		if got != c.w {
			t.Errorf("%q\n  → %+v\n  volevo %+v", c.in, got, c.w)
		}
		if c.ex != nil {
			if msg := c.ex(d); msg != "" {
				t.Errorf("%q: %s", c.in, msg)
			}
		}
		if d.Missing() != "" {
			t.Errorf("%q: manca %s", c.in, d.Missing())
		}
	}
	for in, title := range map[string]string{
		"domenica alle 16 live con la community, gioco Minecraft":                  "Live con la community",
		"puoi segnarmi per sabato alle 10 il meccanico?":                           "Meccanico",
		"devo pagare la bolletta entro il 15 novembre, mettilo nelle cose da fare": "Pagare la bolletta",
		"appuntamento con Giulia domani alle 18:30 al bar":                         "Appuntamento con Giulia al bar",
		"crea evento palestra il martedì e il venerdì alle 7 di mattina":           "Palestra",
		"dentista il 3/12 alle 11":                                                 "Dentista",
	} {
		if !IsCreateRequest(in, now) {
			t.Errorf("non riconosciuta: %q", in)
		}
		if d := ParseDraft(in, now, cats); d.Title != title {
			t.Errorf("%q → titolo %q", in, d.Title)
		}
	}
	// non sono richieste di creare
	for _, q := range []string{"impegni di domani", "qual è il mio prossimo impegno?", "metti la playlist Alf", "che ore sono", "quando ho il dentista?", "scrivimi un titolo per la live"} {
		if IsCreateRequest(q, now) {
			t.Errorf("presa per una richiesta di creare: %q", q)
		}
	}
	// correzioni
	d := ParseDraft("domani alle 15 ho il dentista", now, cats)
	d = d.Merge(ParseDraft("no, alle 17", now, cats))
	if d.Time != "17:00" || d.Title != "Dentista" || d.Date != "2026-10-30" {
		t.Errorf("correzione ora: %+v", d)
	}
	d = d.Merge(ParseDraft("spostalo a lunedì", now, cats))
	if d.Date != "2026-11-02" || d.Time != "17:00" {
		t.Errorf("correzione giorno: %+v", d)
	}
	d = d.Merge(ParseDraft("chiamalo Visita dal dentista", now, cats))
	if d.Title != "Visita dal dentista" {
		t.Errorf("correzione titolo: %q", d.Title)
	}
	if ParseDraft("pausa", now, cats).Changes() {
		t.Error("\"pausa\" presa per una correzione")
	}
	d = d.Merge(ParseDraft("categoria lavoro", now, cats))
	if d.Category != "work" {
		t.Errorf("correzione categoria: %q", d.Category)
	}
	sum := d.Summary(cats)
	for _, w := range []string{"Impegno: Visita dal dentista", "Lunedì 2 novembre", "alle 17:00", "Categoria: Lavoro"} {
		if !strings.Contains(sum, w) {
			t.Errorf("scheda senza %q:\n%s", w, sum)
		}
	}
	if !isYes("Sì, salva") && !isYes("ok") {
		t.Error("sì")
	}
	if !isNo("annulla") {
		t.Error("no")
	}
	act, body := ParseDraft("ogni martedì e giovedì alle 18 palestra fino a dicembre", now, cats).Payload()
	if act != "event" || fmt.Sprint(body["repeat"]) != "map[days:[2 4] freq:weekly interval:1 until:2026-12-31]" {
		t.Errorf("%s %v", act, body)
	}
}
