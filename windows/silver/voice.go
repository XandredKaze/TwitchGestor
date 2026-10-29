package main

// La voce: il suono (un borbottio di circa 2 secondi) suona a pezzi mentre le parole compaiono nel fumetto.
// È un flusso audio sempre aperto (silenzio quando non parla): così il mixer di Windows vede "Silver" come app.

import (
	"bytes"
	"encoding/binary"
	"io"
	"math/rand"
	"sync"

	"github.com/hajimehoshi/go-mp3"
)

type voice struct {
	mu       sync.Mutex
	pcm      []int16 // 16 bit stereo
	rate     int
	segs     [][2]int // parti con il suono (in fotogrammi), il resto del file è silenzio
	pos, end int
	speaking bool
	gain     float64 // per attaccare e staccare senza "clic"
	rnd      *rand.Rand
}

func newVoice(mp3data []byte) (*voice, error) {
	d, err := mp3.NewDecoder(bytes.NewReader(mp3data))
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(d)
	if err != nil && len(raw) == 0 {
		return nil, err
	}
	pcm := make([]int16, len(raw)/2)
	for i := range pcm {
		pcm[i] = int16(binary.LittleEndian.Uint16(raw[i*2:]))
	}
	// sempre alla stessa frequenza: il flusso audio resta aperto anche quando cambi la voce in Gestor
	v := &voice{pcm: resample(pcm, d.SampleRate(), voiceRate), rate: voiceRate, rnd: rand.New(rand.NewSource(7))}
	frames := len(v.pcm) / 2
	sec := func(s float64) int { return min(frames, int(s*float64(v.rate))) }
	v.segs = [][2]int{{sec(0.08), sec(1.0)}, {sec(1.08), sec(2.0)}}
	return v, nil
}

const voiceRate = 48000

// resample: stereo 16 bit da una frequenza all'altra (interpolazione lineare: per un borbottio basta)
func resample(pcm []int16, from, to int) []int16 {
	if from == to || from <= 0 {
		return pcm
	}
	in := len(pcm) / 2
	out := int(int64(in) * int64(to) / int64(from))
	res := make([]int16, out*2)
	for i := 0; i < out; i++ {
		p := float64(i) * float64(from) / float64(to)
		j := int(p)
		f := p - float64(j)
		k := min(j+1, in-1)
		for c := 0; c < 2; c++ {
			res[i*2+c] = int16(float64(pcm[j*2+c])*(1-f) + float64(pcm[k*2+c])*f)
		}
	}
	return res
}

func (v *voice) SetSpeaking(on bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if on && !v.speaking && v.gain < 0.05 {
		v.jump()
	}
	v.speaking = on
}

// un punto a caso dentro una delle due parti con il suono
func (v *voice) jump() {
	s := v.segs[v.rnd.Intn(len(v.segs))]
	span := s[1] - s[0] - v.rate/4
	if span < 1 {
		span = 1
	}
	v.pos = s[0] + v.rnd.Intn(span)
	v.end = s[1]
}

func (v *voice) Read(p []byte) (int, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	target := 0.0
	if v.speaking {
		target = 1
	}
	step := 1.0 / float64(v.rate/200) // 5 ms per attaccare o staccare
	n := len(p) / 4 * 4
	for i := 0; i < n; i += 4 {
		if v.gain < target {
			v.gain = min(target, v.gain+step)
		} else if v.gain > target {
			v.gain = max(target, v.gain-step)
		}
		var l, r int16
		if v.gain > 0 && v.pos < len(v.pcm)/2 {
			l = int16(float64(v.pcm[v.pos*2]) * v.gain)
			r = int16(float64(v.pcm[v.pos*2+1]) * v.gain)
			v.pos++
			if v.pos >= v.end {
				v.jump()
			}
		}
		binary.LittleEndian.PutUint16(p[i:], uint16(l))
		binary.LittleEndian.PutUint16(p[i+2:], uint16(r))
	}
	for i := n; i < len(p); i++ {
		p[i] = 0
	}
	return len(p), nil
}
