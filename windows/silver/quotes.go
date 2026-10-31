package main

// Altre citazioni (in italiano, brevi), raggruppate per gioco: quando giochi a uno di questi, Silver
// pesca di preferenza da quello.

import "strings"

func init() { quotes = append(quotes, moreQuotes...) }

var moreQuotes = []quote{
	// Undertale
	{"Ti riempie di DETERMINAZIONE.", "Undertale", "Sì, anche davanti a questa lista di cose da fare."},
	{"Fuori è una bella giornata. Gli uccelli cantano, i fiori sbocciano…", "Undertale", "…e tu sei qui al PC."},
	{"In questo mondo, o uccidi o vieni ucciso.", "Undertale", "Flowey esagera. Ma solo un po'."},
	{"Nyeh heh heh!", "Undertale", "Papyrus approverebbe quello che stai facendo. Credo."},
	{"hOI! sono temmie!", "Undertale", ""},
	{"Resta determinato.", "Undertale", ""},
	{"Il tuo PECCATO striscia sulla tua schiena.", "Undertale", "Hai lasciato ancora le notifiche non lette, vero?"},
	// Deltarune
	{"Nessuno può scegliere chi è in questo mondo.", "Deltarune", ""},
	{"Posso fare qualsiasi cosa!", "Deltarune", "Jevil ci credeva. Tu almeno provaci."},
	{"Caos, caos!", "Deltarune", "Più o meno lo stato della tua scrivania."},
	{"Ora è la tua occasione di diventare un [[BIG SHOT]]!", "Deltarune", "Spamton dice così a tutti. Io lo dico solo a te."},
	{"Ho! Ho! Ho!", "Deltarune", "Lancer è sempre di buon umore. Prendi esempio."},
	{"Sei in una partita e non lo sai ancora.", "Deltarune", ""},
	// inFAMOUS
	{"Buono o cattivo: la scelta è tua.", "inFAMOUS", "Vale anche per finire il lavoro o rimandarlo."},
	{"Non sono mai stato un eroe.", "inFAMOUS", "Io sì. Ma non mi vanto."},
	{"Il potere ti cambia. Sempre.", "inFAMOUS", ""},
	{"Una città intera ti guarda. Decidi chi vuoi essere.", "inFAMOUS", "La chat, almeno, ti guarda di sicuro."},
	// Assassin's Creed
	{"Requiescat in pace.", "Assassin's Creed", ""},
	{"Sono io, Mario!", "Assassin's Creed II", "Lo zio di Ezio, non l'idraulico."},
	{"Lavoriamo nell'oscurità per servire la luce. Siamo Assassini.", "Assassin's Creed", ""},
	{"Tieni la lama lontana dalla carne degli innocenti.", "Assassin's Creed", "E le mani lontane dai file che non hai salvato."},
	{"Non compromettere mai la Confraternita.", "Assassin's Creed", ""},
	{"Sono Ezio Auditore da Firenze.", "Assassin's Creed II", "E io sono Silver. Piacere."},
	{"Salto della fede!", "Assassin's Creed", "Ricorda il pagliaio, però."},
	// Pokémon
	{"Preparatevi a passare guai! Sì, guai grossi!", "Pokémon", ""},
	{"Ci sono un tempo e un luogo per ogni cosa, ma non ora.", "Pokémon", "Il Professor Oak lo dice meglio di me."},
	{"Un Pokémon selvatico appare!", "Pokémon", "Ah no, è solo un'altra notifica."},
	{"Magikarp usa Splash! Ma non succede nulla!", "Pokémon", "Un po' come la tua produttività di stamattina."},
	{"Acchiappali tutti!", "Pokémon", "Anche le cose da fare, se ci riesci."},
	{"Il Team Rocket viene sconfitto di nuovo!", "Pokémon", ""},
	{"Pikachu, scelgo te!", "Pokémon", ""},
	{"È superefficace!", "Pokémon", "Detto di te quando ti concentri."},
	// Skyrim
	{"Ehi, tu. Finalmente sei sveglio.", "Skyrim", ""},
	{"Un tempo ero un avventuriero come te, poi mi sono beccato una freccia nel ginocchio.", "Skyrim", ""},
	{"Fus Ro Dah!", "Skyrim", "Non provarci con me. Non funziona."},
	{"Sono qui per portare i tuoi fardelli.", "Skyrim", "Io no, però. Trovati una Lydia."},
	{"Fammi indovinare: qualcuno ti ha rubato il dolcetto?", "Skyrim", ""},
	{"Non c'è niente da vedere qui. Circola.", "Skyrim", ""},
	{"Dovahkiin, Dovahkiin…", "Skyrim", "Va bene, la smetto di canticchiare."},
	// Yu-Gi-Oh!
	{"È il momento del duello!", "Yu-Gi-Oh!", ""},
	{"Credi nel cuore delle carte.", "Yu-Gi-Oh!", "Io credo nel cuore dei backup."},
	{"Hai attivato la mia carta trappola!", "Yu-Gi-Oh!", ""},
	{"Ho riunito tutti e cinque i pezzi di Exodia!", "Yu-Gi-Oh!", "Peccato che fosse solo la cartella Download."},
	{"Drago Bianco Occhi Blu, attacca!", "Yu-Gi-Oh!", ""},
	{"Pesco!", "Yu-Gi-Oh!", "Dai, che stavolta esce la carta giusta."},
	// League of Legends
	{"Benvenuto nella Landa degli Evocatori.", "League of Legends", ""},
	{"Pentakill!", "League of Legends", "Se succede, voglio vederlo nella clip."},
	{"Demaciaaa!", "League of Legends", ""},
	{"Capitano Teemo, in servizio!", "League of Legends", "Il più odiato di Runeterra. Dopo di me."},
	{"La morte è come il vento: sempre al mio fianco.", "League of Legends", "Yasuo esagera. Ma lo 0/10 è vero."},
	{"Stai dietro a Braum!", "League of Legends", ""},
	{"Un evocatore ha abbandonato la partita.", "League of Legends", "Non farlo tu."},
	{"Il nemico ha distrutto un inibitore.", "League of Legends", "Ok, respira."},
}

// i giochi delle citazioni: se il gioco aperto contiene una di queste parole, usa le sue citazioni
var quoteGames = map[string][]string{
	"Undertale":         {"undertale"},
	"Deltarune":         {"deltarune"},
	"inFAMOUS":          {"infamous"},
	"Assassin's Creed":  {"assassin", "acvalhalla", "acorigins", "acodyssey", "acmirage", "acshadows"},
	"Pokémon":           {"pokemon", "pokémon"},
	"Skyrim":            {"skyrim", "tesv"},
	"Yu-Gi-Oh!":         {"yu-gi-oh", "yugioh", "masterduel", "master duel"},
	"League of Legends": {"league of legends", "league of legends.exe", "leagueclient"},
}

// gameQuotes: le citazioni del gioco che stai giocando (nil se non è uno di questi)
func gameQuotes(c Context) []quote {
	if c.ID != "game" {
		return nil
	}
	where := strings.ToLower(c.Name + " " + c.Key)
	for game, words := range quoteGames {
		for _, w := range words {
			if strings.Contains(where, w) {
				var out []quote
				for _, q := range quotes {
					if strings.HasPrefix(q.source, game) {
						out = append(out, q)
					}
				}
				return out
			}
		}
	}
	return nil
}
