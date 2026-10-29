//go:build windows

package main

// Il lettore audio: un'unica uscita audio di Windows (WASAPI) che suona il flusso continuo di stream.go.
// Suonando dal programma (e non dal motore di Edge) la musica compare in Windows e in Wave Link come
// "Musicante Player". I brani si scaricano e si decodificano mentre suonano (pcm.go).

import (
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ebitengine/oto/v3"
)

type engine struct {
	mu      sync.Mutex
	player  *oto.Player
	initErr string
	st      *stream
	volume  float64
}

func newEngine() *engine { return &engine{st: &stream{}, volume: 1} }

// l'uscita audio si crea alla prima canzone e resta aperta (così Windows la vede sempre come la stessa app)
func (e *engine) out() *oto.Player {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.player != nil || e.initErr != "" {
		return e.player
	}
	ctx, ready, err := oto.NewContext(&oto.NewContextOptions{SampleRate: outRate, ChannelCount: 2, Format: oto.FormatSignedInt16LE, BufferSize: 100 * time.Millisecond})
	if err != nil {
		e.initErr = "audio di Windows non disponibile: " + err.Error()
		return nil
	}
	<-ready
	e.player = ctx.NewPlayer(e.st)
	e.player.SetBufferSize(outRate * 4 / 5) // 0,2 s: cambi di brano e spostamenti rapidi
	e.player.SetVolume(e.volume)
	return e.player
}

// svuota il buffer dell'uscita (dopo un cambio di brano scelto a mano o uno spostamento)
func (e *engine) flush() {
	if p := e.out(); p != nil {
		_, _ = p.Seek(0, io.SeekCurrent)
	}
}

var client = http.Client{Transport: &http.Transport{DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext, ResponseHeaderTimeout: 10 * time.Second}}

// avvia lo scaricamento e la decodifica di un brano (in sottofondo)
func startTrack(url string) *track {
	t := &track{url: url, p: newPCM()}
	go func() {
		res, err := client.Get(url)
		if err != nil {
			t.p.finish(errors.New("il Raspberry non risponde"))
			return
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			t.p.finish(errors.New("file non trovato"))
			return
		}
		lower := strings.ToLower(strings.SplitN(url, "?", 2)[0])
		switch {
		case strings.HasSuffix(lower, ".mp3"):
			decodeMP3(res.Body, res.ContentLength, t.p)
		case strings.HasSuffix(lower, ".wav"):
			b, err := io.ReadAll(res.Body)
			if err != nil {
				t.p.finish(errors.New("download interrotto"))
				return
			}
			data, rate, err := decodeWAV(b)
			if err == nil {
				t.p.add(data, rate)
			}
			t.p.finish(err)
		default:
			t.p.finish(errors.New("formato non supportato dal programma (solo MP3 e WAV): aprilo con \"Apri nel browser\""))
		}
	}()
	return t
}

// Load: suona questo brano adesso (scelto a mano). Se è già quello che sta suonando non fa niente.
func (e *engine) Load(url string) {
	if cur, _ := e.st.urls(); cur == url {
		return
	}
	_, next := e.st.urls()
	var t *track
	if next == url {
		e.st.mu.Lock()
		t = e.st.next // già in preparazione: si usa quello
		e.st.mu.Unlock()
	}
	if t == nil {
		t = startTrack(url)
	}
	e.st.setCurrent(t)
	e.flush()
}

// Preload: prepara il brano successivo, che partirà senza pause alla fine di quello attuale
func (e *engine) Preload(url string) {
	cur, next := e.st.urls()
	if url == "" {
		e.st.setNext(nil) // nessun brano dopo (es. "ripeti il brano")
		return
	}
	if url == cur || url == next {
		return
	}
	e.st.setNext(startTrack(url))
}

func (e *engine) Play() {
	if p := e.out(); p != nil {
		p.Play()
	}
}

func (e *engine) Pause() {
	if p := e.out(); p != nil {
		p.Pause()
	}
}

func (e *engine) Seek(sec float64) {
	e.st.seekCurrent(int64(sec * outRate))
	e.flush()
}

func (e *engine) SetVolume(v float64) {
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	e.mu.Lock()
	e.volume = v
	p := e.player
	e.mu.Unlock()
	if p != nil {
		p.SetVolume(v)
	}
}

type audioState struct {
	URL      string  `json:"url"`
	Ready    bool    `json:"ready"`
	Playing  bool    `json:"playing"`
	Ended    bool    `json:"ended"`
	Position float64 `json:"position"`
	Duration float64 `json:"duration"`
	Error    string  `json:"error"`
}

func (e *engine) State() audioState {
	e.mu.Lock()
	p, initErr := e.player, e.initErr
	e.mu.Unlock()
	if initErr != "" {
		return audioState{Error: initErr}
	}
	buffered := int64(0)
	playing := false
	if p != nil {
		buffered = int64(p.BufferedSize() / 4)
		playing = p.IsPlaying()
	}
	t, pos, last := e.st.heard(buffered)
	if t == nil {
		return audioState{}
	}
	total := t.p.total()
	return audioState{
		URL:      t.url,
		Ready:    t.p.ready(),
		Playing:  playing,
		Ended:    last && t.p.ended() && pos >= total,
		Position: float64(pos) / outRate,
		Duration: float64(total) / outRate,
		Error:    t.p.failed(),
	}
}
