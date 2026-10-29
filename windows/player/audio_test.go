package main

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

// un WAV di prova: secondi di La (440 Hz), mono, 22050 Hz
func testWAV(sec float64) []byte {
	const rate = 22050
	n := int(rate * sec)
	data := make([]byte, n*2)
	for i := 0; i < n; i++ {
		binary.LittleEndian.PutUint16(data[i*2:], uint16(int16(10000*math.Sin(2*math.Pi*440*float64(i)/rate))))
	}
	h := make([]byte, 44)
	copy(h, "RIFF")
	binary.LittleEndian.PutUint32(h[4:], uint32(36+len(data)))
	copy(h[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(h[16:], 16)
	binary.LittleEndian.PutUint16(h[20:], 1)
	binary.LittleEndian.PutUint16(h[22:], 1)
	binary.LittleEndian.PutUint32(h[24:], rate)
	binary.LittleEndian.PutUint32(h[28:], rate*2)
	binary.LittleEndian.PutUint16(h[32:], 2)
	binary.LittleEndian.PutUint16(h[34:], 16)
	copy(h[36:], "data")
	binary.LittleEndian.PutUint32(h[40:], uint32(len(data)))
	return append(h, data...)
}

func wavTrack(t *testing.T, url string, sec float64) *track {
	data, rate, err := decodeWAV(testWAV(sec))
	if err != nil {
		t.Fatal(err)
	}
	tr := &track{url: url, p: newPCM()}
	tr.p.add(data, rate)
	tr.p.finish(nil)
	return tr
}

func TestRicampionamentoSenzaSalti(t *testing.T) {
	tr := wavTrack(t, "a", 0.5)
	if tot := tr.p.total(); tot != 24000 { // 0,5 s a 48 kHz
		t.Fatalf("durata: %d", tot)
	}
	out := make([]byte, 24000*4)
	if n := tr.p.readInto(out); n != len(out) {
		t.Fatalf("letti %d", n)
	}
	prev := int16(0)
	for i := 0; i < 24000; i++ {
		v := int16(binary.LittleEndian.Uint16(out[i*4:]))
		if d := int(v) - int(prev); i > 0 && (d > 2000 || d < -2000) {
			t.Fatalf("salto al campione %d", i)
		}
		prev = v
	}
	if !tr.p.ended() {
		t.Fatal("dovrebbe essere finito")
	}
}

// il flusso: il brano successivo parte senza pause e la fine si conta su quello che si è sentito
func TestFlussoSenzaPauseEFineGiusta(t *testing.T) {
	s := &stream{}
	a := wavTrack(t, "a", 0.5) // 24000 fotogrammi
	b := wavTrack(t, "b", 0.5)
	s.setCurrent(a)
	s.setNext(b)
	buf := make([]byte, 30000*4) // più di un brano: deve continuare con b
	s.Read(buf)
	if s.cur != b || s.next != nil {
		t.Fatal("doveva passare al brano b")
	}
	// con 10000 fotogrammi ancora nel buffer dell'uscita si sente ancora a, verso la fine
	tr, pos, _ := s.heard(10000)
	if tr != a || pos != 20000 {
		t.Fatalf("si sente %s a %d", tr.url, pos)
	}
	// buffer vuoto: si sente b, a 6000 fotogrammi dall'inizio (nessun silenzio in mezzo)
	tr, pos, last := s.heard(0)
	if tr != b || pos != 6000 || !last {
		t.Fatalf("si sente %s a %d (ultimo %v)", tr.url, pos, last)
	}
	// fine di b: silenzio, poi "finito" solo quando è stato sentito tutto
	s.Read(make([]byte, 20000*4))
	tr, pos, _ = s.heard(2000)
	if pos != 24000 || !b.p.ended() {
		t.Fatalf("fine: %d", pos)
	}
}

func TestBranoInArrivoNonContaIlSilenzio(t *testing.T) {
	s := &stream{}
	tr := &track{url: "x", p: newPCM()} // ancora niente audio (si sta scaricando)
	s.setCurrent(tr)
	s.Read(make([]byte, 4800*4)) // 0,1 s di silenzio
	data, rate, _ := decodeWAV(testWAV(0.5))
	tr.p.add(data, rate)
	tr.p.finish(nil)
	s.Read(make([]byte, 4800*4))
	if _, pos, _ := s.heard(0); pos != 4800 {
		t.Fatalf("posizione %d: il silenzio iniziale non deve contare", pos)
	}
	// spostarsi nel brano
	s.seekCurrent(12000)
	if _, pos, _ := s.heard(0); pos != 12000 {
		t.Fatalf("dopo lo spostamento: %d", pos)
	}
}

func TestMP3NonValido(t *testing.T) {
	p := newPCM()
	decodeMP3(bytes.NewReader([]byte("non è un mp3")), 0, p)
	if p.failed() == "" || !p.ended() {
		t.Fatal("un file non MP3 deve dare errore")
	}
}
