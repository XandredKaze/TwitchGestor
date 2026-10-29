package main

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestTelecomando(t *testing.T) {
	var r *remote
	var got string
	r = newRemote(func(js string) {
		got = js
		go r.reply("1", json.RawMessage(`{"ok":true,"text":"Playlist Rock."}`))
	})
	r.report(json.RawMessage(`{"playing":true,"title":"Song"}`))
	srv := httptest.NewServer(r)
	defer srv.Close()
	// senza l'intestazione (una pagina web): no
	res, _ := http.Get(srv.URL + "/state")
	if res.StatusCode != 403 {
		t.Fatal(res.StatusCode)
	}
	req, _ := http.NewRequest("POST", srv.URL+"/cmd", strings.NewReader(`{"action":"find","query":"rock"}`))
	req.Header.Set("x-silver", "1")
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatal(err, res.StatusCode)
	}
	var out struct{ Text string }
	_ = json.NewDecoder(res.Body).Decode(&out)
	if out.Text != "Playlist Rock." || !strings.Contains(got, `musicanteRemote({"action":"find","query":"rock"})`) {
		t.Fatal(out, got)
	}
	// porta occupata: si passa alla successiva
	busy, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(remotePort))
	if err == nil {
		defer busy.Close()
	}
	if p, err := listenRemote(r); err != nil || (busy != nil && p == remotePort) {
		t.Fatal(p, err)
	}
	req, _ = http.NewRequest("POST", srv.URL+"/cmd", strings.NewReader(`alert(1)`))
	req.Header.Set("x-silver", "1")
	if res, _ = http.DefaultClient.Do(req); res.StatusCode != 400 {
		t.Fatal("comando non JSON accettato")
	}
}
