package main

import (
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFinestraChat(t *testing.T) {
	out := os.Getenv("OUT")
	r := NewRenderer(1.25)
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	save := func(name string, v *ChatView) []ChatHit {
		img, hits := v.Render(r, now, 0.3)
		if out != "" {
			f, _ := os.Create(filepath.Join(out, name+".png"))
			_ = png.Encode(f, img)
			f.Close()
		}
		return hits
	}
	v := NewChatView()
	hits := save("chat-0-vuota", v)
	chips := 0
	for _, h := range hits {
		if strings.HasPrefix(h.ID, "chip:") {
			chips++
		}
	}
	if chips != len(chatSuggestions) {
		t.Fatal("suggerimenti", chips)
	}
	v.Add("me", "ricordami tra 20 minuti di bere")
	v.Add("silver", "Va bene: tra 20 minuti ti ricordo \"bere\".")
	v.Add("me", "scrivimi un titolo per la live horror di stasera")
	v.Add("silver", "Ecco tre idee:\n• Stanotte non si dorme: horror a luci spente\n• Urla garantite (le mie)\n• Il buio ha fame — live horror")
	v.Add("error", "Non riesco a pensare: Ollama: llama-server process no longer running: exit status 1 error: Failed to load CLIP model from C:\\Users\\xanfo\\.ollama\\models\\blobs\\sha256-7a50f9607a47389c028f2598c1f2d3e23b61913b4ce3c4a9eaaca62de1b9e098")
	v.Add("me", "puoi cercare delle immagini brutalism?")
	v.Thinking = "Ci penso…"
	v.Busy = true
	hits = save("chat-1-conversazione", v)
	var copies int
	for _, h := range hits {
		if strings.HasPrefix(h.ID, "copy:") {
			copies++
		}
	}
	if copies == 0 || v.maxScr <= 0 || v.Scroll != v.maxScr {
		t.Fatal("copia / scorrimento", copies, v.maxScr, v.Scroll)
	}
	v.Wheel(10000) // in cima
	if v.Scroll != 0 || v.stick {
		t.Fatal("rotellina")
	}
	save("chat-2-in-cima", v)
}
