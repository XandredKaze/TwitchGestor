//go:build windows

package main

// La finestra per scrivere a Silver (Ctrl+Alt+S o dal menu): sopra la barra delle applicazioni, accanto a lui.
// Sopra la conversazione (si può selezionare e copiare), sotto la riga dove scrivi: Invio manda, Esc chiude.

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
	pIsDialogMessage   = user32.NewProc("IsDialogMessageW")
	pIsWindowVisible   = user32.NewProc("IsWindowVisible")
	pMoveWindow        = user32.NewProc("MoveWindow")
	pBeginPaint        = user32.NewProc("BeginPaint")
	pEndPaint          = user32.NewProc("EndPaint")
	pGetClientRect     = user32.NewProc("GetClientRect")
	pRegisterHotKey    = user32.NewProc("RegisterHotKey")
	pOpenClipboard     = user32.NewProc("OpenClipboard")
	pEmptyClipboard    = user32.NewProc("EmptyClipboard")
	pSetClipboardData  = user32.NewProc("SetClipboardData")
	pCloseClipboard    = user32.NewProc("CloseClipboard")
	pCreateSolidBrush  = gdi32.NewProc("CreateSolidBrush")
	pCreateFont        = gdi32.NewProc("CreateFontW")
	pSetTextColor      = gdi32.NewProc("SetTextColor")
	pSetBkColor        = gdi32.NewProc("SetBkColor")
	pSetBkMode         = gdi32.NewProc("SetBkMode")
	pTextOut           = gdi32.NewProc("TextOutW")
	pGlobalAlloc       = kernel32.NewProc("GlobalAlloc")
	pGlobalLock        = kernel32.NewProc("GlobalLock")
	pGlobalUnlock      = kernel32.NewProc("GlobalUnlock")
	pMoveMemory        = kernel32.NewProc("RtlMoveMemory")
	pShellExecute      = shell32.NewProc("ShellExecuteW")
	pSetWindowSubclass = windows.NewLazySystemDLL("comctl32.dll").NewProc("SetWindowSubclass")
	pDefSubclassProc   = windows.NewLazySystemDLL("comctl32.dll").NewProc("DefSubclassProc")
	panelProcCallback  = windows.NewCallback(panelProc)
	inputSubclassCbk   = windows.NewCallback(inputSubclass)
	panelClassName, _  = windows.UTF16PtrFromString("SilverChat")
	editClass, _       = windows.UTF16PtrFromString("EDIT")
	buttonClass, _     = windows.UTF16PtrFromString("BUTTON")
)

const (
	wsChild        = 0x40000000
	wsVisible      = 0x10000000
	wsVScroll      = 0x00200000
	wsTabStop      = 0x00010000
	wsBorder       = 0x00800000
	wsExCtrlParent = 0x00010000
	esMultiline    = 0x0004
	esAutoVScroll  = 0x0040
	esAutoHScroll  = 0x0080
	esReadOnly     = 0x0800
	bsDefPush      = 0x0001
	emSetSel       = 0x00B1
	emScrollCaret  = 0x00B7
	emSetMargins   = 0x00D3
	emSetCueBanner = 0x1501
	wmSetFont      = 0x0030
	wmCommand      = 0x0111
	wmPaint        = 0x000F
	wmClose        = 0x0010
	wmKeyDown      = 0x0100
	wmChar         = 0x0102
	wmHotkey       = 0x0312
	wmCtlColorEdit = 0x0133
	wmCtlColorStat = 0x0138
	swHide         = 0
	swShow         = 5
	modAlt         = 0x1
	modControl     = 0x2
	modNoRepeat    = 0x4000
	cfUnicodeText  = 13
	gmemMoveable   = 0x2
	idSend         = 1 // IDOK: Invio
	idClose        = 2 // IDCANCEL: Esc
	idCopy         = 3
)

// colori (COLORREF: 0x00BBGGRR)
const (
	crBg     = 0x00211A16 // #161A21
	crField  = 0x002C231E // #1E232C
	crText   = 0x00EFE9E6
	crMuted  = 0x00A6968D
	crAccent = 0x00B0D35F
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
	hwnd, out, in, send, copy, close uintptr
	font, bold                       uintptr
	fieldBrush                       uintptr
	log                              []string // righe della conversazione
	dirty                            bool
	lastAnswer                       string
	scale                            float64
}

func (a *app) createPanel() {
	p := &panel{}
	a.panel = p
	bg, _, _ := pCreateSolidBrush.Call(crBg)
	p.fieldBrush, _, _ = pCreateSolidBrush.Call(crField)
	cursor, _, _ := pLoadCursor.Call(0, idcArrow)
	wc := wndClassEx{WndProc: panelProcCallback, Instance: a.inst, ClassName: panelClassName, Cursor: cursor, Background: bg, Icon: a.tray.Icon, IconSm: a.tray.Icon}
	wc.Size = uint32(unsafe.Sizeof(wc))
	pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	title, _ := windows.UTF16PtrFromString("Chiedi a Silver")
	p.hwnd, _, _ = pCreateWindowEx.Call(wsExTopmost|wsExToolWindow|wsExCtrlParent, uintptr(unsafe.Pointer(panelClassName)), uintptr(unsafe.Pointer(title)), wsPopup|wsBorder, 0, 0, 10, 10, 0, 0, uintptr(a.inst), 0)
	child := func(class *uint16, text string, style, id uintptr) uintptr {
		t, _ := windows.UTF16PtrFromString(text)
		h, _, _ := pCreateWindowEx.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(t)), wsChild|wsVisible|style, 0, 0, 10, 10, p.hwnd, id, uintptr(a.inst), 0)
		return h
	}
	p.out = child(editClass, "", wsVScroll|esMultiline|esReadOnly|esAutoVScroll, 10)
	p.in = child(editClass, "", wsTabStop|esAutoHScroll, 11)
	p.send = child(buttonClass, "Invia", wsTabStop|bsDefPush, idSend)
	p.copy = child(buttonClass, "Copia risposta", wsTabStop, idCopy)
	p.close = child(buttonClass, "✕", wsTabStop, idClose)
	cue, _ := windows.UTF16PtrFromString("Scrivi qui (es. \"ricordami tra 20 minuti di bere\")")
	pSendMessage.Call(p.in, emSetCueBanner, 1, uintptr(unsafe.Pointer(cue)))
	// Invio nella riga: lo intercettiamo noi (IsDialogMessage lo farebbe, ma così funziona sempre)
	pSetWindowSubclass.Call(p.in, inputSubclassCbk, 1, 0)
	p.layout(a.scale)
}

func (p *panel) layout(scale float64) {
	p.scale = scale
	s := func(v float64) int32 { return int32(v * scale) }
	if p.font != 0 {
		pDeleteObject.Call(p.font)
		pDeleteObject.Call(p.bold)
	}
	face, _ := windows.UTF16PtrFromString("Segoe UI")
	p.font, _, _ = pCreateFont.Call(uintptr(-s(15)), 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(face)))
	p.bold, _, _ = pCreateFont.Call(uintptr(-s(15)), 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(face)))
	for _, h := range []uintptr{p.out, p.in, p.send, p.copy, p.close} {
		pSendMessage.Call(h, wmSetFont, p.font, 1)
	}
	m := uintptr(s(6))
	pSendMessage.Call(p.out, emSetMargins, 3, m|m<<16)
	pSendMessage.Call(p.in, emSetMargins, 3, m|m<<16)
	w, h := s(420), s(340)
	move := func(hw uintptr, x, y, cw, ch int32) {
		pMoveWindow.Call(hw, uintptr(x), uintptr(y), uintptr(cw), uintptr(ch), 1)
	}
	move(p.close, w-s(40), s(8), s(30), s(26))
	move(p.copy, w-s(40)-s(118), s(8), s(112), s(26))
	move(p.out, s(12), s(42), w-s(24), h-s(42)-s(56))
	move(p.in, s(12), h-s(44), w-s(24)-s(78), s(30))
	move(p.send, w-s(12)-s(70), h-s(44), s(70), s(30))
}

// show: accanto a Silver, sopra la barra delle applicazioni
func (a *app) showPanel() {
	if a.panel == nil {
		a.createPanel()
	}
	p := a.panel
	if p.scale != a.scale {
		p.layout(a.scale)
	}
	w, h := int32(420*a.scale), int32(340*a.scale)
	x := a.pos.X + int32((winW-8)*a.scale)
	y := a.pos.Y + int32(a.bh) - h - int32(6*a.scale)
	pMoveWindow.Call(p.hwnd, uintptr(x), uintptr(y), uintptr(w), uintptr(h), 1)
	if len(p.log) == 0 {
		p.add("Silver: Dimmi. (Scrivi \"aiuto\" per vedere cosa so fare.)")
	}
	p.flush()
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

// add: una riga nuova nella conversazione
func (p *panel) add(line string) {
	p.log = append(p.log, line)
	if len(p.log) > 200 {
		p.log = p.log[len(p.log)-200:]
	}
	p.dirty = true
}

// appendLast: la risposta che arriva a pezzi
func (p *panel) appendLast(s string) {
	if len(p.log) == 0 {
		p.log = append(p.log, "")
	}
	p.log[len(p.log)-1] += s
	p.dirty = true
}

func (p *panel) setLast(s string) {
	if len(p.log) == 0 {
		p.log = append(p.log, "")
	}
	p.log[len(p.log)-1] = s
	p.dirty = true
}

// flush: aggiorna il testo (al massimo una volta per fotogramma) e va in fondo
func (p *panel) flush() {
	if !p.dirty || p.hwnd == 0 {
		return
	}
	p.dirty = false
	text := strings.ReplaceAll(strings.Join(p.log, "\n\n"), "\r", "")
	text = strings.ReplaceAll(text, "\n", "\r\n")
	t, _ := windows.UTF16PtrFromString(text)
	pSetWindowText.Call(p.out, uintptr(unsafe.Pointer(t)))
	n, _, _ := pGetWindowTextLen.Call(p.out)
	pSendMessage.Call(p.out, emSetSel, n, n)
	pSendMessage.Call(p.out, emScrollCaret, 0, 0)
}

func (p *panel) takeInput() string {
	n, _, _ := pGetWindowTextLen.Call(p.in)
	buf := make([]uint16, n+1)
	pGetWindowText.Call(p.in, uintptr(unsafe.Pointer(&buf[0])), n+1)
	empty, _ := windows.UTF16PtrFromString("")
	pSetWindowText.Call(p.in, uintptr(unsafe.Pointer(empty)))
	return strings.TrimSpace(windows.UTF16ToString(buf))
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
	switch uint32(msg) {
	case wmCommand:
		switch wparam & 0xffff {
		case idSend:
			a.submitPanel()
		case idClose:
			a.hidePanel()
		case idCopy:
			if p.lastAnswer != "" && copyText(hwnd, p.lastAnswer) {
				a.brain.Reply(time.Now(), "Copiato. Incolla dove vuoi.")
			}
		}
		return 0
	case wmClose:
		a.hidePanel()
		return 0
	case wmCtlColorEdit, wmCtlColorStat:
		pSetTextColor.Call(wparam, crText)
		pSetBkColor.Call(wparam, crField)
		return p.fieldBrush
	case wmPaint:
		var ps paintStruct
		dc, _, _ := pBeginPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		pSetBkMode.Call(dc, 1) // trasparente
		pSelectObject.Call(dc, p.bold)
		pSetTextColor.Call(dc, crAccent)
		t := utf16.Encode([]rune("SILVER"))
		pTextOut.Call(dc, uintptr(int32(12*p.scale)), uintptr(int32(12*p.scale)), uintptr(unsafe.Pointer(&t[0])), uintptr(len(t)))
		pSelectObject.Call(dc, p.font)
		pSetTextColor.Call(dc, crMuted)
		t = utf16.Encode([]rune("Ctrl+Alt+S"))
		pTextOut.Call(dc, uintptr(int32(78*p.scale)), uintptr(int32(12*p.scale)), uintptr(unsafe.Pointer(&t[0])), uintptr(len(t)))
		pEndPaint.Call(hwnd, uintptr(unsafe.Pointer(&ps)))
		return 0
	}
	r, _, _ := pDefWindowProc.Call(hwnd, msg, wparam, lparam)
	return r
}
