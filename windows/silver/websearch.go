package main

// Cercare su internet: i primi risultati di DuckDuckGo (o di Wikipedia se DuckDuckGo non risponde), il testo delle
// pagine migliori, e l'IA del PC che risponde usando solo quelle, citando le fonti [1], [2]…
// Niente di Windows qui (websearch_test.go).

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type WebResult struct {
	Title   string
	URL     string
	Snippet string
	Text    string // il testo della pagina (i primi pezzi)
	Index   int    // ordine (Wikipedia)
}

func sortByIndex(rs []WebResult) {
	sort.SliceStable(rs, func(i, j int) bool { return rs[i].Index < rs[j].Index })
}

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

var (
	reDDGLink    = regexp.MustCompile(`(?s)<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>`)
	reDDGSnippet = regexp.MustCompile(`(?s)class="result__snippet"[^>]*>(.*?)</a>`)
	reHTMLTag    = regexp.MustCompile(`(?s)<[^>]*>`)
	reDrop       = regexp.MustCompile(`(?is)<(script|style|noscript|svg|nav|header|footer|form|aside|iframe)[^>]*>.*?</(script|style|noscript|svg|nav|header|footer|form|aside|iframe)>`)
	reSpaces     = regexp.MustCompile(`[ \t\r\f\v]+`)
	reBlank      = regexp.MustCompile(`\n\s*\n+`)
)

func stripHTML(s string) string {
	return strings.TrimSpace(html.UnescapeString(reHTMLTag.ReplaceAllString(s, "")))
}

// ddgURL: i link di DuckDuckGo passano da //duckduckgo.com/l/?uddg=<indirizzo vero>
func ddgURL(href string) string {
	href = html.UnescapeString(href)
	if strings.HasPrefix(href, "//") {
		href = "https:" + href
	}
	if u, err := url.Parse(href); err == nil && strings.Contains(u.Host, "duckduckgo.com") {
		if real := u.Query().Get("uddg"); real != "" {
			return real
		}
	}
	return href
}

// parseDDG: i risultati della pagina di DuckDuckGo (senza le pubblicità)
func parseDDG(page string) []WebResult {
	links := reDDGLink.FindAllStringSubmatch(page, -1)
	snips := reDDGSnippet.FindAllStringSubmatch(page, -1)
	var out []WebResult
	for i, l := range links {
		u := ddgURL(l[1])
		if strings.Contains(u, "duckduckgo.com/y.js") || strings.Contains(u, "ad_provider") || !strings.HasPrefix(u, "http") {
			continue
		}
		r := WebResult{Title: stripHTML(l[2]), URL: u}
		if i < len(snips) {
			r.Snippet = stripHTML(snips[i][1])
		}
		out = append(out, r)
	}
	return out
}

// pageText: il testo leggibile di una pagina (senza menu, script, pubblicità…), al massimo n caratteri
func pageText(page string, n int) string {
	if i := strings.Index(strings.ToLower(page), "<body"); i >= 0 {
		page = page[i:]
	}
	if i := strings.Index(strings.ToLower(page), "<main"); i >= 0 { // dove c'è, il contenuto vero
		page = page[i:]
	} else if i := strings.Index(strings.ToLower(page), "<article"); i >= 0 {
		page = page[i:]
	}
	page = reDrop.ReplaceAllString(page, " ")
	page = regexp.MustCompile(`(?i)<(br|/p|/div|/li|/h[1-6]|/tr)[^>]*>`).ReplaceAllString(page, "\n")
	t := html.UnescapeString(reHTMLTag.ReplaceAllString(page, " "))
	t = reSpaces.ReplaceAllString(t, " ")
	var lines []string
	for _, l := range strings.Split(t, "\n") {
		l = strings.TrimSpace(l)
		if len([]rune(l)) >= 40 { // le righe corte sono quasi sempre menu e pulsanti
			lines = append(lines, l)
		}
	}
	t = strings.Join(lines, "\n")
	if r := []rune(t); len(r) > n {
		t = string(r[:n])
	}
	return t
}

func getPage(ctx context.Context, u string, limit int64) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept-Language", "it-IT,it;q=0.9,en;q=0.6")
	res, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return "", fmt.Errorf("%s", res.Status)
	}
	if ct := res.Header.Get("Content-Type"); ct != "" && !strings.Contains(ct, "html") && !strings.Contains(ct, "json") && !strings.Contains(ct, "text") {
		return "", fmt.Errorf("non è una pagina (%s)", ct)
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, limit))
	return string(b), err
}

// wikiSearch: se DuckDuckGo non risponde, Wikipedia in italiano (permesso e senza account)
func wikiSearch(ctx context.Context, q string) ([]WebResult, error) {
	body, err := getPage(ctx, "https://it.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=3&prop=extracts|info&inprop=url&exintro=1&explaintext=1&gsrsearch="+url.QueryEscape(q), 2<<20)
	if err != nil {
		return nil, err
	}
	var r struct {
		Query struct {
			Pages map[string]struct {
				Title   string `json:"title"`
				Extract string `json:"extract"`
				URL     string `json:"fullurl"`
				Index   int    `json:"index"`
			} `json:"pages"`
		} `json:"query"`
	}
	if err := json.Unmarshal([]byte(body), &r); err != nil {
		return nil, err
	}
	out := make([]WebResult, 0, len(r.Query.Pages))
	for _, p := range r.Query.Pages {
		out = append(out, WebResult{Title: p.Title, URL: p.URL, Text: p.Extract, Snippet: firstSentence(p.Extract), Index: p.Index})
	}
	sortByIndex(out)
	return out, nil
}

func firstSentence(s string) string {
	if i := strings.Index(s, ". "); i > 0 && i < 300 {
		return s[:i+1]
	}
	if r := []rune(s); len(r) > 200 {
		return string(r[:200]) + "…"
	}
	return s
}

// WebSearch: i risultati, con il testo delle prime pagine (in parallelo, pochi secondi)
func WebSearch(ctx context.Context, q string) ([]WebResult, error) {
	page, err := getPage(ctx, "https://html.duckduckgo.com/html/?kl=it-it&q="+url.QueryEscape(q), 2<<20)
	results := []WebResult(nil)
	if err == nil {
		results = parseDDG(page)
	}
	if len(results) == 0 { // DuckDuckGo non risponde o non dà niente: Wikipedia
		return wikiSearch(ctx, q)
	}
	if len(results) > 6 {
		results = results[:6]
	}
	var wg sync.WaitGroup
	for i := range results[:min(3, len(results))] {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c, cancel := context.WithTimeout(ctx, 6*time.Second)
			defer cancel()
			if p, err := getPage(c, results[i].URL, 3<<20); err == nil {
				results[i].Text = pageText(p, 2500)
			}
		}(i)
	}
	wg.Wait()
	return results, nil
}

// webPrompt: la domanda con i testi trovati, per l'IA (risponde solo con quelli e cita le fonti)
func webPrompt(q string, rs []WebResult, now time.Time) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Oggi è %s %s. Ho cercato su internet: \"%s\". Ecco cosa ho trovato:\n\n", weekdays[now.Weekday()], now.Format("02/01/2006"), q)
	n := 0
	for i, r := range rs {
		text := r.Text
		if text == "" {
			text = r.Snippet
		}
		if text == "" {
			continue
		}
		n++
		fmt.Fprintf(&b, "[%d] %s (%s)\n%s\n\n", i+1, r.Title, r.URL, text)
		if n >= 4 {
			break
		}
	}
	b.WriteString("Rispondi in italiano usando SOLO queste informazioni. Cita le fonti con [1], [2]… dove le usi. ")
	b.WriteString("Se le informazioni non bastano o non sono d'accordo tra loro, dillo chiaramente invece di inventare. Sii breve: poche frasi.")
	return b.String()
}

// WantsWeb: la domanda ha bisogno di internet? (cose recenti, notizie, prezzi, risultati, uscite)
func WantsWeb(q string) bool {
	low := strings.ToLower(q)
	return regexp.MustCompile(`(?:^|\s)(?:oggi|ieri|stamattina|stasera|questa settimana|ultime notizie|notizie|news|adesso|attualmente|attuale|in questo momento|ultimo|ultima|recente|recenti|prezzo|quanto costa|risultato|classifica|chi ha vinto|quando esce|data di uscita|è uscito|uscirà|nel 2025|nel 2026|del 2025|del 2026|aggiornamento|patch)(?:\s|$|[?.,!])`).MatchString(low) &&
		regexp.MustCompile(`^(?:chi|cosa|che|quando|dove|quanto|quanti|quale|qual|come|perché|perche|c'è|ci sono|dimmi|sai)`).MatchString(low)
}
