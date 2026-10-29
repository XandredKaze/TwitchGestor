package main

// Audio dei brani in memoria (16 bit stereo), riempito mentre si scarica e si decodifica: così un brano parte
// subito, senza aspettare il file intero. In uscita si legge sempre a 48 kHz (con l'interpolazione se serve).

import (
	"encoding/binary"
	"errors"
	"io"
	"sync"

	"github.com/hajimehoshi/go-mp3"
)

const outRate = 48000

type pcm struct {
	mu     sync.Mutex
	data   []int16 // campioni L,R,L,R… alla frequenza del file
	rate   int
	done   bool  // decodifica finita
	err    string
	outPos int64 // prossimo fotogramma (a 48 kHz) da consegnare
	est    int64 // durata stimata in fotogrammi a 48 kHz (finché la decodifica non è finita)
}

func newPCM() *pcm { return &pcm{} }

// aggiunta di audio decodificato (dal goroutine che scarica)
func (s *pcm) add(samples []int16, rate int) {
	s.mu.Lock()
	s.rate = rate
	s.data = append(s.data, samples...)
	s.mu.Unlock()
}

func (s *pcm) finish(err error) {
	s.mu.Lock()
	s.done = true
	if err != nil && len(s.data) < 4 {
		s.err = err.Error()
	}
	s.mu.Unlock()
}

func (s *pcm) setEstimate(frames int64) {
	s.mu.Lock()
	s.est = frames
	s.mu.Unlock()
}

// fotogrammi in uscita già disponibili (serve anche il fotogramma dopo, per l'interpolazione)
func (s *pcm) availLocked() int64 {
	if s.rate == 0 {
		return 0
	}
	frames := int64(len(s.data) / 2)
	if s.done {
		return frames * outRate / int64(s.rate)
	}
	if frames < 2 {
		return 0
	}
	return (frames - 1) * outRate / int64(s.rate)
}

// durata in fotogrammi a 48 kHz: esatta a decodifica finita, altrimenti stimata
func (s *pcm) total() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.availLocked()
	if s.done || s.est < a {
		return a
	}
	return s.est
}

func (s *pcm) ready() bool { s.mu.Lock(); defer s.mu.Unlock(); return s.availLocked() > 0 || s.err != "" }

// finito: tutto decodificato e tutto consegnato
func (s *pcm) ended() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return (s.done || s.err != "") && s.outPos >= s.availLocked()
}

func (s *pcm) position() int64 { s.mu.Lock(); defer s.mu.Unlock(); return s.outPos }

func (s *pcm) failed() string { s.mu.Lock(); defer s.mu.Unlock(); return s.err }

// readInto riempie p con l'audio disponibile; ritorna i byte scritti (0 se non c'è ancora niente o è finito)
func (s *pcm) readInto(p []byte) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	avail := s.availLocked()
	frames := int64(len(s.data) / 2)
	n := 0
	for n+4 <= len(p) && s.outPos < avail {
		pos := float64(s.outPos) * float64(s.rate) / outRate
		i := int64(pos)
		frac := pos - float64(i)
		j := i + 1
		if j >= frames {
			j = frames - 1
		}
		for ch := int64(0); ch < 2; ch++ {
			a := float64(s.data[i*2+ch])
			b := float64(s.data[j*2+ch])
			binary.LittleEndian.PutUint16(p[n+int(ch)*2:], uint16(int16(a+(b-a)*frac)))
		}
		n += 4
		s.outPos++
	}
	return n
}

// seek a un fotogramma (a 48 kHz); oltre la parte già decodificata si ferma lì
func (s *pcm) seek(frame int64) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	if frame < 0 {
		frame = 0
	}
	if a := s.availLocked(); frame > a {
		frame = a
	}
	s.outPos = frame
	return frame
}

// ---------- decodifica ----------

// conta i byte letti (per stimare la durata finché la decodifica non è finita)
type counter struct {
	r io.Reader
	n int64
}

func (c *counter) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

// decodeMP3 decodifica a pezzi da r (anche mentre si scarica) dentro s. size: byte del file (0 se non noto).
func decodeMP3(r io.Reader, size int64, s *pcm) {
	c := &counter{r: r}
	d, err := mp3.NewDecoder(c)
	if err != nil {
		s.finish(errors.New("MP3 non leggibile"))
		return
	}
	rate := d.SampleRate()
	buf := make([]byte, 64*1024)
	var got int64 // fotogrammi decodificati
	for {
		n, err := d.Read(buf)
		if n > 0 {
			n -= n % 4
			samples := make([]int16, n/2)
			for i := range samples {
				samples[i] = int16(binary.LittleEndian.Uint16(buf[i*2:]))
			}
			s.add(samples, rate)
			got += int64(n / 4)
			if size > 0 && c.n > 0 {
				s.setEstimate(got * size / c.n * outRate / int64(rate))
			}
		}
		if err != nil {
			if err == io.EOF {
				err = nil
			}
			s.finish(err)
			return
		}
	}
}

// decodeWAV legge un WAV PCM a 16 bit (mono o stereo) intero
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
