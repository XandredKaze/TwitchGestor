//go:build windows

package main

// Aprire i programmi e i giochi del PC: si cercano nei collegamenti del menu Start e del desktop, in Steam e in Epic.
// L'elenco si rifà all'avvio e ogni 10 minuti (programmi installati nel frattempo).

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
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
	// prima i giochi e l'elenco di Windows (comprende le app dello Store), poi i collegamenti
	apps := append(scanSteam(steamDir()), scanEpic(filepath.Join(env("ProgramData"), `Epic\EpicGamesLauncher\Data\Manifests`))...)
	apps = append(apps, startApps()...)
	apps = append(apps, scanShortcuts(start, "start")...)
	apps = append(apps, scanShortcuts(desk, "desktop")...)
	return apps
}

func steamDir() string {
	steam := `C:\Program Files (x86)\Steam`
	if k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Valve\Steam`, registry.QUERY_VALUE); err == nil {
		if p, _, err := k.GetStringValue("SteamPath"); err == nil && p != "" {
			steam = filepath.FromSlash(p)
		}
		k.Close()
	}
	return steam
}

// startApps: l'elenco delle app del menu Start secondo Windows (anche quelle dello Store)
func startApps() []AppEntry {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
		"[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	return parseStartApps(out)
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
	if strings.HasPrefix(e.Target, "shell:") { // app dello Store e app del menu Start: le apre Esplora risorse
		_ = exec.Command("explorer.exe", e.Target).Start()
	} else {
		openURL(e.Target)
	}
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

// appsInfo: "che programmi conosci" (list) / "diagnosi programmi"
func (a *app) appsInfo(diag bool) {
	if a.apps == nil || diag {
		a.apps = scanApps()
	}
	count := map[string]int{}
	var names []string
	seen := map[string]bool{}
	for _, e := range a.apps {
		count[e.Source]++
		if k := normName(e.Name); !seen[k] {
			seen[k] = true
			names = append(names, e.Name)
		}
	}
	sort.Slice(names, func(i, j int) bool { return strings.ToLower(names[i]) < strings.ToLower(names[j]) })
	if diag {
		a.chat.Add("silver", fmt.Sprintf("Diagnosi programmi:\nmenu Start (Windows): %d\ncollegamenti del menu Start: %d\ndesktop: %d\nSteam: %d (cartella %s)\nEpic: %d\nIn tutto %d programmi diversi.",
			count["startapps"], count["start"], count["desktop"], count["steam"], steamDir(), count["epic"], len(names)))
		a.brain.Reply(time.Now(), fmt.Sprintf("Conosco %d programmi. I dettagli sono nella finestra.", len(names)))
		a.wantPanel = true
		return
	}
	a.chat.Add("silver", fmt.Sprintf("Conosco %d programmi:\n%s", len(names), strings.Join(names, " · ")))
	a.brain.Reply(time.Now(), fmt.Sprintf("Ne conosco %d: li trovi tutti nella finestra (Ctrl+Alt+S).", len(names)))
	a.wantPanel = true
}
