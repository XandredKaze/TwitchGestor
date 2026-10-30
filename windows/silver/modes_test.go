package main

import (
	"fmt"
	"testing"
	"time"
)

func TestModalita(t *testing.T) {
	got := ParseModeSteps("apri Discord e Spotify, metti la playlist Alf e poi scena Inizio")
	if fmt.Sprint(got) != "[apri Discord apri Spotify metti la playlist Alf scena Inizio]" {
		t.Fatalf("%q", got)
	}
	if got := ParseModeSteps("apri OBS; avvia Wave Link poi scrivi in chat ciao a tutti e benvenuti"); fmt.Sprint(got) != "[apri OBS avvia Wave Link scrivi in chat ciao a tutti e benvenuti]" {
		t.Fatalf("%q", got)
	}
	now := time.Date(2026, 10, 29, 10, 0, 0, 0, time.Local)
	for in, want := range map[string]Command{
		"crea la modalità studio: apri Discord, apri Spotify": {Kind: "modedef", Text: "studio"},
		"modalità live":                                       {Kind: "mode", Text: "live"},
		"attiva la modalità fine live":                        {Kind: "mode", Text: "fine live"},
		"che modalità ho?":                                    {Kind: "modelist"},
		"cancella la modalità studio":                         {Kind: "modedel", Text: "studio"},
		"cambia il titolo della live in Notte horror con voi": {Kind: "twitch", Text: "title", Arg: "Notte horror con voi"},
		"cambia il gioco in Elden Ring":                       {Kind: "twitch", Text: "game", Arg: "Elden Ring"},
		"fai uno shoutout a @lupo_grigio":                     {Kind: "twitch", Text: "shoutout", Arg: "lupo_grigio"},
		"scrivi in chat: torno tra 5 minuti!":                 {Kind: "twitch", Text: "chat", Arg: "torno tra 5 minuti!"},
		"fai un annuncio: giveaway alle 22":                   {Kind: "twitch", Text: "announce", Arg: "giveaway alle 22"},
		"metti un segnalibro":                                 {Kind: "twitch", Text: "marker"},
		"segnalibro: boss sconfitto":                          {Kind: "twitch", Text: "marker", Arg: "boss sconfitto"},
		"clippa questo":                                       {Kind: "twitch", Text: "clip"},
		"quanti spettatori ho?":                               {Kind: "twitch", Text: "viewers"},
		"fai un raid a amico_streamer":                        {Kind: "twitch", Text: "raid", Arg: "amico_streamer"},
	} {
		c := ParseCommand(in, now)
		if c.Kind != want.Kind || c.Text != want.Text || (c.Kind != "modedef" && c.Arg != want.Arg) {
			t.Errorf("%q → %+v (volevo %+v)", in, c, want)
		}
	}
}
