package main

// La voce per chiedere a Silver: si registra dal microfono e Whisper (whisper.cpp, gratis) trasforma la voce
// in testo, tutto sul PC. Qui le parti senza Windows (si provano anche altrove, speech_test.go):
// il file WAV, la scelta del pacchetto di whisper.cpp da scaricare, l'estrazione, la pulizia del testo.

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	micRate = 16000 // quello che vuole Whisper: 16 kHz, mono, 16 bit
	// le versioni di whisper.cpp pubblicate su GitHub (Silver cerca il pacchetto per Windows)
	whisperReleases = "https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15"
)

// modelli in ordine di preferenza: "small" capisce bene l'italiano; la versione compressa pesa meno
var whisperModels = []string{
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
}

// wavBytes: PCM 16 bit mono → file WAV
func wavBytes(pcm []int16, rate int) []byte {
	var b bytes.Buffer
	n := len(pcm) * 2
	b.WriteString("RIFF")
	_ = binary.Write(&b, binary.LittleEndian, uint32(36+n))
	b.WriteString("WAVEfmt ")
	for _, v := range []any{uint32(16), uint16(1), uint16(1), uint32(rate), uint32(rate * 2), uint16(2), uint16(16)} {
		_ = binary.Write(&b, binary.LittleEndian, v)
	}
	b.WriteString("data")
	_ = binary.Write(&b, binary.LittleEndian, uint32(n))
	_ = binary.Write(&b, binary.LittleEndian, pcm)
	return b.Bytes()
}

// level: quanto è forte un pezzo di audio (0..1), per capire quando hai smesso di parlare
func level(pcm []int16) float64 {
	if len(pcm) == 0 {
		return 0
	}
	var sum float64
	for _, s := range pcm {
		f := float64(s) / 32768
		sum += f * f
	}
	return math.Sqrt(sum / float64(len(pcm)))
}

// pickWhisperAsset: dalle versioni di whisper.cpp, il pacchetto per Windows 64 bit che va su ogni PC (CPU)
func pickWhisperAsset(releasesJSON []byte) (string, error) {
	var rels []struct {
		Tag    string `json:"tag_name"`
		Assets []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.Unmarshal(releasesJSON, &rels); err != nil {
		return "", err
	}
	for _, r := range rels { // dalla più recente
		for _, a := range r.Assets {
			if a.Name == "whisper-bin-x64.zip" {
				return a.URL, nil
			}
		}
	}
	for _, r := range rels {
		for _, a := range r.Assets {
			n := strings.ToLower(a.Name)
			if strings.HasSuffix(n, "x64.zip") && strings.Contains(n, "bin") && !strings.Contains(n, "cublas") && !strings.Contains(n, "cuda") && !strings.Contains(n, "blas") && !strings.Contains(n, "vulkan") {
				return a.URL, nil
			}
		}
	}
	return "", fmt.Errorf("non trovo whisper.cpp per Windows")
}

// unzipTo: estrae tutti i file (senza cartelle) in dir; restituisce il programma da usare
func unzipTo(data []byte, dir string) (string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := filepath.Base(strings.ReplaceAll(f.Name, `\`, "/"))
		if name == "" || name == "." || name == ".." {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		b, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return "", err
		}
		if err := os.WriteFile(filepath.Join(dir, name), b, 0o755); err != nil {
			return "", err
		}
	}
	return whisperExe(dir), nil
}

// whisperExe: il programma di whisper.cpp nella cartella ("" se non c'è)
func whisperExe(dir string) string {
	for _, n := range []string{"whisper-cli.exe", "main.exe", "whisper.exe"} {
		if _, err := os.Stat(filepath.Join(dir, n)); err == nil {
			return filepath.Join(dir, n)
		}
	}
	return ""
}

var (
	reTags  = regexp.MustCompile(`\[[^\]]*\]|\([^)]*\)|\*[^*]*\*`) // [BLANK_AUDIO], (musica), *ride*
	reTimes = regexp.MustCompile(`^\s*\[\d\d:\d\d[^\]]*\]\s*`)
)

// cleanTranscript: il testo di Whisper senza segnaposto, tempi e spazi in più
func cleanTranscript(out string) string {
	var parts []string
	for _, l := range strings.Split(out, "\n") {
		l = reTimes.ReplaceAllString(l, "")
		l = strings.TrimSpace(reTags.ReplaceAllString(l, ""))
		if l == "" || strings.HasPrefix(l, "whisper_") || strings.HasPrefix(l, "main:") || strings.HasPrefix(l, "system_info") {
			continue
		}
		parts = append(parts, l)
	}
	s := strings.Join(strings.Fields(strings.Join(parts, " ")), " ")
	// Whisper con il silenzio a volte "inventa" frasi tipiche dei sottotitoli
	low := strings.ToLower(strings.Trim(s, " .!"))
	for _, junk := range []string{"sottotitoli a cura di", "sottotitoli creati dalla comunità", "grazie per la visione", "amara.org"} {
		if strings.Contains(low, junk) {
			return ""
		}
	}
	return strings.TrimSpace(strings.TrimRight(s, " "))
}
