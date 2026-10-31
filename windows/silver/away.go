package main

// "Sparisci" / "torna": Silver non si vede più ma resta acceso (promemoria, avvisi, "Ehi Silver", Ctrl+Alt+S).

import (
	"regexp"
	"strings"
)

var (
	reAway = regexp.MustCompile(`^(?:(?:dai|su|ok|ehi|adesso|ora)\s+)?(?:silver\s+)?(?:(?:per\s+favore|per\s+piacere|pure|un\s+attimo|un\s+po'?|ora|adesso|subito)\s+)*` +
		`(?:sparisci|scompari|scomparisci|sparire|vattene|vai\s+via|va\s+via|levati(?:\s+di\s+(?:torno|mezzo|qui))?|togliti(?:\s+di\s+(?:torno|mezzo|qui|dai\s+piedi))?|smamma|sloggia|nasconditi|eclissati|dileguati|fuori\s+dai\s+piedi|fuori\s+di\s+qui|via\s+di\s+qui|lasciami\s+(?:in\s+pace|stare|solo|sola)|non\s+ti\s+voglio\s+(?:più\s+)?vedere|non\s+voglio\s+vederti|fatti\s+da\s+parte|fatti\s+in\s+là|levati\s+dalle\s+scatole|nasconditi\s+un\s+po'?)` +
		`(?:\s+(?:per\s+favore|per\s+piacere|pure|un\s+attimo|un\s+po'?|per\s+un\s+po'?|adesso|ora|subito|silver|dallo\s+schermo|dal\s+desktop))*$`)
	reBack = regexp.MustCompile(`^(?:(?:dai|su|ok|ehi|adesso|ora)\s+)?(?:silver\s+)?(?:(?:per\s+favore|pure|ora|adesso)\s+)*` +
		`(?:torna|ritorna|rientra|riappari|ricompari|ricompari|rifatti\s+vedere|fatti\s+vedere|fatti\s+rivedere|mostrati|vieni\s+(?:qui|qua|fuori)|esci\s+fuori|dove\s+sei(?:\s+finito)?|ci\s+sei|torna\s+qui|torna\s+qua|puoi\s+tornare|ora\s+puoi\s+tornare)` +
		`(?:\s+(?:qui|qua|pure|silver|per\s+favore|sullo\s+schermo|sul\s+desktop|fuori|ora|adesso|da\s+me))*$`)
)

// parseAway: "sparisci" → away; "torna" → back ("torna indietro" resta alla musica)
func parseAway(low string) Command {
	low = strings.Join(strings.Fields(strings.NewReplacer(",", " ", "!", " ", "?", " ", ".", " ").Replace(low)), " ")
	switch {
	case reAway.MatchString(low):
		return Command{Kind: "away"}
	case reBack.MatchString(low):
		return Command{Kind: "back"}
	}
	return Command{}
}
