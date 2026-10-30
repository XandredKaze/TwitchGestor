//go:build windows

package main

// Le cose utili: quello che gli scrivi (comandi o domande per l'IA), il collegamento con Gestor
// (avvisi, prossima live, musica, scene, note), i promemoria.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	pairHint     = "Per gli avvisi e i comandi devo collegarmi a TwitchGestor: apri ⚙ Sistema → 🧰 Tools e premi \"Consenti\"."
	paired       = "Collegato a TwitchGestor. Adesso ti tengo d'occhio anche lì."
	needPair     = "Prima collegami a TwitchGestor: dal mio menu scegli \"Collega a TwitchGestor\", poi in ⚙ Sistema → 🧰 Tools premi \"Consenti\"."
	noOllama     = "Per risponderti mi serve l'IA sul tuo PC: Ollama, gratis. Installalo (due clic), poi chiedimi di nuovo."
	askPull      = "Ollama c'è, ma manca il cervello: lo scarico? Sono circa 2 GB, una volta sola."
	askPullAgain = "Il cervello che ho non funziona su questo PC. Ne scarico uno più leggero? Circa 2 GB, una volta sola."
	noGestor     = "Non trovo TwitchGestor. Il Raspberry è acceso?"
	hotkeyTip    = "Scrivimi quando vuoi: Ctrl+Alt+S."
)

func (a *app) gestorBase() string {
	b, _ := a.base.Load().(string)
	return b
}

// gestorCall: chiamata a Gestor con la chiave di Silver (fuori dal filo della finestra)
func gestorCall(base, key, method, path string, body any, out any) (int, error) {
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, base+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("x-silver-key", key)
	}
	res, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if out != nil {
		_ = json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode, nil
}

// ---------- collegamento con Gestor ----------

// pair: chiede il permesso a Gestor e aspetta "Consenti" (al massimo 10 minuti)
func (a *app) pair(announce bool) {
	if a.pairing {
		if announce {
			a.brain.Reply(time.Now(), pairHint)
		}
		return
	}
	base := a.gestorBase()
	if base == "" {
		if announce {
			a.brain.Reply(time.Now(), noGestor)
		}
		return
	}
	a.pairing = true
	if announce || !a.cfg.PairHintShown {
		a.cfg.PairHintShown = true
		a.cfg.save()
		wait := 2 * time.Second
		if !announce {
			wait = 12 * time.Second // all'avvio: dopo il saluto
		}
		go func() {
			time.Sleep(wait)
			a.post <- func() { a.brain.Reply(time.Now(), pairHint) }
		}()
	}
	pc, _ := os.Hostname()
	go func() {
		var r struct {
			ID string `json:"id"`
		}
		if code, err := gestorCall(base, "", "POST", "/silver/pair", map[string]string{"pc": pc}, &r); err != nil || code != 200 || r.ID == "" {
			a.post <- func() { a.pairing = false }
			return
		}
		for i := 0; i < 200; i++ {
			time.Sleep(3 * time.Second)
			var st struct {
				Status string `json:"status"`
				Key    string `json:"key"`
			}
			if _, err := gestorCall(base, "", "GET", "/silver/pair/"+r.ID, nil, &st); err != nil {
				continue
			}
			switch st.Status {
			case "ok":
				a.post <- func() {
					a.pairing = false
					a.cfg.Key, a.cfg.PairDenied = st.Key, false
					a.cfg.save()
					a.brain.Reply(time.Now(), paired+" "+hotkeyTip)
				}
				return
			case "denied", "gone":
				a.post <- func() {
					a.pairing = false
					if st.Status == "denied" {
						a.cfg.PairDenied = true
						a.cfg.save()
					}
				}
				return
			}
		}
		a.post <- func() { a.pairing = false }
	}()
}

// watchFeed: avvisi e prossima live da Gestor (ogni 10 secondi, quando è collegato)
func (a *app) watchFeed() {
	for {
		time.Sleep(10 * time.Second)
		base, key := a.gestorBase(), a.feedKey.Load()
		k, _ := key.(string)
		if base == "" || k == "" {
			continue
		}
		var f Feed
		code, err := gestorCall(base, k, "GET", "/silver/feed?since=0", nil, &f)
		if err != nil {
			continue
		}
		if code == 401 { // scollegato da Gestor
			a.post <- func() {
				if a.cfg.Key == k {
					a.cfg.Key = ""
					a.cfg.save()
				}
			}
			continue
		}
		if code == 200 {
			a.post <- func() { a.onFeed(f) }
		}
	}
}

func (a *app) onFeed(f Feed) {
	a.feed = &f
	now := time.Now()
	events, alerts := a.watch.Lines(f, now, a.rnd)
	for _, t := range alerts {
		a.brain.Alert(now, t, nil)
	}
	if len(alerts) > 0 {
		return
	}
	if quiet := a.brain.Ctx.ID == "game" && a.brain.GameMode == "quiet"; len(events) > 0 && !quiet && (a.brain.Bubble == nil || !a.brain.Bubble.Alert) {
		a.brain.Act(now)
		if len(events) > 2 { // tanti insieme: uno solo
			a.brain.Say(now, fmt.Sprintf("%s E altri %d avvisi.", events[len(events)-1], len(events)-1), "", "", nil)
		} else {
			a.brain.Say(now, strings.Join(events, " "), "", "", nil)
		}
	}
}

// ---------- promemoria ----------

func (a *app) checkReminders(now time.Time) {
	if len(a.cfg.Reminders) == 0 || (a.brain.Bubble != nil && a.brain.Bubble.Alert) {
		return
	}
	due, rest := dueReminders(a.cfg.Reminders, now)
	if len(due) == 0 {
		return
	}
	r := due[0] // uno alla volta: gli altri al prossimo giro
	a.cfg.Reminders = append(rest, due[1:]...)
	a.cfg.save()
	a.lastAlert = r.Text
	a.brain.Alert(now, r.Text, []Action{{"Fatto", "x:done"}, {"Tra 10 minuti", "x:snooze"}})
	a.chat.Add("silver", "⏰ "+r.Text)
}

func (a *app) addReminder(at time.Time, text string) {
	a.cfg.Reminders = append(a.cfg.Reminders, Reminder{ID: strconv.FormatInt(time.Now().UnixNano(), 36), At: at.UnixMilli(), Text: text})
	a.cfg.save()
}

func (a *app) onAction(choice string) {
	now := time.Now()
	if a.launchChoice(choice) || a.fileAction(choice) || a.guardAction(choice) || a.webAction(choice) || a.updateAction(choice) {
		return
	}
	switch choice {
	case "x:snooze":
		a.addReminder(now.Add(10*time.Minute), a.lastAlert)
		a.brain.Reply(now, "Va bene, tra 10 minuti te lo ridico.")
	case "x:done":
		a.brain.Reply(now, a.pick([]string{"Bene.", "Visto? Non era difficile.", "Uno in meno."}))
	case "x:ollama":
		openURL("https://ollama.com/download")
	case "x:pull":
		a.pullModel()
	case "x:draftsave":
		a.saveDraft()
	case "x:draftcancel":
		a.draft = nil
		a.reply("Va bene, non salvo niente.")
	case "x:whisper":
		a.installEar()
	case "x:nowhisper":
	case "x:nopull":
		a.pendingQ = ""
	}
}

func (a *app) pick(list []string) string { return list[a.rnd.Intn(len(list))] }

// ---------- quello che gli scrivi ----------

func (a *app) submitPanel() {
	text := a.panel.takeInput()
	if text == "" {
		return
	}
	a.chat.Add("me", text)
	a.handleInput(text)
}

// reply: risponde nel fumetto e nella finestra
func (a *app) reply(text string) {
	a.chat.Add("silver", text)
	a.brain.Reply(time.Now(), text)
}

func (a *app) handleInput(text string) {
	now := time.Now()
	// c'è una scheda da confermare: sì / no / una correzione ("no, alle 17", "spostalo a venerdì")
	if a.draft != nil && now.Sub(a.draftAt) < 15*time.Minute {
		switch {
		case isYes(text):
			a.saveDraft()
			return
		case isNo(text):
			a.draft = nil
			a.reply("Va bene, non salvo niente.")
			return
		}
		if !IsCreateRequest(text, now) {
			if corr := ParseDraft(text, now, a.categories()); corr.Changes() {
				d := a.draft.Merge(corr)
				a.draft, a.draftAt = &d, now
				a.showDraft("Corretto.")
				return
			}
		}
	}
	c := ParseCommand(text, now)
	switch c.Kind { // fa qualcosa: la posa d'azione (se hai caricato le pose)
	case "remind", "clear", "note", "music", "scene", "open", "launch", "close", "folder", "lastfile":
		a.brain.Act(now)
	}
	switch c.Kind {
	case "help":
		a.chat.Add("silver", helpText)
		a.brain.Reply(now, "Ecco cosa so fare. Leggi nella finestra.")
	case "time":
		a.reply("Sono le " + now.Format("15:04") + ". " + a.pick([]string{"Il tempo vola, tu un po' meno.", "Fai tu.", ""}))
	case "remind":
		a.addReminder(c.At, c.Text)
		a.reply(fmt.Sprintf("Va bene: %s ti ricordo \"%s\".", whenText(c.At, now), c.Text))
	case "reminders":
		a.reply(remindersText(a.cfg.Reminders, now))
	case "clear":
		n := len(a.cfg.Reminders)
		a.cfg.Reminders = nil
		a.cfg.save()
		a.reply(fmt.Sprintf("Cancellati %d promemoria.", n))
	case "nextlive":
		if a.feed == nil {
			if a.cfg.Key == "" {
				a.reply(needPair)
			} else {
				a.reply("Non ho ancora sentito TwitchGestor. Riprova tra poco.")
			}
			return
		}
		if t := nextLiveText(a.feed, now); t != "" {
			a.reply("Prossima live: " + t + ".")
		} else {
			a.reply("Nessuna live in programma. Aggiungine una in Programmazione (o in Howl-UP).")
		}
	case "create":
		if a.cfg.Key == "" {
			a.reply(needPair)
			a.pair(false)
			return
		}
		d := ParseDraft(text, now, a.categories())
		a.draft, a.draftAt = &d, now
		a.showDraft("")
	case "agenda":
		if a.feed == nil {
			if a.cfg.Key == "" {
				a.reply(needPair)
			} else {
				a.reply("Non ho ancora sentito TwitchGestor. Riprova tra poco.")
			}
			return
		}
		a.reply(agendaText(a.feed.Agenda, now, c.Text))
	case "open":
		host := "twitchgestor"
		if u, err := url.Parse(a.gestorBase()); err == nil && u.Hostname() != "" {
			host = u.Hostname()
		}
		switch c.Text {
		case "player":
			a.launchPlayer()
			return
		case "gestor":
			openURL("http://" + host + ":3000/dashboard")
		case "howlup":
			openURL("http://" + host + ":3100/")
		case "musicante":
			openURL("http://" + host + ":3200/")
		case "ollama":
			openURL("https://ollama.com/download")
		}
		a.reply("Aperto.")
	case "diag":
		a.diagnoseMusic()
	case "launch":
		a.launchCmd(c.Text)
	case "update":
		a.updateCmd(c.Text)
	case "version":
		a.updateCmd("version")
	case "web":
		a.webCmd(c.Text)
	case "mode":
		a.runMode(c.Text)
	case "modedef":
		a.defineMode(c.Text, c.Arg)
	case "modedel":
		a.deleteMode(c.Text)
	case "modelist":
		a.reply(a.modeList())
	case "twitch":
		a.twitchCmd(c)
	case "briefing":
		a.briefing()
	case "weather":
		a.weatherCmd(c.Text == "tomorrow")
	case "city":
		a.setCity(c.Text)
	case "close":
		a.closeCmd(c.Text)
	case "pc":
		a.pcCmd(c)
	case "folder":
		a.folderCmd(c.Text)
	case "findfile":
		a.findCmd(c.Text, c.Arg)
	case "lastfile":
		a.lastFileCmd(c.Text)
	case "remember":
		a.remember(c.Text)
	case "memories":
		a.memories()
	case "forget":
		a.forget(c.Text)
	case "applist", "appdiag":
		a.appsInfo(c.Kind == "appdiag")
	case "music":
		a.musicCmd(c)
	case "note", "scene":
		a.gestorDo(c)
	default:
		a.askAI(text)
	}
}

// gestorDo: musica, scena, nota (passano da Gestor)
func (a *app) gestorDo(c Command) {
	base, key := a.gestorBase(), a.cfg.Key
	if base == "" {
		a.reply(noGestor)
		return
	}
	if key == "" {
		a.reply(needPair)
		a.pair(false)
		return
	}
	body := map[string]string{"action": c.Kind}
	switch c.Kind {
	case "note":
		body["text"] = c.Text
	case "music":
		body["what"] = c.Text
	case "scene":
		body["scene"] = c.Text
	}
	go func() {
		var r struct {
			Text  string `json:"text"`
			Error string `json:"error"`
		}
		code, err := gestorCall(base, key, "POST", "/silver/do", body, &r)
		a.post <- func() {
			switch {
			case err != nil:
				a.reply(noGestor)
			case code == 401:
				a.cfg.Key = ""
				a.cfg.save()
				a.reply(needPair)
			case r.Error != "":
				a.reply(r.Error)
			default:
				a.reply(r.Text)
			}
		}
	}()
}

// ---------- IA (Ollama sul PC) ----------

func (a *app) askAI(q string) {
	if a.aiBusy {
		a.reply("Un attimo: sto ancora pensando alla domanda di prima.")
		return
	}
	a.aiBusy = true
	a.brain.Thinking = "Ci penso…"
	ctxInfo, live, next := a.brain.Ctx, a.brain.Live, nextLiveText(a.feed, time.Now())
	agenda := ""
	if a.feed != nil {
		agenda = agendaBrief(a.feed.Agenda, time.Now())
	}
	history := append([]chatMsg(nil), a.history...)
	go func() {
		ok, models := a.ai.Detect(context.Background())
		model := pickModel(models, a.cfg.Model, a.cfg.BadModels...)
		if !ok || model == "" {
			a.post <- func() {
				a.aiBusy = false
				a.brain.Thinking = ""
				now := time.Now()
				if !ok {
					a.chat.Add("silver", noOllama)
					a.brain.Alert(now, noOllama, []Action{{"Apri la pagina di Ollama", "x:ollama"}})
				} else {
					a.pendingQ = q
					msg := askPull
					if len(a.cfg.BadModels) > 0 {
						msg = askPullAgain
					}
					a.chat.Add("silver", msg)
					a.brain.Alert(now, msg, []Action{{"Sì, scarica", "x:pull"}, {"No", "x:nopull"}})
				}
			}
			return
		}
		a.ai.Model = model
		msgs := append([]chatMsg{{"system", systemPrompt(time.Now(), ctxInfo, live, next, agenda, strings.Join(a.cfg.Memory, "\n"))}}, history...)
		msgs = append(msgs, chatMsg{"user", q})
		a.post <- func() { a.chat.Add("silver", "") }
		answer, err := a.ai.Chat(context.Background(), msgs, func(tok string) {
			a.post <- func() { a.chat.AppendLast(tok) }
		})
		answer = strings.TrimSpace(plain(answer))
		a.post <- func() {
			a.aiBusy = false
			a.brain.Thinking = ""
			if err != nil && answer == "" {
				if brokenModel(err) { // questo modello non parte sul PC: si segna e se ne usa (o scarica) un altro
					a.cfg.BadModels = append(a.cfg.BadModels, model)
					a.cfg.Model = ""
					a.cfg.save()
					a.chat.SetLast("error", "Il cervello "+model+" non riesce a partire su questo PC. Ne provo un altro.")
					a.askAI(q)
					return
				}
				a.chat.SetLast("error", "Non riesco a pensare: "+err.Error())
				a.brain.Reply(time.Now(), "Qualcosa non va con l'IA. Dettagli nella finestra.")
				return
			}
			a.cfg.Model = model
			a.chat.SetLast("silver", answer)
			a.history = append(a.history, chatMsg{"user", q}, chatMsg{"assistant", answer})
			if len(a.history) > 8 {
				a.history = a.history[len(a.history)-8:]
			}
			a.brain.Reply(time.Now(), answer)
		}
	}()
}

// pullModel: scarica il modello (una volta sola), poi risponde alla domanda rimasta in sospeso
func (a *app) pullModel() {
	if a.aiBusy {
		return
	}
	a.aiBusy = true
	a.brain.Thinking = "Scarico il cervello…"
	a.chat.Add("silver", "Scarico il cervello ("+defaultModel+")…")
	go func() {
		last := time.Time{}
		err := a.ai.Pull(context.Background(), defaultModel, func(f float64, status string) {
			if time.Since(last) < 500*time.Millisecond || f < 0 {
				return
			}
			last = time.Now()
			pct := int(f * 100)
			a.post <- func() {
				a.brain.Thinking = fmt.Sprintf("Scarico il cervello… %d%%", pct)
				a.chat.SetLast("silver", fmt.Sprintf("Scarico il cervello (%s)… %d%%", defaultModel, pct))
			}
		})
		a.post <- func() {
			a.aiBusy = false
			a.brain.Thinking = ""
			if err != nil {
				a.chat.SetLast("error", "Download non riuscito: "+err.Error())
				a.brain.Reply(time.Now(), "Il download non è andato. Riprova più tardi.")
				return
			}
			a.cfg.Model = defaultModel
			a.cfg.save()
			for _, m := range a.cfg.BadModels { // quelli che non partivano: si tolgono (liberano spazio)
				go a.ai.Delete(context.Background(), m)
			}
			a.chat.SetLast("silver", "Fatto, ho il cervello. Adesso ragiono.")
			if q := a.pendingQ; q != "" {
				a.pendingQ = ""
				a.askAI(q)
			} else {
				a.brain.Reply(time.Now(), "Fatto. Adesso puoi chiedermi quello che vuoi.")
			}
		}
	}()
}

// ---------- impegni, cose da fare e live per Howl-UP ----------

// categories: quelle di Howl-UP (arrivano con l'agenda), altrimenti quelle di base
func (a *app) categories() []Category {
	if a.feed != nil && a.feed.Agenda != nil && len(a.feed.Agenda.Categories) > 0 {
		return a.feed.Agenda.Categories
	}
	return defaultCategories
}

// showDraft: la scheda con tutti i dettagli, da confermare (o correggere)
func (a *app) showDraft(intro string) {
	d := a.draft
	sum := d.Summary(a.categories())
	if intro != "" {
		sum = intro + "\n" + sum
	}
	if m := d.Missing(); m != "" {
		a.chat.Add("silver", sum+"\n\nMi manca "+m+". Dimmelo e aggiorno la scheda.")
		a.brain.Alert(time.Now(), sum+"\nMi manca "+m+".", []Action{{"Annulla", "x:draftcancel"}})
		return
	}
	a.chat.Add("silver", sum+"\n\nSalvo? Puoi anche correggere (es. \"no, alle 17\", \"spostalo a venerdì\", \"categoria lavoro\").")
	a.brain.Alert(time.Now(), sum, []Action{{"Salva", "x:draftsave"}, {"Annulla", "x:draftcancel"}})
}

// saveDraft: in Howl-UP (passando da Gestor)
func (a *app) saveDraft() {
	d := a.draft
	if d == nil {
		return
	}
	if m := d.Missing(); m != "" {
		a.reply("Prima mi serve " + m + ".")
		return
	}
	base, key := a.gestorBase(), a.cfg.Key
	if base == "" || key == "" {
		a.reply(needPair)
		return
	}
	a.draft = nil
	action, body := d.Payload()
	a.brain.Act(time.Now())
	go func() {
		var r struct {
			Text  string `json:"text"`
			Error string `json:"error"`
		}
		code, err := gestorCall(base, key, "POST", "/silver/do", map[string]any{"action": action, action: body}, &r)
		a.post <- func() {
			switch {
			case err != nil:
				a.draft = d // si può riprovare con "salva"
				a.reply(noGestor)
			case code == 401:
				a.cfg.Key = ""
				a.cfg.save()
				a.reply(needPair)
			case r.Error != "":
				a.reply(r.Error)
			default:
				a.reply(r.Text)
			}
		}
	}()
}
