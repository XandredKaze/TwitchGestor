package main

import (
	"encoding/binary"
	"io"
	"math"
	"testing"
)

// un WAV di prova: 0,5 secondi di La (440 Hz), mono, 22050 Hz
func testWAV() []byte {
	const rate = 22050
	n := rate / 2
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

func TestWAVeRicampionamento(t *testing.T) {
	data, rate, err := decodeWAV(testWAV())
	if err != nil || rate != 22050 || len(data) != 22050 { // mono → stereo: 11025 fotogrammi × 2
		t.Fatalf("decodeWAV: %v %d %d", err, rate, len(data))
	}
	s := newPCM(data, rate)
	if s.outSize != 24000 { // 0,5 s a 48 kHz
		t.Fatalf("durata in uscita: %d", s.outSize)
	}
	out, err := io.ReadAll(s)
	if err != nil || len(out) != 24000*4 {
		t.Fatalf("letti %d byte, %v", len(out), err)
	}
	// la sinusoide resta una sinusoide: nessun salto enorme tra un campione e il successivo
	prev := int16(0)
	for i := 0; i < 24000; i++ {
		v := int16(binary.LittleEndian.Uint16(out[i*4:]))
		if d := int(v) - int(prev); i > 0 && (d > 2000 || d < -2000) {
			t.Fatalf("salto al campione %d: %d → %d", i, prev, v)
		}
		prev = v
	}
	// spostarsi a metà brano
	if _, err := s.Seek(12000*4, io.SeekStart); err != nil || s.delivered() != 12000 {
		t.Fatalf("seek: %v %d", err, s.delivered())
	}
	if _, _, err := decodeWAV([]byte("niente")); err == nil {
		t.Fatal("un file non WAV deve dare errore")
	}
}
