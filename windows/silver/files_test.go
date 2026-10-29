package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFileECartelle(t *testing.T) {
	for in, want := range map[string]string{"download": "downloads", "Immagini": "pictures", "delle registrazioni": "", "registrazioni": "recordings", "condivisa": "share", "scrivania": "desktop", "Grafiche live": ""} {
		if got := folderKey(in); got != want {
			t.Errorf("%q → %q", in, got)
		}
	}
	dir := t.TempDir()
	mk := func(rel string, age time.Duration) {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte("x"), 0o644)
		tm := time.Now().Add(-age)
		os.Chtimes(p, tm, tm)
	}
	mk("Pictures/Grafica_Halloween_2025.png", 48*time.Hour)
	mk("Pictures/grafica-halloween-v2.psd", time.Hour)
	mk("Documents/Halloween lista.txt", time.Hour)
	mk("AppData/Local/cache/grafica halloween.png", 0)
	mk("Videos/2026-10-28 21-00-00.mkv", 24*time.Hour)
	mk("Videos/2026-10-29 21-00-00.mkv", time.Hour)
	mk("Videos/note.txt", 0)
	os.MkdirAll(filepath.Join(dir, "Documents", "Grafiche Live"), 0o755)

	hits := searchFiles([]string{dir}, "grafica halloween", "", 5, 5*time.Second)
	if len(hits) != 2 || filepath.Base(hits[0].Path) != "grafica-halloween-v2.psd" {
		t.Fatalf("%v", hits)
	}
	if h := searchFiles([]string{dir}, "halloween", "foto", 5, time.Second); len(h) != 2 {
		t.Fatalf("solo immagini: %v", h)
	}
	if h := searchFiles([]string{dir}, "grafiche live", "cartella", 5, time.Second); len(h) != 1 || !h[0].Dir {
		t.Fatalf("cartella: %v", h)
	}
	if n := newestFile([]string{filepath.Join(dir, "Videos")}, fileKinds["video"]); filepath.Base(n) != "2026-10-29 21-00-00.mkv" {
		t.Fatal(n)
	}
	obs := filepath.Join(dir, "obs")
	os.MkdirAll(filepath.Join(obs, "basic", "profiles", "Live"), 0o755)
	os.WriteFile(filepath.Join(obs, "basic", "profiles", "Live", "basic.ini"), []byte("[SimpleOutput]\nFilePath=D:/Registrazioni\n"), 0o644)
	if d := obsRecordingDirs(obs); len(d) != 1 || filepath.ToSlash(d[0]) != "D:/Registrazioni" {
		t.Fatal(d)
	}
}
