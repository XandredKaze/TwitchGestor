package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestBriefingEGuardiano(t *testing.T) {
	now := time.Date(2026, 10, 29, 8, 30, 0, 0, time.Local)
	w, err := parseForecast([]byte(`{"current":{"temperature_2m":14.6,"weather_code":3},"daily":{"temperature_2m_max":[21.2,19],"temperature_2m_min":[11.8,10],"precipitation_probability_max":[40,10],"weather_code":[61,1]}}`), "Roma")
	if err != nil {
		t.Fatal(err)
	}
	if s := w.Say(false); s != "A Roma ora 15°, nuvoloso. Oggi tra 12° e 21°, pioggia al 40%: prendi l'ombrello." {
		t.Error(s)
	}
	if s := w.Say(true); s != "Domani a Roma: quasi sereno, tra 10° e 19°." {
		t.Error(s)
	}
	var ag Agenda
	_ = json.Unmarshal([]byte(`{"today":"2026-10-29","events":[{"day":"2026-10-29","time":"16:00","endTime":"17:00","title":"Dentista"}],"tasks":[{"title":"Microfono","due":"2026-10-29"},{"title":"Email"}]}`), &ag)
	b := briefingText(now, w, &ag, []Reminder{{At: now.Add(3 * time.Hour).UnixMilli(), Text: "chiamare Marco"}}, "oggi alle 21:00 — Horror")
	for _, want := range []string{"Buongiorno. Oggi è giovedì 29 ottobre.", "A Roma ora 15°", "In agenda oggi:\n• 16:00–17:00: Dentista", "Da fare entro oggi: Microfono.", "Prossima live: oggi alle 21:00 — Horror.", "Promemoria di oggi: 11:30 chiamare Marco."} {
		if !strings.Contains(b, want) {
			t.Errorf("manca %q in:\n%s", want, b)
		}
	}

	g := &Guard{}
	live := &struct {
		ID    string
		At    time.Time
		Title string
	}{"l1", now.Add(20 * time.Minute), "Horror"}
	msgs := g.Check(GuardInput{FreeCGB: 8.2, NextLive: live, RAM: 50}, now)
	if len(msgs) != 2 || !strings.Contains(msgs[0].Text, "Tra 20 minuti sei in live e OBS è chiuso") || !strings.Contains(msgs[1].Text, "8.2 GB") {
		t.Fatalf("%+v", msgs)
	}
	if again := g.Check(GuardInput{FreeCGB: 8.2, NextLive: live}, now.Add(time.Minute)); len(again) != 0 {
		t.Fatal("ripetuto", again)
	}
	// RAM piena per 3 minuti di fila
	var got []GuardMsg
	for i := 0; i < 3; i++ {
		got = g.Check(GuardInput{RAM: 95, TopProc: "Chrome", OBSRunning: true}, now.Add(time.Duration(2+i)*time.Minute))
	}
	if len(got) != 1 || !strings.Contains(got[0].Text, "Chrome") {
		t.Fatalf("%+v", got)
	}
	// 2 ore di gioco
	g2 := &Guard{}
	g2.Check(GuardInput{InGame: true, GameName: "Elden Ring"}, now)
	if m := g2.Check(GuardInput{InGame: true, GameName: "Elden Ring"}, now.Add(2*time.Hour)); len(m) != 1 || !strings.Contains(m[0].Text, "2 ore che giochi a Elden Ring") {
		t.Fatalf("%+v", m)
	}
	// in live: niente avvisi di pausa
	g3 := &Guard{}
	if m := g3.Check(GuardInput{Live: true, ActiveFor: 5 * time.Hour}, now); len(m) != 0 {
		t.Fatal(m)
	}
}
