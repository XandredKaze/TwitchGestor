//go:build windows

package main

// Il PC a comando: volume di Windows, screenshot, blocca, spegni/riavvia/sospendi (sempre con conferma),
// chiudi un programma; cartelle e file; la memoria personale.

import (
	"fmt"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	pKeybdEvent     = user32.NewProc("keybd_event")
	pLockWorkStn    = user32.NewProc("LockWorkStation")
	pEnumWindows    = user32.NewProc("EnumWindows")
	pBitBlt         = gdi32.NewProc("BitBlt")
	pDeleteDC       = gdi32.NewProc("DeleteDC")
	enumWindowsCb   = windows.NewCallback(enumWindowsProc)
	enumWindowsList []uintptr
)

func enumWindowsProc(hwnd, _ uintptr) uintptr {
	enumWindowsList = append(enumWindowsList, hwnd)
	return 1
}

// ---------- volume, screenshot, blocco, spegnimento ----------

func pressKey(vk uintptr, times int) {
	for i := 0; i < times; i++ {
		pKeybdEvent.Call(vk, 0, 0, 0)
		pKeybdEvent.Call(vk, 0, 2, 0) // KEYEVENTF_KEYUP
	}
}

const (
	vkVolMute = 0xAD
	vkVolDown = 0xAE
	vkVolUp   = 0xAF
)

func (a *app) pcCmd(c Command) {
	now := time.Now()
	switch c.Text {
	case "volup":
		pressKey(vkVolUp, 5) // ogni tasto = 2%
		a.reply("Volume del PC più alto.")
	case "voldown":
		pressKey(vkVolDown, 5)
		a.reply("Volume del PC più basso.")
	case "volset":
		v, _ := strconv.Atoi(c.Arg)
		v = min(100, max(0, v))
		pressKey(vkVolDown, 50) // a zero, poi su fino al valore
		pressKey(vkVolUp, v/2)
		a.reply(fmt.Sprintf("Volume del PC al %d%%.", v/2*2))
	case "mute":
		pressKey(vkVolMute, 1)
		a.reply("Audio del PC: muto/riattivato.")
	case "screenshot":
		a.screenshot()
	case "lock":
		a.reply("Blocco il PC.")
		go func() { time.Sleep(800 * time.Millisecond); pLockWorkStn.Call() }()
	case "shutdown", "restart", "sleep":
		what := map[string]string{"shutdown": "Spengo il PC", "restart": "Riavvio il PC", "sleep": "Metto il PC in sospensione"}[c.Text]
		a.chat.Add("silver", what+"? Chiudi prima quello che stai facendo.")
		a.brain.Alert(now, what+"? Sicuro?", []Action{{"Sì", "x:power:" + c.Text}, {"No", "x:power:no"}})
	}
}

func (a *app) power(what string) {
	switch what {
	case "shutdown":
		a.reply("Spengo tra 5 secondi. Ci vediamo.")
		_ = exec.Command("shutdown.exe", "/s", "/t", "5").Start()
	case "restart":
		a.reply("Riavvio tra 5 secondi.")
		_ = exec.Command("shutdown.exe", "/r", "/t", "5").Start()
	case "sleep":
		a.reply("Buonanotte, PC.")
		go func() {
			time.Sleep(1500 * time.Millisecond)
			_ = exec.Command("rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0").Start()
		}()
	default:
		a.reply("Va bene, niente.")
	}
}

// screenshot: tutto lo schermo (tutti i monitor), salvato in Immagini\Screenshots
func (a *app) screenshot() {
	x, _, _ := pGetSystemMetrics.Call(76) // SM_XVIRTUALSCREEN
	y, _, _ := pGetSystemMetrics.Call(77)
	w, _, _ := pGetSystemMetrics.Call(78)
	h, _, _ := pGetSystemMetrics.Call(79)
	W, H := int(int32(w)), int(int32(h))
	if W <= 0 || H <= 0 {
		a.reply("Non riesco a fotografare lo schermo.")
		return
	}
	mem, _, _ := pCreateCompatibleDC.Call(a.screenDC)
	bi := bitmapInfoHeader{Width: int32(W), Height: -int32(H), Planes: 1, BitCount: 32}
	bi.Size = uint32(unsafe.Sizeof(bi))
	var bits unsafe.Pointer
	bmp, _, _ := pCreateDIBSection.Call(mem, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	old, _, _ := pSelectObject.Call(mem, bmp)
	// SRCCOPY senza CAPTUREBLT: Silver e il suo fumetto (finestre trasparenti) non finiscono nella foto
	pBitBlt.Call(mem, 0, 0, uintptr(W), uintptr(H), a.screenDC, uintptr(int32(x)), uintptr(int32(y)), 0x00CC0020)
	img := image.NewRGBA(image.Rect(0, 0, W, H))
	src := unsafe.Slice((*byte)(bits), W*H*4)
	for i := 0; i+3 < len(src); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = src[i+2], src[i+1], src[i], 255
	}
	pSelectObject.Call(mem, old)
	pDeleteObject.Call(bmp)
	pDeleteDC.Call(mem)
	dir := filepath.Join(knownFolder("pictures"), "Screenshots")
	_ = os.MkdirAll(dir, 0o755)
	path := filepath.Join(dir, "Silver "+time.Now().Format("2006-01-02 15.04.05")+".png")
	a.brain.Act(time.Now())
	go func() {
		f, err := os.Create(path)
		if err == nil {
			err = png.Encode(f, img)
			f.Close()
		}
		a.post <- func() {
			if err != nil {
				a.reply("Non riesco a salvare lo screenshot: " + err.Error())
				return
			}
			a.lastPath = path
			a.chat.Add("silver", "Screenshot salvato: "+path)
			a.brain.Alert(time.Now(), "Screenshot fatto.", []Action{{"Apri", "x:openlast"}, {"Mostra nella cartella", "x:showlast"}})
		}
	}()
}

// ---------- chiudere un programma ----------

type procWin struct {
	hwnd  uintptr
	pid   uint32
	exe   string // nome del programma (senza .exe)
	title string
}

func visibleWindows() []procWin {
	enumWindowsList = nil
	pEnumWindows.Call(enumWindowsCb, 0)
	names := map[uint32]string{}
	if snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0); err == nil {
		var pe windows.ProcessEntry32
		pe.Size = uint32(unsafe.Sizeof(pe))
		for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
			names[pe.ProcessID] = strings.TrimSuffix(windows.UTF16ToString(pe.ExeFile[:]), ".exe")
		}
		windows.CloseHandle(snap)
	}
	var out []procWin
	for _, hw := range enumWindowsList {
		if v, _, _ := pIsWindowVisible.Call(hw); v == 0 {
			continue
		}
		tb := make([]uint16, 256)
		pGetWindowText.Call(hw, uintptr(unsafe.Pointer(&tb[0])), 256)
		title := windows.UTF16ToString(tb)
		if title == "" || hw == theApp.hwnd || (theApp.panel != nil && hw == theApp.panel.hwnd) {
			continue
		}
		var pid uint32
		pGetWindowThreadPID.Call(hw, uintptr(unsafe.Pointer(&pid)))
		out = append(out, procWin{hw, pid, names[pid], title})
	}
	return out
}

// closeCmd: "chiudi Discord": chiusura gentile (come la ✕); se resta aperto, chiede se chiuderlo del tutto
func (a *app) closeCmd(name string) {
	q := normName(name)
	if al, ok := appAliases[q]; ok {
		q = al
	}
	best, bestS := "", 0
	for _, w := range visibleWindows() {
		if strings.EqualFold(w.exe, "explorer") || strings.EqualFold(w.exe, "Silver") {
			continue
		}
		s := max(appScore(w.exe, q), appScore(w.exe, normName(name)), appScore(w.title, q)-10)
		if s > bestS {
			best, bestS = w.exe, s
		}
	}
	if best == "" {
		a.reply("Non vedo nessuna finestra di \"" + name + "\" aperta.")
		return
	}
	for _, w := range visibleWindows() {
		if strings.EqualFold(w.exe, best) {
			pPostMessage.Call(w.hwnd, wmClose, 0, 0)
		}
	}
	a.brain.Act(time.Now())
	a.reply("Chiudo " + best + ".")
	exe := best
	go func() {
		time.Sleep(4 * time.Second)
		if processRunning(exe + ".exe") {
			a.post <- func() {
				a.closeExe = exe
				a.chat.Add("silver", exe+" è ancora acceso (magari vicino all'orologio).")
				a.brain.Alert(time.Now(), exe+" è ancora acceso. Lo chiudo del tutto?", []Action{{"Sì, chiudi", "x:kill"}, {"Lascia", "x:nokill"}})
			}
		}
	}()
}

func processRunning(exe string) bool {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(snap)
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
		if strings.EqualFold(windows.UTF16ToString(pe.ExeFile[:]), exe) {
			return true
		}
	}
	return false
}

func (a *app) killExe(exe string) {
	cmd := exec.Command("taskkill.exe", "/IM", exe+".exe", "/F")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	if err := cmd.Run(); err != nil {
		a.reply("Non riesco a chiudere " + exe + ".")
		return
	}
	a.reply(exe + " chiuso.")
}

// ---------- cartelle e file ----------

func knownFolder(key string) string {
	id := map[string]*windows.KNOWNFOLDERID{"downloads": windows.FOLDERID_Downloads, "documents": windows.FOLDERID_Documents, "pictures": windows.FOLDERID_Pictures, "videos": windows.FOLDERID_Videos, "music": windows.FOLDERID_Music, "desktop": windows.FOLDERID_Desktop}[key]
	if id != nil {
		if p, err := windows.KnownFolderPath(id, 0); err == nil {
			return p
		}
	}
	return filepath.Join(os.Getenv("USERPROFILE"), map[string]string{"downloads": "Downloads", "documents": "Documents", "pictures": "Pictures", "videos": "Videos", "music": "Music", "desktop": "Desktop"}[key])
}

func (a *app) gestorHost() string {
	if b := a.gestorBase(); b != "" {
		h := strings.TrimPrefix(strings.TrimPrefix(b, "http://"), "https://")
		if i := strings.IndexAny(h, ":/"); i > 0 {
			h = h[:i]
		}
		return h
	}
	return "twitchgestor"
}

func (a *app) folderPath(key string) string {
	switch key {
	case "screenshots":
		return filepath.Join(knownFolder("pictures"), "Screenshots")
	case "recordings":
		if d := obsRecordingDirs(filepath.Join(os.Getenv("APPDATA"), "obs-studio")); len(d) > 0 {
			return d[0]
		}
		return knownFolder("videos")
	case "share":
		return `\\` + a.gestorHost() + `\TwitchGestor`
	case "sharemusic":
		return `\\` + a.gestorHost() + `\TwitchGestor\music`
	case "silver":
		return dataDir()
	}
	return knownFolder(key)
}

func userRoots() []string {
	roots := []string{knownFolder("desktop"), knownFolder("documents"), knownFolder("downloads"), knownFolder("pictures"), knownFolder("videos"), knownFolder("music")}
	if od := os.Getenv("OneDrive"); od != "" {
		roots = append(roots, od)
	}
	return roots
}

func openPath(p string) { openURL(p) }

func showInFolder(p string) { _ = exec.Command("explorer.exe", "/select,", p).Start() }

func (a *app) folderCmd(name string) {
	if k := folderKey(name); k != "" {
		p := a.folderPath(k)
		openPath(p)
		a.brain.Act(time.Now())
		a.reply("Apro " + p + ".")
		return
	}
	a.reply("Cerco la cartella \"" + name + "\"…")
	go func() {
		hits := searchFiles(userRoots(), name, "cartella", 3, 6*time.Second)
		a.post <- func() { a.showHits(name, hits) }
	}()
}

func (a *app) findCmd(query, kind string) {
	if kind == "file" {
		kind = ""
	}
	a.reply("Cerco \"" + query + "\"…")
	go func() {
		hits := searchFiles(userRoots(), query, kind, 5, 8*time.Second)
		a.post <- func() { a.showHits(query, hits) }
	}()
}

// showHits: i risultati della ricerca, con i pulsanti per aprirli
func (a *app) showHits(query string, hits []fileHit) {
	if len(hits) == 0 {
		a.reply("Non trovo niente con \"" + query + "\" nelle tue cartelle (Desktop, Documenti, Download, Immagini, Video, Musica, OneDrive).")
		return
	}
	a.fileHits = hits
	var b strings.Builder
	var acts []Action
	for i, h := range hits {
		b.WriteString("\n• " + h.Path)
		if i < 3 {
			acts = append(acts, Action{"Apri " + strconv.Itoa(i+1), "x:openhit:" + strconv.Itoa(i)})
		}
	}
	a.chat.Add("silver", "Trovati:"+b.String())
	if len(hits) == 1 {
		acts = append(acts, Action{"Mostra nella cartella", "x:showhit:0"})
	}
	a.brain.Alert(time.Now(), fmt.Sprintf("Trovati %d: il primo è %s.", len(hits), filepath.Base(hits[0].Path)), acts)
}

func (a *app) lastFileCmd(what string) {
	var roots []string
	var exts []string
	switch what {
	case "video", "registrazione":
		roots = append(obsRecordingDirs(filepath.Join(os.Getenv("APPDATA"), "obs-studio")), knownFolder("videos"))
		exts = fileKinds["video"]
	case "screenshot":
		roots = []string{filepath.Join(knownFolder("pictures"), "Screenshots"), knownFolder("pictures")}
		exts = fileKinds["foto"]
	case "foto", "immagine":
		roots = []string{knownFolder("pictures")}
		exts = fileKinds["foto"]
	default:
		roots = []string{knownFolder("downloads")}
	}
	go func() {
		p := newestFile(roots, exts)
		a.post <- func() {
			if p == "" {
				a.reply("Non trovo niente.")
				return
			}
			a.lastPath = p
			openPath(p)
			a.brain.Act(time.Now())
			a.reply("Apro " + filepath.Base(p) + ".")
		}
	}()
}

// fileAction: i pulsanti di file e screenshot
func (a *app) fileAction(choice string) bool {
	switch {
	case choice == "x:openlast":
		openPath(a.lastPath)
	case choice == "x:showlast":
		showInFolder(a.lastPath)
	case strings.HasPrefix(choice, "x:openhit:"), strings.HasPrefix(choice, "x:showhit:"):
		i, _ := strconv.Atoi(choice[strings.LastIndex(choice, ":")+1:])
		if i < len(a.fileHits) {
			if strings.HasPrefix(choice, "x:openhit:") {
				openPath(a.fileHits[i].Path)
			} else {
				showInFolder(a.fileHits[i].Path)
			}
		}
	case strings.HasPrefix(choice, "x:power:"):
		a.power(strings.TrimPrefix(choice, "x:power:"))
	case choice == "x:kill":
		a.killExe(a.closeExe)
	case choice == "x:nokill":
	default:
		return false
	}
	return true
}

// ---------- memoria personale ----------

func (a *app) remember(fact string) {
	if fact == "" {
		a.reply("Cosa devo ricordarmi?")
		return
	}
	for _, m := range a.cfg.Memory {
		if strings.EqualFold(m, fact) {
			a.reply("Lo so già.")
			return
		}
	}
	a.cfg.Memory = append(a.cfg.Memory, fact)
	a.cfg.save()
	a.brain.Act(time.Now())
	a.reply(a.pick([]string{"Me lo ricordo.", "Memorizzato.", "Fatto, non me lo scordo."}))
}

func (a *app) memories() {
	if len(a.cfg.Memory) == 0 {
		a.reply("Di te so solo quello che vedo. Dimmi \"ricordati che…\" e me lo tengo.")
		return
	}
	a.reply("Mi ricordo che:\n• " + strings.Join(a.cfg.Memory, "\n• "))
}

func (a *app) forget(what string) {
	if w := normName(what); w == "tutto" || w == "tutto quanto" || w == "tutto di me" {
		n := len(a.cfg.Memory)
		a.cfg.Memory = nil
		a.cfg.save()
		a.reply(fmt.Sprintf("Dimenticate %d cose. Tabula rasa.", n))
		return
	}
	q := strings.Fields(normName(what))
	var keep []string
	removed := 0
	for _, m := range a.cfg.Memory {
		n := normName(m)
		all := len(q) > 0
		for _, w := range q {
			if !strings.Contains(n, w) {
				all = false
				break
			}
		}
		if all {
			removed++
		} else {
			keep = append(keep, m)
		}
	}
	a.cfg.Memory = keep
	a.cfg.save()
	if removed == 0 {
		a.reply("Non trovo niente del genere tra le cose che mi ricordo.")
		return
	}
	a.reply("Dimenticato.")
}
