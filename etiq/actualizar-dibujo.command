#!/bin/bash
# Solo cambia el dibujo de la etiqueta. No pide cola ni código y no toca el vínculo.
set -eu
say() { printf '%s\n' "$1"; }
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.minecore-dymo"
[ -f "$HERE/bridge.py" ] || { say "Falta bridge.py junto a este archivo."; exit 1; }
if [ ! -f "$DEST/bridge.py" ]; then
  say "El puente de la v2 todavía no está instalado."
  say "Termina instalar-bodega.command. No hace falta otro código para el dibujo."
  exit 1
fi
cp "$HERE/bridge.py" "$DEST/bridge.py"
PLIST="$HOME/Library/LaunchAgents/com.minecore.dymo-clientes.plist"
if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load "$PLIST"
fi
say "Dibujo actualizado. La cola y el vínculo quedan como estaban."
say "No vuelvas a escribir el código."
