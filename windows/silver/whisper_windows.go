//go:build windows

package main

// Whisper sul PC: la prima volta Silver scarica whisper.cpp (il programma, da GitHub) e il modello che
// capisce l'italiano (da Hugging Face, dove li pubblica whisper.cpp); poi trasforma la voce in testo
// senza internet. Tutto in %APPDATA%\Silver\whisper.

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"
)

func whisperDir() string   { return filepath.Join(dataDir(), "whisper") }
func whisperModel() string { return filepath.Join(whisperDir(), "model.bin") }
func wakeModel() string    { return filepath.Join(whisperDir(), "wake.bin") }

func modelOK(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.Size() > 10<<20
}

func whisperReady() bool { return whisperExe(whisperDir()) != "" && modelOK(whisperModel()) }
func wakeReady() bool    { return whisperExe(whisperDir()) != "" && modelOK(wakeModel()) }

// fetchTo: scarica tutto in memoria o su file, con l'avanzamento (0..1; -1 se non si sa)
func fetchTo(ctx context.Context, url string, w io.Writer, progress func(float64)) error {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	req.Header.Set("User-Agent", "Silver-Companion")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("%s: %s", url, res.Status)
	}
	total := res.ContentLength
	var got int64
	buf := make([]byte, 256<<10)
	last := time.Time{}
	for {
		n, err := res.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return werr
			}
			got += int64(n)
			if time.Since(last) > 400*time.Millisecond {
				last = time.Now()
				if total > 0 {
					progress(float64(got) / float64(total))
				} else {
					progress(-1)
				}
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// installWhisper: programma + modello (status: cosa sta facendo, per il fumetto)
func installWhisper(ctx context.Context, status func(string)) error {
	return installWhisperWith(ctx, status, whisperModel(), whisperModels)
}

// installWake: programma + modello piccolo per "Ehi Silver"
func installWake(ctx context.Context, status func(string)) error {
	return installWhisperWith(ctx, status, wakeModel(), wakeModels)
}

func installWhisperWith(ctx context.Context, status func(string), modelPath string, urls []string) error {
	dir := whisperDir()
	if whisperExe(dir) == "" {
		status("Cerco whisper.cpp…")
		var rel bytes.Buffer
		if err := fetchTo(ctx, whisperReleases, &rel, func(float64) {}); err != nil {
			return err
		}
		url, err := pickWhisperAsset(rel.Bytes())
		if err != nil {
			return err
		}
		var zip bytes.Buffer
		if err := fetchTo(ctx, url, &zip, func(f float64) {
			if f >= 0 {
				status(fmt.Sprintf("Scarico l'orecchio… programma %d%%", int(f*100)))
			}
		}); err != nil {
			return err
		}
		if exe, err := unzipTo(zip.Bytes(), dir); err != nil {
			return err
		} else if exe == "" {
			return fmt.Errorf("nel pacchetto di whisper.cpp non c'è il programma")
		}
	}
	if !modelOK(modelPath) {
		var last error
		for _, url := range urls {
			tmp := modelPath + ".part"
			f, err := os.Create(tmp)
			if err != nil {
				return err
			}
			err = fetchTo(ctx, url, f, func(p float64) {
				if p >= 0 {
					status(fmt.Sprintf("Scarico l'orecchio… %d%%", int(p*100)))
				}
			})
			f.Close()
			if err == nil {
				return os.Rename(tmp, modelPath)
			}
			os.Remove(tmp)
			last = err
		}
		return last
	}
	return nil
}

// transcribe: dalla voce al testo (in italiano)
func transcribe(pcm []int16) (string, error) { return transcribeWith(whisperModel(), "", pcm) }

// transcribeWith: con un modello scelto; prompt aiuta Whisper a riconoscere certe parole ("Ehi Silver")
func transcribeWith(model, prompt string, pcm []int16) (string, error) {
	exe := whisperExe(whisperDir())
	if exe == "" {
		return "", fmt.Errorf("whisper non è installato")
	}
	wav := filepath.Join(os.TempDir(), "silver-voce-"+filepath.Base(model)+".wav")
	if err := os.WriteFile(wav, wavBytes(pcm, micRate), 0o644); err != nil {
		return "", err
	}
	defer os.Remove(wav)
	threads := min(8, max(2, runtime.NumCPU()-1))
	args := []string{"-m", model, "-f", wav, "-l", "it", "-nt", "-np", "-t", strconv.Itoa(threads)}
	if prompt != "" {
		args = append(args, "--prompt", prompt)
	}
	cmd := exec.Command(exe, args...)
	cmd.Dir = whisperDir()
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // niente finestra nera
	var out, errOut bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errOut
	if err := cmd.Run(); err != nil {
		msg := errOut.String()
		if len(msg) > 200 {
			msg = msg[len(msg)-200:]
		}
		return "", fmt.Errorf("whisper: %v %s", err, msg)
	}
	return cleanTranscript(out.String()), nil
}
