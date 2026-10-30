package main

import (
	"strings"
	"testing"
	"time"
)

func TestCercaOnline(t *testing.T) {
	page := `<div class="result results_links"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.example.it%2Fnotizia&amp;rut=abc">Elden Ring: <b>Nightreign</b> esce il 30 maggio</a>
<a class="result__snippet" href="x">Il nuovo capitolo <b>esce</b> il 30 maggio 2025 su PC e console.</a></div>
<div class="result"><a class="result__a" href="https://duckduckgo.com/y.js?ad_provider=x">Pubblicità</a><a class="result__snippet">compra</a></div>
<div class="result"><a class="result__a" href="https://it.wikipedia.org/wiki/Elden_Ring">Elden Ring - Wikipedia</a><a class="result__snippet" href="y">Videogioco del 2022.</a></div>`
	rs := parseDDG(page)
	if len(rs) != 2 || rs[0].URL != "https://www.example.it/notizia" || rs[0].Title != "Elden Ring: Nightreign esce il 30 maggio" || !strings.Contains(rs[0].Snippet, "esce il 30 maggio 2025") {
		t.Fatalf("%+v", rs)
	}
	html := `<html><head><style>x{}</style></head><body><nav>Home Notizie Giochi Contatti</nav><main><h1>Elden Ring Nightreign: data di uscita ufficiale</h1><p>FromSoftware ha annunciato che Nightreign uscirà il 30 maggio 2025 su PC, PS5 e Xbox.</p><script>var a=1</script><p>Ok</p></main><footer>Copyright tutti i diritti riservati alla redazione del sito</footer></body></html>`
	txt := pageText(html, 1000)
	if !strings.Contains(txt, "uscirà il 30 maggio 2025") || strings.Contains(txt, "var a") || strings.Contains(txt, "Copyright") || strings.Contains(txt, "Home Notizie") {
		t.Fatalf("%q", txt)
	}
	rs[0].Text = txt
	p := webPrompt("quando esce Nightreign", rs, time.Date(2026, 10, 30, 10, 0, 0, 0, time.Local))
	if !strings.Contains(p, "[1] Elden Ring: Nightreign esce il 30 maggio (https://www.example.it/notizia)") || !strings.Contains(p, "[2] Elden Ring - Wikipedia") {
		t.Fatal(p)
	}
	for q, want := range map[string]bool{"chi ha vinto ieri la partita?": true, "quando esce il nuovo Zelda?": true, "che notizie ci sono oggi?": true, "come stai?": false, "scrivimi un titolo per la live": false, "cos'è un buco nero?": false} {
		if WantsWeb(q) != want {
			t.Errorf("%q → %v", q, !want)
		}
	}
	now := time.Date(2026, 10, 30, 10, 0, 0, 0, time.Local)
	for in, want := range map[string]string{"cerca su internet ultime notizie su Silksong": "ultime notizie su Silksong", "cerca online il prezzo della PS5": "il prezzo della PS5", "googla ricetta carbonara": "ricetta carbonara", "notizie su Elden Ring": "Elden Ring", "cerca sul web: orari treni Roma Milano": "orari treni Roma Milano"} {
		if c := ParseCommand(in, now); c.Kind != "web" || c.Text != want {
			t.Errorf("%q → %+v", in, c)
		}
	}
	if c := ParseCommand("chi ha vinto ieri la partita?", now); c.Kind != "web" {
		t.Errorf("domanda recente → %+v", c)
	}
	if c := ParseCommand("cerca la foto del gatto", now); c.Kind != "findfile" {
		t.Errorf("la foto resta una ricerca di file: %+v", c)
	}
}
