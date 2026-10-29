//go:build windows

package main

// Il buongiorno (anche da solo, la prima volta che usi il PC la mattina) e il guardiano che controlla ogni minuto
// live, disco, memoria, processore e le ore di fila.

import (
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	pGlobalMemStatus = kernel32.NewProc("GlobalMemoryStatusEx")
	pGetSystemTimes  = kernel32.NewProc("GetSystemTimes")
	pProcMemInfo     = kernel32.NewProc("K32GetProcessMemoryInfo")
)

type memStatus struct {
	Length                                                                     uint32
	MemoryLoad                                                                 uint32
	TotalPhys, AvailPhys, TotalPage, AvailPage, TotalVirt, AvailVirt, AvailExt uint64
}

type procMemCounters struct {
	Cb                                                 uint32
	PageFaultCount                                     uint32
	PeakWorkingSetSize, WorkingSetSize                 uintptr
	QuotaPeakPagedPoolUsage, QuotaPagedPoolUsage       uintptr
	QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage uintptr
	PagefileUsage, PeakPagefileUsage                   uintptr
}

func ramUsed() int {
	m := memStatus{}
	m.Length = uint32(unsafe.Sizeof(m))
	if r, _, _ := pGlobalMemStatus.Call(uintptr(unsafe.Pointer(&m))); r == 0 {
		return 0
	}
	return int(m.MemoryLoad)
}

// cpuUsed: % di processore dall'ultima volta
func (a *app) cpuUsed() int {
	var idle, kern, user windows.Filetime
	if r, _, _ := pGetSystemTimes.Call(uintptr(unsafe.Pointer(&idle)), uintptr(unsafe.Pointer(&kern)), uintptr(unsafe.Pointer(&user))); r == 0 {
		return 0
	}
	ft := func(f windows.Filetime) uint64 { return uint64(f.HighDateTime)<<32 | uint64(f.LowDateTime) } // sono durate, non date
	i, k, u := ft(idle), ft(kern), ft(user)
	defer func() { a.cpuPrev = [3]uint64{i, k, u} }()
	if a.cpuPrev[1] == 0 {
		return 0
	}
	di, dk, du := i-a.cpuPrev[0], k-a.cpuPrev[1], u-a.cpuPrev[2]
	if dk+du == 0 {
		return 0
	}
	return int(100 * (dk + du - di) / (dk + du)) // il tempo del kernel comprende quello a riposo
}

// topMemProcess: il programma che usa più memoria (solo quando serve: costa un po')
func topMemProcess() string {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(snap)
	sum := map[string]uint64{}
	var pe windows.ProcessEntry32
	pe.Size = uint32(unsafe.Sizeof(pe))
	for err = windows.Process32First(snap, &pe); err == nil; err = windows.Process32Next(snap, &pe) {
		h, err := windows.OpenProcess(processQueryLtd|0x0010, false, pe.ProcessID) // + PROCESS_VM_READ
		if err != nil {
			continue
		}
		var pmc procMemCounters
		pmc.Cb = uint32(unsafe.Sizeof(pmc))
		if r, _, _ := pProcMemInfo.Call(uintptr(h), uintptr(unsafe.Pointer(&pmc)), uintptr(pmc.Cb)); r != 0 {
			sum[strings.TrimSuffix(windows.UTF16ToString(pe.ExeFile[:]), ".exe")] += uint64(pmc.WorkingSetSize)
		}
		windows.CloseHandle(h)
	}
	best, bestN := "", uint64(0)
	for k, v := range sum {
		if v > bestN && !strings.EqualFold(k, "Memory Compression") && !strings.EqualFold(k, "System") {
			best, bestN = k, v
		}
	}
	return best
}

func freeCGB() float64 {
	var free, total, totalFree uint64
	p, _ := windows.UTF16PtrFromString(`C:\`)
	if windows.GetDiskFreeSpaceEx(p, &free, &total, &totalFree) != nil {
		return 0
	}
	return float64(free) / (1 << 30)
}

// tickGuard: ogni minuto
func (a *app) tickGuard(now time.Time) {
	// da quanto stai al PC senza una pausa di almeno 5 minuti
	if idle := a.userIdle(); idle > 5*time.Minute || a.activeSince.IsZero() {
		a.activeSince = now
	}
	a.tickBriefing(now)
	if now.Sub(a.lastGuard) < time.Minute || a.cfg.NoGuard {
		return
	}
	a.lastGuard = now
	in := GuardInput{FreeCGB: freeCGB(), RAM: ramUsed(), CPU: a.cpuUsed(), OBSRunning: processRunning("obs64.exe") || processRunning("obs32.exe") || processRunning("obs.exe"),
		Live: a.brain.Live, InGame: a.brain.Ctx.ID == "game", GameName: a.brain.Ctx.Name, ActiveFor: now.Sub(a.activeSince)}
	if in.RAM >= 90 {
		in.TopProc = topMemProcess()
	}
	if a.feed != nil && a.feed.NextLive != nil {
		n := a.feed.NextLive
		in.NextLive = &struct {
			ID    string
			At    time.Time
			Title string
		}{n.ID, time.UnixMilli(n.At), n.Title}
	}
	for _, m := range a.guard.Check(in, now) {
		a.chat.Add("silver", m.Text)
		if m.Alert || len(m.Actions) > 0 {
			a.brain.Alert(now, m.Text, m.Actions)
		} else if a.brain.Bubble == nil || !a.brain.Bubble.Alert {
			a.brain.Say(now, m.Text, "", "", nil)
		}
	}
}

func (a *app) guardAction(choice string) bool {
	switch choice {
	case "x:guard:obs":
		a.launchCmd("obs")
	case "x:guard:storage":
		openURL("ms-settings:storagesense")
	case "x:guard:no":
	default:
		return false
	}
	return true
}

// ---------- buongiorno ----------

// tickBriefing: la prima volta che usi il PC la mattina (6-12), una volta al giorno
func (a *app) tickBriefing(now time.Time) {
	if a.cfg.NoAutoBriefing || now.Hour() < 6 || now.Hour() >= 12 || a.cfg.LastBriefing == dayKey(now) {
		return
	}
	if now.Sub(a.start) < 40*time.Second || a.userIdle() > 30*time.Second || a.brain.Live || a.brain.Ctx.ID == "game" || a.brain.Bubble != nil {
		return
	}
	a.cfg.LastBriefing = dayKey(now)
	a.cfg.save()
	a.briefing()
}

// weather: il meteo (si riusa per mezz'ora); done riceve nil se la città non è impostata o internet non va
func (a *app) weather(done func(*Weather, error)) {
	if a.cfg.City == "" {
		done(nil, nil)
		return
	}
	if a.wx != nil && time.Since(a.wx.Fetched) < 30*time.Minute {
		done(a.wx, nil)
		return
	}
	city, lat, lon := a.cfg.City, a.cfg.Lat, a.cfg.Lon
	go func() {
		w, err := fetchWeather(city, lat, lon)
		a.post <- func() {
			if err == nil {
				a.wx = w
			}
			done(w, err)
		}
	}()
}

func (a *app) briefing() {
	a.brain.Thinking = "Preparo il riepilogo…"
	a.weather(func(w *Weather, _ error) {
		a.brain.Thinking = ""
		now := time.Now()
		var ag *Agenda
		if a.feed != nil {
			ag = a.feed.Agenda
		}
		text := briefingText(now, w, ag, a.cfg.Reminders, nextLiveText(a.feed, now))
		if a.cfg.City == "" {
			text += "\nPer il meteo dimmi la tua città: \"la mia città è …\"."
		}
		a.reply(text)
	})
}

func (a *app) weatherCmd(tomorrow bool) {
	if a.cfg.City == "" {
		a.reply("Di che città? Dimmi \"la mia città è …\" e da lì in poi lo so.")
		return
	}
	a.weather(func(w *Weather, err error) {
		if w == nil {
			a.reply("Non riesco a sapere il meteo adesso (internet?).")
			return
		}
		a.reply(w.Say(tomorrow))
	})
}

func (a *app) setCity(name string) {
	a.reply("Cerco " + name + "…")
	go func() {
		city, lat, lon, err := geocode(name)
		a.post <- func() {
			if err != nil {
				a.reply("Non trovo \"" + name + "\". Prova con il nome della città più vicina.")
				return
			}
			a.cfg.City, a.cfg.Lat, a.cfg.Lon = city, lat, lon
			a.cfg.save()
			a.wx = nil
			a.weatherCmd(false)
		}
	}()
}
