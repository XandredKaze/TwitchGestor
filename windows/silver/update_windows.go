//go:build windows

package main

// Aggiornarsi da soli: scaricare da Gestor, controllare l'impronta, sostituire il programma e ripartire.
// Un programma in uso su Windows non si può sovrascrivere, ma si può rinominare: Silver.exe → Silver.exe.old,
// il nuovo prende il suo posto, parte con --updated e la versione vecchia si chiude (poi .old si cancella).

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// afterStart: l'impronta di sé stesso; dopo un aggiornamento cancella la versione vecchia e lo dice
func (a *app) afterStart(updated bool) {
	exe, _ := os.Executable()
	h := fileHash(exe)
	a.post <- func() { a.myHash = h }
	if updated {
		for i := 0; i < 20; i++ {
			if err := os.Remove(exe + ".old"); err == nil || os.IsNotExist(err) {
				break
			}
			time.Sleep(time.Second)
		}
		time.Sleep(2 * time.Second)
		a.post <- func() {
			a.brain.Reply(time.Now(), "Aggiornato alla versione "+appVersion+". Si sente la differenza, vero?")
		}
	}
	// il Player: cancella la versione vecchia lasciata da un aggiornamento
	if p := readPlayerConf().Exe; p != "" {
		_ = os.Remove(p + ".old")
	}
}

// onExeVersions: cosa offre Gestor; una versione nuova di Silver la propone una volta (si aggiorna solo se dici sì)
func (a *app) onExeVersions(silver, player, version string) {
	a.newSilver, a.newPlayer, a.newVersion = silver, player, version
	if silver == "" || a.myHash == "" || silver == a.myHash || a.cfg.OfferedUpdate == silver || a.updating {
		return
	}
	a.cfg.OfferedUpdate = silver
	a.cfg.save()
	a.chat.Add("silver", "C'è una versione nuova di me ("+version+"). Quando vuoi dimmi \"aggiornati\".")
	a.brain.Alert(time.Now(), "C'è una versione nuova di me. Mi aggiorno?", []Action{{"Aggiornati", "x:update:silver"}, {"Più tardi", "x:update:no"}})
}

func (a *app) updateAction(choice string) bool {
	if !strings.HasPrefix(choice, "x:update:") {
		return false
	}
	switch strings.TrimPrefix(choice, "x:update:") {
	case "silver":
		a.updateCmd("silver")
	}
	return true
}

func downloadExe(url string) ([]byte, error) {
	res, err := (&http.Client{Timeout: 3 * time.Minute}).Get(url)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("%s", res.Status)
	}
	return io.ReadAll(io.LimitReader(res.Body, 200<<20))
}

// replaceExe: il nuovo programma al posto di quello vecchio (che può essere in uso: si rinomina)
func replaceExe(path string, data []byte) error {
	tmp := path + ".new"
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return err
	}
	_ = os.Remove(path + ".old")
	if err := os.Rename(path, path+".old"); err != nil && !os.IsNotExist(err) {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Rename(path+".old", path) // si rimette com'era
		return err
	}
	return nil
}

func (a *app) updateCmd(what string) {
	if what == "version" {
		a.reply("Sono la versione " + appVersion + ".")
		return
	}
	base := a.gestorBase()
	if base == "" {
		a.reply(noGestor)
		return
	}
	if a.updating {
		a.reply("Mi sto già aggiornando.")
		return
	}
	a.updating = true
	a.brain.Thinking = "Controllo gli aggiornamenti…"
	wantSilver, wantPlayer := a.newSilver, a.newPlayer // le impronte dichiarate da Gestor
	go func() {
		var msgs []string
		restart := false
		var playerErr, silverErr error
		if what == "player" || what == "all" {
			var m string
			m, playerErr = updatePlayer(base, wantPlayer)
			msgs = append(msgs, m)
		}
		if what == "silver" || what == "all" {
			data, err := downloadExe(base + "/scarica/Silver.exe")
			switch {
			case err != nil:
				silverErr = err
			case len(data) < 1<<20:
				silverErr = fmt.Errorf("file troppo piccolo")
			case wantSilver != "" && bytesHash(data) != wantSilver:
				silverErr = fmt.Errorf("il file scaricato non è integro")
			default:
				exe, _ := os.Executable()
				if bytesHash(data) == fileHash(exe) {
					msgs = append(msgs, "Io sono già aggiornato (versione "+appVersion+").")
				} else if err := replaceExe(exe, data); err != nil {
					silverErr = err
				} else {
					restart = true
				}
			}
		}
		a.post <- func() {
			a.brain.Thinking = ""
			a.updating = false
			if playerErr != nil {
				msgs = append(msgs, "Musicante Player non si è aggiornato: "+playerErr.Error()+".")
			}
			if silverErr != nil {
				msgs = append(msgs, "Non riesco ad aggiornarmi: "+silverErr.Error()+". Riscaricami da TwitchGestor (⚙ Sistema → 🧰 Tools).")
			}
			if restart {
				a.chat.Add("silver", strings.TrimSpace(strings.Join(msgs, "\n")+"\nMi aggiorno e torno subito."))
				a.brain.Reply(time.Now(), "Mi aggiorno. Torno tra un attimo.")
				a.restartUpdated()
				return
			}
			a.reply(strings.Join(msgs, "\n"))
		}
	}()
}

// restartUpdated: parte la versione nuova e questa si chiude
func (a *app) restartUpdated() {
	go func() {
		time.Sleep(1500 * time.Millisecond)
		a.post <- func() {
			exe, _ := os.Executable()
			windows.CloseHandle(mutexHandle) // la nuova deve poter partire
			cmd := exec.Command(exe, "--updated")
			if err := cmd.Start(); err != nil {
				a.reply("Non riesco a ripartire: aprimi tu (" + err.Error() + ").")
				return
			}
			a.quitAt = time.Now()
		}
	}()
}

// updatePlayer: scarica Musicante Player nuovo; se è aperto lo chiude, lo sostituisce e lo riapre
func updatePlayer(base, want string) (string, error) {
	conf := readPlayerConf()
	if conf.Exe == "" {
		return "", fmt.Errorf("non so dove sta (aprilo una volta)")
	}
	data, err := downloadExe(base + "/scarica/MusicantePlayer.exe")
	if err != nil {
		return "", err
	}
	if want != "" && bytesHash(data) != want {
		return "", fmt.Errorf("il file scaricato non è integro")
	}
	if bytesHash(data) == fileHash(conf.Exe) {
		return "Musicante Player è già aggiornato.", nil
	}
	wasOpen := playerRunning()
	if wasOpen {
		for _, w := range visibleWindows() {
			if strings.EqualFold(w.exe, "MusicantePlayer") {
				pPostMessage.Call(w.hwnd, wmClose, 0, 0)
			}
		}
		for i := 0; i < 10 && playerRunning(); i++ {
			time.Sleep(500 * time.Millisecond)
		}
		if playerRunning() {
			kill := exec.Command("taskkill.exe", "/IM", "MusicantePlayer.exe", "/F")
			kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
			_ = kill.Run()
			time.Sleep(time.Second)
		}
	}
	if err := replaceExe(conf.Exe, data); err != nil {
		return "", err
	}
	if wasOpen {
		_ = exec.Command(conf.Exe).Start()
		return "Musicante Player aggiornato e riaperto.", nil
	}
	_ = os.Remove(conf.Exe + ".old")
	return "Musicante Player aggiornato (" + filepath.Base(conf.Exe) + ").", nil
}
