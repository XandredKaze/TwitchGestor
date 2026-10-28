// Musicante Player: programma per Windows che riproduce la musica del Raspberry (quella scaricata con Musicante
// e le playlist di TwitchGestor). È una finestra con il motore di Edge (WebView2, già presente in Windows 10/11)
// che apre il lettore servito da TwitchGestor (http://<raspberry>:3000/player): il lettore si aggiorna con
// TwitchGestor, il programma va riscaricato solo raramente.
//
// Costruzione (da qualsiasi sistema): vedi build.sh.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

const appName = "Musicante Player"

// indirizzi provati al primo avvio: il nome del Raspberry sulla rete di casa
var defaults = []string{"http://twitchgestor:3000", "http://twitchgestor.local:3000"}

type config struct {
	Server string `json:"server"`
}

func dataDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base = "."
	}
	dir := filepath.Join(base, "MusicantePlayer")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func loadConfig() config {
	var c config
	if b, err := os.ReadFile(filepath.Join(dataDir(), "config.json")); err == nil {
		_ = json.Unmarshal(b, &c)
	}
	return c
}

func saveConfig(c config) {
	b, _ := json.MarshalIndent(c, "", "  ")
	_ = os.WriteFile(filepath.Join(dataDir(), "config.json"), b, 0o644)
}

// "192.168.1.79" → "http://192.168.1.79:3000"; "twitchgestor" → "http://twitchgestor:3000"
func normalize(addr string) (string, error) {
	a := strings.TrimSpace(addr)
	a = strings.TrimSuffix(a, "/")
	a = strings.TrimSuffix(a, "/player")
	a = strings.TrimSuffix(a, "/dashboard")
	if a == "" {
		return "", fmt.Errorf("scrivi l'indirizzo del Raspberry")
	}
	if !strings.Contains(a, "://") {
		a = "http://" + a
	}
	u, err := url.Parse(a)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("indirizzo non valido")
	}
	if u.Port() == "" && u.Scheme == "http" {
		u.Host += ":3000"
	}
	return u.Scheme + "://" + u.Host, nil
}

// TwitchGestor risponde su quell'indirizzo? (la pagina /player/ping è pubblica e piccola)
func reachable(base string) bool {
	client := http.Client{Timeout: 4 * time.Second}
	res, err := client.Get(base + "/player/ping")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	return res.StatusCode == 200
}

func messageBox(text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(appName)
	_, _, _ = box.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x40)
}

func main() {
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  filepath.Join(dataDir(), "webview"), // password e preferenze del lettore restano qui
		WindowOptions: webview2.WindowOptions{
			Title:  appName,
			Width:  1200,
			Height: 780,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		messageBox("Per funzionare serve Microsoft Edge WebView2 (c'è già in Windows 10 e 11).\n\nScaricalo gratis da: https://go.microsoft.com/fwlink/p/?LinkId=2124703")
		return
	}
	defer w.Destroy()
	w.SetSize(760, 520, webview2.HintMin)

	cfg := loadConfig()
	open := func(base string) {
		w.Dispatch(func() { w.Navigate(base + "/player?app=windows") })
	}
	setup := func(msg string) {
		w.Dispatch(func() { w.SetHtml(setupPage(cfg.Server, msg)) })
	}

	// dalla pagina di configurazione: prova l'indirizzo scritto e, se risponde, apre il lettore
	_ = w.Bind("musicanteConnect", func(addr string) (string, error) {
		base, err := normalize(addr)
		if err != nil {
			return "", err
		}
		if !reachable(base) {
			return "", fmt.Errorf("su %s TwitchGestor non risponde: il Raspberry è acceso? Il PC è sulla rete di casa (o su Tailscale)?", base)
		}
		cfg.Server = base
		saveConfig(cfg)
		open(base)
		return base, nil
	})
	// dal lettore: "⚙ Cambia indirizzo"
	_ = w.Bind("musicanteSettings", func() { setup("") })

	w.SetHtml(loadingPage())
	go func() {
		tries := append([]string{}, defaults...)
		if cfg.Server != "" {
			tries = append([]string{cfg.Server}, tries...)
		}
		for _, base := range tries {
			if reachable(base) {
				if cfg.Server != base {
					cfg.Server = base
					saveConfig(cfg)
				}
				open(base)
				return
			}
		}
		setup("Non trovo il Raspberry da solo: scrivi qui il suo indirizzo.")
	}()
	w.Run()
}
