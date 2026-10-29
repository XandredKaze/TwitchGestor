package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRiconosceIProgrammi(t *testing.T) {
	cases := []struct {
		exe, title, class string
		full              bool
		id, name          string
	}{
		{"", "", "Progman", false, "desktop", ""},
		{`C:\Program Files\obs-studio\bin\64bit\obs64.exe`, "OBS 30.2 - Profilo: Live", "Qt", false, "obs", "OBS Studio"},
		{`C:\Users\x\AppData\Local\Discord\app-1.0\Discord.exe`, "#generale | Server", "Chrome_WidgetWin_1", false, "discord", "Discord"},
		{`C:\Program Files\Google\Chrome\Application\chrome.exe`, "xandred_kaze - Twitch - Google Chrome", "Chrome_WidgetWin_1", false, "twitch", "Twitch"},
		{`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, "TwitchGestor e altre 2 pagine - Personale - Microsoft\u200b Edge", "Chrome_WidgetWin_1", false, "gestor", "TwitchGestor"},
		{`C:\Program Files\Google\Chrome\Application\chrome.exe`, "Wikipedia - Google Chrome", "Chrome_WidgetWin_1", true, "browser", "Wikipedia"}, // browser a schermo intero non è un gioco
		{`D:\SteamLibrary\steamapps\common\ELDEN RING\Game\eldenring.exe`, "ELDEN RING™", "ELDEN RING™", false, "game", "ELDEN RING™"},
		{`C:\Games\Hollow Knight\hollow_knight.exe`, "Hollow Knight", "UnityWndClass", true, "game", "Hollow Knight"},
		{`C:\Program Files (x86)\Steam\steam.exe`, "Steam", "SDL_app", true, "other", "Steam"},
		{`C:\Users\x\Documenti\MusicantePlayer.exe`, "Musicante Player", "webview", false, "music", "Musicante Player"},
		{`C:\Windows\explorer.exe`, "Download", "CabinetWClass", false, "explorer", "Esplora file"},
		{`C:\Users\x\AppData\Local\Programs\Microsoft VS Code\Code.exe`, "main.go - silver - Visual Studio Code", "Chrome_WidgetWin_1", false, "code", "Visual Studio Code"},
	}
	for _, c := range cases {
		got := classify(c.exe, c.title, c.class, c.full)
		if got.ID != c.id || got.Name != c.name {
			t.Errorf("%s %q → %+v (atteso %s %q)", c.exe, c.title, got, c.id, c.name)
		}
	}
	if k := classify(`D:\SteamLibrary\steamapps\common\ELDEN RING\Game\eldenring.exe`, "ELDEN RING™", "", false).Key; k != "eldenring.exe" {
		t.Errorf("chiave del gioco: %q", k)
	}
}

func TestVoce(t *testing.T) {
	// la voce non è nel repository: SILVER_ART=cartella con voice.mp3 per provarla
	dir := os.Getenv("SILVER_ART")
	if dir == "" {
		t.Skip("SILVER_ART non impostato")
	}
	b, err := os.ReadFile(filepath.Join(dir, "voice.mp3"))
	if err != nil {
		t.Fatal(err)
	}
	v, err := newVoice(b)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 4096)
	v.Read(buf)
	for _, x := range buf {
		if x != 0 {
			t.Fatal("zitto: deve essere silenzio")
		}
	}
	v.SetSpeaking(true)
	loud := false
	for i := 0; i < 20; i++ {
		v.Read(buf)
		for _, x := range buf {
			if x != 0 {
				loud = true
			}
		}
	}
	if !loud {
		t.Fatal("parlando deve suonare")
	}
	v.SetSpeaking(false)
	for i := 0; i < 5; i++ {
		v.Read(buf)
	}
	for _, x := range buf {
		if x != 0 {
			t.Fatal("dopo aver smesso deve tornare il silenzio")
		}
	}
}
