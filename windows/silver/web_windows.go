//go:build windows

package main

// "Cerca su internet …": risultati, testo delle pagine, risposta dell'IA del PC con le fonti; senza IA, i risultati.

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (a *app) webCmd(q string) {
	if q == "" {
		a.reply("Cosa cerco?")
		return
	}
	if a.aiBusy {
		a.reply("Un attimo: sto ancora pensando alla domanda di prima.")
		return
	}
	a.aiBusy = true
	a.brain.Thinking = "Cerco online…"
	a.chat.Add("silver", "Cerco online: "+q+"…")
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()
		rs, err := WebSearch(ctx, q)
		ok, models := a.ai.Detect(context.Background())
		model := pickModel(models, a.cfg.Model, a.cfg.BadModels...)
		a.post <- func() {
			a.webResults, a.webQuery = rs, q
			if err != nil || len(rs) == 0 {
				a.aiBusy = false
				a.brain.Thinking = ""
				a.chat.SetLast("error", "Non riesco a cercare online adesso (internet?).")
				a.brain.Alert(time.Now(), "Non riesco a cercare online adesso. La apro nel browser?", []Action{{"Apri nel browser", "x:web:search"}})
				return
			}
			if !ok || model == "" { // senza IA: i risultati così come sono
				a.aiBusy = false
				a.brain.Thinking = ""
				var b strings.Builder
				for i, r := range rs[:min(5, len(rs))] {
					fmt.Fprintf(&b, "\n%d. %s\n%s\n%s", i+1, r.Title, r.Snippet, r.URL)
				}
				a.chat.SetLast("silver", "Risultati per \""+q+"\":"+b.String())
				a.brain.Alert(time.Now(), "Ecco i risultati: "+rs[0].Title, a.webButtons())
				return
			}
			a.brain.Thinking = "Leggo e riassumo…"
			a.chat.SetLast("silver", "")
			a.webAnswer(q, rs, model)
		}
	}()
}

// webAnswer: l'IA risponde usando solo i testi trovati (in diretta nella finestra), poi le fonti
func (a *app) webAnswer(q string, rs []WebResult, model string) {
	a.ai.Model = model
	sys := systemPrompt(time.Now(), a.brain.Ctx, a.brain.Live, nextLiveText(a.feed, time.Now()), "", strings.Join(a.cfg.Memory, "\n"))
	msgs := []chatMsg{{"system", sys}, {"user", webPrompt(q, rs, time.Now())}}
	go func() {
		answer, err := a.ai.Chat(context.Background(), msgs, func(tok string) {
			a.post <- func() { a.chat.AppendLast(tok) }
		})
		answer = strings.TrimSpace(plain(answer))
		a.post <- func() {
			a.aiBusy = false
			a.brain.Thinking = ""
			if err != nil && answer == "" {
				a.chat.SetLast("error", "Non riesco a riassumere: "+err.Error())
				a.brain.Alert(time.Now(), "Ho trovato i risultati ma non riesco a riassumerli. Li apro?", a.webButtons())
				return
			}
			var src strings.Builder
			for i, r := range rs[:min(4, len(rs))] {
				fmt.Fprintf(&src, "\n[%d] %s — %s", i+1, r.Title, r.URL)
			}
			a.chat.SetLast("silver", answer+"\n\nFonti:"+src.String())
			a.history = append(a.history, chatMsg{"user", q}, chatMsg{"assistant", answer})
			if len(a.history) > 8 {
				a.history = a.history[len(a.history)-8:]
			}
			a.brain.Alert(time.Now(), answer, a.webButtons())
		}
	}()
}

func (a *app) webButtons() []Action {
	var acts []Action
	for i := range a.webResults[:min(2, len(a.webResults))] {
		acts = append(acts, Action{"Fonte " + strconv.Itoa(i+1), "x:web:" + strconv.Itoa(i)})
	}
	return append(acts, Action{"Apri la ricerca", "x:web:search"})
}

func (a *app) webAction(choice string) bool {
	if !strings.HasPrefix(choice, "x:web:") {
		return false
	}
	what := strings.TrimPrefix(choice, "x:web:")
	if what == "search" { // la ricerca completa la apre nel tuo browser, con Google
		openURL("https://www.google.com/search?q=" + url.QueryEscape(a.webQuery))
		return true
	}
	if i, err := strconv.Atoi(what); err == nil && i < len(a.webResults) {
		openURL(a.webResults[i].URL)
	}
	return true
}
