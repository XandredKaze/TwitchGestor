#!/usr/bin/env bash
# Costruisce MusicantePlayer.exe (Windows 10/11, 64 bit) da Linux o da qualsiasi sistema con Go e llvm-windres.
#   uso: bash windows/player/build.sh   → windows/MusicantePlayer.exe
set -euo pipefail
cd "$(dirname "$0")"
WINDRES="$(command -v llvm-windres || command -v llvm-windres-18 || command -v x86_64-w64-mingw32-windres)"
"$WINDRES" -O coff --target=x86_64-w64-mingw32 player.rc -o rsrc_windows_amd64.syso
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o ../MusicantePlayer.exe .
echo "Pronto: windows/MusicantePlayer.exe ($(du -h ../MusicantePlayer.exe | cut -f1))"
