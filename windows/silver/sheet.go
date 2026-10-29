package main

// Il foglio delle pose: più pose dello stesso personaggio una accanto all'altra (come gli sprite dei videogiochi).
// Silver lo divide da solo (le colonne vuote separano le pose), toglie lo sfondo se non è trasparente e mette
// tutte le pose sulla stessa tela, in basso al centro, così cambiando posa non "salta".

import (
	"image"
	"image/color"
)

// splitSheet: le pose del foglio (una sola se non si riesce a dividerlo)
func splitSheet(src image.Image) []image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	// sfondo pieno (non trasparente): il colore dell'angolo, tolto partendo dai bordi
	if bg := img.NRGBAAt(0, 0); bg.A > 200 {
		near := func(c color.NRGBA) bool {
			d := func(a, b uint8) int {
				if a > b {
					return int(a - b)
				}
				return int(b - a)
			}
			return d(c.R, bg.R)+d(c.G, bg.G)+d(c.B, bg.B) < 30
		}
		seen := make([]bool, w*h)
		var stack [][2]int
		for x := 0; x < w; x++ {
			stack = append(stack, [2]int{x, 0}, [2]int{x, h - 1})
		}
		for y := 0; y < h; y++ {
			stack = append(stack, [2]int{0, y}, [2]int{w - 1, y})
		}
		for len(stack) > 0 {
			p := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			x, y := p[0], p[1]
			if x < 0 || y < 0 || x >= w || y >= h || seen[y*w+x] || !near(img.NRGBAAt(x, y)) {
				continue
			}
			seen[y*w+x] = true
			img.SetNRGBA(x, y, color.NRGBA{})
			stack = append(stack, [2]int{x + 1, y}, [2]int{x - 1, y}, [2]int{x, y + 1}, [2]int{x, y - 1})
		}
	}
	used := make([]bool, w)
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			if img.NRGBAAt(x, y).A > 16 {
				used[x] = true
				break
			}
		}
	}
	type box struct{ x0, x1, y0, y1 int }
	var boxes []box
	for x := 0; x < w; {
		if !used[x] {
			x++
			continue
		}
		x0 := x
		for x < w && used[x] {
			x++
		}
		if x-x0 < max(4, w/100) { // briciole, non pose
			continue
		}
		bx := box{x0, x, h, 0}
		for yy := 0; yy < h; yy++ {
			for xx := bx.x0; xx < bx.x1; xx++ {
				if img.NRGBAAt(xx, yy).A > 16 {
					bx.y0, bx.y1 = min(bx.y0, yy), max(bx.y1, yy+1)
				}
			}
		}
		boxes = append(boxes, bx)
	}
	if len(boxes) < 2 {
		return []image.Image{src}
	}
	mw, mh := 0, 0
	for _, bx := range boxes {
		mw, mh = max(mw, bx.x1-bx.x0), max(mh, bx.y1-bx.y0)
	}
	var out []image.Image
	for _, bx := range boxes {
		f := image.NewNRGBA(image.Rect(0, 0, mw, mh))
		ox, oy := (mw-(bx.x1-bx.x0))/2, mh-(bx.y1-bx.y0)
		for yy := bx.y0; yy < bx.y1; yy++ {
			for xx := bx.x0; xx < bx.x1; xx++ {
				f.SetNRGBA(ox+xx-bx.x0, oy+yy-bx.y0, img.NRGBAAt(xx, yy))
			}
		}
		out = append(out, f)
	}
	return out
}

// isPixelArt: immagini piccole (sprite): si ingrandiscono a pixel netti invece di sfumarle
func isPixelArt(img image.Image) bool { return img.Bounds().Dy() <= 200 }
