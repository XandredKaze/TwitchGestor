' Avvia TwitchGestor senza nessuna finestra.
' Per spegnerlo: pulsante "Spegni" nella dashboard, oppure chiudi OBS (se usi lo script per OBS).
' I messaggi del programma si leggono nella dashboard (Registro del programma) o in data\twitchgestor.log
Option Explicit
Dim sh, fso, dir, fromObs
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir

fromObs = False
If WScript.Arguments.Count > 0 Then fromObs = (LCase(WScript.Arguments(0)) = "obs")

If sh.Run("cmd /c where node", 0, True) <> 0 Then
  MsgBox "Node.js non trovato. Installalo da https://nodejs.org (versione LTS) e riprova.", vbExclamation, "TwitchGestor"
  WScript.Quit 1
End If

' Prima volta: installa i componenti in una finestra visibile, cosi vedi l'avanzamento.
If Not fso.FolderExists(dir & "\node_modules") Then
  If sh.Run("cmd /c title TwitchGestor - installazione & echo Prima installazione in corso, attendi... & npm install", 1, True) <> 0 Then
    MsgBox "Installazione non riuscita. Apri Avvia.bat per vedere l'errore.", vbExclamation, "TwitchGestor"
    WScript.Quit 1
  End If
End If

' 0 = finestra nascosta, False = non aspettare
sh.Run "node src\index.js", 0, False

If Not fromObs Then
  WScript.Sleep 2500
  sh.Run "http://localhost:3000/dashboard"
End If
