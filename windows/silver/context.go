package main

// Da quello che c'è in primo piano su Windows (programma, titolo della finestra) a cosa stai facendo.

import (
	"path/filepath"
	"regexp"
	"strings"
)

var browsers = map[string]bool{"chrome.exe": true, "msedge.exe": true, "firefox.exe": true, "opera.exe": true, "opera_gx.exe": true, "brave.exe": true, "vivaldi.exe": true}

// launcher e programmi che non sono giochi anche quando sono a schermo intero
var notGames = map[string]bool{"steam.exe": true, "steamwebhelper.exe": true, "epicgameslauncher.exe": true, "battle.net.exe": true, "vlc.exe": true, "mpc-hc64.exe": true, "applicationframehost.exe": true, "powerpnt.exe": true}

// (il titolo di Edge contiene uno spazio invisibile tra "Microsoft" e "Edge")
var titleNoise = regexp.MustCompile(`\s*[-–—|]\s*(Google Chrome|Microsoft​? Edge|Mozilla Firefox|Opera|Brave|Vivaldi)\s*$`)

// classify: exe = percorso completo del programma; class = classe della finestra; fullscreen = copre tutto lo schermo
func classify(exe, title, class string, fullscreen bool) Context {
	name := strings.ToLower(filepath.Base(strings.ReplaceAll(exe, `\`, "/")))
	path := strings.ToLower(exe)
	t := strings.ToLower(title)
	switch {
	case name == "" || class == "Progman" || class == "WorkerW" || class == "Shell_TrayWnd":
		return Context{ID: "desktop"}
	case name == "obs64.exe" || name == "obs32.exe" || name == "obs.exe":
		return Context{ID: "obs", Name: "OBS Studio"}
	case name == "discord.exe":
		return Context{ID: "discord", Name: "Discord"}
	case name == "musicanteplayer.exe" || name == "spotify.exe":
		return Context{ID: "music", Name: niceName(name, title)}
	case name == "code.exe" || name == "devenv.exe" || strings.HasPrefix(name, "idea") || strings.HasPrefix(name, "pycharm") || name == "notepad++.exe" || name == "sublime_text.exe":
		return Context{ID: "code", Name: niceName(name, title)}
	case name == "explorer.exe" && class == "CabinetWClass":
		return Context{ID: "explorer", Name: "Esplora file"}
	case browsers[name]:
		page := strings.TrimSpace(titleNoise.ReplaceAllString(title, ""))
		switch {
		case strings.Contains(t, "twitchgestor"):
			return Context{ID: "gestor", Name: "TwitchGestor"}
		case strings.Contains(t, "musicante"):
			return Context{ID: "music", Name: "Musicante"}
		case strings.Contains(t, "twitch"):
			return Context{ID: "twitch", Name: "Twitch"}
		case strings.Contains(t, "youtube") && strings.Contains(t, "music"):
			return Context{ID: "music", Name: "YouTube Music"}
		}
		if page == "" {
			page = "Browser"
		}
		return Context{ID: "browser", Name: page}
	}
	// giochi: installati con Steam, Epic, GOG, Xbox… oppure qualsiasi programma a schermo intero
	game := strings.Contains(path, `\steamapps\common\`) || strings.Contains(path, `\epic games\`) || strings.Contains(path, `\gog galaxy\games\`) ||
		strings.Contains(path, `\xboxgames\`) || strings.Contains(path, `\riot games\`) || strings.Contains(path, `\ubisoft game launcher\games\`) ||
		(fullscreen && !notGames[name] && !browsers[name])
	if game && !notGames[name] {
		n := strings.TrimSpace(title)
		if n == "" {
			n = strings.TrimSuffix(filepath.Base(strings.ReplaceAll(exe, `\`, "/")), filepath.Ext(exe))
		}
		return Context{ID: "game", Name: n, Key: name}
	}
	return Context{ID: "other", Name: niceName(name, title)}
}

func niceName(exe, title string) string {
	known := map[string]string{"musicanteplayer.exe": "Musicante Player", "spotify.exe": "Spotify", "code.exe": "Visual Studio Code", "devenv.exe": "Visual Studio", "notepad++.exe": "Notepad++", "sublime_text.exe": "Sublime Text"}
	if n, ok := known[exe]; ok {
		return n
	}
	if i := strings.LastIndexAny(title, "-–—"); i > 0 && i < len(title)-1 {
		return strings.TrimSpace(title[i+1:])
	}
	if title != "" {
		return title
	}
	return strings.TrimSuffix(exe, ".exe")
}
