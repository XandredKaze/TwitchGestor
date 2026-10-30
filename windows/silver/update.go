package main

// "Aggiornati": Silver (e Musicante Player) si aggiornano da soli scaricando la versione nuova da TwitchGestor.

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"regexp"
)

// appVersion: la versione di TwitchGestor con cui è stato costruito (la mette build.sh)
var appVersion = "sviluppo"

var (
	reUpdateSilver = regexp.MustCompile(`^(?:silver[,\s]+)?(?:aggiornati|aggiorna (?:silver|te stesso|il programma)|installa (?:la )?(?:nuova )?versione(?: nuova)?|scarica (?:la )?(?:nuova )?versione|c'è una (?:nuova )?versione(?: nuova)?(?: di te)?|ci sono aggiornamenti|controlla (?:gli )?aggiornamenti|sei aggiornato|aggiornamenti)$`)
	reUpdatePlayer = regexp.MustCompile(`^(?:aggiorna (?:il |anche il )?(?:musicante )?player|aggiorna musicante(?: player)?)$`)
	reUpdateAll    = regexp.MustCompile(`^(?:aggiorna tutto|aggiorna tutti i programmi|aggiorna (?:silver e (?:il )?player|tutti e due|entrambi))$`)
	reVersion      = regexp.MustCompile(`^(?:che|quale) versione (?:sei|hai|è questa|stai usando)|^versione$`)
)

// parseUpdate: Kind "update" con Text silver | player | all, oppure "version"
func parseUpdate(low string) Command {
	switch {
	case reUpdateAll.MatchString(low):
		return Command{Kind: "update", Text: "all"}
	case reUpdatePlayer.MatchString(low):
		return Command{Kind: "update", Text: "player"}
	case reUpdateSilver.MatchString(low):
		return Command{Kind: "update", Text: "silver"}
	case reVersion.MatchString(low):
		return Command{Kind: "version"}
	}
	return Command{}
}

// fileHash: l'impronta sha256 di un file (come quella che dà Gestor)
func fileHash(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

func bytesHash(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}
