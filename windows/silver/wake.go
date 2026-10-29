package main

// "Ehi Silver": il microfono resta acceso e, quando qualcuno parla, il pezzo di voce va a un Whisper piccolo
// e veloce; se dentro c'è "Silver", Silver ti ascolta. Qui le parti senza Windows (wake_test.go):
// il taglio dell'audio in frasi (quando parli, quando smetti) e il riconoscimento della parola.

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// modelli piccoli per la parola d'ascolto (pochi MB, risposta in una frazione di secondo)
var wakeModels = []string{
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin",
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
}

const (
	frame      = micRate / 50 // 20 ms
	preRoll    = 15           // 300 ms prima che cominci la voce (la "e" di "ehi")
	endSilence = 30           // 600 ms di silenzio = frase finita
	minSpeech  = 12           // almeno 240 ms di voce
	maxFrames  = 350          // al massimo 7 secondi
)

// segmenter: taglia l'audio continuo nelle frasi dette (con una soglia che si adatta al rumore di fondo)
type segmenter struct {
	rest    []int16
	ring    [][]int16 // ultimi pezzi prima della voce
	cur     [][]int16
	speech  int
	silence int
	noise   float64
}

// Push: nuovo audio; restituisce le frasi finite
func (s *segmenter) Push(pcm []int16) [][]int16 {
	var out [][]int16
	s.rest = append(s.rest, pcm...)
	for len(s.rest) >= frame {
		f := append([]int16(nil), s.rest[:frame]...)
		s.rest = s.rest[frame:]
		lv := level(f)
		if s.noise == 0 {
			s.noise = lv
		}
		th := max(0.02, s.noise*3)
		loud := lv > th
		if !loud { // il rumore di fondo si aggiorna piano, solo quando nessuno parla
			s.noise = s.noise*0.98 + lv*0.02
		}
		if s.cur == nil {
			s.ring = append(s.ring, f)
			if len(s.ring) > preRoll {
				s.ring = s.ring[1:]
			}
			if loud {
				s.cur, s.ring = append([][]int16(nil), s.ring...), nil
				s.speech, s.silence = 1, 0
			}
			continue
		}
		s.cur = append(s.cur, f)
		if loud {
			s.speech++
			s.silence = 0
		} else {
			s.silence++
		}
		if s.silence >= endSilence || len(s.cur) >= maxFrames {
			if s.speech >= minSpeech {
				var seg []int16
				for _, x := range s.cur {
					seg = append(seg, x...)
				}
				out = append(out, seg)
			}
			s.cur, s.speech, s.silence = nil, 0, 0
		}
	}
	return out
}

func (s *segmenter) Reset() { *s = segmenter{noise: s.noise} }

var reWake = regexp.MustCompile(`(?:^|\s)(?:(?:e?hey|ehi|ei|hei|ehy|ok|okay|ciao|oh|o)\s+)?(?:silver|sylver|selver|silvers|silverr|sil ver)\b[\s,.!?:;-]*`)

// plainLower: minuscolo, senza accenti né punteggiatura strana (per cercare la parola)
func plainLower(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// matchWake: c'è "Silver" (o "Ehi Silver")? rest = quello che hai detto dopo, se hai detto tutto insieme
func matchWake(text string) (ok bool, rest string) {
	src := strings.ToLower(text)
	loc := reWake.FindStringIndex(src)
	if loc == nil { // magari con qualche accento strano nel nome
		src = plainLower(text)
		if loc = reWake.FindStringIndex(src); loc == nil {
			return false, ""
		}
	} else if len(src) == len(text) {
		src = text // stesse posizioni: il resto si prende con le maiuscole originali
	}
	r := strings.TrimSpace(strings.Trim(strings.TrimSpace(src[loc[1]:]), ",.!?:;-"))
	if len(strings.Fields(r)) < 2 { // "Ehi Silver." / "Silver, eh": ti ascolta
		r = ""
	}
	return true, r
}
