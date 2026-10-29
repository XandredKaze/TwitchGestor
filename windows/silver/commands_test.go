package main

import (
	"strings"
	"testing"
	"time"
)

func TestComandi(t *testing.T) {
	now := time.Date(2026, 10, 29, 15, 0, 0, 0, time.Local)
	cases := []struct {
		in   string
		kind string
		text string
		at   time.Time
	}{
		{"ricordami tra 20 minuti di bere", "remind", "bere", now.Add(20 * time.Minute)},
		{"Ricordami di chiamare Marco tra 2 ore", "remind", "chiamare Marco", now.Add(2 * time.Hour)},
		{"ricordami tra mezz'ora la pizza", "remind", "la pizza", now.Add(30 * time.Minute)},
		{"ricordami tra un'ora di staccare", "remind", "staccare", now.Add(time.Hour)},
		{"ricordami alle 18:30 la riunione", "remind", "la riunione", time.Date(2026, 10, 29, 18, 30, 0, 0, time.Local)},
		{"ricordami alle 9 di fare la spesa", "remind", "fare la spesa", time.Date(2026, 10, 29, 21, 0, 0, 0, time.Local)},
		{"ricordami domani alle 9 il dentista", "remind", "il dentista", time.Date(2026, 10, 30, 9, 0, 0, 0, time.Local)},
		{"timer 10 minuti", "remind", "Tempo scaduto.", now.Add(10 * time.Minute)},
		{"timer 30 secondi tè", "remind", "tè", now.Add(30 * time.Second)},
		{"nota: idea per la live horror", "note", "idea per la live horror", time.Time{}},
		{"appunta che devo cambiare il microfono", "note", "devo cambiare il microfono", time.Time{}},
		{"pausa", "music", "pause", time.Time{}},
		{"musica avanti", "music", "next", time.Time{}},
		{"Prossima", "music", "next", time.Time{}},
		{"metti in pausa la musica", "music", "pause", time.Time{}},
		{"metti Linkin Park", "music", "find", time.Time{}},
		{"cambia canzone dalla playlist Alf", "music", "find", time.Time{}},
		{"puoi cambiare canzone?", "music", "next", time.Time{}},
		{"metti un'altra canzone", "music", "next", time.Time{}},
		{"torna alla canzone di prima", "music", "prev", time.Time{}},
		{"ferma la canzone", "music", "pause", time.Time{}},
		{"metti un po' di musica", "music", "play", time.Time{}},
		{"volume 40", "music", "volume", time.Time{}},
		{"Metti pausa.", "music", "pause", time.Time{}},
		{"Alza il volume.", "music", "volume", time.Time{}},
		{"abbassa un po' la musica", "music", "volume", time.Time{}},
		{"Skippa", "music", "next", time.Time{}},
		{"metti un'altra playlist", "music", "otherPlaylist", time.Time{}},
		{"Metti musica da una qualsiasi playlist che ho.", "music", "randomPlaylist", time.Time{}},
		{"cambia playlist", "music", "otherPlaylist", time.Time{}},
		{"metti una playlist a caso", "music", "randomPlaylist", time.Time{}},
		{"metti musica a caso", "music", "randomPlaylist", time.Time{}},
		{"che canzone è?", "music", "now", time.Time{}},
		{"apri musicante player", "open", "player", time.Time{}},
		{"apri musicante", "open", "musicante", time.Time{}},
		{"metti un timer di 10 minuti", "remind", "Tempo scaduto.", now.Add(10 * time.Minute)},
		{"scena Gioco", "scene", "Gioco", time.Time{}},
		{"apri Howl-UP", "open", "howlup", time.Time{}},
		{"apri twitch gestor", "open", "gestor", time.Time{}},
		{"quando è la prossima live?", "nextlive", "", time.Time{}},
		{"promemoria", "reminders", "", time.Time{}},
		{"domani alle 15 ho il dentista", "create", "", time.Time{}},
		{"aggiungi un impegno domani alle 9: riunione", "create", "", time.Time{}},
		{"segna tra le cose da fare comprare il microfono", "create", "", time.Time{}},
		{"qual è il mio prossimo impegno?", "agenda", "next", time.Time{}},
		{"impegni di domani", "agenda", "tomorrow", time.Time{}},
		{"cosa ho oggi", "agenda", "today", time.Time{}},
		{"agenda della settimana", "agenda", "week", time.Time{}},
		{"cose da fare", "agenda", "tasks", time.Time{}},
		{"cosa devo fare domani?", "agenda", "tomorrow", time.Time{}},
		{"cancella promemoria", "clear", "", time.Time{}},
		{"cosa sai fare?", "help", "", time.Time{}},
		{"scrivimi un titolo per la live di stasera", "ask", "scrivimi un titolo per la live di stasera", time.Time{}},
		{"ricordami perché i gatti fanno le fusa", "ask", "ricordami perché i gatti fanno le fusa", time.Time{}},
	}
	for _, c := range cases {
		got := ParseCommand(c.in, now)
		if got.Kind != c.kind || (c.text != "" && got.Text != c.text) || !got.At.Equal(c.at) {
			t.Errorf("%q → %+v (volevo %s %q %v)", c.in, got, c.kind, c.text, c.at)
		}
	}
	if c := ParseCommand("cambia canzone dalla playlist Alf", now); c.Arg != "playlist alf" {
		t.Errorf("%+v", c)
	}
	if c := ParseCommand("metti la playlist Chill", now); c.Arg != "playlist chill" || c.Where != "" {
		t.Errorf("%+v", c)
	}
	if c := ParseCommand("pausa la musica della live", now); c.Text != "pause" || c.Where != "live" {
		t.Errorf("%+v", c)
	}
	if c := ParseCommand("avanti in live", now); c.Text != "next" || c.Where != "live" {
		t.Errorf("%+v", c)
	}
	if c := ParseCommand("volume al 30%", now); c.Arg != "30" {
		t.Errorf("%+v", c)
	}
	if w := whenText(now.Add(20*time.Minute), now); w != "tra 20 minuti" {
		t.Error(w)
	}
	if w := whenText(time.Date(2026, 10, 30, 9, 0, 0, 0, time.Local), now); w != "domani alle 09:00" {
		t.Error(w)
	}
}

func TestModello(t *testing.T) {
	if m := pickModel([]string{"nomic-embed-text:latest", "llama3.2:3b", "gemma3:4b"}, ""); m != "llama3.2:3b" {
		t.Error(m)
	}
	if m := pickModel([]string{"gemma3:4b"}, "gemma3:4b", "gemma3:4b"); m != "" {
		t.Error(m)
	}
	if m := pickModel([]string{"nomic-embed-text:latest", "mistral:latest"}, ""); m != "mistral:latest" {
		t.Error(m)
	}
	if m := pickModel(nil, ""); m != "" {
		t.Error(m)
	}
	if p := plain("## Titolo\n**ciao**\n- uno\n* due"); p != "Titolo\nciao\n• uno\n• due" {
		t.Errorf("%q", p)
	}
}

func TestRispostaIA(t *testing.T) {
	stream := `{"message":{"content":"<think>"}}
{"message":{"content":"devo pensare"}}
{"message":{"content":"</think>\n\nCiao"}}
{"message":{"content":", Xandred."},"done":true}
`
	var got string
	all, err := readChat(strings.NewReader(stream), func(s string) { got += s })
	if err != nil || all != "Ciao, Xandred." || got != all {
		t.Fatalf("%q %q %v", all, got, err)
	}
}
