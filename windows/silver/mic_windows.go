//go:build windows

package main

// Il microfono (waveIn di Windows, 16 kHz mono): registra finché non lo fermi; Level dice quanto è forte
// l'ultimo pezzo (per capire quando hai smesso di parlare).

import (
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	winmm                = windows.NewLazySystemDLL("winmm.dll")
	pWaveInOpen          = winmm.NewProc("waveInOpen")
	pWaveInPrepareHeader = winmm.NewProc("waveInPrepareHeader")
	pWaveInUnprepare     = winmm.NewProc("waveInUnprepareHeader")
	pWaveInAddBuffer     = winmm.NewProc("waveInAddBuffer")
	pWaveInStart         = winmm.NewProc("waveInStart")
	pWaveInReset         = winmm.NewProc("waveInReset")
	pWaveInClose         = winmm.NewProc("waveInClose")
)

type waveFormatEx struct {
	FormatTag      uint16
	Channels       uint16
	SamplesPerSec  uint32
	AvgBytesPerSec uint32
	BlockAlign     uint16
	BitsPerSample  uint16
	Size           uint16
}

type waveHdr struct {
	Data          uintptr
	BufferLength  uint32
	BytesRecorded uint32
	User          uintptr
	Flags         uint32
	Loops         uint32
	Next          uintptr
	Reserved      uintptr
}

const whdrDone = 1

type recorder struct {
	h     uintptr
	hdrs  []*waveHdr
	bufs  [][]byte
	mu    sync.Mutex
	pcm   []int16
	level atomic.Uint64 // float64
	quit  chan struct{}
	done  chan struct{}
}

func startRecorder() (*recorder, error) {
	r := &recorder{quit: make(chan struct{}), done: make(chan struct{})}
	f := waveFormatEx{FormatTag: 1, Channels: 1, SamplesPerSec: micRate, AvgBytesPerSec: micRate * 2, BlockAlign: 2, BitsPerSample: 16}
	if res, _, _ := pWaveInOpen.Call(uintptr(unsafe.Pointer(&r.h)), uintptr(^uint32(0)), uintptr(unsafe.Pointer(&f)), 0, 0, 0); res != 0 {
		return nil, fmt.Errorf("non trovo un microfono (errore %d)", res)
	}
	for i := 0; i < 10; i++ { // 10 pezzi da 100 ms
		buf := make([]byte, micRate*2/10)
		h := &waveHdr{Data: uintptr(unsafe.Pointer(&buf[0])), BufferLength: uint32(len(buf))}
		r.bufs, r.hdrs = append(r.bufs, buf), append(r.hdrs, h)
		pWaveInPrepareHeader.Call(r.h, uintptr(unsafe.Pointer(h)), unsafe.Sizeof(*h))
		pWaveInAddBuffer.Call(r.h, uintptr(unsafe.Pointer(h)), unsafe.Sizeof(*h))
	}
	if res, _, _ := pWaveInStart.Call(r.h); res != 0 {
		r.close()
		return nil, fmt.Errorf("il microfono non parte (errore %d)", res)
	}
	go r.loop()
	return r, nil
}

// take: i pezzi pronti (in ordine), che poi si rimettono in coda
func (r *recorder) take(next *int, requeue bool) {
	for n := 0; n < len(r.hdrs); n++ {
		h := r.hdrs[*next]
		if atomic.LoadUint32(&h.Flags)&whdrDone == 0 {
			return
		}
		got := r.bufs[*next][:h.BytesRecorded]
		pcm := make([]int16, len(got)/2)
		for i := range pcm {
			pcm[i] = int16(uint16(got[2*i]) | uint16(got[2*i+1])<<8)
		}
		r.mu.Lock()
		r.pcm = append(r.pcm, pcm...)
		r.mu.Unlock()
		r.level.Store(math.Float64bits(level(pcm)))
		atomic.StoreUint32(&h.Flags, atomic.LoadUint32(&h.Flags)&^whdrDone)
		h.BytesRecorded = 0
		if requeue {
			pWaveInAddBuffer.Call(r.h, uintptr(unsafe.Pointer(h)), unsafe.Sizeof(*h))
		}
		*next = (*next + 1) % len(r.hdrs)
	}
}

func (r *recorder) loop() {
	defer close(r.done)
	next := 0
	t := time.NewTicker(20 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-r.quit:
			pWaveInReset.Call(r.h) // i pezzi in corso tornano indietro "finiti"
			time.Sleep(30 * time.Millisecond)
			r.take(&next, false)
			r.close()
			return
		case <-t.C:
			r.take(&next, true)
		}
	}
}

func (r *recorder) close() {
	for _, h := range r.hdrs {
		pWaveInUnprepare.Call(r.h, uintptr(unsafe.Pointer(h)), unsafe.Sizeof(*h))
	}
	pWaveInClose.Call(r.h)
}

// Level: quanto è forte quello che senti adesso (0..1)
func (r *recorder) Level() float64 { return math.Float64frombits(r.level.Load()) }

// Stop: ferma e restituisce tutto quello che ha sentito
func (r *recorder) Stop() []int16 {
	close(r.quit)
	<-r.done
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.pcm
}
