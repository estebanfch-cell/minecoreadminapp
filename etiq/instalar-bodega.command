#!/bin/bash
# Instalador del puente Minecore en el iMac de bodega (Catalina 10.15).
# Doble clic. Pide la cola CUPS y el código del portal. No abre puertos,
# no cambia el candado, FileVault ni el reposo, y no instala Python ni
# las herramientas de desarrollador de Apple.
set -eu
say() { printf '%s\n' "$1"; }
die() { say "No se instaló: $1"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/bridge.py" ] || die "falta bridge.py junto a este instalador."
[ -f "$HERE/pick-python.sh" ] || die "falta pick-python.sh junto a este instalador."
# shellcheck disable=SC1091
. "$HERE/pick-python.sh"

if [ -x "${MINECORE_USR_PYTHON3:-/usr/bin/python3}" ]; then
  say "No ejecuto /usr/bin/python3. En Catalina ese comando abre el cuadro de herramientas de Apple. Cancelar está bien."
fi

PY="$(minecore_pick_python)"
[ -n "$PY" ] || die "no hay un Python usable. Catalina ya trae /usr/bin/python2.7. No instalo Homebrew, Python ni las herramientas de Apple."
VER="$("$PY" -c 'import sys; sys.stdout.write("%d.%d.%d" % sys.version_info[:3])')"
say "Python: $PY ($VER). No instalo otro."

say "Colas CUPS de esta Mac:"
lpstat -p 2>/dev/null || say "(lpstat no listó colas)"
printf 'Nombre EXACTO de la cola de la DYMO LabelWriter Wireless (no la 450 USB): '
read -r QUEUE
printf '%s' "$QUEUE" | grep -Eq '^[A-Za-z0-9_-]{1,64}$' || die "nombre de cola inválido."
case "$QUEUE" in
  *450*) die "ese nombre parece la impresora de bodega 57×102. Esta cola es solo Clientes." ;;
esac
lpstat -p "$QUEUE" >/dev/null 2>&1 || die "CUPS no tiene la cola $QUEUE."

say "En el portal, EFCH u Oswal: Preparar orden, «Código para el iMac». Vale 10 minutos."
printf 'Código: '
read -r CODE
printf '%s' "$CODE" | grep -Eq '^[A-Za-z0-9]{6,32}$' || die "el código no tiene la forma esperada."

DEST="$HOME/.minecore-dymo"
umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"
cp "$HERE/bridge.py" "$DEST/bridge.py"
REQ="$(mktemp "$DEST/pair.XXXXXX")"
chmod 600 "$REQ"
printf '{"code":"%s","queue":"%s"}\n' "$CODE" "$QUEUE" > "$REQ"
unset CODE
if "$PY" "$DEST/bridge.py" --vincular "$REQ"; then
  rm -f "$REQ"
else
  rm -f "$REQ"
  die "no se pudo vincular. El código pudo vencer o ventas-api no respondió. No quedó un token en pantalla."
fi
[ -f "$DEST/bridge.conf" ] || die "no quedó la configuración."

xml_escape() { printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }
PY_XML="$(xml_escape "$PY")"
BR_XML="$(xml_escape "$DEST/bridge.py")"
LOG_XML="$(xml_escape "$DEST/puente.log")"
PLIST="$HOME/Library/LaunchAgents/com.minecore.dymo-clientes.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.minecore.dymo-clientes</string>
<key>ProgramArguments</key>
<array><string>${PY_XML}</string><string>${BR_XML}</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${LOG_XML}</string>
<key>StandardErrorPath</key><string>${LOG_XML}</string>
</dict></plist>
EOF
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"
say "Puente cargado para este usuario. Con la sesión iniciada sigue aunque la pantalla se bloquee."
say "No sigue si la Mac entra en reposo del sistema, se apaga o se cierra la sesión."
say "Después de reiniciar hay que entrar con la contraseña una vez. Esto no desbloquea FileVault solo."
pmset -g 2>/dev/null | grep -E 'sleep|displaysleep' || true
say "Si sleep del sistema no es 0, el puente se detiene cuando la Mac duerme. No lo cambié."
say "CUPS aceptó un trabajo no significa que la etiqueta ya salió. Mírala en la impresora."
