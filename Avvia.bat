@echo off
title TwitchGestor
cd /d "%~dp0"

where npm >nul 2>nul || (
  echo Node.js non trovato. Installalo da https://nodejs.org ^(versione LTS^) e riprova.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Prima installazione in corso, attendi...
  call npm install || (pause & exit /b 1)
)

rem Versione con la finestra visibile (utile per leggere i messaggi).
rem Per avviarlo senza finestra usa "Avvia TwitchGestor.vbs".
rem Avviato da OBS ("Avvia.bat obs"): non apre la dashboard e non resta in attesa alla chiusura.
if /i not "%~1"=="obs" start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000/dashboard"

call npm start
if /i not "%~1"=="obs" if errorlevel 1 pause
