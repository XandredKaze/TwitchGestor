package main

// Il flusso audio continuo che ascolta Windows: un solo flusso per tutta la sessione, in cui i brani si susseguono
// senza pause (il successivo si prepara mentre suona quello attuale). Quando l'audio non è ancora pronto si manda
// silenzio, così il flusso non si ferma mai e la fine di un brano dipende da quello che si è davvero sentito.

import (
	"io"
	"sync"
)

type track struct {
	url string
	p   *pcm
}

// seg: da quale punto del flusso (fotogrammi consegnati) comincia un brano, e da quale suo fotogramma
type seg struct {
	t          *track
	startTotal int64
	startFrame int64
}

type stream struct {
	mu    sync.Mutex
	cur   *track
	next  *track
	total int64 // fotogrammi consegnati all'uscita audio
	segs  []seg
}

func (s *stream) Read(b []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	waiting := false
	for n+4 <= len(b) {
		if s.cur != nil {
			if k := s.cur.p.readInto(b[n:]); k > 0 {
				n += k
				s.total += int64(k / 4)
				continue
			}
			// finito: si passa al successivo se è pronto (senza pause)
			if s.cur.p.ended() && s.next != nil && s.next.p.ready() {
				s.cur, s.next = s.next, nil
				s.segs = append(s.segs, seg{t: s.cur, startTotal: s.total, startFrame: s.cur.p.position()})
				if len(s.segs) > 8 {
					s.segs = s.segs[len(s.segs)-8:]
				}
				continue
			}
			waiting = !s.cur.p.ended() // si sta ancora scaricando
		}
		break
	}
	// silenzio per il resto (niente da suonare, o audio non ancora pronto)
	rest := (len(b) - n) / 4
	for i := n; i < len(b); i++ {
		b[i] = 0
	}
	s.total += int64(rest)
	// il silenzio in attesa dell'audio non conta come tempo del brano
	if waiting && len(s.segs) > 0 && s.segs[len(s.segs)-1].t == s.cur {
		s.segs[len(s.segs)-1].startTotal += int64(rest)
	}
	return len(b), nil
}

// Seek: lo usa l'uscita audio per svuotare il suo buffer (le posizioni le gestiscono i metodi qui sotto)
func (s *stream) Seek(offset int64, whence int) (int64, error) { return 0, nil }

var _ io.ReadSeeker = (*stream)(nil)

func (s *stream) setCurrent(t *track) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cur, s.next = t, nil
	s.segs = []seg{{t: t, startTotal: s.total, startFrame: t.p.position()}}
}

func (s *stream) setNext(t *track) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.next = t
}

func (s *stream) urls() (cur, next string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cur != nil {
		cur = s.cur.url
	}
	if s.next != nil {
		next = s.next.url
	}
	return
}

func (s *stream) seekCurrent(frame int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cur == nil {
		return
	}
	f := s.cur.p.seek(frame)
	s.segs = []seg{{t: s.cur, startTotal: s.total, startFrame: f}}
}

// heard: il brano che si sta sentendo e la sua posizione (in fotogrammi), tenendo conto dell'audio ancora
// nel buffer dell'uscita (buffered); last: è l'ultimo brano del flusso (dopo non ne è previsto un altro)
func (s *stream) heard(buffered int64) (t *track, pos int64, last bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.segs) == 0 {
		return nil, 0, true
	}
	a := s.total - buffered
	i := 0
	for k := range s.segs {
		if s.segs[k].startTotal <= a {
			i = k
		}
	}
	g := s.segs[i]
	pos = g.startFrame + a - g.startTotal
	if pos < 0 {
		pos = 0
	}
	if tot := g.t.p.total(); pos > tot {
		pos = tot
	}
	return g.t, pos, i == len(s.segs)-1 && s.next == nil
}
