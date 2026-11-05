#!/bin/bash
# Instalador del puente Minecore en el iMac de bodega (Catalina).
# No abre puertos, no cambia el candado de pantalla, no toca FileVault ni el reposo.
# El token no se imprime. Hay que tener un código de un solo uso del portal.
set -eu
say() { printf '%s\n' "$1"; }
die() { say "No se instaló: $1"; exit 1; }

DEST="$HOME/minecore-dymo"
PY=""
for c in python3 python2.7 python2 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
[ -n "$PY" ] || die "no hay Python en esta Mac. No instalo Homebrew ni Python por mi cuenta."

HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/bridge.py" ] || die "falta bridge.py junto a este instalador."

say "Python: $PY"
"$PY" -c 'import sys; raise SystemExit(0 if sys.version_info[0]>=2 else 1)' || die "Python demasiado viejo."

say "Colas CUPS de esta Mac:"
lpstat -p 2>/dev/null || say "(lpstat no listó colas)"
printf 'Nombre EXACTO de la cola de la DYMO LabelWriter Wireless (no la 450 USB): '
read -r QUEUE
printf '%s' "$QUEUE" | grep -Eq '^[A-Za-z0-9_-]{1,64}$' || die "nombre de cola inválido."
case "$QUEUE" in
  *450*) die "ese nombre parece la impresora de bodega 57×102. Esta cola es solo Clientes." ;;
esac
lpstat -p "$QUEUE" >/dev/null 2>&1 || die "CUPS no tiene la cola $QUEUE."

say "En el portal, con el permiso de imprimir etiquetas, pide un código de vincular (vale 10 minutos)."
printf 'Código: '
read -r CODE
[ -n "$CODE" ] || die "sin código."

mkdir -p "$DEST"
cp "$HERE/bridge.py" "$DEST/bridge.py"
RESP="$(mktemp)"
"$PY" - "$CODE" "$RESP" <<'PY'
import json,sys
sys.path.insert(0,".")
# el código se manda una vez; la respuesta con el token se escribe en un archivo, no en pantalla
code, path = sys.argv[1], sys.argv[2]
try:
    from urllib.request import Request, urlopen
except ImportError:
    from urllib2 import Request, urlopen
body=json.dumps({"op":"etiq_pair_finish","code":code.strip().upper()}).encode("utf-8")
req=Request("https://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/ventas-api", data=body)
req.add_header("Content-Type","application/json")
req.add_header("x-etiq-pair","1")
try:
    res=urlopen(req, timeout=25)
    raw=res.read()
except Exception as e:
    sys.stderr.write("sin servicio: %s\n"%e.__class__.__name__)
    sys.exit(2)
if not isinstance(raw, str):
    raw=raw.decode("utf-8","replace")
open(path,"w").write(raw)
PY
EC=$?
if [ "$EC" != 0 ]; then rm -f "$RESP"; die "ventas-api no entregó el vínculo. El servicio puede no estar desplegado todavía."; fi
TOKEN="$("$PY" -c 'import json,sys; d=json.load(open(sys.argv[1]));
import sys as s
ok=d.get("ok") and d.get("token") and d.get("physically_printed") is False
s.stdout.write(d.get("token","") if ok else "")' "$RESP")"
rm -f "$RESP"
[ -n "$TOKEN" ] || die "el código no sirvió o el servicio respondió otra cosa. No quedó token."

umask 077
cat > "$DEST/bridge.conf" <<EOF
BRIDGE_TOKEN=$TOKEN
CUPS_QUEUE=$QUEUE
API_BASE=https://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/ventas-api
EOF
chmod 600 "$DEST/bridge.conf"
unset TOKEN

PLIST="$HOME/Library/LaunchAgents/com.minecore.dymo-clientes.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.minecore.dymo-clientes</string>
<key>ProgramArguments</key>
<array><string>$PY</string><string>$DEST/bridge.py</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
</dict></plist>
EOF
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"
say "Puente cargado para este usuario. Con la sesión iniciada sigue aunque la pantalla se bloquee."
say "No sigue si la Mac entra en reposo del sistema, se apaga o se cierra la sesión."
say "Después de reiniciar hay que entrar con la contraseña una vez. Esto no desbloquea FileVault solo."
pmset -g 2>/dev/null | grep -E 'sleep|displaysleep' || true
say "Si sleep del sistema no es 0, el puente se detiene cuando la Mac duerme. No lo cambié."
