package main

// Telecomando per Silver (il compagno sul desktop): un piccolo indirizzo raggiungibile solo da questo PC
// (127.0.0.1:47321). Silver chiede cosa suona e manda comandi (pausa, avanti, cerca un artista…);
// il programma li passa al lettore nella finestra e aspetta la sua risposta.
// Serve l'intestazione "x-silver": una pagina web aperta nel browser non può aggiungerla (CORS), quindi
// nessun sito può comandare la musica.

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

const remoteAddr = "127.0.0.1:47321"

type remote struct {
	eval    func(js string) // esegue nella pagina del lettore
	mu      sync.Mutex
	state   json.RawMessage
	seq     int
	waiting map[string]chan json.RawMessage
}

func newRemote(eval func(string)) *remote {
	return &remote{eval: eval, waiting: map[string]chan json.RawMessage{}, state: json.RawMessage(`null`)}
}

// report: il lettore dice cosa sta suonando (a ogni cambio)
func (r *remote) report(state json.RawMessage) {
	r.mu.Lock()
	r.state = state
	r.mu.Unlock()
}

// reply: la risposta del lettore a un comando
func (r *remote) reply(id string, res json.RawMessage) {
	r.mu.Lock()
	ch := r.waiting[id]
	delete(r.waiting, id)
	r.mu.Unlock()
	if ch != nil {
		ch <- res
	}
}

func (r *remote) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	if req.Header.Get("x-silver") != "1" {
		http.Error(w, "no", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	switch {
	case req.Method == "GET" && req.URL.Path == "/state":
		r.mu.Lock()
		st := r.state
		r.mu.Unlock()
		_, _ = w.Write(st)
	case req.Method == "POST" && req.URL.Path == "/cmd":
		body, _ := io.ReadAll(io.LimitReader(req.Body, 4096))
		var check map[string]any
		if json.Unmarshal(body, &check) != nil {
			http.Error(w, `{"error":"comando non valido"}`, http.StatusBadRequest)
			return
		}
		r.mu.Lock()
		r.seq++
		id := strconv.Itoa(r.seq)
		ch := make(chan json.RawMessage, 1)
		r.waiting[id] = ch
		r.mu.Unlock()
		r.eval(`(async()=>{let r;try{r=window.musicanteRemote?window.musicanteRemote(` + string(body) + `):{ok:false,text:"Il lettore non è pronto"}}catch(e){r={ok:false,text:String(e)}}window.musicanteReply(` + strconv.Quote(id) + `,JSON.stringify(r))})()`)
		select {
		case res := <-ch:
			_, _ = w.Write(res)
		case <-time.After(5 * time.Second):
			r.mu.Lock()
			delete(r.waiting, id)
			r.mu.Unlock()
			http.Error(w, `{"error":"il lettore non risponde"}`, http.StatusGatewayTimeout)
		}
	default:
		http.NotFound(w, req)
	}
}
