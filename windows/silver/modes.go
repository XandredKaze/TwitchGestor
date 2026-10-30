package main

// Le modalità: una sequenza di comandi di Silver con un nome, che decidi tu.
//   "crea la modalità studio: apri Discord, apri Spotify e metti la playlist Alf"
//   "modalità studio" → li fa uno dopo l'altro. "che modalità ho?", "cancella la modalità studio".
// Niente di Windows qui (modes_test.go).

import (
	"regexp"
	"strings"
)

// modalità pronte (finché non le cambi tu)
var defaultModes = map[string][]string{
	"live":      {"apri OBS", "apri Discord", "apri Gestor", "prossima live"},
	"fine live": {"pausa della live", "chiudi OBS"},
}

var reStepVerb = regexp.MustCompile(`(?i)^(?:apri|avvia|lancia|chiudi|metti|pausa|play|avanti|scena|alza|abbassa|volume|scrivi|manda|fai|cambia|imposta|blocca|ricordami|timer|nota|segna|prossima|che|trova|cerca|dimmi|attiva|spegni|riavvia|sospendi|annuncio|annuncia|shoutout|raid|segnalibro|buongiorno|meteo)\b`)

// ParseModeSteps: "apri Discord, apri Spotify e poi metti la playlist Alf" → i singoli comandi
func ParseModeSteps(text string) []string {
	parts := regexp.MustCompile(`(?i)\s*(?:,|;|\n|\s+e poi\s+|\s+poi\s+|\s+dopo\s+)\s*`).Split(text, -1)
	var out []string
	for _, p := range parts {
		// "… e …": nuovo comando solo se dopo la "e" c'è un verbo ("apri Discord e Spotify" resta uno)
		sub := regexp.MustCompile(`(?i)\s+e\s+`).Split(p, -1)
		cur := ""
		for _, x := range sub {
			x = strings.TrimSpace(x)
			if cur != "" && reStepVerb.MatchString(x) {
				out = append(out, cur)
				cur = x
			} else if cur != "" {
				cur += " e " + x
			} else {
				cur = x
			}
		}
		if cur = strings.Trim(cur, " .!"); cur != "" {
			out = append(out, cur)
		}
	}
	// "apri Discord e Spotify" → due aperture
	var final []string
	for _, s := range out {
		if g := regexp.MustCompile(`(?i)^(apri|avvia|lancia|chiudi)\s+(.+)$`).FindStringSubmatch(s); g != nil && strings.Contains(g[2], " e ") {
			for _, name := range strings.Split(g[2], " e ") {
				final = append(final, g[1]+" "+strings.TrimSpace(name))
			}
			continue
		}
		final = append(final, s)
	}
	return final
}

func modeKey(name string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.Trim(name, " .!?:\"'"))), " ")
}
