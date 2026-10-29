//go:build windows

package main

// Parlare a Silver: Ctrl+Alt+V (tienilo premuto mentre parli, oppure premilo una volta e parla: si ferma
// quando smetti) o il microfono nella finestra. La voce diventa testo con Whisper sul PC e va a Silver
// come se l'avessi scritta.

import (
	"context"
	"time"
)

var pGetAsyncKeyState = user32.NewProc("GetAsyncKeyState")

const (
	askWhisper = "Per sentirti devo scaricare l'orecchio (Whisper, circa 200 MB), una volta sola. Poi tutto resta sul tuo PC. Scarico?"
	micHelp    = "Non sento il microfono. Controlla in Impostazioni di Windows → Privacy → Microfono che le app desktop possano usarlo."
)

type listening struct {
	rec       *recorder
	start     time.Time
	hold      bool // tenuto premuto Ctrl+Alt+V: si ferma quando lo lasci
	heard     bool // hai cominciato a parlare
	lastLoud  time.Time
	fromPanel bool
}

// startListening: hold = da Ctrl+Alt+V (si ferma quando lo lasci, o quando smetti di parlare se l'hai solo premuto)
func (a *app) startListening(hold, fromPanel bool) {
	now := time.Now()
	if a.listen != nil { // di nuovo: basta così
		a.stopListening()
		return
	}
	if a.installingEar {
		a.reply("Sto ancora scaricando l'orecchio. Un attimo.")
		return
	}
	if !whisperReady() {
		a.chat.Add("silver", askWhisper)
		a.brain.Alert(now, askWhisper, []Action{{"Sì, scarica", "x:whisper"}, {"No", "x:nowhisper"}})
		return
	}
	rec, err := startRecorder()
	if err != nil {
		a.reply(micHelp + " (" + err.Error() + ")")
		return
	}
	a.listen = &listening{rec: rec, start: now, hold: hold, lastLoud: now, fromPanel: fromPanel}
	a.brain.Bubble = nil
	a.brain.Thinking = "Ti ascolto…"
	a.chat.Listening = true
}

// tickListening: quando smettere di ascoltare (ogni fotogramma)
func (a *app) tickListening(now time.Time) {
	l := a.listen
	if l == nil {
		return
	}
	lv := l.rec.Level()
	if lv > 0.025 {
		l.heard, l.lastLoud = true, now
	}
	held := false
	if r, _, _ := pGetAsyncKeyState.Call('V'); r&0x8000 != 0 {
		if r2, _, _ := pGetAsyncKeyState.Call(0x11); r2&0x8000 != 0 { // Ctrl
			held = true
		}
	}
	elapsed := now.Sub(l.start)
	switch {
	case l.hold && held:
		// tieni premuto: si ascolta
	case l.hold && elapsed < 400*time.Millisecond:
		// premuto e lasciato subito: si ascolta "a mani libere" fino al silenzio
		l.hold = false
	case l.hold:
		a.stopListening() // lasciato
	case l.heard && now.Sub(l.lastLoud) > 1300*time.Millisecond:
		a.stopListening() // hai finito la frase
	case !l.heard && elapsed > 7*time.Second:
		a.cancelListening("Non ho sentito niente. Il microfono è quello giusto?")
	}
	if l == a.listen && elapsed > 30*time.Second {
		a.stopListening()
	}
}

func (a *app) cancelListening(msg string) {
	if a.listen == nil {
		return
	}
	a.listen.rec.Stop()
	a.listen = nil
	a.chat.Listening = false
	a.brain.Thinking = ""
	a.reply(msg)
}

// stopListening: dalla voce al testo, poi come se l'avessi scritto
func (a *app) stopListening() {
	l := a.listen
	if l == nil {
		return
	}
	a.listen = nil
	a.chat.Listening = false
	pcm := l.rec.Stop()
	if len(pcm) < micRate/3 || !l.heard {
		a.brain.Thinking = ""
		a.reply("Non ho sentito niente.")
		return
	}
	a.brain.Thinking = "Capisco…"
	go func() {
		text, err := transcribe(pcm)
		a.post <- func() {
			a.brain.Thinking = ""
			switch {
			case err != nil:
				a.chat.Add("error", "Non riesco a capire la voce: "+err.Error())
				a.brain.Reply(time.Now(), "Qualcosa non va con l'orecchio. Dettagli nella finestra (Ctrl+Alt+S).")
			case text == "":
				a.reply("Non ho capito. Riprova, magari più vicino al microfono.")
			default:
				a.chat.Add("me", text)
				a.handleInput(text)
			}
		}
	}()
}

// installEar: scarica Whisper (programma e modello) con l'avanzamento nel fumetto
func (a *app) installEar() {
	if a.installingEar {
		return
	}
	a.installingEar = true
	a.brain.Thinking = "Scarico l'orecchio…"
	a.chat.Add("silver", "Scarico l'orecchio…")
	go func() {
		err := installWhisper(context.Background(), func(st string) {
			a.post <- func() {
				a.brain.Thinking = st
				a.chat.SetLast("silver", st)
			}
		})
		a.post <- func() {
			a.installingEar = false
			a.brain.Thinking = ""
			if err != nil {
				a.chat.SetLast("error", "Download dell'orecchio non riuscito: "+err.Error())
				a.brain.Reply(time.Now(), "Il download non è andato. Riprova più tardi.")
				return
			}
			a.chat.SetLast("silver", "Fatto, adesso ti sento.")
			a.brain.Reply(time.Now(), "Fatto, adesso ti sento. Tieni premuto Ctrl+Alt+V e parla.")
		}
	}()
}
