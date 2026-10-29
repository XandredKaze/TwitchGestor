package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestVoceVersoTesto(t *testing.T) {
	w := wavBytes([]int16{0, 1000, -1000, 0}, micRate)
	if len(w) != 44+8 || string(w[:4]) != "RIFF" || string(w[8:16]) != "WAVEfmt " {
		t.Fatal(len(w))
	}
	if level(make([]int16, 100)) != 0 || level([]int16{32767, -32768}) < 0.99 {
		t.Fatal("livello")
	}
	rel := []byte(`[{"tag_name":"v1.9.5","assets":[]},{"tag_name":"v1.8.0","assets":[{"name":"whisper-cublas-12.4.0-bin-x64.zip","browser_download_url":"u1"},{"name":"whisper-bin-x64.zip","browser_download_url":"u2"},{"name":"whisper-bin-Win32.zip","browser_download_url":"u3"}]}]`)
	if u, err := pickWhisperAsset(rel); err != nil || u != "u2" {
		t.Fatal(u, err)
	}
	if _, err := pickWhisperAsset([]byte(`[{"assets":[]}]`)); err == nil {
		t.Fatal("niente pacchetto: errore")
	}
	var zb bytes.Buffer
	zw := zip.NewWriter(&zb)
	for _, n := range []string{"Release/whisper-cli.exe", "Release/whisper.dll", "Release/ggml.dll"} {
		f, _ := zw.Create(n)
		f.Write([]byte("x"))
	}
	zw.Close()
	dir := t.TempDir()
	exe, err := unzipTo(zb.Bytes(), dir)
	if err != nil || exe != filepath.Join(dir, "whisper-cli.exe") {
		t.Fatal(exe, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "ggml.dll")); err != nil {
		t.Fatal("dll mancante")
	}
	cases := map[string]string{
		" Metti la playlist Alf.\n":                    "Metti la playlist Alf.",
		"[00:00:00.000 --> 00:00:02.000]  Ciao Silver": "Ciao Silver",
		"[BLANK_AUDIO]\n":                              "",
		" (musica) Che canzone è?":                     "Che canzone è?",
		"Sottotitoli a cura di QTSS":                   "",
	}
	for in, want := range cases {
		if got := cleanTranscript(in); got != want {
			t.Errorf("%q → %q", in, got)
		}
	}
}
