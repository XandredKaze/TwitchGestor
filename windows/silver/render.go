package main

// Disegno di Silver, fotogramma per fotogramma, in un'immagine trasparente (la finestra di Windows mostra solo
// i pixel disegnati e lascia passare i clic altrove). Niente di Windows qui: si prova anche altrove (render_test.go).

import (
	"bytes"
	"embed"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg"
	"image/png"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	"golang.org/x/image/draw"
	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/goitalic"
	"golang.org/x/image/font/gofont/goregular"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/f64"
	"golang.org/x/image/math/fixed"
	_ "golang.org/x/image/webp"
)

//go:embed assets
var assets embed.FS

// dimensioni (in punti logici; sullo schermo si moltiplicano per la scala dello schermo)
const (
	winW    = 440
	winH    = 360
	boxX    = 14
	boxW    = 112
	boxH    = 168
	bubW    = 300
	bubMinW = 250 // il fumetto più stretto (se Silver è largo)
)

type rectF struct{ x, y, w, h float64 }

func (r rectF) has(x, y float64) bool { return x >= r.x && x <= r.x+r.w && y >= r.y && y <= r.y+r.h }

// Hits: dove sono le cose cliccabili nell'ultimo fotogramma (in pixel della finestra)
type Hits struct {
	Silver   rectF
	Bubble   rectF
	Buttons  []rectF
	Remember rectF
}

type poseParams struct{ angle, tx, ty, sx, sy float64 }

var poses = map[string]poseParams{
	"obs":      {-3, 2, 0, 1, 1},
	"twitch":   {5, 6, 0, 1, 1},
	"discord":  {5, 6, 0, 1, 1},
	"game":     {0, 0, 4, -1, .94}, // girato e accovacciato
	"code":     {-6, 0, 2, 1, 1},
	"explorer": {3, 0, -2, 1, 1},
	"live":     {0, 0, 0, 1.06, 1.06},
}

var glows = map[string]color.NRGBA{
	"live":  {255, 70, 90, 120},
	"game":  {120, 140, 255, 110},
	"music": {201, 168, 224, 130},
}

type fonts struct{ regular, bold, italic *opentype.Font }

type Renderer struct {
	Scale float64

	src      image.Image                     // l'immagine di Silver (scaricata da Gestor); nil = sagoma di riserva
	sprite   image.Image                     // Silver già alla dimensione giusta
	visible  map[image.Image]image.Rectangle // dove l'immagine non è trasparente (per il fumetto)
	srcPoses []image.Image                   // le pose del foglio (se l'hai caricato)
	poses    []image.Image                   // …già alla dimensione giusta
	props    map[string]image.Image
	fonts    fonts
	faces    map[string]font.Face
	cur      poseParams
	pose     string
	poseAt   time.Time
	lastTick time.Time
	Hover    bool

	// parti già disegnate, riusate tra un fotogramma e l'altro (Silver resta sempre acceso: deve pesare poco)
	frame    *image.RGBA
	glowKey  string
	glow     *image.RGBA
	bubKey   string
	bubLayer *image.RGBA
	bubHits  Hits
}

func mustImage(name string) image.Image {
	b, err := assets.ReadFile("assets/" + name)
	if err != nil {
		panic(err)
	}
	img, err := png.Decode(bytes.NewReader(b))
	if err != nil {
		panic(err)
	}
	return img
}

// decodeImage: l'immagine di Silver caricata in Gestor (PNG, JPG o WEBP)
func decodeImage(b []byte) (image.Image, error) {
	img, _, err := image.Decode(bytes.NewReader(b))
	return img, err
}

// placeholder: una sagoma semplice finché l'immagine vera non arriva da Gestor
func placeholder() image.Image {
	img := image.NewRGBA(image.Rect(0, 0, 300, 450))
	oval := func(cx, cy, rx, ry float64, c color.NRGBA) { // bordo netto (1 pixel di sfumatura)
		for y := int(cy - ry); y <= int(cy+ry)+1; y++ {
			for x := int(cx - rx); x <= int(cx+rx)+1; x++ {
				dx, dy := (float64(x)+0.5-cx)/rx, (float64(y)+0.5-cy)/ry
				if cov := (1 - math.Sqrt(dx*dx+dy*dy)) * math.Min(rx, ry); cov > 0 {
					blend(img, x, y, c, math.Min(1, cov))
				}
			}
		}
	}
	body := color.NRGBA{170, 180, 198, 255}
	oval(150, 360, 100, 92, body)
	oval(150, 175, 112, 104, body)
	for _, ex := range []float64{108, 192} {
		oval(ex, 180, 15, 22, color.NRGBA{255, 255, 255, 255})
		oval(ex+3, 186, 7, 11, color.NRGBA{40, 46, 60, 255})
	}
	return img
}

// carattere: Segoe UI di Windows (come il mockup); altrimenti quelli di riserva
func loadFonts() fonts {
	try := func(paths ...string) *opentype.Font {
		for _, p := range paths {
			if b, err := os.ReadFile(p); err == nil {
				if f, err := opentype.Parse(b); err == nil {
					return f
				}
			}
		}
		return nil
	}
	win := os.Getenv("WINDIR")
	if win == "" {
		win = `C:\Windows`
	}
	f := fonts{
		regular: try(win+`\Fonts\segoeui.ttf`, "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
		bold:    try(win+`\Fonts\segoeuib.ttf`, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
		italic:  try(win+`\Fonts\segoeuii.ttf`, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"),
	}
	fallback := func(b []byte) *opentype.Font { x, _ := opentype.Parse(b); return x }
	if f.regular == nil {
		f.regular = fallback(goregular.TTF)
	}
	if f.bold == nil {
		f.bold = fallback(gobold.TTF)
	}
	if f.italic == nil {
		f.italic = fallback(goitalic.TTF)
	}
	return f
}

func NewRenderer(scale float64) *Renderer {
	r := &Renderer{fonts: loadFonts(), props: map[string]image.Image{}, pose: "desktop"}
	for _, n := range []string{"cam", "pad", "folder", "note1", "note2"} {
		r.props[n] = mustImage(n + ".png")
	}
	r.SetScale(scale)
	return r
}

// SetScale: scala dello schermo (1 = 100%, 1.5 = 150%…): rifà Silver e i caratteri alla misura giusta
func (r *Renderer) SetScale(scale float64) {
	if scale <= 0 {
		scale = 1
	}
	r.Scale = scale
	src := r.src
	if src == nil {
		src = placeholder()
	}
	r.sprite = fitSprite(src, scale)
	r.poses = nil
	for _, p := range r.srcPoses {
		r.poses = append(r.poses, fitSprite(p, scale))
	}
	r.faces = map[string]font.Face{}
	r.frame, r.glow, r.bubLayer, r.glowKey, r.bubKey = nil, nil, nil, "", ""
}

// spriteFit: quanto ingrandire perché stia nel riquadro di Silver (alto boxH, largo al massimo boxW×1.25)
func spriteFit(w, h, s float64) float64 { return math.Min(boxH*s/h, boxW*1.25*s/w) }

// fitSprite: l'immagine già alla misura giusta (la pixel art a pixel netti, il resto morbido)
func fitSprite(src image.Image, scale float64) *image.RGBA {
	b := src.Bounds()
	f := spriteFit(float64(b.Dx()), float64(b.Dy()), scale)
	dst := image.NewRGBA(image.Rect(0, 0, max(1, int(math.Round(float64(b.Dx())*f))), max(1, int(math.Round(float64(b.Dy())*f)))))
	if isPixelArt(src) {
		draw.NearestNeighbor.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	} else {
		draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	}
	return dst
}

// SetPoses: più pose dal foglio (nil: si torna all'immagine sola)
func (r *Renderer) SetPoses(list []image.Image) {
	r.srcPoses = list
	r.SetScale(r.Scale)
}

// faceIcon: la faccia di Silver in un cerchio, per l'icona vicino all'orologio (n×n pixel, non premoltiplicato)
func faceIcon(src image.Image, n int) *image.NRGBA {
	b := src.Bounds()
	w := float64(b.Dx())
	cx, cy, rad := float64(b.Min.X)+w*0.48, float64(b.Min.Y)+float64(b.Dy())*0.25, w*0.28
	crop := image.NewNRGBA(image.Rect(0, 0, n, n))
	draw.CatmullRom.Scale(crop, crop.Bounds(), src, image.Rect(int(cx-rad), int(cy-rad), int(cx+rad), int(cy+rad)), draw.Src, nil)
	// fondo chiaro nel cerchio (l'immagine è trasparente intorno), bordo morbido
	out := image.NewNRGBA(crop.Bounds())
	h := float64(n) / 2
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			d := math.Hypot(float64(x)+0.5-h, float64(y)+0.5-h)
			cov := math.Max(0, math.Min(1, h-d))
			c := crop.NRGBAAt(x, y)
			al := float64(c.A) / 255
			bg := [3]float64{232, 236, 244}
			px := color.NRGBA{A: uint8(255 * cov)}
			px.R = uint8(float64(c.R)*al + bg[0]*(1-al))
			px.G = uint8(float64(c.G)*al + bg[1]*(1-al))
			px.B = uint8(float64(c.B)*al + bg[2]*(1-al))
			out.SetNRGBA(x, y, px)
		}
	}
	return out
}

// SetSprite: arriva (o cambia) l'immagine di Silver; nil torna alla sagoma
func (r *Renderer) SetSprite(img image.Image) {
	r.src = img
	r.SetScale(r.Scale)
}

// HasSprite: c'è l'immagine vera
func (r *Renderer) HasSprite() bool { return r.src != nil || len(r.srcPoses) > 0 }

func (r *Renderer) face(kind string, size float64) font.Face {
	key := kind + ":" + strconv.FormatFloat(size, 'f', 2, 64)
	if f, ok := r.faces[key]; ok {
		return f
	}
	src := r.fonts.regular
	switch kind {
	case "bold":
		src = r.fonts.bold
	case "italic":
		src = r.fonts.italic
	}
	f, _ := opentype.NewFace(src, &opentype.FaceOptions{Size: size * r.Scale, DPI: 72, Hinting: font.HintingFull})
	r.faces[key] = f
	return f
}

func lerp(a, b, t float64) float64 { return a + (b-a)*t }

// smooth: 0→1→0 morbido con periodo p (come un'animazione CSS "alternate")
func smooth(t, p float64) float64 { return (1 - math.Cos(2*math.Pi*t/p)) / 2 }

// Render disegna il fotogramma. mono: secondi da quando è partito il programma (per le animazioni).
func (r *Renderer) Render(now time.Time, mono float64, b *Brain) (*image.RGBA, Hits) {
	s := r.Scale
	if r.frame == nil {
		r.frame = image.NewRGBA(image.Rect(0, 0, int(winW*s), int(winH*s)))
	}
	img := r.frame
	clear(img.Pix)
	var hits Hits
	if !b.Visible() {
		return img, hits
	}
	dt := 1.0 / 30
	if !r.lastTick.IsZero() {
		dt = math.Max(0, math.Min(0.2, now.Sub(r.lastTick).Seconds())) // anche se l'orologio torna indietro
	}
	r.lastTick = now

	// posa: ci si arriva con un movimento morbido
	pose := b.Pose()
	if pose != r.pose {
		r.pose, r.poseAt = pose, now
	}
	target, ok := poses[pose]
	if !ok {
		target = poseParams{0, 0, 0, 1, 1}
	}
	k := 1 - math.Exp(-dt*7)
	r.cur = poseParams{lerp(r.cur.angle, target.angle, k), lerp(r.cur.tx, target.tx, k), lerp(r.cur.ty, target.ty, k), lerp(r.cur.sx, target.sx, k), lerp(r.cur.sy, target.sy, k)}
	if r.cur.sx == 0 {
		r.cur.sx = 1
	}

	// oscillazione continua (più veloce nei giochi, lenta col codice, a tempo con la musica, sospesa in idle)
	var wobA, wobY float64
	switch {
	case b.Idle:
		u := smooth(mono, 5.2)
		wobA, wobY = -1+2*u, -2-6*u
	case pose == "music":
		u := smooth(mono, 0.9)
		wobA, wobY = -3+6*u, -5*u
	default:
		p := 6.8
		if pose == "game" {
			p = 3.2
		} else if pose == "code" {
			p = 11
		}
		u := smooth(mono, p)
		wobA, wobY = -2+4*u, -3*math.Sin(math.Pi*u)
	}
	sqX, sqY := 1.0, 1.0
	if b.Talking() {
		w := math.Sin(2 * math.Pi * mono / 0.32)
		sqX, sqY = 1.015+0.045*w, 0.985-0.055*w
	}
	hov := 0.0
	if r.Hover {
		hov = 1
	}

	// ombra e aura (disegnate una volta per posa)
	ox, oy := (boxX+boxW/2)*s, (winH-2)*s
	if r.glowKey != pose || r.glow == nil {
		r.glowKey = pose
		r.glow = image.NewRGBA(img.Bounds())
		fillEllipse(r.glow, ox, oy-2*s, 40*s, 6*s, color.NRGBA{0, 0, 0, 90}, 1)
		glow, ok := glows[pose]
		if !ok {
			glow = color.NRGBA{95, 211, 176, 45}
		}
		fillEllipse(r.glow, ox, oy-boxH*s*0.48, boxW*s*0.62, boxH*s*0.52, glow, 0)
	}
	gr := image.Rect(int(ox-boxW*s*0.7), int(oy-boxH*s*1.05), int(ox+boxW*s*0.7), img.Rect.Max.Y)
	draw.Draw(img, gr, r.glow, gr.Min, draw.Over)

	// Silver: dal suo fondo al centro, schiacciamento, oscillazione, posa, passaggio del mouse
	sprite := r.sprite
	if n := len(r.poses); n > 0 { // la posa giusta per quello che sta facendo
		sprite = r.poses[b.Frame(now, mono, n)]
	}
	sw, sh := float64(sprite.Bounds().Dx()), float64(sprite.Bounds().Dy())
	fit := spriteFit(sw, sh, s) // già alla misura: circa 1
	sx := fit * sqX * r.cur.sx * (1 + 0.03*hov)
	sy := fit * sqY * r.cur.sy * (1 + 0.03*hov)
	ang := (wobA + r.cur.angle) * math.Pi / 180
	cos, sin := math.Cos(ang), math.Sin(ang)
	tx := ox + r.cur.tx*s
	ty := oy + (wobY+r.cur.ty-3*hov)*s
	// punto della figura (u,v) → schermo: R·S·(u - sw/2, v - sh) + (tx, ty)
	a, bb, d, e := cos*sx, -sin*sy, sin*sx, cos*sy
	m := f64.Aff3{a, bb, tx - a*sw/2 - bb*sh, d, e, ty - d*sw/2 - e*sh}
	draw.ApproxBiLinear.Transform(img, m, sprite, sprite.Bounds(), draw.Over, nil)
	// dove sta davvero la figura (le immagini larghe sono più basse del riquadro): gli oggetti si mettono lì intorno
	drawn := rectF{tx - sw*fit/2, ty - sh*fit, sw * fit, sh * fit}
	hits.Silver = rectF{math.Min(boxX*s, drawn.x), drawn.y - 8*s, math.Max(boxW*s, drawn.w), drawn.h + 8*s}

	r.drawProps(img, pose, now, mono, drawn)
	if b.Thinking != "" && b.Bubble == nil {
		r.drawPill(img, b.Thinking, "", mono)
	} else if b.Idle {
		text := b.IdleTask
		if b.IdleKind == "sleep" { // "Dormo z", "Dormo zz", "Dormo zzz"
			text += " " + strings.Repeat("z", 1+int(mono/0.9)%3)
		}
		r.drawPill(img, text, "", mono)
	}
	if bb := b.Bubble; bb != nil {
		// il fumetto accanto alla testa di Silver, dove sta davvero la figura (senza l'oscillazione, così
		// non balla): la codina punta all'altezza della testa
		vis := r.visibleBounds(sprite)
		figTop := oy - sh*fit + float64(vis.Min.Y)*fit
		figH := float64(vis.Dy()) * fit
		figRight := ox - sw*fit/2 + float64(vis.Max.X)*fit
		// subito a destra della figura; se Silver è largo il fumetto si stringe un po' (mai sopra di lui)
		bx := math.Max(70*s, math.Min(figRight+8*s, (winW-bubMinW-6)*s))
		bw := math.Min(bubW*s, winW*s-bx-6*s)
		bBottom := math.Min(figTop+figH*0.30+14*s, (winH-30)*s)
		// il fumetto si ridisegna solo quando cambia (lettera nuova, cursore, comparsa, casella)
		appearing := now.Sub(bb.shown) < 220*time.Millisecond
		key := fmt.Sprintf("%p|%d|%d|%v|%v|%v|%.0f|%.0f|%.0f", bb, bb.page, bb.typed, bb.Remember, !bb.Done() && math.Mod(mono, 0.8) < 0.4, bb.More() && math.Mod(mono, 1) < 0.6, bx, bBottom, bw)
		if appearing || key != r.bubKey || r.bubLayer == nil {
			if r.bubLayer == nil {
				r.bubLayer = image.NewRGBA(img.Bounds())
			} else {
				clear(r.bubLayer.Pix)
			}
			var bh Hits
			r.drawBubble(r.bubLayer, bb, now, mono, &bh, bx, bBottom, bw)
			r.bubHits = bh
			r.bubKey = key
			if appearing {
				r.bubKey = ""
			}
		}
		br := image.Rect(int(bx-12*s), 0, int(bx+bw+8*s), img.Rect.Max.Y)
		draw.Draw(img, br, r.bubLayer, br.Min, draw.Over)
		hits.Bubble, hits.Buttons, hits.Remember = r.bubHits.Bubble, r.bubHits.Buttons, r.bubHits.Remember
	}
	return img, hits
}

// gli oggetti accanto a Silver per ogni attività (compaiono con un piccolo "pop")
func (r *Renderer) drawProps(img *image.RGBA, pose string, now time.Time, mono float64, fig rectF) {
	s := r.Scale
	pop := math.Min(1, now.Sub(r.poseAt).Seconds()/0.35)
	pop = 1 - math.Pow(1-pop, 3)
	// riferimenti: la figura disegnata (in alto a sinistra, larghezza e altezza)
	bx, by, fw, fh := fig.x, fig.y, fig.w, fig.h
	put := func(name string, x, y, size float64, alpha float64) {
		im := r.props[name]
		sz := size * s * (0.6 + 0.4*pop)
		dst := image.Rect(int(x-sz/2), int(y-sz/2), int(x+sz/2), int(y+sz/2))
		draw.BiLinear.Scale(img, dst, im, im.Bounds(), draw.Over, &draw.Options{SrcMask: image.NewUniform(color.Alpha{uint8(255 * alpha * pop)})})
	}
	switch pose {
	case "music":
		for i, n := range []string{"note1", "note2"} {
			t := math.Mod(mono+float64(i)*0.5, 1.6) / 1.6
			alpha := math.Min(1, t/0.3) * (1 - t)
			put(n, bx+fw+2*s+float64(i)*14*s, by+20*s-24*s*t, 22, alpha*1.6)
		}
	case "game":
		put("pad", bx+fw*0.86, by+fh*0.74, 30, 1) // accanto alle mani, mai sulla faccia
	case "obs":
		put("cam", bx+fw+4*s, by+18*s, 28, 1)
	case "explorer":
		put("folder", bx+fw+2*s, by+22*s, 28, 1)
	case "code":
		r.chip(img, bx+fw-14*s, by+4*s, "</>", color.NRGBA{29, 34, 43, 255}, color.NRGBA{159, 240, 214, 255}, pop)
	case "twitch", "discord":
		y := by + 4*s - 3*s*smooth(mono, 1.8)
		r.chip(img, bx+fw-12*s, y, "…", color.NRGBA{255, 255, 255, 255}, color.NRGBA{40, 40, 40, 255}, pop)
	case "live":
		w := 1 + 0.5*smooth(mono, 1.4)
		r.chipW(img, bx+fw/2-26*s, by-14*s, "● LIVE", color.NRGBA{229, 72, 77, 255}, color.NRGBA{255, 255, 255, 255}, pop, w)
	}
}

func (r *Renderer) chip(img *image.RGBA, x, y float64, text string, bg, fg color.NRGBA, alpha float64) {
	r.chipW(img, x, y, text, bg, fg, alpha, 0)
}

func (r *Renderer) chipW(img *image.RGBA, x, y float64, text string, bg, fg color.NRGBA, alpha, ring float64) {
	s := r.Scale
	f := r.face("bold", 11)
	w := float64(font.MeasureString(f, text).Ceil()) + 12*s
	h := 18 * s
	if ring > 0 {
		fillRoundRect(img, rectF{x - 3*s*ring, y - 3*s*ring, w + 6*s*ring, h + 6*s*ring}, 7*s, color.NRGBA{bg.R, bg.G, bg.B, 60}, alpha)
	}
	fillRoundRect(img, rectF{x, y, w, h}, 5*s, bg, alpha)
	drawText(img, f, x+6*s, y+13*s, text, fg, alpha)
}

// "finge di lavorare": la pillola con la rotellina e la percentuale
// drawPill: la pastiglia con la rotellina (finta attività, "ci penso…")
func (r *Renderer) drawPill(img *image.RGBA, text, pct string, mono float64) {
	s := r.Scale
	f := r.face("regular", 12)
	tw := float64(font.MeasureString(f, text).Ceil())
	pw := float64(font.MeasureString(f, pct).Ceil())
	x, y, h := 130*s, (winH-64-26)*s, 26*s
	w := 8*s + 12*s + 8*s + tw + 8*s + pw + 10*s
	fillRoundRect(img, rectF{x - 1*s, y - 1*s, w + 2*s, h + 2*s}, 14*s, color.NRGBA{42, 48, 59, 255}, 1)
	fillRoundRect(img, rectF{x, y, w, h}, 13*s, color.NRGBA{22, 26, 33, 235}, 1)
	cx, cy := x+14*s, y+h/2
	drawArc(img, cx, cy, 5.5*s, 1.6*s, 0, 2*math.Pi, color.NRGBA{42, 48, 59, 255})
	start := math.Mod(mono, 1) * 2 * math.Pi
	drawArc(img, cx, cy, 5.5*s, 1.6*s, start, start+math.Pi/2, color.NRGBA{95, 211, 176, 255})
	drawText(img, f, x+28*s, y+17*s, text, color.NRGBA{141, 150, 166, 255}, 1)
	drawText(img, f, x+28*s+tw+8*s, y+17*s, pct, color.NRGBA{159, 240, 214, 255}, 1)
}

// wrap: spezza il testo in righe che stanno nella larghezza
func wrap(f font.Face, text string, maxW float64) []string {
	var out []string
	for _, para := range strings.Split(text, "\n") {
		line := ""
		for _, w := range strings.Fields(para) {
			t := w
			if line != "" {
				t = line + " " + w
			}
			if float64(font.MeasureString(f, t).Ceil()) > maxW && line != "" {
				out = append(out, line)
				line = w
			} else {
				line = t
			}
		}
		out = append(out, line)
	}
	return out
}

func (r *Renderer) drawBubble(img *image.RGBA, bb *Bubble, now time.Time, mono float64, hits *Hits, x, bottom, bw float64) {
	s := r.Scale
	appear := math.Min(1, now.Sub(bb.shown).Seconds()/0.2)
	ease := 1 - math.Pow(1-appear, 3)
	padX, padY := 14*s, 12*s
	fText := r.face("regular", 14)
	fLabel := r.face("bold", 10)
	fSmall := r.face("regular", 11)
	fSrc := r.face("italic", 11)
	inner := bw - 2*padX
	// pulsanti, fonte e casella solo sull'ultima pagina
	actions, source, remember := bb.Actions, bb.Source, bb.RememberLabel
	if bb.More() {
		actions, source, remember = nil, "", ""
	}
	// le righe si calcolano sul testo intero, così non saltano mentre si scrive
	rows := wrap(fText, bb.Full(), inner)
	lineH := 20 * s
	h := padY + 16*s + float64(len(rows))*lineH
	if source != "" {
		h += 18 * s
	}
	var btnW []float64
	btnRows := 0
	if len(actions) > 0 {
		rowW := 0.0
		btnRows = 1
		for _, a := range actions {
			w := float64(font.MeasureString(fSmall, a.Label).Ceil()) + 20*s
			if rowW > 0 && rowW+w > inner {
				btnRows++
				rowW = 0
			}
			rowW += w + 6*s
			btnW = append(btnW, w)
		}
		h += 10*s + float64(btnRows)*30*s
		if remember != "" {
			h += 22 * s
		}
	}
	h += padY - 4*s
	if bottom-h < 4*s { // troppo alto per stare lì: scende quanto basta
		bottom = h + 4*s
	}
	y := bottom - h + (1-ease)*8*s
	alpha := ease
	rect := rectF{x, y, bw, h}
	hits.Bubble = rect

	// ombra, bordo, sfondo e codina verso Silver
	fillRoundRect(img, rectF{x + 2*s, y + 8*s, bw, h}, 16*s, color.NRGBA{0, 0, 0, 70}, alpha)
	fillRoundRect(img, rectF{x - 1*s, y - 1*s, bw + 2*s, h + 2*s}, 15*s, color.NRGBA{58, 66, 80, 255}, alpha)
	fillRoundRect(img, rect, 14*s, color.NRGBA{22, 26, 33, 250}, alpha)
	fillTriangle(img, x-7*s, bottom-14*s+(1-ease)*8*s, x+1*s, bottom-22*s+(1-ease)*8*s, x+1*s, bottom-6*s+(1-ease)*8*s, color.NRGBA{58, 66, 80, 255}, alpha)
	fillTriangle(img, x-5*s, bottom-14*s+(1-ease)*8*s, x+2*s, bottom-20*s+(1-ease)*8*s, x+2*s, bottom-8*s+(1-ease)*8*s, color.NRGBA{22, 26, 33, 250}, alpha)

	cy := y + padY + 9*s
	drawTextSpaced(img, fLabel, x+padX, cy, "SILVER", color.NRGBA{95, 211, 176, 255}, alpha, 2.2*s)
	// l'etichetta (programma in primo piano, pagina) sta a destra di "SILVER" senza toccarlo: se è lunga
	// (es. il titolo di un video) si accorcia con "…"
	page := bb.Page()
	room := bw - 2*padX - float64(font.MeasureString(fLabel, "SILVER").Ceil()) - 6*2.2*s - 14*s
	if page != "" {
		room -= float64(font.MeasureString(fSmall, " · "+page).Ceil())
	}
	label := fitText(fSmall, bb.Label, room-float64(font.MeasureString(fSmall, "· ").Ceil()))
	if page != "" { // pagina 2/3
		if label != "" {
			label += " · "
		}
		label += page
	}
	if label != "" {
		lw := float64(font.MeasureString(fSmall, "· "+label).Ceil())
		drawText(img, fSmall, x+bw-padX-lw, cy, "· "+label, color.NRGBA{141, 150, 166, 255}, alpha)
	}
	// continua: il triangolino che lampeggia in basso a destra (come nei giochi)
	if bb.More() && bb.Done() && math.Mod(mono, 1) < 0.6 {
		tx, tyy := x+bw-padX-6*s, y+h-padY+2*s
		fillTriangle(img, tx-5*s, tyy-6*s, tx+5*s, tyy-6*s, tx, tyy, color.NRGBA{95, 211, 176, 255}, alpha)
	}
	// testo scritto fin qui (lettera per lettera) e il cursore che lampeggia
	typed := []rune(bb.Typed())
	ty := cy + 7*s
	n := 0
	for i, row := range rows {
		ty += lineH
		rr := []rune(row)
		show := rr
		if n+len(rr) > len(typed) {
			k := len(typed) - n
			if k < 0 {
				k = 0
			}
			show = rr[:k]
		}
		drawText(img, fText, x+padX, ty-5*s, string(show), color.NRGBA{233, 237, 243, 255}, alpha)
		if !bb.Done() && len(show) < len(rr) || (!bb.Done() && i == len(rows)-1 && len(show) == len(rr)) {
			if math.Mod(mono, 0.8) < 0.4 {
				cx := x + padX + float64(font.MeasureString(fText, string(show)).Ceil()) + 1*s
				fillRoundRect(img, rectF{cx, ty - 19*s, 6 * s, 16 * s}, 0, color.NRGBA{95, 211, 176, 255}, alpha)
			}
			break
		}
		n += len(rr) + 1 // lo spazio tolto andando a capo
	}
	if source != "" && bb.Done() {
		ty += 18 * s
		drawText(img, fSrc, x+padX, ty-6*s, "— "+source, color.NRGBA{141, 150, 166, 255}, alpha)
	} else if source != "" {
		ty += 18 * s
	}
	// pulsanti (domanda sui giochi): compaiono a frase finita
	if len(actions) > 0 {
		by := ty + 10*s
		bx := x + padX
		show := 0.0
		if bb.Done() {
			show = alpha
		}
		for i, a := range actions {
			w := btnW[i]
			if bx > x+padX && bx+w > x+padX+inner {
				bx = x + padX
				by += 30 * s
			}
			br := rectF{bx, by, w, 24 * s}
			fillRoundRect(img, rectF{br.x - 1*s, br.y - 1*s, br.w + 2*s, br.h + 2*s}, 8*s, color.NRGBA{58, 66, 80, 255}, show)
			fillRoundRect(img, br, 7*s, color.NRGBA{35, 41, 53, 255}, show)
			drawText(img, fSmall, bx+10*s, by+16*s, a.Label, color.NRGBA{233, 237, 243, 255}, show)
			if bb.Done() {
				hits.Buttons = append(hits.Buttons, br)
			}
			bx += w + 6*s
		}
		if remember != "" {
			ry := by + 32*s
			box := rectF{x + padX, ry, 13 * s, 13 * s}
			if bb.Remember {
				fillRoundRect(img, box, 3*s, color.NRGBA{95, 211, 176, 255}, show)
				drawText(img, r.face("bold", 10), box.x+2.5*s, box.y+10.5*s, "✓", color.NRGBA{15, 17, 21, 255}, show)
			} else {
				fillRoundRect(img, box, 3*s, color.NRGBA{141, 150, 166, 255}, show)
				fillRoundRect(img, rectF{box.x + 1.5*s, box.y + 1.5*s, box.w - 3*s, box.h - 3*s}, 2*s, color.NRGBA{22, 26, 33, 255}, show)
			}
			drawText(img, fSmall, box.x+20*s, ry+11*s, remember, color.NRGBA{141, 150, 166, 255}, show)
			if bb.Done() {
				hits.Remember = rectF{box.x, ry - 2*s, inner, 18 * s}
			}
		}
	}
}

// ---------- disegno di base (con i bordi morbidi) ----------

func blend(img *image.RGBA, x, y int, c color.NRGBA, cov float64) {
	if cov <= 0 || !image.Pt(x, y).In(img.Rect) { // (anche su un pezzo di immagine: SubImage)
		return
	}
	if cov > 1 {
		cov = 1
	}
	a := float64(c.A) / 255 * cov
	i := img.PixOffset(x, y)
	p := img.Pix[i : i+4 : i+4]
	inv := 1 - a
	p[0] = uint8(float64(c.R)*a + float64(p[0])*inv)
	p[1] = uint8(float64(c.G)*a + float64(p[1])*inv)
	p[2] = uint8(float64(c.B)*a + float64(p[2])*inv)
	p[3] = uint8(255*a + float64(p[3])*inv)
}

func fillRoundRect(img *image.RGBA, r rectF, rad float64, c color.NRGBA, alpha float64) {
	if alpha <= 0 {
		return
	}
	x0, y0 := int(math.Floor(r.x)), int(math.Floor(r.y))
	x1, y1 := int(math.Ceil(r.x+r.w)), int(math.Ceil(r.y+r.h))
	for y := y0; y <= y1; y++ {
		for x := x0; x <= x1; x++ {
			px, py := float64(x)+0.5, float64(y)+0.5
			// distanza dal bordo del rettangolo arrotondato
			qx := math.Abs(px-(r.x+r.w/2)) - (r.w/2 - rad)
			qy := math.Abs(py-(r.y+r.h/2)) - (r.h/2 - rad)
			out := math.Hypot(math.Max(qx, 0), math.Max(qy, 0)) + math.Min(math.Max(qx, qy), 0) - rad
			blend(img, x, y, c, (0.5-out)*alpha)
		}
	}
}

// ellisse; soft = 0: sfumata dal centro (aura); soft = 1: bordo netto ma morbido (ombra)
func fillEllipse(img *image.RGBA, cx, cy, rx, ry float64, c color.NRGBA, soft float64) {
	for y := int(cy - ry); y <= int(cy+ry)+1; y++ {
		for x := int(cx - rx); x <= int(cx+rx)+1; x++ {
			dx, dy := (float64(x)+0.5-cx)/rx, (float64(y)+0.5-cy)/ry
			d := math.Sqrt(dx*dx + dy*dy)
			if d >= 1 {
				continue
			}
			cov := 1 - d
			if soft > 0 {
				cov = math.Min(1, (1-d)*3)
			} else {
				cov = cov * cov
			}
			blend(img, x, y, c, cov)
		}
	}
}

func fillTriangle(img *image.RGBA, ax, ay, bx, by, cx, cy float64, c color.NRGBA, alpha float64) {
	minX, maxX := math.Min(ax, math.Min(bx, cx)), math.Max(ax, math.Max(bx, cx))
	minY, maxY := math.Min(ay, math.Min(by, cy)), math.Max(ay, math.Max(by, cy))
	edge := func(x0, y0, x1, y1, px, py float64) float64 { return (px-x0)*(y1-y0) - (py-y0)*(x1-x0) }
	area := edge(ax, ay, bx, by, cx, cy)
	for y := int(minY); y <= int(maxY)+1; y++ {
		for x := int(minX); x <= int(maxX)+1; x++ {
			px, py := float64(x)+0.5, float64(y)+0.5
			w0, w1, w2 := edge(bx, by, cx, cy, px, py), edge(cx, cy, ax, ay, px, py), edge(ax, ay, bx, by, px, py)
			if (area > 0 && w0 >= 0 && w1 >= 0 && w2 >= 0) || (area < 0 && w0 <= 0 && w1 <= 0 && w2 <= 0) {
				blend(img, x, y, c, alpha)
			}
		}
	}
}

func drawArc(img *image.RGBA, cx, cy, rad, width, from, to float64, c color.NRGBA) {
	for y := int(cy - rad - width); y <= int(cy+rad+width)+1; y++ {
		for x := int(cx - rad - width); x <= int(cx+rad+width)+1; x++ {
			dx, dy := float64(x)+0.5-cx, float64(y)+0.5-cy
			d := math.Abs(math.Hypot(dx, dy) - rad)
			if d > width {
				continue
			}
			a := math.Atan2(dy, dx)
			for a < from {
				a += 2 * math.Pi
			}
			if a > to {
				continue
			}
			blend(img, x, y, c, math.Min(1, width-d+0.5))
		}
	}
}

func drawText(img *image.RGBA, f font.Face, x, y float64, text string, c color.NRGBA, alpha float64) {
	if alpha <= 0 || text == "" {
		return
	}
	c.A = uint8(float64(c.A) * math.Min(1, alpha))
	d := font.Drawer{Dst: img, Src: image.NewUniform(c), Face: f, Dot: fixed.Point26_6{X: fixed.Int26_6(x * 64), Y: fixed.Int26_6(y * 64)}}
	d.DrawString(text)
}

func drawTextSpaced(img *image.RGBA, f font.Face, x, y float64, text string, c color.NRGBA, alpha, spacing float64) {
	for _, ch := range text {
		drawText(img, f, x, y, string(ch), c, alpha)
		x += float64(font.MeasureString(f, string(ch)).Ceil()) + spacing
	}
}

// visibleBounds: il rettangolo dei pixel non trasparenti (le immagini spesso hanno bordi vuoti)
func (r *Renderer) visibleBounds(img image.Image) image.Rectangle {
	if v, ok := r.visible[img]; ok {
		return v
	}
	b := img.Bounds()
	v := image.Rectangle{}
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			if _, _, _, a := img.At(x, y).RGBA(); a > 0x2000 {
				v = v.Union(image.Rect(x, y, x+1, y+1))
			}
		}
	}
	if v.Empty() {
		v = b
	}
	v = v.Sub(b.Min)
	if r.visible == nil || len(r.visible) > 32 {
		r.visible = map[image.Image]image.Rectangle{}
	}
	r.visible[img] = v
	return v
}

// fitText: il testo accorciato con "…" perché stia in maxW pixel ("" se non c'è posto neanche per poco)
func fitText(f font.Face, text string, maxW float64) string {
	if text == "" || float64(font.MeasureString(f, text).Ceil()) <= maxW {
		return text
	}
	r := []rune(text)
	for n := len(r) - 1; n > 0; n-- {
		t := strings.TrimRight(string(r[:n]), " -–—·|") + "…"
		if float64(font.MeasureString(f, t).Ceil()) <= maxW {
			return t
		}
	}
	return ""
}
