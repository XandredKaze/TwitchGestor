package main

import (
	"testing"
	"time"
)

func TestParseAway(t *testing.T) {
	now := time.Now()
	for in, want := range map[string]string{
		"sparisci": "away", "Vattene!": "away", "scompari": "away", "Silver, sparisci per favore": "away", "vai via": "away",
		"levati di torno": "away", "nasconditi un attimo": "away", "lasciami in pace": "away", "dai, sparisci": "away", "smamma": "away",
		"torna": "back", "Torna!": "back", "ritorna": "back", "fatti vedere": "back", "riappari": "back", "Silver, torna qui": "back",
		"dove sei?": "back", "vieni qui": "back", "ok torna pure": "back",
		"torna indietro": "", "indietro": "", "torna alla canzone di prima": "", "sparisci dalla mia vita per sempre adesso subito ok": "",
	} {
		c := ParseCommand(in, now)
		if want == "" {
			if c.Kind == "away" || c.Kind == "back" {
				t.Errorf("%q: non doveva essere %s", in, c.Kind)
			}
		} else if c.Kind != want {
			t.Errorf("%q: %+v, volevo %s", in, c, want)
		}
	}
}
