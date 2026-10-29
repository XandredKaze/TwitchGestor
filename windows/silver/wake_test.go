package main

import (
	"math"
	"testing"
)

func tone(n int, amp float64) []int16 {
	out := make([]int16, n)
	for i := range out {
		out[i] = int16(amp * 32767 * math.Sin(float64(i)*0.3))
	}
	return out
}

func TestParolaDAscolto(t *testing.T) {
	var s segmenter
	var segs [][]int16
	feed := func(p []int16) {
		for i := 0; i < len(p); i += 1600 { // a pezzi da 100 ms, come il microfono
			segs = append(segs, s.Push(p[i:min(len(p), i+1600)])...)
		}
	}
	feed(tone(micRate, 0.002)) // 1 s di rumore di fondo
	feed(tone(micRate, 0.3))   // 1 s di voce
	feed(tone(micRate, 0.002)) // silenzio: frase finita
	if len(segs) != 1 {
		t.Fatalf("frasi: %d", len(segs))
	}
	if n := len(segs[0]); n < micRate || n > micRate*2 {
		t.Fatalf("lunghezza %d", n)
	}
	feed(tone(micRate/20, 0.3)) // un colpo (50 ms): non è una frase
	feed(tone(micRate, 0.002))
	if len(segs) != 1 {
		t.Fatal("un colpo è stato preso per una frase")
	}
	cases := []struct {
		in   string
		ok   bool
		rest string
	}{
		{"Ehi Silver.", true, ""},
		{" Hey Silver, metti la playlist Alf.", true, "metti la playlist Alf"},
		{"Silver che ore sono?", true, "che ore sono"},
		{"Ehi, Silver!", true, ""},
		{"ho comprato un anello in silver", true, ""},
		{"Silvia è arrivata", false, ""},
		{"argento vivo", false, ""},
		{"Ehi Silver, metti già la musica", true, "metti già la musica"},
		{"Ehi Sìlver, apri il player", true, "apri il player"},
	}
	for _, c := range cases {
		ok, rest := matchWake(c.in)
		if ok != c.ok || rest != c.rest {
			t.Errorf("%q → %v %q", c.in, ok, rest)
		}
	}
}
