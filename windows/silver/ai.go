package main

// L'IA per rispondere alle domande: Ollama sul tuo PC (gratis, niente account, niente esce dal PC).
// Silver controlla se c'è, sceglie un modello già scaricato (o ne scarica uno piccolo se glielo dici)
// e scrive la risposta man mano che arriva.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const ollamaURL = "http://127.0.0.1:11434"

// in ordine di preferenza: piccoli, buoni in italiano, girano su un PC normale
var preferredModels = []string{"gemma3:4b", "qwen3:4b", "llama3.2:3b", "qwen2.5:3b", "gemma3:1b", "gemma2:2b"}

// il modello che scarica se non ce n'è nessuno (circa 3 GB)
const defaultModel = "gemma3:4b"

type chatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type AI struct {
	URL    string
	Model  string
	client *http.Client
}

func NewAI() *AI { return &AI{URL: ollamaURL, client: &http.Client{}} }

// Detect: Ollama è acceso? Quali modelli ha? (ok=false: Ollama non installato o spento)
func (a *AI) Detect(ctx context.Context) (ok bool, models []string) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", a.URL+"/api/tags", nil)
	res, err := a.client.Do(req)
	if err != nil {
		return false, nil
	}
	defer res.Body.Close()
	var tags struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if json.NewDecoder(res.Body).Decode(&tags) != nil {
		return true, nil
	}
	for _, m := range tags.Models {
		models = append(models, m.Name)
	}
	return true, models
}

// pickModel: il preferito tra quelli scaricati (altrimenti il primo che c'è; "" se nessuno)
func pickModel(models []string, want string) string {
	has := map[string]bool{}
	for _, m := range models {
		has[m] = true
		has[strings.TrimSuffix(m, ":latest")] = true
	}
	if want != "" && has[want] {
		return want
	}
	for _, p := range preferredModels {
		if has[p] {
			return p
		}
	}
	for _, m := range models {
		if !strings.Contains(m, "embed") { // i modelli "embed" non sanno parlare
			return m
		}
	}
	return ""
}

// Pull: scarica un modello; progress(0..1, stato) mentre scarica (-1: non si sa quanto manca)
func (a *AI) Pull(ctx context.Context, model string, progress func(float64, string)) error {
	body, _ := json.Marshal(map[string]any{"model": model, "stream": true})
	req, _ := http.NewRequestWithContext(ctx, "POST", a.URL+"/api/pull", bytes.NewReader(body))
	res, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	for sc.Scan() {
		var p struct {
			Status    string `json:"status"`
			Total     int64  `json:"total"`
			Completed int64  `json:"completed"`
			Error     string `json:"error"`
		}
		if json.Unmarshal(sc.Bytes(), &p) != nil {
			continue
		}
		if p.Error != "" {
			return fmt.Errorf("%s", p.Error)
		}
		f := -1.0
		if p.Total > 0 {
			f = float64(p.Completed) / float64(p.Total)
		}
		progress(f, p.Status)
		if p.Status == "success" {
			return nil
		}
	}
	if err := sc.Err(); err != nil {
		return err
	}
	return fmt.Errorf("download interrotto")
}

// Chat: la risposta arriva a pezzi in onToken; restituisce il testo intero
func (a *AI) Chat(ctx context.Context, msgs []chatMsg, onToken func(string)) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":      a.Model,
		"messages":   msgs,
		"stream":     true,
		"keep_alive": "5m", // dopo 5 minuti libera la memoria (se giochi non pesa)
		"options":    map[string]any{"temperature": 0.7, "num_predict": 700},
	})
	req, _ := http.NewRequestWithContext(ctx, "POST", a.URL+"/api/chat", bytes.NewReader(body))
	res, err := a.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(res.Body).Decode(&e)
		return "", fmt.Errorf("Ollama: %s", e.Error)
	}
	return readChat(res.Body, onToken)
}

// readChat: legge le righe di Ollama; quello che il modello "ragiona" tra <think> e </think> non si mostra
func readChat(r interface{ Read([]byte) (int, error) }, onToken func(string)) (string, error) {
	var all strings.Builder
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	think := false
	for sc.Scan() {
		var p struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Done  bool   `json:"done"`
			Error string `json:"error"`
		}
		if json.Unmarshal(sc.Bytes(), &p) != nil {
			continue
		}
		if p.Error != "" {
			return all.String(), fmt.Errorf("%s", p.Error)
		}
		tok := p.Message.Content
		if i := strings.Index(tok, "<think>"); i >= 0 {
			think = true
			if i > 0 {
				all.WriteString(tok[:i])
				onToken(tok[:i])
			}
			tok = tok[i+len("<think>"):]
		}
		if think {
			i := strings.Index(tok, "</think>")
			if i < 0 {
				tok = ""
			} else {
				think = false
				tok = tok[i+len("</think>"):]
				if all.Len() == 0 {
					tok = strings.TrimLeft(tok, "\n ")
				}
			}
		}
		if tok != "" {
			all.WriteString(tok)
			onToken(tok)
		}
		if p.Done {
			break
		}
	}
	return all.String(), sc.Err()
}

var weekdays = []string{"domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"}

// systemPrompt: chi è Silver e cosa sa di adesso
func systemPrompt(now time.Time, ctx Context, live bool, nextLive string) string {
	var b strings.Builder
	b.WriteString("Sei Silver, il compagno sul desktop di uno streamer italiano. Rispondi SEMPRE in italiano, in modo chiaro e utile. ")
	b.WriteString("Carattere: un po' spigoloso ma elegante, mai volgare; una battuta ogni tanto, senza esagerare. ")
	b.WriteString("Vai dritto al punto: di solito 1-4 frasi. Se ti chiede un testo da usare (titolo, messaggio, post, elenco), scrivilo pronto da copiare, senza giri di parole. ")
	b.WriteString("Non usare Markdown (niente asterischi o #): solo testo semplice, elenchi con •. ")
	fmt.Fprintf(&b, "Adesso: %s %s.", weekdays[now.Weekday()], now.Format("02/01/2006 15:04"))
	if ctx.Name != "" {
		fmt.Fprintf(&b, " In primo piano sul PC: %s.", ctx.Name)
	}
	if live {
		b.WriteString(" È in live in questo momento.")
	}
	if nextLive != "" {
		fmt.Fprintf(&b, " Prossima live in programma: %s.", nextLive)
	}
	return b.String()
}

// plain: toglie il Markdown che scappa lo stesso (asterischi, titoli)
func plain(s string) string {
	s = strings.NewReplacer("**", "", "__", "", "`", "").Replace(s)
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		t := strings.TrimLeft(l, " ")
		switch {
		case strings.HasPrefix(t, "#"):
			lines[i] = strings.TrimLeft(t, "# ")
		case strings.HasPrefix(t, "* ") || strings.HasPrefix(t, "- "):
			lines[i] = "• " + t[2:]
		}
	}
	return strings.Join(lines, "\n")
}
