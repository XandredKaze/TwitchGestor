package main

// Audio suonato dal programma stesso (e non dal motore di Edge): così in Windows, nel mixer e in programmi come
// Elgato Wave Link, la musica compare come "Musicante Player" e si può regolare a parte.
// Il brano si scarica dal Raspberry, si decodifica tutto in memoria (MP3 o WAV) e si suona a 48 kHz.

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"sync"

	"github.com/hajimehoshi/go-mp3"
)

const outRate = 48000

// pcm: audio a 16 bit stereo (in memoria) letto alla frequenza di uscita, con l'interpolazione se serve.
type pcm struct {
	mu      sync.Mutex
	data    []int16 // campioni L,R,L,R…
	rate    int
	outPos  int64 // fotogrammi già consegnati (alla frequenza di uscita)
	frames  int64
	outSize int64 // durata in fotogrammi di uscita
}

func newPCM(data []int16, rate int) *pcm {
	f := int64(len(data) / 2)
	return &pcm{data: data, rate: rate, frames: f, outSize: f * outRate / int64(rate)}
}

func (s *pcm) Read(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for n+4 <= len(p) {
		if s.outPos >= s.outSize {
			if n == 0 {
				return 0, io.EOF
			}
			break
		}
		pos := float64(s.outPos) * float64(s.rate) / outRate
		i := int64(pos)
		frac := pos - float64(i)
		j := i + 1
		if j >= s.frames {
			j = s.frames - 1
		}
		for ch := int64(0); ch < 2; ch++ {
			a := float64(s.data[i*2+ch])
			b := float64(s.data[j*2+ch])
			binary.LittleEndian.PutUint16(p[n+int(ch)*2:], uint16(int16(a+(b-a)*frac)))
		}
		n += 4
		s.outPos++
	}
	return n, nil
}

func (s *pcm) Seek(offset int64, whence int) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var pos int64
	switch whence {
	case io.SeekStart:
		pos = offset / 4
	case io.SeekCurrent:
		pos = s.outPos + offset/4
	case io.SeekEnd:
		pos = s.outSize + offset/4
	}
	if pos < 0 {
		pos = 0
	}
	if pos > s.outSize {
		pos = s.outSize
	}
	s.outPos = pos
	return pos * 4, nil
}

func (s *pcm) delivered() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.outPos
}

// ---------- decodifica ----------

func decodeMP3(b []byte) ([]int16, int, error) {
	d, err := mp3.NewDecoder(bytes.NewReader(b))
	if err != nil {
		return nil, 0, err
	}
	raw, err := io.ReadAll(d)
	if err != nil && len(raw) == 0 {
		return nil, 0, err
	}
	out := make([]int16, len(raw)/2)
	for i := range out {
		out[i] = int16(binary.LittleEndian.Uint16(raw[i*2:]))
	}
	return out, d.SampleRate(), nil
}

// WAV PCM a 16 bit (mono o stereo)
func decodeWAV(b []byte) ([]int16, int, error) {
	if len(b) < 12 || string(b[0:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return nil, 0, errors.New("WAV non valido")
	}
	var channels, bits uint16
	var rate uint32
	for i := 12; i+8 <= len(b); {
		id := string(b[i : i+4])
		size := int(binary.LittleEndian.Uint32(b[i+4:]))
		body := i + 8
		if body+size > len(b) {
			size = len(b) - body
		}
		switch id {
		case "fmt ":
			if size < 16 || binary.LittleEndian.Uint16(b[body:]) != 1 {
				return nil, 0, errors.New("WAV in un formato non supportato (serve PCM)")
			}
			channels = binary.LittleEndian.Uint16(b[body+2:])
			rate = binary.LittleEndian.Uint32(b[body+4:])
			bits = binary.LittleEndian.Uint16(b[body+14:])
		case "data":
			if bits != 16 || (channels != 1 && channels != 2) {
				return nil, 0, errors.New("WAV non supportato (serve 16 bit, mono o stereo)")
			}
			n := size / 2
			out := make([]int16, 0, n*int(3-channels))
			for k := 0; k < n; k++ {
				v := int16(binary.LittleEndian.Uint16(b[body+k*2:]))
				out = append(out, v)
				if channels == 1 {
					out = append(out, v)
				}
			}
			return out, int(rate), nil
		}
		i = body + size + size%2
	}
	return nil, 0, errors.New("WAV senza audio")
}

