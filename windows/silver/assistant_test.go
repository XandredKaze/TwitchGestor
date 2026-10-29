package main

import (
	"context"
	"encoding/json"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAvvisi(t *testing.T) {
	now := time.Date(2026, 10, 29, 20, 35, 0, 0, time.Local)
	var f Feed
	_ = json.Unmarshal([]byte(`{"live":false,"seq":3,"events":[{"id":3,"text":"Nuovo follower: Lupo."}],"nextLive":{"id":"a","at":`+itoa(now.Add(25*time.Minute).UnixMilli())+`,"title":"Horror"}}`), &f)
	w := &Watch{}
	rnd := rand.New(rand.NewSource(1))
	ev, al := w.Lines(f, now, rnd)
	if len(ev) != 0 { // la prima volta: gli avvisi vecchi no
		t.Fatal(ev)
	}
	if len(al) != 1 || al[0] != "Tra 25 minuti vai in live: Horror." {
		t.Fatal(al)
	}
	_ = json.Unmarshal([]byte(`{"live":false,"seq":4,"events":[{"id":3,"text":"x"},{"id":4,"text":"Ada ha donato 5 EUR."}]}`), &f)
	f.NextLive.At = now.Add(4 * time.Minute).UnixMilli()
	ev, al = w.Lines(f, now, rnd)
	if len(ev) != 1 || !strings.HasPrefix(ev[0], "Ada ha donato") || len(al) != 1 || !strings.HasPrefix(al[0], "Tra 4 minuti sei in live") {
		t.Fatal(ev, al)
	}
	if ev, al = w.Lines(f, now, rnd); len(ev)+len(al) != 0 {
		t.Fatal("ripetuto", ev, al)
	}
	// in live: gli avvisi li mostra già l'overlay
	f.Live, f.Seq = true, 5
	f.Events = append(f.Events, f.Events[0])
	f.Events[len(f.Events)-1].ID = 5
	if ev, _ = w.Lines(f, now, rnd); len(ev) != 0 {
		t.Fatal(ev)
	}
}

func TestPromemoria(t *testing.T) {
	now := time.Date(2026, 10, 29, 15, 0, 0, 0, time.Local)
	list := []Reminder{{ID: "a", At: now.Add(-time.Second).UnixMilli(), Text: "bere"}, {ID: "b", At: now.Add(time.Hour).UnixMilli(), Text: "staccare"}}
	due, rest := dueReminders(list, now)
	if len(due) != 1 || due[0].ID != "a" || len(rest) != 1 {
		t.Fatal(due, rest)
	}
	if s := remindersText(rest, now); s != "Promemoria:\n• tra 60 minuti: staccare" {
		t.Errorf("%q", s)
	}
	long := strings.Repeat("Frase lunga di prova. ", 20)
	if s := short(long, 120); len([]rune(s)) > 160 || !strings.HasSuffix(s, "(il resto è nella finestra)") {
		t.Errorf("%q", s)
	}
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func TestOllamaFinto(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/tags":
			w.Write([]byte(`{"models":[{"name":"llama3.2:3b"},{"name":"gemma3:4b"}]}`))
		case "/api/chat":
			var body struct {
				Model    string    `json:"model"`
				Messages []chatMsg `json:"messages"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			if body.Model != "gemma3:4b" || body.Messages[0].Role != "system" {
				w.WriteHeader(400)
				return
			}
			w.Write([]byte("{\"message\":{\"content\":\"**Titolo:** \"}}\n{\"message\":{\"content\":\"Notte horror\"},\"done\":true}\n"))
		case "/api/pull":
			w.Write([]byte("{\"status\":\"pulling\",\"total\":100,\"completed\":50}\n{\"status\":\"success\"}\n"))
		}
	}))
	defer srv.Close()
	ai := NewAI()
	ai.URL = srv.URL
	ok, models := ai.Detect(context.Background())
	if !ok || len(models) != 2 {
		t.Fatal(ok, models)
	}
	ai.Model = pickModel(models, "")
	msgs := []chatMsg{{"system", systemPrompt(time.Now(), Context{ID: "obs", Name: "OBS Studio"}, false, "")}, {"user", "titolo?"}}
	got, err := ai.Chat(context.Background(), msgs, func(string) {})
	if err != nil || plain(got) != "Titolo: Notte horror" {
		t.Fatalf("%q %v", got, err)
	}
	var last float64
	if err := ai.Pull(context.Background(), "gemma3:4b", func(f float64, _ string) { last = max(last, f) }); err != nil || last != 0.5 {
		t.Fatal(err, last)
	}
}

func TestSenzaEmoji(t *testing.T) {
	if s := noEmoji("⏰ bere\napri ⚙ Sistema → 🧰 Tools ❤️"); s != "bere\napri Sistema → Tools" {
		t.Errorf("%q", s)
	}
}
