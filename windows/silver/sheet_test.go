package main

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"testing"
)

func TestFoglioPose(t *testing.T) {
	// foglio finto: 3 pose su sfondo bianco pieno
	sheet := image.NewNRGBA(image.Rect(0, 0, 90, 40))
	for i := range sheet.Pix {
		sheet.Pix[i] = 255
	}
	for k, hgt := range []int{30, 25, 35} {
		for y := 40 - hgt; y < 40; y++ {
			for x := 5 + k*30; x < 25+k*30; x++ {
				sheet.SetNRGBA(x, y, color.NRGBA{120, 120, 200, 255})
			}
		}
	}
	poses := splitSheet(sheet)
	if len(poses) != 3 {
		t.Fatalf("pose: %d", len(poses))
	}
	for _, p := range poses {
		if p.Bounds().Dx() != 20 || p.Bounds().Dy() != 35 {
			t.Fatal("tele diverse", p.Bounds())
		}
	}
	// la prima (più bassa) sta in basso: sopra è trasparente, niente bianco del foglio
	if _, _, _, a := poses[0].At(0, 0).RGBA(); a != 0 {
		t.Fatal("sfondo non tolto")
	}
	if _, _, _, a := poses[0].At(0, 34).RGBA(); a == 0 {
		t.Fatal("posa non in basso")
	}
	if !isPixelArt(poses[0]) {
		t.Fatal("sprite piccoli = pixel art")
	}
	// il foglio vero (se c'è): SILVER_SHEET=percorso del PNG
	if p := os.Getenv("SILVER_SHEET"); p != "" {
		f, err := os.Open(p)
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(f)
		f.Close()
		if err != nil {
			t.Fatal(err)
		}
		if n := len(splitSheet(img)); n != 4 {
			t.Fatalf("foglio vero: %d pose", n)
		}
	}
	// un'immagine sola resta una
	if n := len(splitSheet(image.NewNRGBA(image.Rect(0, 0, 50, 50)))); n != 1 {
		t.Fatal(n)
	}
}
