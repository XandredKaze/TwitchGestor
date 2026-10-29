package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTrovaProgrammi(t *testing.T) {
	dir := t.TempDir()
	start := filepath.Join(dir, "Start Menu", "Programs")
	for _, f := range []string{"Discord Inc/Discord.lnk", "OBS Studio/OBS Studio (64bit).lnk", "OBS Studio/Uninstall OBS.lnk", "Riot Games/League of Legends.lnk", "Riot Games/Teamfight Tactics.lnk", "Spotify.lnk", "Google Chrome.lnk", "DaVinci Resolve/DaVinci Resolve.lnk", "DaVinci Resolve/DaVinci Resolve Readme.lnk", "Discord PTB.lnk"} {
		p := filepath.Join(start, filepath.FromSlash(f))
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte("x"), 0o644)
	}
	steam := filepath.Join(dir, "Steam")
	lib2 := filepath.Join(dir, "D", "SteamLibrary")
	os.MkdirAll(filepath.Join(steam, "steamapps"), 0o755)
	os.MkdirAll(filepath.Join(lib2, "steamapps"), 0o755)
	os.WriteFile(filepath.Join(steam, "steamapps", "libraryfolders.vdf"), []byte(`"libraryfolders" { "0" { "path" "`+steam+`" } "1" { "path" "`+lib2+`" } }`), 0o644)
	os.WriteFile(filepath.Join(lib2, "steamapps", "appmanifest_1086940.acf"), []byte(`"AppState" { "appid" "1086940" "name" "Baldur's Gate 3" }`), 0o644)
	os.WriteFile(filepath.Join(steam, "steamapps", "appmanifest_228980.acf"), []byte(`"AppState" { "appid" "228980" "name" "Steamworks Common Redistributables" }`), 0o644)
	epic := filepath.Join(dir, "Epic")
	os.MkdirAll(epic, 0o755)
	os.WriteFile(filepath.Join(epic, "a.item"), []byte(`{"DisplayName":"Fortnite","AppName":"Fortnite"}`), 0o644)

	apps := append(scanShortcuts([]string{start}, "start"), append(scanSteam(steam), scanEpic(epic)...)...)
	for _, a := range apps {
		if reNotApp.MatchString(a.Name) || a.Name == "Steamworks Common Redistributables" {
			t.Fatalf("non è un programma: %s", a.Name)
		}
	}
	cases := map[string]string{
		"discord": "Discord", "obs": "OBS Studio (64bit)", "lol": "League of Legends", "League of Legends": "League of Legends",
		"bg3": "Baldur's Gate 3", "baldur's gate": "Baldur's Gate 3", "fortnite": "Fortnite", "chrome": "Google Chrome",
		"davinci": "DaVinci Resolve", "spotify": "Spotify", "tft": "Teamfight Tactics",
	}
	for q, want := range cases {
		got := FindApps(apps, q)
		if len(got) == 0 || got[0].Name != want {
			t.Errorf("%q → %v (volevo %s)", q, got, want)
		}
	}
	if got := FindApps(apps, "photoshop"); len(got) != 0 {
		t.Errorf("photoshop non c'è: %v", got)
	}
	if got := FindApps(apps, "bg3"); got[0].Target != "steam://rungameid/1086940" {
		t.Error(got[0].Target)
	}
}
