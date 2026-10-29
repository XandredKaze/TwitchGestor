//go:build windows

package main

// La finestra per scrivere a Silver (Ctrl+Alt+S o dal menu): sopra la barra delle applicazioni, accanto a lui.
// È disegnata come il fumetto (chatview.go); l'unico pezzo di Windows è la riga dove scrivi (un campo vero:
// tastiera, incolla, accenti funzionano come sempre). Invio manda, Esc chiude, la rotellina scorre.

import (
	"strings"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	pSendMessage       = user32.NewProc("SendMessageW")
	pSetWindowText     = user32.NewProc("SetWindowTextW")
	pGetWindowTextLen  = user32.NewProc("GetWindowTextLengthW")
	pSetFocus          = user32.NewProc("SetFocus")
	pIsWindowVisible   = user32.NewProc("IsWindowVisible")
	pMoveWindow        = user32.NewProc("MoveWindow")
	pBeginPaint        = user32.NewProc("BeginPaint")
	pEndPaint          = user32.NewProc("EndPaint")
	pReleaseDC         = user32.NewProc("ReleaseDC")
	pSetWindowRgn      = user32.NewProc("SetWindowRgn")
	pRegisterHotKey    = user32.NewProc("RegisterHotKey")
	pOpenClipboard     = user32.NewProc("OpenClipboard")
	pEmptyClipboard    = user32.NewProc("EmptyClipboard")
	pSetClipboardData  = user32.NewProc("SetClipboardData")
	pCloseClipboard    = user32.NewProc("CloseClipboard")
	pCreateSolidBrush  = gdi32.NewProc("CreateSolidBrush")
	pCreateFont        = gdi32.NewProc("CreateFontW")
	pSetTextColor      = gdi32.NewProc("SetTextColor")
	pSetBkColor        = gdi32.NewProc("SetBkColor")
	pSetDIBitsToDevice = gdi32.NewProc("SetDIBitsToDevice")
	pCreateRoundRgn    = gdi32.NewProc("CreateRoundRectRgn")
	pGlobalAlloc       = kernel32.NewProc("GlobalAlloc")
	pGlobalLock        = kernel32.NewProc("GlobalLock")
	pGlobalUnlock      = kernel32.NewProc("GlobalUnlock")
	pMoveMemory        = kernel32.NewProc("RtlMoveMemory")
	pShellExecute      = shell32.NewProc("ShellExecuteW")
	pDwmSetWindowAttr  = windows.NewLazySystemDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")
	pSetWindowSubclass = windows.NewLazySystemDLL("comctl32.dll").NewProc("SetWindowSubclass")
	pDefSubclassProc   = windows.NewLazySystemDLL("comctl32.dll").NewProc("DefSubclassProc")
	panelProcCallback  = windows.NewCallback(panelProc)
	inputSubclassCbk   = windows.NewCallback(inputSubclass)
	panelClassName, _  = windows.UTF16PtrFromString("SilverChat")
	editClass, _       = windows.UTF16PtrFromString("EDIT")
)

const (
	wsChild        = 0x40000000
	wsVisible      = 0x10000000
	wsClipChildren = 0x02000000
	esAutoHScroll  = 0x0080
	emSetMargins   = 0x00D3
	emSetCueBanner = 0x1501
	wmSetFont      = 0x0030
	wmPaint        = 0x000F
	wmClose        = 0x0010
	wmEraseBkgnd   = 0x0014
	wmKeyDown      = 0x0100
	wmChar         = 0x0102
	wmHotkey       = 0x0312
	wmMouseWheel   = 0x020A
	wmCtlColorEdit = 0x0133
	swHide         = 0
	swShow         = 5
	modAlt         = 0x1
	modControl     = 0x2
	modNoRepeat    = 0x4000
	cfUnicodeText  = 13
	gmemMoveable   = 0x2
	crText         = 0x00EFE9E6 // COLORREF 0x00BBGGRR: come cText
	crField        = 0x002C231E // come cCard
)

type paintStruct struct {
	HDC       uintptr
	Erase     int32
	Paint     rect
	Restore   int32
	IncUpdate int32
	Reserved  [32]byte
}

type panel struct {
	hwnd, in   uintptr
	font       uintptr
	fieldBrush uintptr
	scale      float64
	hits       []ChatHit
	tracking   bool
	sig        string // cosa c'era nell'ultimo disegno (si ridisegna solo se cambia)
	bgra       []byte // l'ultimo disegno, pronto per Windows
	w, h       int
	dwmRound   bool
}

func (a *app) createPanel() {
	p := &panel{}
	a.panel = p
	p.fieldBrush, _, _ = pCreateSolidBrush.Call(crField)
	cursor, _, _ := pLoadCursor.Call(0, idcArrow)
	wc := wndClassEx{WndProc: panelProcCallback, Instance: a.inst, ClassName: panelClassName, Cursor: cursor, Icon: a.tray.Icon, IconSm: a.tray.Icon}
	wc.Size = uint32(unsafe.Sizeof(wc))
	pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	title, _ := windows.UTF16PtrFromString("Chiedi a Silver")
	p.hwnd, _, _ = pCreateWindowEx.Call(wsExTopmost|wsExToolWindow, uintptr(unsafe.Pointer(panelClassName)), uintptr(unsafe.Pointer(title)), wsPopup|wsClipChildren, 0, 0, 10, 10, 0, 0, uintptr(a.inst), 0)
	// angoli arrotondati: Windows 11 li fa da sé (morbidi); su Windows 10 si taglia la finestra
	pref := uint32(2) // DWMWCP_ROUND
	if r, _, _ := pDwmSetWindowAttr.Call(p.hwnd, 33, uintptr(unsafe.Pointer(&pref)), 4); r == 0 {
		p.dwmRound = true
		a.chat.Radius = 8
	}
	empty, _ := windows.UTF16PtrFromString("")
	p.in, _, _ = pCreateWindowEx.Call(0, uintptr(unsafe.Pointer(editClass)), uintptr(unsafe.Pointer(empty)), wsChild|wsVisible|esAutoHScroll, 0, 0, 10, 10, p.hwnd, 11, uintptr(a.inst), 0)
	cue, _ := windows.UTF16PtrFromString("Scrivi qui… (es. \"ricordami tra 20 minuti di bere\")")
	pSendMessage.Call(p.in, emSetCueBanner, 1, uintptr(unsafe.Pointer(cue)))
	pSetWindowSubclass.Call(p.in, inputSubclassCbk, 1, 0) // Invio manda, Esc chiude
	p.layout(a)
}

func (p *panel) layout(a *app) {
	p.scale = a.scale
	s := a.scale
	p.w, p.h = int(chatW*s+0.999), int(chatH*s+0.999)
	if p.font != 0 {
		pDeleteObject.Call(p.font)
	}
	face, _ := windows.UTF16PtrFromString("Segoe UI")
	p.font, _, _ = pCreateFont.Call(uintptr(-int32(15*s)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(face)))
	pSendMessage.Call(p.in, wmSetFont, p.font, 1)
	f := a.chat.Field(s)
	pMoveWindow.Call(p.in, uintptr(int32(f.x)), uintptr(int32(f.y)), uintptr(int32(f.w)), uintptr(int32(f.h)), 1)
	if !p.dwmRound {
		d := uintptr(int32(2 * a.chat.Radius * s))
		rgn, _, _ := pCreateRoundRgn.Call(0, 0, uintptr(p.w+1), uintptr(p.h+1), d, d)
		pSetWindowRgn.Call(p.hwnd, rgn, 1)
	}
	p.sig = ""
}

// show: accanto a Silver, sopra la barra delle applicazioni
func (a *app) showPanel() {
	if a.panel == nil {
		a.createPanel()
	}
	p := a.panel
	if p.scale != a.scale {
		p.layout(a)
	}
	x := a.pos.X + int32((winW-8)*a.scale)
	y := a.pos.Y + int32(a.bh) - int32(p.h) - int32(6*a.scale)
	pMoveWindow.Call(p.hwnd, uintptr(x), uintptr(y), uintptr(p.w), uintptr(p.h), 1)
	p.sig = ""
	a.paintPanel(time.Now())
	pShowWindow.Call(p.hwnd, swShow)
	pSetForegroundWindow.Call(p.hwnd)
	pSetFocus.Call(p.in)
}

func (a *app) hidePanel() {
	if a.panel != nil {
		pShowWindow.Call(a.panel.hwnd, swHide)
	}
}

func (a *app) panelVisible() bool {
	if a.panel == nil {
		return false
	}
	v, _, _ := pIsWindowVisible.Call(a.panel.hwnd)
	return v != 0
}

// paintPanel: ridisegna se qualcosa è cambiato (o se i puntini "ci penso" si muovono)
func (a *app) paintPanel(now time.Time) {
	p := a.panel
	if p == nil || !a.panelVisible() && p.sig != "" {
		return
	}
	v := a.chat
	last := ""
	if n := len(v.Msgs); n > 0 {
		last = v.Msgs[n-1].Text
	}
	sig := strings.Join([]string{itoaInt(len(v.Msgs)), itoaInt(len(last)), v.Thinking, v.HoverID, itoaInt(int(v.Scroll)), itoaInt(v.Copied), boolS(v.Busy), boolS(now.Sub(v.CopiedAt) < 2*time.Second)}, "|")
	if sig == p.sig && v.Thinking == "" {
		return
	}
	p.sig = sig
	img, hits := v.Render(a.r, now, now.Sub(a.start).Seconds())
	p.hits = hits
	if len(p.bgra) != len(img.Pix) {
		p.bgra = make([]byte, len(img.Pix))
	}
	src := img.Pix
	for i := 0; i+3 < len(src); i += 4 {
		p.bgra[i], p.bgra[i+1], p.bgra[i+2], p.bgra[i+3] = src[i+2], src[i+1], src[i], 255
	}
	p.w, p.h = img.Rect.Dx(), img.Rect.Dy()
	dc, _, _ := pGetDC.Call(p.hwnd)
	p.blit(dc)
	pReleaseDC.Call(p.hwnd, dc)
}

func boolS(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func (p *panel) blit(dc uintptr) {
	if len(p.bgra) == 0 {
		return
	}
	bi := bitmapInfoHeader{Width: int32(p.w), Height: -int32(p.h), Planes: 1, BitCount: 32}
	bi.Size = uint32(unsafe.Sizeof(bi))
	pSetDIBitsToDevice.Call(dc, 0, 0, uintptr(p.w), uintptr(p.h), 0, 0, 0, uintptr(p.h), uintptr(unsafe.Pointer(&p.bgra[0])), uintptr(unsafe.Pointer(&bi)), 0)
}

func (p *panel) hitAt(x, y float64) string {
	for _, h := range p.hits {
		if h.R.has(x, y) {
			return h.ID
		}
	}
	return ""
}

func (p *panel) takeInput() string {
	n, _, _ := pGetWindowTextLen.Call(p.in)
	buf := make([]uint16, n+1)
	pGetWindowText.Call(p.in, uintptr(unsafe.Pointer(&buf[0])), n+1)
	empty, _ := windows.UTF16PtrFromString("")
	pSetWindowText.Call(p.in, uintptr(unsafe.Pointer(empty)))
	return strings.TrimSpace(windows.UTF16ToString(buf))
}

// clickPanel: pulsanti disegnati (chiudi, manda, copia, suggerimenti)
func (a *app) clickPanel(id string) {
	switch {
	case id == "close":
		a.hidePanel()
	case id == "send":
		a.submitPanel()
	case strings.HasPrefix(id, "copy:"):
		i := 0
		for _, c := range id[5:] {
			i = i*10 + int(c-'0')
		}
		if i < len(a.chat.Msgs) && copyText(a.panel.hwnd, a.chat.Msgs[i].Text) {
			a.chat.Copied, a.chat.CopiedAt = i, time.Now()
		}
	case strings.HasPrefix(id, "chip:"):
		text := id[5:]
		if text == "un titolo per la live" {
			text = "Scrivimi tre idee di titolo per la mia prossima live"
		}
		a.chat.Add("me", text)
		a.handleInput(text)
	}
	pSetFocus.Call(a.panel.hwnd)
	pSetFocus.Call(a.panel.in)
}

func copyText(owner uintptr, text string) bool {
	if r, _, _ := pOpenClipboard.Call(owner); r == 0 {
		return false
	}
	defer pCloseClipboard.Call()
	pEmptyClipboard.Call()
	u := utf16.Encode([]rune(strings.ReplaceAll(strings.ReplaceAll(text, "\r", ""), "\n", "\r\n") + "\x00"))
	h, _, _ := pGlobalAlloc.Call(gmemMoveable, uintptr(len(u)*2))
	if h == 0 {
		return false
	}
	ptr, _, _ := pGlobalLock.Call(h)
	pMoveMemory.Call(ptr, uintptr(unsafe.Pointer(&u[0])), uintptr(len(u)*2))
	pGlobalUnlock.Call(h)
	r, _, _ := pSetClipboardData.Call(cfUnicodeText, h)
	return r != 0
}

func openURL(url string) {
	verb, _ := windows.UTF16PtrFromString("open")
	u, _ := windows.UTF16PtrFromString(url)
	pShellExecute.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(u)), 0, 0, 1)
}

// inputSubclass: Invio manda, Esc chiude (dentro la riga dove scrivi)
func inputSubclass(hwnd, msg, wparam, lparam, id, data uintptr) uintptr {
	a := theApp
	if a != nil && a.panel != nil {
		switch uint32(msg) {
		case wmKeyDown:
			switch wparam {
			case 0x0D: // Invio
				a.submitPanel()
				return 0
			case 0x1B: // Esc
				a.hidePanel()
				return 0
			}
		case wmChar:
			if wparam == 0x0D || wparam == 0x1B { // niente "bip"
				return 0
			}
		}
	}
	r, _, _ := pDefSubclassProc.Call(hwnd, msg, wparam, lparam)
	return r
}

func panelProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	a := theApp
	if a == nil || a.panel == nil || a.panel.hwnd != hwnd {
		r, _, _ := pDefWindowProc.Call(hwnd, msg, wparam, lparam)
		return r
	}
	p := a.panel
	x := float64(int16(lparam & 0xffff))
	y := float64(int16((lparam >> 16) & 0xffff))
	switch uint32(msg) {
	case wmEraseBkgnd:
		return 1 // il fondo lo disegniamo noi (niente sfarfallio)
	case wmPaint:
		var ps paintStruct
		dc, _, _ := pBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		p.blit(dc)
		pEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		return 0
	case wmMouseMove:
		if !p.tracking {
			tme := trackMouseEvent{Flags: tmeLeave, Track: hwnd}
			tme.Size = uint32(unsafe.Sizeof(tme))
			pTrackMouseEvent.Call(uintptr(unsafe.Pointer(&tme)))
			p.tracking = true
		}
		a.chat.HoverID = p.hitAt(x, y)
		a.paintPanel(time.Now())
		return 0
	case wmMouseLeave:
		p.tracking = false
		a.chat.HoverID = ""
		a.paintPanel(time.Now())
		return 0
	case wmSetCursor:
		if a.chat.HoverID != "" {
			c, _, _ := pLoadCursor.Call(0, idcHand)
			pSetCursor.Call(c)
			return 1
		}
	case wmLButtonUp:
		if id := p.hitAt(x, y); id != "" {
			a.clickPanel(id)
			a.paintPanel(time.Now())
		} else {
			pSetFocus.Call(p.in)
		}
		return 0
	case wmMouseWheel:
		a.chat.Wheel(float64(int16(wparam>>16)) / 120 * 48 * a.scale)
		a.paintPanel(time.Now())
		return 0
	case wmCtlColorEdit:
		pSetTextColor.Call(wparam, crText)
		pSetBkColor.Call(wparam, crField)
		return p.fieldBrush
	case wmClose:
		a.hidePanel()
		return 0
	}
	r, _, _ := pDefWindowProc.Call(hwnd, msg, wparam, lparam)
	return r
}
