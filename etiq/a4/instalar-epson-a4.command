#!/bin/bash
# Minecore — agrega la Epson A4 al puente de bodega (iMac Catalina).
# NO toca el puente de etiquetas: bridge.py, bridge.conf, la cola DYMO y
# com.minecore.dymo-clientes quedan igual. No pide código: usa el vínculo que ya existe.
set -eu
say() { printf '%s\n' "$1"; }
die() { say "No se instaló: $1"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
HOME_MC="$HOME/.minecore-dymo"
DEST="$HOME_MC/a4"
DYMO_PLIST="$HOME/Library/LaunchAgents/com.minecore.dymo-clientes.plist"
PLIST="$HOME/Library/LaunchAgents/com.minecore.epson-a4.plist"
[ -f "$HERE/docbridge.py" ] || die "falta docbridge.py junto a este archivo."
[ -f "$HOME_MC/bridge.conf" ] || die "este Mac no tiene el puente de etiquetas vinculado (~/.minecore-dymo/bridge.conf)."
[ -f "$DYMO_PLIST" ] || die "no encuentro el arranque del puente de etiquetas."
# Mismo Python que ya usa el puente de etiquetas (python2.7 de Catalina). Nunca /usr/bin/python3.
PY="$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$DYMO_PLIST" 2>/dev/null || true)"
[ -n "$PY" ] && [ -x "$PY" ] || PY=/usr/bin/python2.7
[ "$PY" = "/usr/bin/python3" ] && PY=/usr/bin/python2.7
[ -x "$PY" ] || die "no hay Python usable ($PY)."
say "Python: $PY"
umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"
if [ -f "$DEST/docbridge.py" ]; then cp "$DEST/docbridge.py" "$DEST/docbridge.py.bak"; fi
cp "$HERE/docbridge.py" "$DEST/docbridge.py"
"$PY" -c 'import py_compile,sys; py_compile.compile(sys.argv[1], cfile=sys.argv[1]+".chk", doraise=True)' "$DEST/docbridge.py" || die "docbridge.py no compila con $PY."
rm -f "$DEST/docbridge.py.chk"
say ""
say "Impresoras que ve este iMac:"
"$PY" "$DEST/docbridge.py" --detectar || true
say ""
say "Si la cola elegida no es la Epson L4260 de bodega, escribe aquí el nombre EXACTO (o Enter para dejar la automática):"
read -r QUEUE || QUEUE=""
if [ -n "$QUEUE" ]; then
  printf '%s' "$QUEUE" | grep -Eq '^[A-Za-z0-9_.-]{1,80}$' || die "nombre de cola inválido."
  lpstat -p "$QUEUE" >/dev/null 2>&1 || die "CUPS no tiene la cola $QUEUE."
  case "$QUEUE" in *DYMO*|*dymo*|*450*) die "esa es una cola de etiquetas, no la A4." ;; esac
  printf 'A4_QUEUE=%s\n' "$QUEUE" > "$DEST/a4.conf"
  chmod 600 "$DEST/a4.conf"
fi
xml_escape() { printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.minecore.epson-a4</string>
<key>ProgramArguments</key>
<array><string>$(xml_escape "$PY")</string><string>$(xml_escape "$DEST/docbridge.py")</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>$(xml_escape "$DEST/a4.log")</string>
<key>StandardErrorPath</key><string>$(xml_escape "$DEST/a4.log")</string>
</dict></plist>
PL
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"
say ""
say "Listo: puente A4 cargado (com.minecore.epson-a4). El de etiquetas sigue igual."
say "Se actualiza solo desde el servidor y vuelve a la versión anterior si una nueva no arranca."
say "No se imprimió nada. La primera hoja la mandas tú desde el portal: «Imprimir remoto A4»."
