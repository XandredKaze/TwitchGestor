//go:build windows

package main

// Aprire i programmi e i giochi del PC: si cercano nei collegamenti del menu Start e del desktop, in Steam e in Epic.
// L'elenco si rifà all'avvio e ogni 10 minuti (programmi installati nel frattempo).

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/windows/registry"
)

func scanApps() []AppEntry {
	env := func(k string) string { return os.Getenv(k) }
	start := []string{
		filepath.Join(env("ProgramData"), `Microsoft\Windows\Start Menu\Programs`),
		filepath.Join(env("APPDATA"), `Microsoft\Windows\Start Menu\Programs`),
	}
	desk := []string{filepath.Join(env("USERPROFILE"), "Desktop"), filepath.Join(env("PUBLIC"), "Desktop")}
	if od := env("OneDrive"); od != "" {
		desk = append(desk, filepath.Join(od, "Desktop"), filepath.Join(od, "Desktop", "..", "Scrivania"))
	}
	apps := scanShortcuts(start, "start")
	apps = append(apps, scanShortcuts(desk, "desktop")...)
	steam := `C:\Program Files (x86)\Steam`
	if k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Valve\Steam`, registry.QUERY_VALUE); err == nil {
		if p, _, err := k.GetStringValue("SteamPath"); err == nil && p != "" {
			steam = filepath.FromSlash(p)
		}
		k.Close()
	}
	apps = append(apps, scanSteam(steam)...)
	apps = append(apps, scanEpic(filepath.Join(env("ProgramData"), `Epic\EpicGamesLauncher\Data\Manifests`))...)
	return apps
}

// watchApps: l'elenco dei programmi, aggiornato ogni tanto
func (a *app) watchApps() {
	for {
		list := scanApps()
		a.post <- func() { a.apps = list }
		time.Sleep(10 * time.Minute)
	}
}

func (a *app) launch(e AppEntry) {
	a.brain.Act(time.Now())
	openURL(e.Target)
	a.reply("Apro " + e.Name + ".")
}

// launchCmd: "apri Discord"
func (a *app) launchCmd(name string) {
	if a.apps == nil {
		a.apps = scanApps()
	}
	found := FindApps(a.apps, name)
	switch len(found) {
	case 0:
		a.reply("Non trovo \"" + name + "\" tra i tuoi programmi (menu Start, desktop, Steam, Epic). Se ha un collegamento con un altro nome, dimmi quello.")
	case 1:
		a.launch(found[0])
	default:
		a.launchChoices = found
		var acts []Action
		for i, e := range found {
			acts = append(acts, Action{e.Name, "x:launch:" + strconv.Itoa(i)})
		}
		var names []string
		for _, e := range found {
			names = append(names, e.Name)
		}
		a.chat.Add("silver", "Quale? "+strings.Join(names, " · "))
		a.brain.Alert(time.Now(), "Quale apro?", acts)
	}
}

// launchChoice: il pulsante scelto ("x:launch:1")
func (a *app) launchChoice(choice string) bool {
	if !strings.HasPrefix(choice, "x:launch:") {
		return false
	}
	i, err := strconv.Atoi(strings.TrimPrefix(choice, "x:launch:"))
	if err == nil && i >= 0 && i < len(a.launchChoices) {
		a.launch(a.launchChoices[i])
	}
	a.launchChoices = nil
	return true
}
