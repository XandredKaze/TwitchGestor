//go:build windows

package main

// Musicante Player sul PC: Silver lo comanda dal suo telecomando (127.0.0.1:47321, vedi windows/player/remote.go)
// e, se non è aperto, lo apre lui (sa dov'è perché il Player lo scrive nella sua configurazione).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"
)

const playerURL = "http://127.0.0.1:47321"

type playerState struct {
	Playing  bool   `json:"playing"`
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Playlist string `json:"playlist"`
	Volume   int    `json:"volume"`
	Tracks   int    `json:"tracks"`
}

func playerCall(method, path string, body any, out any) bool {
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, playerURL+path, rd)
	req.Header.Set("x-silver", "1")
	res, err := (&http.Client{Timeout: 6 * time.Second}).Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return false
	}
	if out != nil {
		_ = json.NewDecoder(res.Body).Decode(out)
	}
	return true
}

// playerExe: dove sta MusicantePlayer.exe (lo scrive lui all'avvio)
func playerExe() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	var c struct {
		Exe string `json:"exe"`
	}
	if b, err := os.ReadFile(filepath.Join(dir, "MusicantePlayer", "config.json")); err == nil {
		_ = json.Unmarshal(b, &c)
	}
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
			v, _ := strconv.Atoi(c.Arg)
			cmd["value"] = min(100, max(0, v))
		}
		var res struct {
			Ok    bool        `json:"ok"`
			Text  string      `json:"text"`
			State playerState `json:"state"`
		}
		if !playerCall("POST", "/cmd", cmd, &res) {
			a.post <- func() { a.reply("Musicante Player non risponde.") }
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
