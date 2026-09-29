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

rem Avviato a mano apre anche la dashboard; avviato da OBS ("Avvia.bat obs") no.
if /i not "%~1"=="obs" start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000/dashboard"

call npm start
if errorlevel 1 pause
