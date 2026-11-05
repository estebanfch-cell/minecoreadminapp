#!/bin/bash
# Solo cambia el dibujo del puente ya instalado.
# No pide código, no reescribe la cola y no toca otras impresoras.
set -eu
say() { printf '%s\n' "$1"; }
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.minecore-dymo"
CONF="$DEST/bridge.conf"
PLIST="$HOME/Library/LaunchAgents/com.minecore.dymo-clientes.plist"
[ -f "$HERE/bridge.py" ] || { say "Falta bridge.py junto a este archivo."; exit 1; }
[ -f "$DEST/bridge.py" ] || { say "Este Mac no tiene el puente. No se cambia nada."; exit 1; }
[ -f "$CONF" ] || { say "No está el vínculo. No se cambia nada."; exit 1; }
[ -f "$PLIST" ] || { say "No está el arranque del puente. No se cambia nada."; exit 1; }
QUEUE="$(awk -F= '/^CUPS_QUEUE=/{print $2}' "$CONF" | tr -d '\r')"
if [ "$QUEUE" != "DYMO_BODEGA" ]; then
  say "La cola configurada no es DYMO_BODEGA. No se toca esta máquina."
  exit 1
fi
cp "$DEST/bridge.py" "$DEST/bridge.py.bak-v4"
cp "$HERE/bridge.py" "$DEST/bridge.py"
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"
say "Dibujo v5 instalado. La cola y el vínculo siguen igual."
say "Para volver: en Terminal escribe cp, un espacio, arrastra bridge.py.bak-v4, otro espacio, arrastra bridge.py y pulsa Enter."
