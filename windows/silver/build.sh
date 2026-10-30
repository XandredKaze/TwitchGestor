#!/usr/bin/env bash
# Costruisce Silver.exe (Windows 10/11, 64 bit) da Linux o da qualsiasi sistema con Go e llvm-windres.
#   uso: bash windows/silver/build.sh   → windows/Silver.exe
set -euo pipefail
cd "$(dirname "$0")"
WINDRES="$(command -v llvm-windres || command -v llvm-windres-18 || command -v x86_64-w64-mingw32-windres)"
(cd build && "$WINDRES" -O coff --target=x86_64-w64-mingw32 silver.rc -o ../rsrc_windows_amd64.syso)
# la versione di TwitchGestor con cui è stato costruito ("che versione sei?")
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' ../../package.json | head -1)"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui -X main.appVersion=$VERSION" -o ../Silver.exe .
echo "Pronto: windows/Silver.exe ($(du -h ../Silver.exe | cut -f1))"
