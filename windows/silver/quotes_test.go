package main

import (
	"strings"
	"testing"
)

func TestGameQuotes(t *testing.T) {
	for _, c := range []struct {
		ctx  Context
		want string
	}{
		{Context{ID: "game", Name: "League of Legends (TM) Client", Key: "league of legends.exe"}, "League of Legends"},
		{Context{ID: "game", Name: "Skyrim Special Edition", Key: "skyrimse.exe"}, "Skyrim"},
		{Context{ID: "game", Name: "UNDERTALE", Key: "undertale.exe"}, "Undertale"},
		{Context{ID: "game", Name: "Yu-Gi-Oh!  Master Duel", Key: "masterduel.exe"}, "Yu-Gi-Oh!"},
	} {
		qs := gameQuotes(c.ctx)
		if len(qs) < 4 {
			t.Fatalf("%s: solo %d citazioni", c.want, len(qs))
		}
		for _, q := range qs {
			if !strings.HasPrefix(q.source, c.want) {
				t.Errorf("%s: %q", c.want, q.source)
			}
		}
	}
	if gameQuotes(Context{ID: "game", Name: "Elden Ring", Key: "eldenring.exe"}) != nil || gameQuotes(Context{ID: "desktop"}) != nil {
		t.Error("niente citazioni per giochi che non conosce")
	}
	for _, q := range quotes {
		if len([]rune(q.text))+len([]rune(q.note)) > 160 {
			t.Errorf("troppo lunga per il fumetto: %q", q.text)
		}
	}
}
