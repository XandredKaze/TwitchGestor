//go:build windows

package main

// "Ehi Silver": microfono sempre acceso (solo se l'hai attivato dal menu). Si ferma da solo in live,
// nei giochi e mentre Silver ti sta già ascoltando; riparte appena puoi.

import (
	"context"
	"time"
)

type wakeState struct {
	rec  *recorder
	seg  segmenter
	busy bool // un pezzo di voce è da Whisper
}

// wakeWanted: adesso deve ascoltare "Ehi Silver"?
func (a *app) wakeWanted() bool {
	return a.cfg.WakeWord && a.cfg.Enabled && !a.installingEar && a.listen == nil && !a.brain.Live && a.brain.Ctx.ID != "game" && wakeReady()
}

func (a *app) stopWake() {
	if a.wake.rec != nil {
		a.wake.rec.Stop()
		a.wake.rec = nil
		a.wake.seg.Reset()
	}
}

// tickWake: ogni fotogramma (accende, spegne, e passa a Whisper le frasi dette)
func (a *app) tickWake(now time.Time) {
	want := a.wakeWanted()
	switch {
	case want && a.wake.rec == nil:
		if now.Before(a.wakeRetry) {
			return
		}
		rec, err := startRecorder()
		if err != nil {
			a.wakeRetry = now.Add(time.Minute) // microfono occupato o assente: si riprova tra poco
			return
		}
		a.wake.rec = rec
	case !want && a.wake.rec != nil:
		a.stopWake()
		return
	case a.wake.rec == nil:
		return
	}
	for _, seg := range a.wake.seg.Push(a.wake.rec.Drain()) {
		if a.wake.busy {
			continue // sta ancora capendo la frase di prima
		}
		a.wake.busy = true
		go func(pcm []int16) {
			text, err := transcribeWith(wakeModel(), "Ehi Silver.", pcm)
			// "Ehi Silver, …" detto tutto insieme: il resto si ricapisce con l'orecchio grande (più preciso)
			if ok, rest := matchWake(text); err == nil && ok && rest != "" && whisperReady() {
				if better, err2 := transcribeWith(whisperModel(), "Ehi Silver.", pcm); err2 == nil {
					if ok2, rest2 := matchWake(better); ok2 && rest2 != "" {
						text = better
					}
				}
			}
			a.post <- func() {
				a.wake.busy = false
				if err != nil || a.listen != nil {
					return
				}
				ok, rest := matchWake(text)
				if !ok {
					return
				}
				if rest != "" { // "Ehi Silver, metti la playlist Alf": si fa subito
					a.chat.Add("me", rest)
					a.handleInput(rest)
					return
				}
				a.stopWake()
				a.startListening(false, false)
			}
		}(seg)
	}
}

// toggleWake: dal menu
func (a *app) toggleWake() {
	if a.cfg.WakeWord {
		a.cfg.WakeWord = false
		a.cfg.save()
		a.stopWake()
		a.reply("Va bene, niente più \"Ehi Silver\". Per parlarmi: Ctrl+Alt+V.")
		return
	}
	a.cfg.WakeWord = true
	a.cfg.save()
	if wakeReady() {
		a.reply("Ti ascolto: chiamami con \"Ehi Silver\". In live e nei giochi sto zitto e non ascolto.")
		return
	}
	if a.installingEar {
		return
	}
	a.installingEar = true
	a.brain.Thinking = "Scarico l'orecchio…"
	a.chat.Add("silver", "Scarico l'orecchio per \"Ehi Silver\"…")
	go func() {
		err := installWake(context.Background(), func(st string) {
			a.post <- func() { a.brain.Thinking = st; a.chat.SetLast("silver", st) }
		})
		a.post <- func() {
			a.installingEar = false
			a.brain.Thinking = ""
			if err != nil {
				a.cfg.WakeWord = false
				a.cfg.save()
				a.chat.SetLast("error", "Download non riuscito: "+err.Error())
				a.brain.Reply(time.Now(), "Il download non è andato. Riprova più tardi dal menu.")
				return
			}
			a.chat.SetLast("silver", "Pronto: chiamami con \"Ehi Silver\".")
			a.brain.Reply(time.Now(), "Pronto: chiamami con \"Ehi Silver\". In live e nei giochi non ascolto.")
		}
	}()
}
