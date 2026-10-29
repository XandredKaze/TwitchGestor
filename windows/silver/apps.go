package main

// "Apri Discord", "avvia OBS", "lancia lol": Silver trova il programma tra i collegamenti del menu Start e del
// desktop, i giochi di Steam e di Epic, e lo apre. Qui le parti senza Windows (apps_test.go): la ricerca nelle
// cartelle e nei file di Steam ed Epic, e la scelta del programma giusto da quello che hai detto.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type AppEntry struct {
	Name   string // come si chiama (dal collegamento o dal gioco)
	Target string // cosa aprire: percorso del collegamento, oppure steam://… / com.epicgames.launcher://…
	Source string // start | desktop | steam | epic
}

// collegamenti che non sono il programma
var reNotApp = regexp.MustCompile(`(?i)(uninstall|disinstall|rimuovi|readme|leggimi|help|guida|manual|manuale|documentation|documentazione|website|sito web|release notes|license|licenza|changelog|support|faq|repair|ripara)`)

// scanShortcuts: i collegamenti (.lnk, .url) nelle cartelle date, anche nelle sottocartelle
func scanShortcuts(dirs []string, source string) []AppEntry {
	var out []AppEntry
	for _, dir := range dirs {
		_ = filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(p))
			if ext != ".lnk" && ext != ".url" {
				return nil
			}
			name := strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
			if reNotApp.MatchString(name) {
				return nil
			}
			out = append(out, AppEntry{Name: name, Target: p, Source: source})
			return nil
		})
	}
	return out
}

var (
	reVdfPath = regexp.MustCompile(`"path"\s+"([^"]+)"`)
	reAcfKV   = regexp.MustCompile(`"(appid|name)"\s+"([^"]*)"`)
)

// scanSteam: i giochi installati con Steam (in tutte le librerie, anche su altri dischi)
func scanSteam(steamDir string) []AppEntry {
	libs := []string{steamDir}
	if b, err := os.ReadFile(filepath.Join(steamDir, "steamapps", "libraryfolders.vdf")); err == nil {
		for _, m := range reVdfPath.FindAllStringSubmatch(string(b), -1) {
			libs = append(libs, strings.ReplaceAll(m[1], `\\`, `\`))
		}
	}
	seen := map[string]bool{}
	var out []AppEntry
	for _, lib := range libs {
		files, _ := filepath.Glob(filepath.Join(lib, "steamapps", "appmanifest_*.acf"))
		for _, f := range files {
			b, err := os.ReadFile(f)
			if err != nil {
				continue
			}
			var id, name string
			for _, m := range reAcfKV.FindAllStringSubmatch(string(b), -1) {
				if m[1] == "appid" && id == "" {
					id = m[2]
				} else if m[1] == "name" && name == "" {
					name = m[2]
				}
			}
			// gli "Steamworks Common Redistributables" e simili non sono giochi
			if id == "" || name == "" || seen[id] || id == "228980" || strings.Contains(strings.ToLower(name), "redistributable") {
				continue
			}
			seen[id] = true
			out = append(out, AppEntry{Name: name, Target: "steam://rungameid/" + id, Source: "steam"})
		}
	}
	return out
}

// scanEpic: i giochi installati con Epic Games
func scanEpic(manifestDir string) []AppEntry {
	files, _ := filepath.Glob(filepath.Join(manifestDir, "*.item"))
	var out []AppEntry
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var m struct {
			DisplayName string
			AppName     string
		}
		if json.Unmarshal(b, &m) != nil || m.DisplayName == "" || m.AppName == "" {
			continue
		}
		out = append(out, AppEntry{Name: m.DisplayName, Target: "com.epicgames.launcher://apps/" + m.AppName + "?action=launch&silent=true", Source: "epic"})
	}
	return out
}

// parseStartApps: l'elenco delle app del menu Start dato da Windows (PowerShell Get-StartApps in JSON),
// comprese quelle dello Store che non hanno un collegamento (Spotify, WhatsApp, Xbox…)
func parseStartApps(b []byte) []AppEntry {
	type sa struct {
		Name  string
		AppID string
	}
	var list []sa
	if json.Unmarshal(b, &list) != nil {
		var one sa
		if json.Unmarshal(b, &one) != nil {
			return nil
		}
		list = []sa{one}
	}
	var out []AppEntry
	for _, a := range list {
		if a.Name == "" || a.AppID == "" || reNotApp.MatchString(a.Name) || strings.HasPrefix(strings.ToLower(a.AppID), "http") {
			continue
		}
		out = append(out, AppEntry{Name: a.Name, Target: `shell:AppsFolder\` + a.AppID, Source: "startapps"})
	}
	return out
}

// le parole di cortesia non fanno parte del nome ("apri Discord per favore")
var reAppPolite = regexp.MustCompile(`(?i)[\s,]+(?:per favore|perfavore|grazie|subito|adesso|ora|un attimo|veloce|please|sul pc|sul computer)[\s,.!?]*$`)

func cleanAppQuery(q string) string {
	for i := 0; i < 3; i++ {
		q = reAppPolite.ReplaceAllString(q, "")
	}
	return strings.TrimSpace(strings.Trim(q, " .,!?\"'"))
}

func normName(s string) string {
	s = plainLower(s)
	s = regexp.MustCompile(`[®™©]`).ReplaceAllString(s, "")
	s = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

// sigla: "League of Legends" → "lol", "Baldur's Gate 3" → "bg3"
func initials(n string) string {
	var b strings.Builder
	for _, w := range strings.Fields(n) {
		if w[0] >= '0' && w[0] <= '9' {
			b.WriteString(w)
		} else {
			b.WriteByte(w[0])
		}
	}
	return b.String()
}

// nomi che si dicono in un altro modo
var appAliases = map[string]string{
	"obs": "obs studio", "lol": "league of legends", "league": "league of legends", "tft": "teamfight tactics",
	"bg3": "baldur s gate 3", "baldur": "baldur s gate 3", "vs code": "visual studio code", "vscode": "visual studio code",
	"word": "microsoft word", "excel": "microsoft excel", "powerpoint": "microsoft powerpoint", "esplora risorse": "file explorer",
	"impostazioni": "settings", "calcolatrice": "calculator", "blocco note": "notepad", "browser": "google chrome",
	"edge": "microsoft edge", "chrome": "google chrome", "davinci": "davinci resolve", "resolve": "davinci resolve",
	"wave link": "elgato wave link", "stream deck": "elgato stream deck",
}

func appScore(name, q string) int {
	n := normName(name)
	switch {
	case n == q:
		return 100
	case strings.HasPrefix(n, q+" ") || strings.HasPrefix(n, q):
		return 80 - min(20, len(n)-len(q)) // più corto è, meglio è ("Discord" prima di "Discord PTB")
	case initials(n) == strings.ReplaceAll(q, " ", ""):
		return 70
	}
	words := strings.Fields(q)
	all := true
	for _, w := range words {
		if !strings.Contains(" "+n+" ", " "+w) {
			all = false
			break
		}
	}
	if all {
		return 60 - min(20, len(n)-len(q))
	}
	if len(q) >= 4 && strings.Contains(n, q) {
		return 40
	}
	return 0
}

// FindApps: i programmi che corrispondono a quello che hai detto, dal più probabile (al massimo 3)
func FindApps(apps []AppEntry, query string) []AppEntry {
	q := normName(cleanAppQuery(query))
	if a, ok := appAliases[q]; ok {
		q = a
	}
	if q == "" {
		return nil
	}
	type scored struct {
		e AppEntry
		s int
	}
	var list []scored
	seen := map[string]bool{}
	for _, e := range apps {
		k := normName(e.Name)
		if seen[k] { // lo stesso programma nel menu Start e sul desktop: uno solo
			continue
		}
		if s := appScore(e.Name, q); s > 0 {
			seen[k] = true
			if e.Source == "steam" || e.Source == "epic" {
				s++ // a parità, il gioco vero più del collegamento al launcher
			}
			list = append(list, scored{e, s})
		}
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].s > list[j].s })
	var out []AppEntry
	for i, x := range list {
		if i >= 3 || (i > 0 && x.s < list[0].s-15) { // solo quelli quasi altrettanto probabili
			break
		}
		out = append(out, x.e)
	}
	return out
}
