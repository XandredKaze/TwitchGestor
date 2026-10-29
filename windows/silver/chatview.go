package main

// La finestra "Chiedi a Silver" disegnata come il fumetto (niente pulsanti bianchi di Windows):
// intestazione, conversazione a nuvolette che scorre, suggerimenti, e il riquadro dove scrivi.
// La riga dove scrivi è un vero campo di Windows messo sopra il riquadro disegnato (chatField).
// Niente di Windows qui: si prova anche altrove (chatview_test.go).

import (
	"image"
	"image/color"
	"math"
	"strings"
	"time"

	"golang.org/x/image/font"
)

const (
	chatW = 420.0
	chatH = 380.0
	headH = 46.0
	footH = 62.0
)

type ChatMsg struct {
	Who  string // me | silver | error
	Text string
}

type ChatView struct {
	Msgs     []ChatMsg
	Thinking string // "Ci penso…" mentre risponde (nuvoletta con i puntini)
	Scroll   float64
	stick    bool // resta in fondo quando arriva testo nuovo
	HoverID  string
	Copied   int // messaggio appena copiato (per un attimo dice "Copiato")
	CopiedAt time.Time
	Busy     bool    // l'IA sta rispondendo: il pulsante manda diventa grigio
	Radius   float64 // angoli della finestra (Windows 11 li arrotonda da sé a 8)
	maxScr   float64
}

type ChatHit struct {
	ID string // close | send | copy:<i> | chip:<testo>
	R  rectF
}

var chatSuggestions = []string{"aiuto", "prossimo impegno", "che canzone è?", "timer 10 minuti", "un titolo per la live"}

var (
	cBg     = color.NRGBA{22, 26, 33, 255}
	cLine   = color.NRGBA{42, 48, 59, 255}
	cCard   = color.NRGBA{30, 35, 44, 255}
	cText   = color.NRGBA{230, 233, 239, 255}
	cMuted  = color.NRGBA{141, 150, 166, 255}
	cAccent = color.NRGBA{95, 211, 176, 255}
	cMine   = color.NRGBA{31, 64, 56, 255}
	cErr    = color.NRGBA{70, 34, 40, 255}
)

func NewChatView() *ChatView { return &ChatView{stick: true, Copied: -1, Radius: 14} }

func (v *ChatView) Add(who, text string) {
	v.Msgs = append(v.Msgs, ChatMsg{who, text})
	if len(v.Msgs) > 100 {
		v.Msgs = v.Msgs[len(v.Msgs)-100:]
	}
	v.stick = true
}

// AppendLast: la risposta che arriva a pezzi
func (v *ChatView) AppendLast(s string) {
	if n := len(v.Msgs); n > 0 && v.Msgs[n-1].Who == "silver" {
		v.Msgs[n-1].Text += s
	} else {
		v.Msgs = append(v.Msgs, ChatMsg{"silver", s})
	}
}

func (v *ChatView) SetLast(who, s string) {
	if n := len(v.Msgs); n > 0 && v.Msgs[n-1].Who != "me" {
		v.Msgs[n-1] = ChatMsg{who, s}
	} else {
		v.Add(who, s)
	}
}

// Wheel: la rotellina del mouse (delta in pixel, positivo = su)
func (v *ChatView) Wheel(delta float64) {
	v.Scroll = math.Max(0, math.Min(v.maxScr, v.Scroll-delta))
	v.stick = v.Scroll >= v.maxScr-1
}

// wrapHard: come wrap, ma spezza anche le parole troppo lunghe (percorsi, link)
func wrapHard(f font.Face, text string, maxW float64) []string {
	var out []string
	for _, line := range wrap(f, text, maxW) {
		for float64(font.MeasureString(f, line).Ceil()) > maxW {
			r := []rune(line)
			n := len(r) - 1
			for n > 1 && float64(font.MeasureString(f, string(r[:n])).Ceil()) > maxW {
				n--
			}
			out = append(out, string(r[:n]))
			line = string(r[n:])
		}
		out = append(out, line)
	}
	return out
}

// Field: dove va il campo di Windows per scrivere (in pixel della finestra)
func (v *ChatView) Field(s float64) rectF {
	return rectF{(14 + 12) * s, (chatH - footH + 12 + 9) * s, (chatW - 28 - 52 - 24) * s, 22 * s}
}

// Render: la finestra intera (w×h pixel = chat×scala)
func (v *ChatView) Render(r *Renderer, now time.Time, mono float64) (*image.RGBA, []ChatHit) {
	s := r.Scale
	W, H := chatW*s, chatH*s
	img := image.NewRGBA(image.Rect(0, 0, int(math.Ceil(W)), int(math.Ceil(H))))
	var hits []ChatHit
	fillRoundRect(img, rectF{0, 0, W, H}, v.Radius*s, cLine, 1)
	fillRoundRect(img, rectF{1 * s, 1 * s, W - 2*s, H - 2*s}, (v.Radius-1)*s, cBg, 1)

	// --- conversazione (si disegna prima, poi intestazione e piede ci vanno sopra) ---
	fText := r.face("regular", 13.5)
	fSmall := r.face("regular", 11)
	top, bottom := headH*s, H-footH*s
	lineH := 19 * s
	maxBub := (chatW - 28 - 60) * s
	pad := 10 * s
	type laid struct {
		m     ChatMsg
		rows  []string
		w, h  float64
		i     int
		copyB bool
	}
	var items []laid
	total := 10 * s
	msgs := v.Msgs
	if v.Thinking != "" && (len(msgs) == 0 || msgs[len(msgs)-1].Who == "me" || strings.TrimSpace(msgs[len(msgs)-1].Text) == "") {
		if len(msgs) > 0 && msgs[len(msgs)-1].Who != "me" {
			msgs = msgs[:len(msgs)-1]
		}
		msgs = append(append([]ChatMsg(nil), msgs...), ChatMsg{"thinking", v.Thinking})
	}
	for i, m := range msgs {
		rows := wrapHard(fText, m.Text, maxBub-2*pad)
		w := 0.0
		for _, row := range rows {
			w = math.Max(w, float64(font.MeasureString(fText, row).Ceil()))
		}
		if m.Who == "thinking" {
			rows, w = []string{""}, 36*s
		}
		it := laid{m: m, rows: rows, w: w + 2*pad, h: float64(len(rows))*lineH + 2*pad - 4*s, i: i}
		it.copyB = m.Who == "silver" && len([]rune(m.Text)) > 25
		total += it.h + 10*s
		if it.copyB {
			total += 18 * s
		}
		items = append(items, it)
	}
	if len(items) == 0 {
		total = 0
	}
	view := bottom - top
	v.maxScr = math.Max(0, total-view)
	if v.stick {
		v.Scroll = v.maxScr
	}
	v.Scroll = math.Min(v.Scroll, v.maxScr)
	y := top + 10*s - v.Scroll
	if total < view {
		y = bottom - total + 10*s - 4*s // pochi messaggi: stanno in basso, vicino a dove scrivi
	}
	clip := image.Rect(0, int(top), img.Rect.Dx(), int(bottom))
	area := img.SubImage(clip).(*image.RGBA)
	for _, it := range items {
		x := 14 * s
		bg, fg := cCard, cText
		switch it.m.Who {
		case "me":
			x = W - 14*s - it.w
			bg = cMine
		case "error":
			bg = cErr
		}
		if y+it.h > top-40*s && y < bottom+40*s {
			fillRoundRect(area, rectF{x, y, it.w, it.h}, 12*s, bg, 1)
			if it.m.Who == "thinking" { // tre puntini che si muovono
				for k := 0; k < 3; k++ {
					c := cMuted
					c.A = uint8(255 * (0.3 + 0.7*smooth(mono-float64(k)*0.18, 1.1)))
					fillEllipse(area, x+pad+4*s+float64(k)*9*s, y+it.h/2, 3.2*s, 3.2*s, c, 1)
				}
			}
			for j, row := range it.rows {
				drawText(area, fText, x+pad, y+pad+float64(j)*lineH+13*s, row, fg, 1)
			}
		}
		y += it.h + 10*s
		if it.copyB {
			label := "Copia"
			id := "copy:" + itoaInt(it.i)
			if v.Copied == it.i && now.Sub(v.CopiedAt) < 2*time.Second {
				label = "Copiato"
			}
			col := cMuted
			if v.HoverID == id {
				col = cAccent
			}
			lw := float64(font.MeasureString(fSmall, label).Ceil())
			cy := y - 6*s
			drawText(area, fSmall, x+4*s, cy+8*s, label, col, 1)
			hr := rectF{x, cy - 4*s, lw + 10*s, 18 * s}
			if hr.y+hr.h > top && hr.y < bottom {
				hits = append(hits, ChatHit{id, hr})
			}
			y += 18 * s
		}
	}
	if len(items) == 0 { // vuota: suggerimenti
		fLead := r.face("regular", 13)
		drawText(img, fLead, 18*s, top+30*s, "Dimmi. Comandi o domande, in italiano.", cMuted, 1)
		cx, cy := 18*s, top+46*s
		for _, c := range chatSuggestions {
			w := float64(font.MeasureString(fSmall, c).Ceil()) + 20*s
			if cx+w > W-18*s {
				cx, cy = 18*s, cy+32*s
			}
			id := "chip:" + c
			border := cLine
			if v.HoverID == id {
				border = cAccent
			}
			fillRoundRect(img, rectF{cx, cy, w, 26 * s}, 13*s, border, 1)
			fillRoundRect(img, rectF{cx + 1*s, cy + 1*s, w - 2*s, 24 * s}, 12*s, cCard, 1)
			drawText(img, fSmall, cx+10*s, cy+17*s, c, cText, 1)
			hits = append(hits, ChatHit{id, rectF{cx, cy, w, 26 * s}})
			cx += w + 8*s
		}
	}
	// barra di scorrimento sottile (solo se serve)
	if v.maxScr > 0 {
		trackH := view - 16*s
		th := math.Max(24*s, trackH*view/total)
		ty := top + 8*s + (trackH-th)*(v.Scroll/v.maxScr)
		fillRoundRect(img, rectF{W - 7*s, ty, 3 * s, th}, 1.5*s, cLine, 1)
	}

	// --- intestazione ---
	fillRoundRect(img, rectF{1 * s, headH*s - 1*s, W - 2*s, 1 * s}, 0, cLine, 1)
	drawTextSpaced(img, r.face("bold", 11), 18*s, 28*s, "SILVER", cAccent, 1, 2*s)
	drawText(img, fSmall, 82*s, 28*s, "Ctrl+Alt+S", cMuted, 1)
	cr := rectF{W - 40*s, 9 * s, 28 * s, 28 * s}
	if v.HoverID == "close" {
		fillRoundRect(img, cr, 8*s, cCard, 1)
	}
	xc, yc, k := cr.x+cr.w/2, cr.y+cr.h/2, 5*s
	drawLine(img, xc-k, yc-k, xc+k, yc+k, 1.6*s, cMuted)
	drawLine(img, xc-k, yc+k, xc+k, yc-k, 1.6*s, cMuted)
	hits = append(hits, ChatHit{"close", cr})

	// --- dove scrivi ---
	fillRoundRect(img, rectF{1 * s, bottom, W - 2*s, 1 * s}, 0, cLine, 1)
	fr := rectF{14 * s, bottom + 12*s, W - 28*s - 52*s, 40 * s}
	fillRoundRect(img, fr, 12*s, cLine, 1)
	fillRoundRect(img, rectF{fr.x + 1*s, fr.y + 1*s, fr.w - 2*s, fr.h - 2*s}, 11*s, cCard, 1)
	sb := rectF{W - 14*s - 44*s, bottom + 12*s, 44 * s, 40 * s}
	sc := cAccent
	if v.Busy {
		sc = cLine
	} else if v.HoverID == "send" {
		sc = color.NRGBA{130, 230, 200, 255}
	}
	fillRoundRect(img, sb, 12*s, sc, 1)
	// freccia "manda"
	ax, ay := sb.x+sb.w/2, sb.y+sb.h/2
	fillTriangle(img, ax-6*s, ay-7*s, ax+8*s, ay, ax-6*s, ay+7*s, cBg, 1)
	fillTriangle(img, ax-6*s, ay-7*s, ax-2*s, ay, ax-6*s, ay+7*s, sc, 1)
	hits = append(hits, ChatHit{"send", sb})
	return img, hits
}

// drawLine: linea spessa e morbida (per la ✕)
func drawLine(img *image.RGBA, x0, y0, x1, y1, width float64, c color.NRGBA) {
	minX, maxX := int(math.Min(x0, x1)-width), int(math.Max(x0, x1)+width)
	minY, maxY := int(math.Min(y0, y1)-width), int(math.Max(y0, y1)+width)
	dx, dy := x1-x0, y1-y0
	l2 := dx*dx + dy*dy
	for y := minY; y <= maxY; y++ {
		for x := minX; x <= maxX; x++ {
			px, py := float64(x)+0.5, float64(y)+0.5
			t := math.Max(0, math.Min(1, ((px-x0)*dx+(py-y0)*dy)/l2))
			d := math.Hypot(px-(x0+t*dx), py-(y0+t*dy))
			blend(img, x, y, c, width/2-d+0.5)
		}
	}
}

func itoaInt(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
