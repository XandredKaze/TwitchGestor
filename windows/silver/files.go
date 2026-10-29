package main

// Cartelle e file: "apri la cartella Download", "trova il file grafica Halloween", "apri l'ultimo video".
// Qui le parti senza Windows (files_test.go): che cartella intendi, la ricerca per nome, il file più recente.

import (
	"bufio"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// folderKey: la cartella detta a parole → una cartella "conosciuta" ("" = da cercare per nome)
func folderKey(name string) string {
	n := normName(name)
	switch {
	case regexp.MustCompile(`^(download|downloads|scaricati|scaricamenti|file scaricati)$`).MatchString(n):
		return "downloads"
	case regexp.MustCompile(`^(documenti|documents|docs)$`).MatchString(n):
		return "documents"
	case regexp.MustCompile(`^(immagini|foto|pictures|immagine)$`).MatchString(n):
		return "pictures"
	case regexp.MustCompile(`^(screenshot|screenshots|catture|schermate)$`).MatchString(n):
		return "screenshots"
	case regexp.MustCompile(`^(video|videos|filmati)$`).MatchString(n):
		return "videos"
	case regexp.MustCompile(`^(registrazioni|registrazioni di obs|registrazioni obs|clip|replay)$`).MatchString(n):
		return "recordings"
	case regexp.MustCompile(`^(musica|music|canzoni)$`).MatchString(n):
		return "music"
	case regexp.MustCompile(`^(desktop|scrivania)$`).MatchString(n):
		return "desktop"
	case regexp.MustCompile(`^(condivisa|cartella condivisa|overlay|grafiche|twitchgestor|gestor|raspberry)$`).MatchString(n):
		return "share"
	case regexp.MustCompile(`^(musica del raspberry|musicante|musica condivisa)$`).MatchString(n):
		return "sharemusic"
	case n == "silver":
		return "silver"
	}
	return ""
}

var fileKinds = map[string][]string{
	"foto":      {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic", ".psd", ".afphoto", ".svg"},
	"immagine":  {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic", ".psd", ".afphoto", ".svg"},
	"grafica":   {".png", ".jpg", ".jpeg", ".webp", ".gif", ".psd", ".afphoto", ".afdesign", ".svg", ".ai", ".webm", ".mp4"},
	"video":     {".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv"},
	"pdf":       {".pdf"},
	"documento": {".pdf", ".doc", ".docx", ".odt", ".txt", ".rtf", ".xls", ".xlsx", ".ppt", ".pptx", ".md"},
}

// cartelle che non vale la pena guardare (sono enormi e non ci sono i tuoi file)
var skipDirs = map[string]bool{"appdata": true, "node_modules": true, ".git": true, "$recycle.bin": true, "steamapps": true, "windows": true, "program files": true, "program files (x86)": true, ".cache": true, ".ollama": true, "cache": true}

type fileHit struct {
	Path string
	Mod  time.Time
	Dir  bool
}

// searchFiles: file (o cartelle, se kind = "cartella") il cui nome contiene tutte le parole, dai più recenti
func searchFiles(roots []string, query, kind string, limit int, budget time.Duration) []fileHit {
	words := strings.Fields(normName(query))
	for i := 0; i < len(words); i++ { // parole di contorno
		if map[string]bool{"il": true, "la": true, "lo": true, "di": true, "del": true, "della": true, "con": true, "per": true, "un": true, "una": true, "file": true}[words[i]] {
			words = append(words[:i], words[i+1:]...)
			i--
		}
	}
	if len(words) == 0 {
		return nil
	}
	exts := fileKinds[kind]
	deadline := time.Now().Add(budget)
	var hits []fileHit
	seen := map[string]bool{}
	for _, root := range roots {
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil || time.Now().After(deadline) {
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			name := d.Name()
			if d.IsDir() && p != root && (skipDirs[strings.ToLower(name)] || strings.HasPrefix(name, ".")) {
				return filepath.SkipDir
			}
			if p == root || seen[p] {
				return nil
			}
			if (kind == "cartella") != d.IsDir() {
				return nil
			}
			if len(exts) > 0 {
				ok := false
				for _, e := range exts {
					if strings.EqualFold(filepath.Ext(name), e) {
						ok = true
					}
				}
				if !ok {
					return nil
				}
			}
			n := normName(strings.TrimSuffix(name, filepath.Ext(name)))
			for _, w := range words {
				if !strings.Contains(n, w) {
					return nil
				}
			}
			seen[p] = true
			info, _ := d.Info()
			h := fileHit{Path: p, Dir: d.IsDir()}
			if info != nil {
				h.Mod = info.ModTime()
			}
			hits = append(hits, h)
			return nil
		})
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].Mod.After(hits[j].Mod) })
	if len(hits) > limit {
		hits = hits[:limit]
	}
	return hits
}

// newestFile: il file più recente con una di quelle estensioni (nelle cartelle date, anche sottocartelle vicine)
func newestFile(roots []string, exts []string) string {
	best, bestT := "", time.Time{}
	for _, root := range roots {
		_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				if p != root && (strings.Count(strings.TrimPrefix(p, root), string(filepath.Separator)) > 2 || skipDirs[strings.ToLower(d.Name())]) {
					return filepath.SkipDir
				}
				return nil
			}
			ok := len(exts) == 0
			for _, e := range exts {
				if strings.EqualFold(filepath.Ext(p), e) {
					ok = true
				}
			}
			if !ok || strings.HasSuffix(strings.ToLower(p), ".part") || strings.HasSuffix(strings.ToLower(p), ".crdownload") || strings.EqualFold(d.Name(), "desktop.ini") {
				return nil
			}
			if info, err := d.Info(); err == nil && info.ModTime().After(bestT) {
				best, bestT = p, info.ModTime()
			}
			return nil
		})
	}
	return best
}

// obsRecordingDirs: dove OBS salva le registrazioni (dalle impostazioni dei profili)
func obsRecordingDirs(obsConfig string) []string {
	var out []string
	files, _ := filepath.Glob(filepath.Join(obsConfig, "basic", "profiles", "*", "basic.ini"))
	for _, f := range files {
		fh, err := os.Open(f)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(fh)
		for sc.Scan() {
			l := sc.Text()
			for _, k := range []string{"FilePath=", "RecFilePath="} {
				if strings.HasPrefix(l, k) && len(l) > len(k) {
					out = append(out, filepath.Clean(strings.TrimPrefix(l, k)))
				}
			}
		}
		fh.Close()
	}
	return out
}
