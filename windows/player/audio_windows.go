//go:build windows

package main

// Il lettore audio: suona (con l'audio di Windows) i brani decodificati da pcm.go.

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ebitengine/oto/v3"
)

// ---------- il lettore ----------

type engine struct {
	mu       sync.Mutex
	ctx      *oto.Context
	ctxErr   error
	gen      int
	player   *oto.Player
	src      *pcm
	loading  bool
	err      string
	duration float64
	wantPlay bool
	seekTo   float64 // posizione da raggiungere appena il brano è pronto (-1 = nessuna)
	volume   float64
	ended    bool
}

func newEngine() *engine { return &engine{volume: 1, seekTo: -1} }

func (e *engine) context() (*oto.Context, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.ctx != nil || e.ctxErr != nil {
		return e.ctx, e.ctxErr
	}
	ctx, ready, err := oto.NewContext(&oto.NewContextOptions{SampleRate: outRate, ChannelCount: 2, Format: oto.FormatSignedInt16LE, BufferSize: 150 * time.Millisecond})
	if err != nil {
		e.ctxErr = fmt.Errorf("audio di Windows non disponibile: %w", err)
		return nil, e.ctxErr
	}
	<-ready
	e.ctx = ctx
	return ctx, nil
}

// Load scarica e prepara un brano; ritorna subito (la pagina segue lo stato con State).
func (e *engine) Load(url string) {
	e.mu.Lock()
	e.gen++
	gen := e.gen
	if e.player != nil {
		e.player.Pause()
		_ = e.player.Close()
		e.player = nil
	}
	e.src = nil
	e.loading, e.err, e.duration, e.ended, e.seekTo = true, "", 0, false, -1
	e.mu.Unlock()

	go func() {
		fail := func(msg string) {
			e.mu.Lock()
			if e.gen == gen {
				e.loading, e.err = false, msg
			}
			e.mu.Unlock()
		}
		ctx, err := e.context()
		if err != nil {
			fail(err.Error())
			return
		}
		client := http.Client{Timeout: 2 * time.Minute}
		res, err := client.Get(url)
		if err != nil {
			fail("il Raspberry non risponde")
			return
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			fail(fmt.Sprintf("file non trovato (%d)", res.StatusCode))
			return
		}
		b, err := io.ReadAll(res.Body)
		if err != nil {
			fail("download interrotto")
			return
		}
		var data []int16
		var rate int
		lower := strings.ToLower(strings.SplitN(url, "?", 2)[0])
		switch {
		case strings.HasSuffix(lower, ".mp3"):
			data, rate, err = decodeMP3(b)
		case strings.HasSuffix(lower, ".wav"):
			data, rate, err = decodeWAV(b)
		default:
			err = errors.New("formato non supportato dal programma (solo MP3 e WAV): aprilo con \"Apri nel browser\"")
		}
		if err == nil && (rate <= 0 || len(data) < 4) {
			err = errors.New("file audio vuoto")
		}
		if err != nil {
			fail(err.Error())
			return
		}
		src := newPCM(data, rate)
		e.mu.Lock()
		defer e.mu.Unlock()
		if e.gen != gen {
			return // nel frattempo è stato scelto un altro brano
		}
		e.src = src
		e.duration = float64(src.outSize) / outRate
		e.player = ctx.NewPlayer(src)
		e.player.SetVolume(e.volume)
		if e.seekTo > 0 {
			_, _ = e.player.Seek(int64(e.seekTo*outRate)*4, io.SeekStart)
		}
		e.seekTo = -1
		e.loading = false
		if e.wantPlay {
			e.player.Play()
		}
	}()
}

func (e *engine) Play() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.wantPlay = true
	e.ended = false
	if e.player != nil {
		e.player.Play()
	}
}

func (e *engine) Pause() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.wantPlay = false
	if e.player != nil {
		e.player.Pause()
	}
}

func (e *engine) Seek(sec float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if sec < 0 {
		sec = 0
	}
	e.ended = false
	if e.player == nil {
		e.seekTo = sec
		return
	}
	_, _ = e.player.Seek(int64(sec*outRate)*4, io.SeekStart)
	if e.wantPlay && !e.player.IsPlaying() {
		e.player.Play()
	}
}

func (e *engine) SetVolume(v float64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	e.volume = v
	if e.player != nil {
		e.player.SetVolume(v)
	}
}

type audioState struct {
	Loading  bool    `json:"loading"`
	Ready    bool    `json:"ready"`
	Playing  bool    `json:"playing"`
	Ended    bool    `json:"ended"`
	Position float64 `json:"position"`
	Duration float64 `json:"duration"`
	Error    string  `json:"error"`
}

func (e *engine) State() audioState {
	e.mu.Lock()
	defer e.mu.Unlock()
	st := audioState{Loading: e.loading, Error: e.err, Duration: e.duration, Ready: e.player != nil}
	if e.player == nil {
		return st
	}
	pos := float64(e.src.delivered()*4-int64(e.player.BufferedSize())) / 4 / outRate
	if pos < 0 {
		pos = 0
	}
	st.Position = pos
	st.Playing = e.player.IsPlaying()
	// finito: stava suonando, ora è fermo ed è arrivato in fondo
	if e.wantPlay && !st.Playing && e.src.delivered() >= e.src.outSize {
		e.ended = true
		e.wantPlay = false
	}
	st.Ended = e.ended
	if st.Ended {
		st.Position = e.duration
	}
	return st
}
