package main

import (
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Disegna alcuni fotogrammi tipici su uno sfondo scuro (OUT=cartella per salvarli e guardarli)
func TestFotogrammi(t *testing.T) {
	out := os.Getenv("OUT")
	r := NewRenderer(1.25)
	// l'immagine vera non è nel repository: SILVER_ART=cartella con silver.webp per provarla (altrimenti la sagoma)
	if dir := os.Getenv("SILVER_ART"); dir != "" {
		b, err := os.ReadFile(filepath.Join(dir, "silver.webp"))
		if err != nil {
			t.Fatal(err)
		}
		img, err := decodeImage(b)
		if err != nil {
			t.Fatal(err)
		}
		r.SetSprite(img)
		if out != "" {
			f, _ := os.Create(filepath.Join(out, "0-icona.png"))
			_ = png.Encode(f, faceIcon(img, 64))
			f.Close()
		}
	}
	t0 := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	save := func(name string, img *image.RGBA) {
		if out == "" {
			return
		}
		bg := image.NewRGBA(img.Bounds())
		draw.Draw(bg, bg.Bounds(), image.NewUniform(color.RGBA{23, 35, 56, 255}), image.Point{}, draw.Src)
		draw.Draw(bg, bg.Bounds(), img, image.Point{}, draw.Over)
		f, _ := os.Create(filepath.Join(out, name+".png"))
		defer f.Close()
		_ = png.Encode(f, bg)
	}
	frame := func(b *Brain, at time.Time, idle time.Duration) (*image.RGBA, Hits) {
		var img *image.RGBA
		var h Hits
		// qualche fotogramma per far arrivare la posa a regime
		for i := 0; i < 40; i++ {
			now := at.Add(time.Duration(i-40) * 33 * time.Millisecond)
			b.Tick(now, idle)
			img, h = r.Render(now, now.Sub(t0).Seconds(), b)
		}
		return img, h
	}

	// 1. parla (fumetto a metà frase)
	b := NewBrain(1)
	b.Say(t0, greeting, "", "", nil)
	img, h := frame(b, t0.Add(1200*time.Millisecond), 0)
	save("1-parla", img)
	if h.Bubble.w == 0 || h.Silver.w == 0 {
		t.Fatal("manca il fumetto o Silver")
	}

	// 2. citazione finita, in OBS
	b = NewBrain(2)
	b.SetContext(t0, Context{ID: "obs", Name: "OBS Studio"})
	q := quotes[1]
	b.Say(t0, "“"+q.text+"”", q.source, q.note, nil)
	img, _ = frame(b, t0.Add(4*time.Second), 0)
	save("2-citazione-obs", img)

	// 3. domanda sui giochi, con i pulsanti
	b = NewBrain(3)
	b.SetContext(t0, Context{ID: "game", Name: "Elden Ring", Key: "eldenring.exe"})
	b.Tick(t0.Add(time.Second), 0)
	img, h = frame(b, t0.Add(5*time.Second), 0)
	save("3-gioco-domanda", img)
	if len(h.Buttons) != 3 || h.Remember.w == 0 {
		t.Fatalf("pulsanti: %d", len(h.Buttons))
	}
	// risposta "Sparisci" ricordata: in quel gioco non si vede niente
	b.Choose(t0.Add(5*time.Second), 0)
	if !b.Hidden() || b.GameChoices["eldenring.exe"] != "hide" {
		t.Fatal("la scelta non è stata ricordata")
	}
	img, _ = frame(b, t0.Add(6*time.Second), 0)
	for _, p := range img.Pix {
		if p != 0 {
			t.Fatal("nascosto, ma qualcosa è disegnato")
		}
	}

	// 4. idle: finge di lavorare
	b = NewBrain(4)
	b.SetContext(t0, Context{ID: "music", Name: "Musicante Player"})
	b.pending, b.Bubble = nil, nil // senza il commento sul cambio di programma (mentre parla non va in idle)
	img, _ = frame(b, t0.Add(10*time.Second), 50*time.Second)
	save("4-idle-musica", img)
	if !b.Idle {
		t.Fatal("doveva andare in idle")
	}

	// 4b. le pose con le icone
	for _, c := range []Context{{ID: "obs", Name: "OBS Studio"}, {ID: "game", Name: "Gioco", Key: "x"}, {ID: "explorer", Name: "Esplora file"}, {ID: "code", Name: "Codice"}, {ID: "twitch", Name: "Twitch"}} {
		b = NewBrain(9)
		b.GameChoices["x"] = "quiet"
		b.SetContext(t0, c)
		b.pending, b.Bubble = nil, nil
		img, _ = frame(b, t0.Add(3*time.Second), 0)
		save("posa-"+c.ID, img)
	}

	// 5. live
	b = NewBrain(5)
	b.SetLive(t0, true)
	img, _ = frame(b, t0.Add(3*time.Second), 0)
	save("5-live", img)
	if b.Speaking() {
		t.Fatal("in live non deve usare la voce")
	}
}
