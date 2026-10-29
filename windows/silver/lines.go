package main

// Le frasi di Silver: carattere tagliente, quasi irascibile, ma elegante. In italiano, brevi e chiare.

var lines = map[string][]string{
	"desktop": {
		"Desktop vuoto. Tranquillo. Fin troppo.",
		"Di nuovo qui? Bene. Vediamo di combinare qualcosa, stavolta.",
		"Scegli una cosa e falla. Fissare lo sfondo non è un piano.",
	},
	"obs": {
		"Controlla il microfono prima di andare in live. Ogni. Singola. Volta.",
		"Le scene sono pronte? Non farmi assistere a transizioni sbagliate.",
		"Se l'audio va sul rosso, sistemalo. Lo sento da qui.",
		"\"Inizia a breve\"? Allora inizia. A breve.",
	},
	"twitch": {
		"La chat ti aspetta. Non lasciarla lì appesa.",
		"Leggi la chat. Rispondi alla chat. Rivoluzionario, lo so.",
		"I follower non crescono sugli alberi. Sii interessante.",
	},
	"discord": {
		"Sii gentile. O almeno sii veloce.",
		"Quaranta notifiche non lette. Non dico niente. …Anzi, lo dico.",
		"Chiacchiere. Affascinante. Davvero.",
	},
	"game": {
		"Concentrati. E cerca di non morire. Di nuovo.",
		"Giochi? Va bene, starò zitto. Più o meno.",
		"Se chiudi il gioco per la rabbia, lo dico alla chat.",
	},
	"code": {
		"Dai nomi decenti alle variabili. Ti prego.",
		"Funziona? Allora non toccarlo. Mai più.",
		"Leggi il messaggio d'errore. Tutto, non solo la prima riga.",
	},
	"explorer": {
		"Dai nomi sensati ai file. \"finale_finale_v3\" non è un nome.",
		"Fai un backup. Ho visto cosa succede a chi non lo fa.",
		"La cartella Download è un cimitero. Pulisci.",
	},
	"music": {
		"Buon gusto. Te lo concedo.",
		"Alza il volume. No, non così tanto.",
		"Musica accesa, lavoro acceso. Questo è il patto.",
	},
	"gestor": {
		"Tutto verde? Bene. Tienilo così.",
		"Prova gli alert prima della live, non durante.",
		"La tua dashboard, le tue regole. Sotto la mia supervisione.",
	},
	"random": {
		"Non badare a me. Sto solo fluttuando qui. Con eleganza.",
		"Bevi un po' d'acqua. È un ordine, non un consiglio.",
		"Sei lì da un bel po'. Sgranchisciti, poi torna al lavoro.",
		"Se ti servo, cliccami. Se non ti servo, cliccami lo stesso. Mi annoio.",
	},
}

// in live: niente voce (finirebbe nell'audio della live) e frasi più brevi
var liveLines = []string{
	"Sei in live. Starò zitto. Più o meno.",
	"Sorridi. La chat se ne accorge quando non lo fai.",
	"Bevi. Poi intrattieni.",
	"Bella live finora. Non rovinarla.",
}

type quote struct{ text, source, note string }

// citazioni dei videogiochi (in italiano), a volte con un suo commento
var quotes = []quote{
	{"È inutile!", "Silver the Hedgehog", ""},
	{"È pericoloso andare da soli!", "The Legend of Zelda", "…e infatti eccomi. Non farla strana."},
	{"Fermati un attimo e ascolta.", "Diablo", ""},
	{"La guerra. La guerra non cambia mai.", "Fallout", "Neanche la tua lista di cose da fare."},
	{"La torta è una bugia.", "Portal", ""},
	{"Fai un avvitamento!", "Star Fox 64", "Oppure, sai, finisci quello che stai facendo."},
	{"Lode al sole!", "Dark Souls", ""},
	{"Ehi! Ascolta!", "The Legend of Zelda", "…giuro che sono meno fastidioso di quella fatina."},
	{"Un uomo sceglie, uno schiavo obbedisce.", "BioShock", ""},
	{"Nulla è reale, tutto è lecito.", "Assassin's Creed", ""},
	{"Grazie Mario! Ma la nostra principessa è in un altro castello!", "Super Mario Bros.", "E il tuo file è in un'altra cartella."},
	{"Si svegli, signor Freeman.", "Half-Life 2", "Sì, dico a te. Svegliati."},
	{"Sei troppo lento!", "Sonic Adventure 2", "Non è una mia battuta. Ma è vera."},
}

// quando non fai niente per un po' finge di lavorare
var idleTasks = []string{
	"Riallineo i Chaos Emerald",
	"Ricalibro la psicocinesi",
	"Mi sistemo gli aculei",
	"Controllo la linea temporale",
	"Riordino i tuoi file (mentalmente)",
	"Medito. Non disturbare",
}

const (
	greeting     = "Hmpf. Ancora tu. Va bene, tengo d'occhio la situazione."
	liveOn       = "Sei in live. Niente voce: starò zitto. Più o meno."
	gameQuestion = "%s? Sparisco, resto zitto o ti faccio compagnia?"
	gameQuiet    = "Va bene. Neanche una parola. …Da adesso."
	gameTalk     = "Bene. Qualcuno deve pur tenerti con i piedi per terra."
	bye          = "Me ne vado. Non sentire troppo la mia mancanza."
	needArt      = "Così non sono io. Carica la mia immagine e la mia voce in TwitchGestor: ⚙ Sistema → 🧰 Tools."
	gotArt       = "Ecco. Adesso sì che ci siamo."
)
