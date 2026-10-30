//go:build windows

package main

// Modalità (sequenze di comandi) e la live a comando (titolo, gioco, shoutout, chat, segnalibro, clip…).

import (
	"sort"
	"strings"
	"time"
)

// modes: quelle pronte più le tue (una tua con lo stesso nome la sostituisce; vuota = cancellata)
func (a *app) modes() map[string][]string {
	all := map[string][]string{}
	for k, v := range defaultModes {
		all[k] = v
	}
	for k, v := range a.cfg.Modes {
		if len(v) == 0 {
			delete(all, k)
		} else {
			all[k] = v
		}
	}
	return all
}

func (a *app) findMode(name string) (string, []string) {
	all := a.modes()
	if steps, ok := all[name]; ok {
		return name, steps
	}
	for k, v := range all { // "modalità stud" → "studio"
		if strings.HasPrefix(k, name) || strings.HasPrefix(name, k) {
			return k, v
		}
	}
	return "", nil
}

func (a *app) modeList() string {
	all := a.modes()
	if len(all) == 0 {
		return "Nessuna modalità. Creane una: \"crea la modalità studio: apri Discord, apri Spotify\"."
	}
	var names []string
	for k := range all {
		names = append(names, k)
	}
	sort.Strings(names)
	var b strings.Builder
	b.WriteString("Le tue modalità:")
	for _, k := range names {
		b.WriteString("\n• " + k + ": " + strings.Join(all[k], ", "))
	}
	return b.String()
}

// runMode: i comandi uno dopo l'altro (con un attimo tra uno e l'altro, così i programmi fanno in tempo ad aprirsi)
func (a *app) runMode(name string) {
	key, steps := a.findMode(name)
	if key == "" {
		a.reply("Non conosco la modalità \"" + name + "\". " + a.modeList())
		return
	}
	if a.modeRunning {
		a.reply("Sto già eseguendo una modalità. Un attimo.")
		return
	}
	a.modeRunning = true
	a.brain.Act(time.Now())
	a.chat.Add("silver", "Modalità "+key+": "+strings.Join(steps, " → "))
	a.brain.Reply(time.Now(), "Modalità "+key+". Ci penso io.")
	go func() {
		for i, st := range steps {
			if i > 0 {
				time.Sleep(2 * time.Second)
			}
			step := st
			a.post <- func() {
				if c := ParseCommand(step, time.Now()); c.Kind == "mode" || c.Kind == "modedef" { // niente modalità dentro le modalità
					return
				}
				a.chat.Add("me", "▸ "+step)
				a.handleInput(step)
			}
		}
		time.Sleep(2 * time.Second)
		a.post <- func() { a.modeRunning = false }
	}()
}

func (a *app) defineMode(name, stepsText string) {
	steps := ParseModeSteps(stepsText)
	if name == "" || len(steps) == 0 {
		a.reply("Dimmi nome e comandi: \"crea la modalità studio: apri Discord, apri Spotify\".")
		return
	}
	if a.cfg.Modes == nil {
		a.cfg.Modes = map[string][]string{}
	}
	a.cfg.Modes[name] = steps
	a.cfg.save()
	a.reply("Modalità " + name + " salvata: " + strings.Join(steps, " → ") + ". Per usarla: \"modalità " + name + "\".")
}

func (a *app) deleteMode(name string) {
	key, _ := a.findMode(name)
	if key == "" {
		a.reply("Non c'è una modalità \"" + name + "\".")
		return
	}
	if a.cfg.Modes == nil {
		a.cfg.Modes = map[string][]string{}
	}
	if _, isDefault := defaultModes[key]; isDefault {
		a.cfg.Modes[key] = []string{} // quella pronta resta nascosta
	} else {
		delete(a.cfg.Modes, key)
	}
	a.cfg.save()
	a.reply("Modalità " + key + " cancellata.")
}

// twitchCmd: la live a comando (passa da Gestor, che parla con Twitch)
func (a *app) twitchCmd(c Command) {
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
	a.brain.Act(time.Now())
	go func() {
		var r struct {
			Text  string `json:"text"`
			URL   string `json:"url"`
			Error string `json:"error"`
		}
		code, err := gestorCall(base, key, "POST", "/silver/do", map[string]any{"action": "twitch", "what": c.Text, "value": c.Arg}, &r)
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
			case r.URL != "":
				a.lastPath = r.URL
				a.chat.Add("silver", r.Text+" "+r.URL)
				a.brain.Alert(time.Now(), r.Text, []Action{{"Apri la clip", "x:openlast"}})
			default:
				a.reply(r.Text)
			}
		}
	}()
}
