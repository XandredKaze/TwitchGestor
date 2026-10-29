package main

// Il buongiorno ("buongiorno Silver", "com'è la giornata?") con meteo, agenda, cose da fare, prossima live e
// promemoria; il meteo da Open-Meteo (gratis, senza account). E il guardiano: avvisi da solo quando serve
// (live vicina e OBS chiuso, disco pieno, PC sotto sforzo, troppe ore di fila).
// Niente di Windows qui (briefing_test.go).

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Weather struct {
	City      string
	Temp      float64
	Code      int
	TodayMax  float64
	TodayMin  float64
	TodayRain int
	TodayCode int
	TomMax    float64
	TomMin    float64
	TomRain   int
	TomCode   int
	Fetched   time.Time
}

func weatherText(code int) string {
	switch {
	case code == 0:
		return "sereno"
	case code == 1:
		return "quasi sereno"
	case code == 2:
		return "poco nuvoloso"
	case code == 3:
		return "nuvoloso"
	case code == 45 || code == 48:
		return "nebbia"
	case code >= 51 && code <= 57:
		return "pioviggine"
	case code >= 61 && code <= 67:
		return "pioggia"
	case code >= 71 && code <= 77:
		return "neve"
	case code >= 80 && code <= 82:
		return "rovesci"
	case code == 85 || code == 86:
		return "rovesci di neve"
	case code >= 95:
		return "temporale"
	}
	return "tempo variabile"
}

var httpClient = &http.Client{Timeout: 8 * time.Second}

// geocode: la città → coordinate (Open-Meteo, in italiano)
func geocode(city string) (name string, lat, lon float64, err error) {
	res, err := httpClient.Get("https://geocoding-api.open-meteo.com/v1/search?count=1&language=it&format=json&name=" + url.QueryEscape(city))
	if err != nil {
		return "", 0, 0, err
	}
	defer res.Body.Close()
	var r struct {
		Results []struct {
			Name      string  `json:"name"`
			Latitude  float64 `json:"latitude"`
			Longitude float64 `json:"longitude"`
			Admin1    string  `json:"admin1"`
		} `json:"results"`
	}
	if err := json.NewDecoder(res.Body).Decode(&r); err != nil {
		return "", 0, 0, err
	}
	if len(r.Results) == 0 {
		return "", 0, 0, fmt.Errorf("non trovo la città \"%s\"", city)
	}
	g := r.Results[0]
	return g.Name, g.Latitude, g.Longitude, nil
}

// parseForecast: la risposta di Open-Meteo
func parseForecast(b []byte, city string) (*Weather, error) {
	var r struct {
		Current struct {
			Temp float64 `json:"temperature_2m"`
			Code int     `json:"weather_code"`
		} `json:"current"`
		Daily struct {
			Max  []float64 `json:"temperature_2m_max"`
			Min  []float64 `json:"temperature_2m_min"`
			Rain []int     `json:"precipitation_probability_max"`
			Code []int     `json:"weather_code"`
		} `json:"daily"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	d := r.Daily
	if len(d.Max) < 2 || len(d.Min) < 2 || len(d.Code) < 2 {
		return nil, fmt.Errorf("meteo incompleto")
	}
	rain := func(i int) int {
		if i < len(d.Rain) {
			return d.Rain[i]
		}
		return 0
	}
	return &Weather{City: city, Temp: r.Current.Temp, Code: r.Current.Code, TodayMax: d.Max[0], TodayMin: d.Min[0], TodayRain: rain(0), TodayCode: d.Code[0],
		TomMax: d.Max[1], TomMin: d.Min[1], TomRain: rain(1), TomCode: d.Code[1], Fetched: time.Now()}, nil
}

func fetchWeather(city string, lat, lon float64) (*Weather, error) {
	u := fmt.Sprintf("https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=2", lat, lon)
	res, err := httpClient.Get(u)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	b, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	return parseForecast(b, city)
}

func deg(f float64) string { return fmt.Sprintf("%d°", int(math.Round(f))) }

// WeatherSay: "A Roma ora 18°, nuvoloso. Oggi tra 12° e 21°, pioggia al 30%." (tomorrow: domani)
func (w *Weather) Say(tomorrow bool) string {
	if tomorrow {
		s := fmt.Sprintf("Domani a %s: %s, tra %s e %s", w.City, weatherText(w.TomCode), deg(w.TomMin), deg(w.TomMax))
		if w.TomRain >= 30 {
			s += fmt.Sprintf(", pioggia al %d%%", w.TomRain)
		}
		return s + "."
	}
	s := fmt.Sprintf("A %s ora %s, %s. Oggi tra %s e %s", w.City, deg(w.Temp), weatherText(w.Code), deg(w.TodayMin), deg(w.TodayMax))
	if w.TodayRain >= 30 {
		s += fmt.Sprintf(", pioggia al %d%%: prendi l'ombrello", w.TodayRain)
	}
	return s + "."
}

// briefingText: il riepilogo della giornata
func briefingText(now time.Time, w *Weather, ag *Agenda, rem []Reminder, nextLive string) string {
	var b strings.Builder
	saluto := "Buongiorno"
	switch h := now.Hour(); {
	case h >= 13 && h < 18:
		saluto = "Buon pomeriggio"
	case h >= 18 || h < 5:
		saluto = "Buonasera"
	}
	fmt.Fprintf(&b, "%s. Oggi è %s %d %s.", saluto, weekIT[weekdayNum(now)], now.Day(), monIT[now.Month()])
	if w != nil {
		b.WriteString("\n" + w.Say(false))
	}
	if ag != nil {
		today := agendaText(ag, now, "today")
		if strings.HasPrefix(today, "Oggi niente") {
			b.WriteString("\nOggi niente in agenda.")
		} else {
			b.WriteString("\nIn agenda " + strings.ToLower(today[:1]) + today[1:])
		}
		var due []string
		for _, t := range ag.Tasks {
			if t.Due != "" && t.Due <= dayKey(now) {
				due = append(due, t.Title)
			}
		}
		if len(due) > 0 {
			b.WriteString("\nDa fare entro oggi: " + strings.Join(due, ", ") + ".")
		} else if len(ag.Tasks) > 0 {
			fmt.Fprintf(&b, "\nHai %d cose da fare in lista.", len(ag.Tasks))
		}
	}
	if nextLive != "" {
		b.WriteString("\nProssima live: " + nextLive + ".")
	}
	var todayRem []string
	for _, r := range rem {
		if dayKey(r.Time()) == dayKey(now) {
			todayRem = append(todayRem, r.Time().Format("15:04")+" "+r.Text)
		}
	}
	if len(todayRem) > 0 {
		b.WriteString("\nPromemoria di oggi: " + strings.Join(todayRem, ", ") + ".")
	}
	return b.String()
}

// ---------- il guardiano ----------

type GuardInput struct {
	FreeCGB    float64 // spazio libero su C:
	RAM        int     // % di memoria usata
	CPU        int     // % di processore
	TopProc    string  // il programma che usa più memoria
	OBSRunning bool
	NextLive   *struct {
		ID    string
		At    time.Time
		Title string
	}
	Live      bool
	InGame    bool
	GameName  string
	ActiveFor time.Duration // da quanto usi il PC senza pause (>5 min)
}

type GuardMsg struct {
	Key     string
	Text    string
	Actions []Action
	Alert   bool // importante (si vede sempre)
}

type Guard struct {
	said     map[string]time.Time // cosa ha già detto e quando
	highRAM  int
	highCPU  int
	gameFrom time.Time
}

// Check: cosa dire adesso (ogni minuto)
func (g *Guard) Check(in GuardInput, now time.Time) []GuardMsg {
	if g.said == nil {
		g.said = map[string]time.Time{}
	}
	var out []GuardMsg
	once := func(key string, every time.Duration, m GuardMsg) {
		if t, ok := g.said[key]; ok && now.Sub(t) < every {
			return
		}
		g.said[key] = now
		m.Key = key
		out = append(out, m)
	}
	// la live sta per iniziare e OBS è chiuso
	if n := in.NextLive; n != nil && !in.Live && !in.OBSRunning {
		if left := n.At.Sub(now); left > 0 && left <= 30*time.Minute {
			once("obs:"+n.ID, 24*time.Hour, GuardMsg{Text: fmt.Sprintf("Tra %d minuti sei in live e OBS è chiuso. Lo apro?", max(1, int(left.Round(time.Minute).Minutes()))),
				Actions: []Action{{"Apri OBS", "x:guard:obs"}, {"No", "x:guard:no"}}, Alert: true})
		}
	}
	// disco quasi pieno (una volta al giorno)
	if in.FreeCGB > 0 && in.FreeCGB < 10 {
		once("disk", 24*time.Hour, GuardMsg{Text: fmt.Sprintf("Il disco C: ha solo %.1f GB liberi. Se si riempie, Windows e i giochi fanno i capricci.", in.FreeCGB),
			Actions: []Action{{"Apri la pulizia", "x:guard:storage"}, {"Più tardi", "x:guard:no"}}, Alert: true})
	}
	// memoria e processore al limite per qualche minuto di fila
	if in.RAM >= 90 {
		g.highRAM++
	} else {
		g.highRAM = 0
	}
	if g.highRAM >= 3 && !in.Live {
		t := fmt.Sprintf("La memoria del PC è quasi piena (%d%%).", in.RAM)
		if in.TopProc != "" {
			t += " Quello che ne usa di più è " + in.TopProc + "."
		}
		once("ram", 30*time.Minute, GuardMsg{Text: t})
	}
	if in.CPU >= 90 {
		g.highCPU++
	} else {
		g.highCPU = 0
	}
	if g.highCPU >= 3 && !in.Live && !in.InGame {
		once("cpu", 30*time.Minute, GuardMsg{Text: fmt.Sprintf("Il processore è al %d%% da qualche minuto. Qualcosa lavora sodo.", in.CPU)})
	}
	// troppe ore di fila (mai in live)
	if in.InGame {
		if g.gameFrom.IsZero() {
			g.gameFrom = now
		}
	} else {
		g.gameFrom = time.Time{}
	}
	if !in.Live && in.InGame && now.Sub(g.gameFrom) >= 2*time.Hour {
		h := int(now.Sub(g.gameFrom).Hours())
		once("game", 2*time.Hour, GuardMsg{Text: fmt.Sprintf("Sono %d ore che giochi a %s. Acqua, sgranchisciti, poi torna a vincere.", h, in.GameName)})
	} else if !in.Live && !in.InGame && in.ActiveFor >= 2*time.Hour {
		once("pause", 2*time.Hour, GuardMsg{Text: "Sono due ore che sei al PC senza pause. Cinque minuti lontano dallo schermo, su."})
	}
	return out
}
