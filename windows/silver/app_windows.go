//go:build windows

package main

// Silver su Windows: una finestra trasparente sempre in primo piano, appoggiata sopra la barra delle
// applicazioni in basso a sinistra. I pixel trasparenti lasciano passare i clic (finestra "layered" con l'alfa
// per pixel), quindi non blocca mai il desktop. Icona vicino all'orologio con il menu, avvio con Windows.

import (
	"encoding/json"
	"image"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/ebitengine/oto/v3"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	pRegisterClassEx     = user32.NewProc("RegisterClassExW")
	pCreateWindowEx      = user32.NewProc("CreateWindowExW")
	pDefWindowProc       = user32.NewProc("DefWindowProcW")
	pGetMessage          = user32.NewProc("GetMessageW")
	pTranslateMessage    = user32.NewProc("TranslateMessage")
	pDispatchMessage     = user32.NewProc("DispatchMessageW")
	pPostQuitMessage     = user32.NewProc("PostQuitMessage")
	pSetTimer            = user32.NewProc("SetTimer")
	pUpdateLayeredWindow = user32.NewProc("UpdateLayeredWindow")
	pGetDC               = user32.NewProc("GetDC")
	pLoadImage           = user32.NewProc("LoadImageW")
	pLoadCursor          = user32.NewProc("LoadCursorW")
	pSetCursor           = user32.NewProc("SetCursor")
	pGetForegroundWindow = user32.NewProc("GetForegroundWindow")
	pGetWindowThreadPID  = user32.NewProc("GetWindowThreadProcessId")
	pGetWindowText       = user32.NewProc("GetWindowTextW")
	pGetClassName        = user32.NewProc("GetClassNameW")
	pGetWindowRect       = user32.NewProc("GetWindowRect")
	pMonitorFromWindow   = user32.NewProc("MonitorFromWindow")
	pGetMonitorInfo      = user32.NewProc("GetMonitorInfoW")
	pGetLastInputInfo    = user32.NewProc("GetLastInputInfo")
	pSetWindowPos        = user32.NewProc("SetWindowPos")
	pShowWindow          = user32.NewProc("ShowWindow")
	pCreatePopupMenu     = user32.NewProc("CreatePopupMenu")
	pAppendMenu          = user32.NewProc("AppendMenuW")
	pTrackPopupMenu      = user32.NewProc("TrackPopupMenu")
	pDestroyMenu         = user32.NewProc("DestroyMenu")
	pSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	pPostMessage         = user32.NewProc("PostMessageW")
	pTrackMouseEvent     = user32.NewProc("TrackMouseEvent")
	pSystemParametersInf = user32.NewProc("SystemParametersInfoW")
	pGetDpiForWindow     = user32.NewProc("GetDpiForWindow")
	pSetDpiAwarenessCtx  = user32.NewProc("SetProcessDpiAwarenessContext")
	pDestroyWindow       = user32.NewProc("DestroyWindow")
	pGetCursorPos        = user32.NewProc("GetCursorPos")
	pRegisterWindowMsg   = user32.NewProc("RegisterWindowMessageW")
	pMessageBox          = user32.NewProc("MessageBoxW")
	pCreateIconIndirect  = user32.NewProc("CreateIconIndirect")
	pDestroyIcon         = user32.NewProc("DestroyIcon")
	pGetSystemMetrics    = user32.NewProc("GetSystemMetrics")
	pCreateBitmap        = gdi32.NewProc("CreateBitmap")
	pCreateCompatibleDC  = gdi32.NewProc("CreateCompatibleDC")
	pCreateDIBSection    = gdi32.NewProc("CreateDIBSection")
	pSelectObject        = gdi32.NewProc("SelectObject")
	pDeleteObject        = gdi32.NewProc("DeleteObject")
	pShellNotifyIcon     = shell32.NewProc("Shell_NotifyIconW")
	pGetTickCount        = kernel32.NewProc("GetTickCount")
)

const (
	wmDestroy       = 0x0002
	wmSetCursor     = 0x0020
	wmMouseActivate = 0x0021
	wmTimer         = 0x0113
	wmMouseMove     = 0x0200
	wmLButtonUp     = 0x0202
	wmRButtonUp     = 0x0205
	wmMouseLeave    = 0x02A3
	wmDpiChanged    = 0x02E0
	wmApp           = 0x8000
	wmTray          = wmApp + 1
	wmNull          = 0

	wsPopup         = 0x80000000
	wsExLayered     = 0x00080000
	wsExTopmost     = 0x00000008
	wsExToolWindow  = 0x00000080
	wsExNoActivate  = 0x08000000
	swShowNoActive  = 4
	swpNoSize       = 0x0001
	swpNoActivate   = 0x0010
	ulwAlpha        = 2
	maNoActivate    = 3
	idcHand         = 32649
	idcArrow        = 32512
	imageIcon       = 1
	lrDefaultSize   = 0x0040
	lrShared        = 0x8000
	nimAdd          = 0
	nimModify       = 1
	nimDelete       = 2
	nifMessage      = 1
	nifIcon         = 2
	nifTip          = 4
	mfString        = 0
	mfChecked       = 0x8
	mfSeparator     = 0x800
	mfPopup         = 0x10
	tpmReturnCmd    = 0x0100
	tpmRightButton  = 0x0002
	tpmBottomAlign  = 0x0020
	tmeLeave        = 0x2
	spiGetWorkArea  = 0x0030
	monitorNearest  = 2
	processQueryLtd = 0x1000
)

type point struct{ X, Y int32 }
type size struct{ CX, CY int32 }
type rect struct{ L, T, R, B int32 }
type msg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
	Private uint32
}
type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   windows.Handle
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}
type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}
type blendFunction struct{ Op, Flags, Alpha, Format byte }
type iconInfo struct {
	Icon               int32
	XHotspot, YHotspot uint32
	Mask, Color        uintptr
}
type notifyIconData struct {
	Size            uint32
	Wnd             uintptr
	ID              uint32
	Flags           uint32
	CallbackMessage uint32
	Icon            uintptr
	Tip             [128]uint16
	State           uint32
	StateMask       uint32
	Info            [256]uint16
	Version         uint32
	InfoTitle       [64]uint16
	InfoFlags       uint32
	GUID            windows.GUID
	BalloonIcon     uintptr
}
type monitorInfo struct {
	Size    uint32
	Monitor rect
	Work    rect
	Flags   uint32
}
type lastInputInfo struct{ Size, Time uint32 }
type trackMouseEvent struct {
	Size      uint32
	Flags     uint32
	Track     uintptr
	HoverTime uint32
}

// ---------- impostazioni (in %APPDATA%\Silver\config.json) ----------

type config struct {
	Enabled    bool              `json:"enabled"`
	Voice      bool              `json:"voice"`
	Volume     float64           `json:"volume"`
	Chattiness float64           `json:"chattiness"`
	Autostart  bool              `json:"autostart"`
	Games      map[string]string `json:"games"`
	Gestor     string            `json:"gestor"`
	// versioni dell'immagine e della voce già scaricate da Gestor (in %APPDATA%\Silver)
	ImageVer int64 `json:"imageVer"`
	VoiceVer int64 `json:"voiceVer"`
}

func dataDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = "."
	}
	_ = os.MkdirAll(filepath.Join(dir, "Silver"), 0o755)
	return filepath.Join(dir, "Silver")
}

func configPath() string { return filepath.Join(dataDir(), "config.json") }

func loadConfig() config {
	c := config{Enabled: true, Voice: true, Volume: 0.22, Chattiness: 0.4, Autostart: true, Games: map[string]string{}}
	if b, err := os.ReadFile(configPath()); err == nil {
		_ = json.Unmarshal(b, &c)
	}
	if c.Games == nil {
		c.Games = map[string]string{}
	}
	return c
}

func (c config) save() {
	b, _ := json.MarshalIndent(c, "", "  ")
	_ = os.WriteFile(configPath(), b, 0o644)
}

// avvio con Windows: la voce "Silver" in HKCU\...\Run
func setAutostart(on bool) {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Run`, registry.SET_VALUE)
	if err != nil {
		return
	}
	defer k.Close()
	if on {
		exe, _ := os.Executable()
		_ = k.SetStringValue("Silver", `"`+exe+`"`)
	} else {
		_ = k.DeleteValue("Silver")
	}
}

// ---------- il programma ----------

type app struct {
	hwnd      uintptr
	inst      windows.Handle
	cfg       config
	brain     *Brain
	r         *Renderer
	hits      Hits
	start     time.Time
	scale     float64
	pos       point
	memDC     uintptr
	screenDC  uintptr
	bits      unsafe.Pointer
	bmp       uintptr
	bw, bh    int
	tray      notifyIconData
	trayMsg   uint32
	tracking  bool
	lastFg    time.Time
	lastPos   time.Time
	live      atomic.Bool
	voice     *voice
	player    *oto.Player
	otoCtx    *oto.Context
	otoReady  chan struct{}
	post      chan func() // dal filo che parla con Gestor a quello della finestra
	trayIcon  uintptr
	quitAt    time.Time
	hoverHand bool
}

var theApp *app

func main() {
	runtime.LockOSThread()
	// una sola Silver alla volta
	name, _ := windows.UTF16PtrFromString(`Local\SilverCompanion`)
	if _, err := windows.CreateMutex(nil, false, name); err == windows.ERROR_ALREADY_EXISTS {
		return
	}
	pSetDpiAwarenessCtx.Call(^uintptr(3)) // -4: per monitor v2 (schermi con scala diversa)

	a := &app{cfg: loadConfig(), start: time.Now(), post: make(chan func(), 8)}
	theApp = a
	if a.cfg.Autostart {
		setAutostart(true)
	}
	a.brain = NewBrain(time.Now().UnixNano())
	a.brain.Enabled, a.brain.Voice, a.brain.Chattiness = a.cfg.Enabled, a.cfg.Voice, a.cfg.Chattiness
	a.brain.GameChoices = a.cfg.Games
	a.brain.lastSpoke = time.Now() // appena acceso saluta, niente commenti sovrapposti
	a.brain.OnChoicesChanged = func() { a.cfg.Games = a.brain.GameChoices; a.cfg.save() }

	var inst windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &inst)
	a.inst = inst
	cls, _ := windows.UTF16PtrFromString("SilverCompanion")
	cursor, _, _ := pLoadCursor.Call(0, idcArrow)
	icon, _, _ := pLoadImage.Call(uintptr(inst), 1, imageIcon, 0, 0, lrDefaultSize|lrShared)
	wc := wndClassEx{WndProc: windows.NewCallback(wndProc), Instance: inst, ClassName: cls, Cursor: cursor, Icon: icon, IconSm: icon}
	wc.Size = uint32(unsafe.Sizeof(wc))
	pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	title, _ := windows.UTF16PtrFromString("Silver")
	a.hwnd, _, _ = pCreateWindowEx.Call(wsExLayered|wsExTopmost|wsExToolWindow|wsExNoActivate, uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(title)), wsPopup, 0, 0, 10, 10, 0, 0, uintptr(inst), 0)
	if a.hwnd == 0 {
		messageBox("Silver non riesce ad aprire la sua finestra.")
		return
	}
	a.screenDC, _, _ = pGetDC.Call(0)
	a.memDC, _, _ = pCreateCompatibleDC.Call(a.screenDC)
	a.scale = a.dpiScale()
	a.r = NewRenderer(a.scale)
	a.place()
	pShowWindow.Call(a.hwnd, swShowNoActive)

	// icona vicino all'orologio (si rimette se Esplora risorse si riavvia)
	tbc, _ := windows.UTF16PtrFromString("TaskbarCreated")
	m, _, _ := pRegisterWindowMsg.Call(uintptr(unsafe.Pointer(tbc)))
	a.trayMsg = uint32(m)
	a.tray = notifyIconData{Wnd: a.hwnd, ID: 1, Flags: nifMessage | nifIcon | nifTip, CallbackMessage: wmTray, Icon: icon}
	a.tray.Size = uint32(unsafe.Sizeof(a.tray))
	copy(a.tray.Tip[:], windows.StringToUTF16("Silver"))
	pShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&a.tray)))

	// la voce: un flusso audio sempre aperto (il mixer di Windows vede "Silver"); il suono arriva da Gestor
	if ctx, ready, err := oto.NewContext(&oto.NewContextOptions{SampleRate: voiceRate, ChannelCount: 2, Format: oto.FormatSignedInt16LE, BufferSize: 60 * time.Millisecond}); err == nil {
		a.otoCtx, a.otoReady = ctx, make(chan struct{})
		go func() { <-ready; close(a.otoReady) }()
	}

	// immagine e voce già scaricate le altre volte (restano sul PC: Silver funziona anche a Raspberry spento)
	if b, err := os.ReadFile(filepath.Join(dataDir(), "image.bin")); err == nil {
		a.applyImage(b)
	}
	if b, err := os.ReadFile(filepath.Join(dataDir(), "voice.mp3")); err == nil {
		a.applyVoice(b)
	}

	go a.watchGestor()
	a.brain.later(time.Now(), 1200*time.Millisecond, func(now time.Time) {
		if a.r.HasSprite() {
			a.brain.Say(now, greeting, "", "", nil)
		} else {
			a.brain.Say(now, needArt, "", "", nil)
		}
	})
	pSetTimer.Call(a.hwnd, 1, 33, 0)

	var m2 msg
	for {
		r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&m2)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		pTranslateMessage.Call(uintptr(unsafe.Pointer(&m2)))
		pDispatchMessage.Call(uintptr(unsafe.Pointer(&m2)))
	}
}

func messageBox(text string) {
	t, _ := windows.UTF16PtrFromString(text)
	c, _ := windows.UTF16PtrFromString("Silver")
	pMessageBox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x40)
}

func (a *app) dpiScale() float64 {
	if dpi, _, _ := pGetDpiForWindow.Call(a.hwnd); dpi > 0 {
		return float64(dpi) / 96
	}
	return 1
}

// in basso a sinistra, appoggiata sopra la barra delle applicazioni (dello schermo principale)
func (a *app) place() {
	var wa rect
	pSystemParametersInf.Call(spiGetWorkArea, 0, uintptr(unsafe.Pointer(&wa)), 0)
	w, h := int(winW*a.scale), int(winH*a.scale)
	a.pos = point{wa.L, wa.B - int32(h)}
	if a.bw != w || a.bh != h {
		if a.bmp != 0 {
			pDeleteObject.Call(a.bmp)
		}
		bi := bitmapInfoHeader{Width: int32(w), Height: -int32(h), Planes: 1, BitCount: 32}
		bi.Size = uint32(unsafe.Sizeof(bi))
		var bits unsafe.Pointer
		a.bmp, _, _ = pCreateDIBSection.Call(a.memDC, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
		pSelectObject.Call(a.memDC, a.bmp)
		a.bits, a.bw, a.bh = bits, w, h
	}
	pSetWindowPos.Call(a.hwnd, ^uintptr(0), uintptr(a.pos.X), uintptr(a.pos.Y), 0, 0, swpNoSize|swpNoActivate) // sempre in primo piano
}

func (a *app) userIdle() time.Duration {
	li := lastInputInfo{Size: 8}
	pGetLastInputInfo.Call(uintptr(unsafe.Pointer(&li)))
	now, _, _ := pGetTickCount.Call()
	return time.Duration(uint32(now)-li.Time) * time.Millisecond
}

// cosa c'è in primo piano
func (a *app) foreground() Context {
	fg, _, _ := pGetForegroundWindow.Call()
	if fg == 0 || fg == a.hwnd {
		return a.brain.Ctx
	}
	var pid uint32
	pGetWindowThreadPID.Call(fg, uintptr(unsafe.Pointer(&pid)))
	exe := ""
	if h, err := windows.OpenProcess(processQueryLtd, false, pid); err == nil {
		buf := make([]uint16, 1024)
		n := uint32(len(buf))
		if windows.QueryFullProcessImageName(h, 0, &buf[0], &n) == nil {
			exe = windows.UTF16ToString(buf[:n])
		}
		windows.CloseHandle(h)
	}
	tb := make([]uint16, 512)
	pGetWindowText.Call(fg, uintptr(unsafe.Pointer(&tb[0])), uintptr(len(tb)))
	cb := make([]uint16, 256)
	pGetClassName.Call(fg, uintptr(unsafe.Pointer(&cb[0])), uintptr(len(cb)))
	var wr rect
	pGetWindowRect.Call(fg, uintptr(unsafe.Pointer(&wr)))
	mon, _, _ := pMonitorFromWindow.Call(fg, monitorNearest)
	mi := monitorInfo{}
	mi.Size = uint32(unsafe.Sizeof(mi))
	pGetMonitorInfo.Call(mon, uintptr(unsafe.Pointer(&mi)))
	full := wr.L <= mi.Monitor.L && wr.T <= mi.Monitor.T && wr.R >= mi.Monitor.R && wr.B >= mi.Monitor.B
	return classify(exe, windows.UTF16ToString(tb), windows.UTF16ToString(cb), full)
}

// da Gestor: sei in live? E l'immagine o la voce sono cambiate? (ogni 20 secondi; se Gestor non risponde resta com'era)
func (a *app) watchGestor() {
	tries := []string{"http://twitchgestor:3000", "http://twitchgestor.local:3000"}
	if a.cfg.Gestor != "" {
		tries = append([]string{a.cfg.Gestor}, tries...)
	}
	client := http.Client{Timeout: 4 * time.Second}
	imageVer, voiceVer := a.cfg.ImageVer, a.cfg.VoiceVer // (letti qui: la configurazione la tocca solo la finestra)
	for {
		for _, base := range tries {
			res, err := client.Get(base + "/silver/state")
			if err != nil {
				continue
			}
			var st struct {
				Live   bool `json:"live"`
				Assets struct {
					Image int64 `json:"image"`
					Voice int64 `json:"voice"`
				} `json:"assets"`
			}
			_ = json.NewDecoder(res.Body).Decode(&st)
			res.Body.Close()
			a.live.Store(st.Live)
			tries = []string{base} // trovato: si resta su questo
			if v := st.Assets.Image; v != 0 && v != imageVer {
				if b := download(base + "/silver/asset/image"); b != nil {
					imageVer = v
					a.post <- func() {
						first := !a.r.HasSprite()
						if a.applyImage(b) {
							_ = os.WriteFile(filepath.Join(dataDir(), "image.bin"), b, 0o644)
							a.cfg.ImageVer = v
							a.cfg.save()
							if first {
								a.brain.Say(time.Now(), gotArt, "", "", nil)
							}
						}
					}
				}
			}
			if v := st.Assets.Voice; v != 0 && v != voiceVer {
				if b := download(base + "/silver/asset/voice"); b != nil {
					voiceVer = v
					a.post <- func() {
						if a.applyVoice(b) {
							_ = os.WriteFile(filepath.Join(dataDir(), "voice.mp3"), b, 0o644)
							a.cfg.VoiceVer = v
							a.cfg.save()
						}
					}
				}
			}
			break
		}
		time.Sleep(20 * time.Second)
	}
}

func download(url string) []byte {
	client := http.Client{Timeout: 60 * time.Second}
	res, err := client.Get(url)
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, 20<<20))
	if err != nil {
		return nil
	}
	return b
}

// applyImage: la nuova immagine di Silver (anche nell'icona vicino all'orologio)
func (a *app) applyImage(b []byte) bool {
	img, err := decodeImage(b)
	if err != nil {
		return false
	}
	a.r.SetSprite(img)
	a.setTrayFace(img)
	return true
}

// applyVoice: il nuovo suono (il flusso audio resta lo stesso, cambia solo cosa ci suona)
func (a *app) applyVoice(b []byte) bool {
	v, err := newVoice(b)
	if err != nil || a.otoCtx == nil {
		return false
	}
	old := a.player
	a.voice = v
	go func() {
		<-a.otoReady
		p := a.otoCtx.NewPlayer(v)
		p.SetBufferSize(v.rate * 4 / 20)
		p.SetVolume(a.cfg.Volume)
		p.Play()
		a.post <- func() {
			a.player = p
			if old != nil {
				_ = old.Close()
			}
		}
	}()
	return true
}

// setTrayFace: l'icona vicino all'orologio diventa la faccia di Silver (un cerchio ritagliato dall'immagine)
func (a *app) setTrayFace(img image.Image) {
	n, _, _ := pGetSystemMetrics.Call(49) // SM_CXSMICON
	if n == 0 {
		n = 16
	}
	px := faceIcon(img, int(n)*2) // il doppio: Windows lo rimpicciolisce bene
	w := int(n) * 2
	var bits unsafe.Pointer
	bi := bitmapInfoHeader{Width: int32(w), Height: -int32(w), Planes: 1, BitCount: 32}
	bi.Size = uint32(unsafe.Sizeof(bi))
	hbm, _, _ := pCreateDIBSection.Call(a.screenDC, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if hbm == 0 {
		return
	}
	dst := unsafe.Slice((*byte)(bits), w*w*4)
	for i := 0; i+3 < len(px.Pix) && i+3 < len(dst); i += 4 { // RGBA → BGRA (non premoltiplicato, come vogliono le icone)
		dst[i], dst[i+1], dst[i+2], dst[i+3] = px.Pix[i+2], px.Pix[i+1], px.Pix[i], px.Pix[i+3]
	}
	mask, _, _ := pCreateBitmap.Call(uintptr(w), uintptr(w), 1, 1, 0)
	ii := iconInfo{Icon: 1, Mask: mask, Color: hbm}
	icon, _, _ := pCreateIconIndirect.Call(uintptr(unsafe.Pointer(&ii)))
	pDeleteObject.Call(hbm)
	pDeleteObject.Call(mask)
	if icon == 0 {
		return
	}
	a.tray.Icon = icon
	a.tray.Flags = nifMessage | nifIcon | nifTip
	pShellNotifyIcon.Call(nimModify, uintptr(unsafe.Pointer(&a.tray)))
	if a.trayIcon != 0 {
		pDestroyIcon.Call(a.trayIcon)
	}
	a.trayIcon = icon
}

func (a *app) tick() {
	now := time.Now()
	for done := false; !done; {
		select {
		case f := <-a.post:
			f()
		default:
			done = true
		}
	}
	if !a.quitAt.IsZero() && now.After(a.quitAt) {
		pDestroyWindow.Call(a.hwnd)
		return
	}
	if now.Sub(a.lastFg) > 400*time.Millisecond {
		a.lastFg = now
		a.brain.SetContext(now, a.foreground())
		a.brain.SetLive(now, a.live.Load())
	}
	if now.Sub(a.lastPos) > 3*time.Second { // la barra delle applicazioni si può spostare o nascondere
		a.lastPos = now
		a.place()
	}
	a.brain.Tick(now, a.userIdle())
	if a.voice != nil {
		a.voice.SetSpeaking(a.brain.Speaking())
	}
	img, hits := a.r.Render(now, now.Sub(a.start).Seconds(), a.brain)
	a.hits = hits
	// RGBA (già premoltiplicato) → BGRA della bitmap di Windows
	dst := unsafe.Slice((*byte)(a.bits), a.bw*a.bh*4)
	src := img.Pix
	for i := 0; i+3 < len(src) && i+3 < len(dst); i += 4 {
		dst[i], dst[i+1], dst[i+2], dst[i+3] = src[i+2], src[i+1], src[i], src[i+3]
	}
	sz := size{int32(a.bw), int32(a.bh)}
	zero := point{}
	bf := blendFunction{Op: 0, Alpha: 255, Format: 1}
	pUpdateLayeredWindow.Call(a.hwnd, a.screenDC, uintptr(unsafe.Pointer(&a.pos)), uintptr(unsafe.Pointer(&sz)), a.memDC, uintptr(unsafe.Pointer(&zero)), 0, uintptr(unsafe.Pointer(&bf)), ulwAlpha)
}

func (a *app) clickAt(x, y float64) {
	now := time.Now()
	h := a.hits
	for i, b := range h.Buttons {
		if b.has(x, y) {
			a.brain.Choose(now, i)
			return
		}
	}
	switch {
	case h.Remember.w > 0 && h.Remember.has(x, y):
		a.brain.ToggleRemember()
	case h.Bubble.w > 0 && h.Bubble.has(x, y):
		a.brain.ClickBubble()
	case h.Silver.has(x, y):
		a.brain.ClickSilver(now)
	}
}

func (a *app) clickable(x, y float64) bool {
	h := a.hits
	for _, b := range h.Buttons {
		if b.has(x, y) {
			return true
		}
	}
	return (h.Remember.w > 0 && h.Remember.has(x, y)) || h.Silver.has(x, y)
}

// il menu dell'icona vicino all'orologio
func (a *app) menu() {
	const (
		cmdEnabled = 1 + iota
		cmdVoice
		cmdTalk
		cmdAutostart
		cmdForget
		cmdLittle
		cmdNormal
		cmdLots
		cmdQuit
	)
	check := func(on bool) uintptr {
		if on {
			return mfChecked
		}
		return 0
	}
	add := func(m uintptr, flags uintptr, id uintptr, text string) {
		t, _ := windows.UTF16PtrFromString(text)
		pAppendMenu.Call(m, flags, id, uintptr(unsafe.Pointer(t)))
	}
	sub, _, _ := pCreatePopupMenu.Call()
	add(sub, check(a.cfg.Chattiness < 0.3), cmdLittle, "Poco")
	add(sub, check(a.cfg.Chattiness >= 0.3 && a.cfg.Chattiness < 0.6), cmdNormal, "Normale")
	add(sub, check(a.cfg.Chattiness >= 0.6), cmdLots, "Tanto")
	m, _, _ := pCreatePopupMenu.Call()
	add(m, check(a.cfg.Enabled), cmdEnabled, "Silver attivo")
	add(m, check(a.cfg.Voice), cmdVoice, "Voce")
	add(m, mfPopup, sub, "Quanto parla da solo")
	add(m, mfSeparator, 0, "")
	add(m, 0, cmdTalk, "Dimmi qualcosa")
	add(m, check(a.cfg.Autostart), cmdAutostart, "Avvia con Windows")
	if len(a.cfg.Games) > 0 {
		add(m, 0, cmdForget, "Dimentica le scelte sui giochi")
	}
	add(m, mfSeparator, 0, "")
	add(m, 0, cmdQuit, "Esci")
	var pt point
	pGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	pSetForegroundWindow.Call(a.hwnd)
	cmd, _, _ := pTrackPopupMenu.Call(m, tpmReturnCmd|tpmRightButton|tpmBottomAlign, uintptr(pt.X), uintptr(pt.Y), 0, a.hwnd, 0)
	pPostMessage.Call(a.hwnd, wmNull, 0, 0)
	pDestroyMenu.Call(m)
	now := time.Now()
	switch cmd {
	case cmdEnabled:
		a.cfg.Enabled = !a.cfg.Enabled
		a.brain.SetEnabled(a.cfg.Enabled)
	case cmdVoice:
		a.cfg.Voice = !a.cfg.Voice
		a.brain.Voice = a.cfg.Voice
	case cmdTalk:
		if !a.cfg.Enabled {
			a.cfg.Enabled = true
			a.brain.SetEnabled(true)
		}
		a.brain.GameMode = "talk"
		a.brain.Talk(now, true)
	case cmdAutostart:
		a.cfg.Autostart = !a.cfg.Autostart
		setAutostart(a.cfg.Autostart)
	case cmdForget:
		a.cfg.Games = map[string]string{}
		a.brain.GameChoices = a.cfg.Games
	case cmdLittle, cmdNormal, cmdLots:
		a.cfg.Chattiness = map[uintptr]float64{cmdLittle: 0.15, cmdNormal: 0.4, cmdLots: 0.75}[cmd]
		a.brain.Chattiness = a.cfg.Chattiness
	case cmdQuit:
		a.brain.GameMode = "talk"
		a.brain.Say(now, bye, "", "", nil)
		a.quitAt = now.Add(1800 * time.Millisecond)
	}
	if cmd != 0 {
		a.cfg.save()
	}
}

func wndProc(hwnd, message, wparam, lparam uintptr) uintptr {
	a := theApp
	if a == nil || a.hwnd == 0 {
		r, _, _ := pDefWindowProc.Call(hwnd, message, wparam, lparam)
		return r
	}
	x := float64(int16(lparam & 0xffff))
	y := float64(int16((lparam >> 16) & 0xffff))
	switch uint32(message) {
	case wmTimer:
		a.tick()
		return 0
	case wmMouseActivate:
		return maNoActivate // cliccarlo non toglie il fuoco al programma che stai usando
	case wmMouseMove:
		if !a.tracking {
			tme := trackMouseEvent{Flags: tmeLeave, Track: hwnd}
			tme.Size = uint32(unsafe.Sizeof(tme))
			pTrackMouseEvent.Call(uintptr(unsafe.Pointer(&tme)))
			a.tracking = true
		}
		a.r.Hover = a.hits.Silver.has(x, y)
		a.hoverHand = a.clickable(x, y)
		return 0
	case wmMouseLeave:
		a.tracking, a.r.Hover, a.hoverHand = false, false, false
		return 0
	case wmSetCursor:
		if a.hoverHand {
			c, _, _ := pLoadCursor.Call(0, idcHand)
			pSetCursor.Call(c)
			return 1
		}
	case wmLButtonUp:
		a.clickAt(x, y)
		return 0
	case wmDpiChanged:
		a.scale = float64(wparam&0xffff) / 96
		a.r.SetScale(a.scale)
		a.place()
		return 0
	case wmTray:
		if l := uint32(lparam & 0xffff); l == wmLButtonUp || l == wmRButtonUp {
			a.menu()
		}
		return 0
	case wmDestroy:
		pShellNotifyIcon.Call(nimDelete, uintptr(unsafe.Pointer(&a.tray)))
		pPostQuitMessage.Call(0)
		return 0
	}
	if a.trayMsg != 0 && uint32(message) == a.trayMsg { // Esplora risorse riavviato: si rimette l'icona
		pShellNotifyIcon.Call(nimAdd, uintptr(unsafe.Pointer(&a.tray)))
	}
	r, _, _ := pDefWindowProc.Call(hwnd, message, wparam, lparam)
	return r
}
