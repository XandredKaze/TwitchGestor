//go:build windows

package main

// Musicante Player sul PC: Silver lo comanda dal suo telecomando (127.0.0.1:47321, vedi windows/player/remote.go)
// e, se non è aperto, lo apre lui (sa dov'è perché il Player lo scrive nella sua configurazione).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// playerRunning: Musicante Player è aperto? (anche se è una versione vecchia senza telecomando)
func playerRunning() bool {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(snap)
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
		if strings.EqualFold(windows.UTF16ToString(pe.ExeFile[:]), "MusicantePlayer.exe") {
			return true
		}
	}
	return false
}

const oldPlayer = "Musicante Player è aperto ma è una versione vecchia, che non si lascia comandare. Chiudilo e riscarica MusicantePlayer.exe da TwitchGestor (⚙ Sistema → 🧰 Tools), poi riaprilo: da lì in poi lo comando io."

// la configurazione di Musicante Player (la scrive lui): dove sta e su che porta ascolta il telecomando
type playerConf struct {
	Exe       string `json:"exe"`
	Remote    int    `json:"remote"`
	RemoteErr string `json:"remoteErr"`
	found     bool
}

func readPlayerConf() playerConf {
	var c playerConf
	dir, err := os.UserConfigDir()
	if err != nil {
		return c
	}
	if b, err := os.ReadFile(filepath.Join(dir, "MusicantePlayer", "config.json")); err == nil {
		c.found = json.Unmarshal(b, &c) == nil
	}
	return c
}

func playerURL() string {
	port := readPlayerConf().Remote
	if port == 0 {
		port = 47321
	}
	return "http://127.0.0.1:" + strconv.Itoa(port)
}

type playerState struct {
	Playing  bool   `json:"playing"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Playlist string `json:"playlist"`
	Volume   int    `json:"volume"`
	Tracks   int    `json:"tracks"`
}

func playerCall(method, path string, body any, out any) bool {
	_, err := playerDo(method, path, body, out)
	return err == nil
}

// playerDo: come playerCall, ma dice cosa è andato storto (per la diagnosi)
func playerDo(method, path string, body any, out any) (int, error) {
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, playerURL()+path, rd)
	req.Header.Set("x-silver", "1")
	res, err := (&http.Client{Timeout: 7 * time.Second}).Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return res.StatusCode, fmt.Errorf("%s %s", res.Status, strings.TrimSpace(string(b)))
	}
	if out != nil {
		_ = json.NewDecoder(res.Body).Decode(out)
	}
	return 200, nil
}

// playerExe: dove sta MusicantePlayer.exe (lo scrive lui all'avvio)
func playerExe() string {
	c := readPlayerConf()
	if c.Exe == "" {
		return ""
	}
	if _, err := os.Stat(c.Exe); err != nil {
		return ""
	}
	return c.Exe
}

// waitPlayer: aspetta che il Player sia pronto (musica caricata), al massimo 25 secondi
func waitPlayer() (playerState, bool) {
	var st playerState
	for i := 0; i < 50; i++ {
		if playerCall("GET", "/state", nil, &st) && st.Tracks > 0 {
			return st, true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return st, false
}

func nowPlaying(st playerState) string {
	if st.Title == "" {
		return "Niente in riproduzione."
	}
	s := st.Title
	if st.Artist != "" {
		s += " di " + st.Artist
	}
	if !st.Playing {
		return "In pausa: " + s + "."
	}
	return "Suona: " + s + "."
}

// musicCmd: pausa, avanti, cerca, volume… su Musicante Player (o sulla musica della live)
func (a *app) musicCmd(c Command) {
	if c.Where == "live" {
		switch c.Text {
		case "now":
			if a.feed != nil && a.feed.Song != "" {
				a.reply("In live suona: " + a.feed.Song + ".")
			} else {
				a.reply("In live non suona niente (o non sono collegato a TwitchGestor).")
			}
		case "volume", "find":
			a.reply("Per la musica della live so fare pausa, play, avanti e indietro. Il resto da TwitchGestor.")
		default:
			a.gestorDo(c)
		}
		return
	}
	go func() {
		var st playerState
		open := playerCall("GET", "/state", nil, &st)
		if !open && playerRunning() {
			// aperto ma senza telecomando (scaricato prima della 1.50): niente musica della live al suo posto
			time.Sleep(1500 * time.Millisecond) // magari si sta ancora aprendo
			if open = playerCall("GET", "/state", nil, &st); !open {
				a.post <- func() { a.reply(oldPlayer) }
				return
			}
		}
		if !open {
			// non è aperto: pausa/avanti/indietro vanno alla musica della live; per il resto si apre il Player
			if c.Text == "pause" || c.Text == "next" || c.Text == "prev" || c.Text == "toggle" {
				a.post <- func() { c.Where = "live"; a.gestorDo(c) }
				return
			}
			exe := playerExe()
			if exe == "" {
				a.post <- func() {
					a.reply("Musicante Player non è aperto, e non so dove l'hai messo. Aprilo una volta (lo scarichi da TwitchGestor: ⚙ Sistema → 🧰 Tools), poi ci penso io.")
				}
				return
			}
			a.post <- func() { a.reply("Apro Musicante Player…") }
			if err := exec.Command(exe).Start(); err != nil {
				a.post <- func() { a.reply("Non riesco ad aprire Musicante Player: " + err.Error()) }
				return
			}
			if st, open = waitPlayer(); !open {
				a.post <- func() { a.reply("Musicante Player si è aperto, ma non ha ancora la musica: il Raspberry è acceso?") }
				return
			}
		}
		cmd := map[string]any{"action": c.Text}
		switch c.Text {
		case "now":
			a.post <- func() { a.reply(nowPlaying(st)) }
			return
		case "find":
			cmd["query"] = c.Arg
		case "volume":
			v, _ := strconv.Atoi(strings.TrimPrefix(c.Arg, "+"))
			if strings.HasPrefix(c.Arg, "+") || strings.HasPrefix(c.Arg, "-") { // "alza il volume": un po' più su
				v += st.Volume
			}
			cmd["value"] = min(100, max(0, v))
		}
		var res struct {
			Ok    bool        `json:"ok"`
			Text  string      `json:"text"`
			State playerState `json:"state"`
		}
		if _, err := playerDo("POST", "/cmd", cmd, &res); err != nil {
			a.post <- func() {
				a.chat.Add("error", "Telecomando di Musicante Player: "+err.Error())
				a.reply("Musicante Player non risponde. Scrivi \"diagnosi musica\" e vedo dove si blocca.")
			}
			return
		}
		text := res.Text
		switch c.Text {
		case "volume":
			text = fmt.Sprintf("Volume al %d%%.", res.State.Volume)
		case "find":
			if res.Ok && res.State.Playlist == "" && text == "" {
				text = nowPlaying(res.State)
			}
		default:
			if text == "" {
				text = nowPlaying(res.State)
			}
		}
		a.post <- func() { a.reply(text) }
	}()
}

// launchPlayer: "apri il player"
func (a *app) launchPlayer() {
	if playerCall("GET", "/state", nil, nil) {
		a.reply("Musicante Player è già aperto.")
		return
	}
	if playerRunning() {
		a.reply(oldPlayer)
		return
	}
	exe := playerExe()
	if exe == "" {
		a.reply("Non so dove hai messo Musicante Player: aprilo una volta tu (lo scarichi da TwitchGestor: ⚙ Sistema → 🧰 Tools).")
		return
	}
	if err := exec.Command(exe).Start(); err != nil {
		a.reply("Non riesco ad aprirlo: " + err.Error())
		return
	}
	a.reply("Aperto.")
}

// diagnoseMusic: "diagnosi musica": controlla ogni passaggio tra Silver e Musicante Player
func (a *app) diagnoseMusic() {
	a.reply("Controllo Musicante Player…")
	go func() {
		var b strings.Builder
		line := func(ok bool, s string) {
			if ok {
				b.WriteString("OK — " + s + "\n")
			} else {
				b.WriteString("NO — " + s + "\n")
			}
		}
		running := playerRunning()
		line(running, "Musicante Player è aperto")
		c := readPlayerConf()
		line(c.found, "trovo la sua configurazione (%APPDATA%\\MusicantePlayer)")
		line(c.Exe != "", "so dove sta il programma: "+c.Exe)
		switch {
		case c.Remote != 0:
			line(true, fmt.Sprintf("il telecomando dice di ascoltare sulla porta %d", c.Remote))
		case c.RemoteErr != "":
			line(false, "il telecomando non è partito: "+c.RemoteErr)
		default:
			line(false, "nessun telecomando: è una versione del Player precedente alla 1.52.2 (riscaricalo)")
		}
		var st playerState
		if _, err := playerDo("GET", "/state", nil, &st); err != nil {
			line(false, "il telecomando non risponde: "+err.Error())
		} else {
			line(true, fmt.Sprintf("il telecomando risponde (brani caricati: %d, %s)", st.Tracks, nowPlaying(st)))
			var res struct {
				Ok   bool   `json:"ok"`
				Text string `json:"text"`
			}
			t0 := time.Now()
			if _, err := playerDo("POST", "/cmd", map[string]any{"action": "state"}, &res); err != nil {
				line(false, "il lettore nella finestra non esegue i comandi: "+err.Error())
			} else {
				line(true, fmt.Sprintf("il lettore esegue i comandi (in %d ms)", time.Since(t0).Milliseconds()))
			}
		}
		out := strings.TrimSpace(b.String())
		a.post <- func() {
			a.chat.Add("silver", "Diagnosi musica:\n"+out)
			if strings.Contains(out, "NO — ") {
				a.brain.Reply(time.Now(), "Qualcosa non va: ho scritto i dettagli nella finestra (Ctrl+Alt+S).")
			} else {
				a.brain.Reply(time.Now(), "Con Musicante Player è tutto a posto.")
			}
			a.wantPanel = true // si apre al prossimo fotogramma (da qui non si può: la finestra rimanda a questi comandi)
		}
	}()
}
