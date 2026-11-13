#!/bin/bash
# Minecore — instala «Impresora Bodega (remota)» en esta Mac (Mac mini oficina).
# Agrega una opción en Imprimir > PDF ▾ de CUALQUIER app. No crea colas CUPS, no toca
# BODEGA_MCOR_ ni otras impresoras, no abre puertos. Pide un código del portal (10 min).
set -eu
say() { printf '%s\n' "$1"; }
die() { say "No se instaló: $1"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/Impresora Bodega (remota)"
[ -f "$SRC" ] || die "falta el archivo «Impresora Bodega (remota)» junto a este instalador."
CONFDIR="$HOME/Library/Application Support/Minecore"
CONF="$CONFDIR/epson-a4.conf"
API="https://bklbvwpkrdaojbezljsd.supabase.co/functions/v1/ventas-api"
if [ ! -f "$CONF" ]; then
  say "En el portal: 🖨 Impresora Bodega (remota) > «Código para la Mac de la oficina». Vale 10 minutos."
  printf 'Código: '
  read -r CODE
  printf '%s' "$CODE" | grep -Eq '^[A-Za-z0-9]{12}$' || die "el código no tiene la forma esperada."
  umask 077
  mkdir -p "$CONFDIR"; chmod 700 "$CONFDIR"
  OUT="$(mktemp -t mcpair)"
  LABEL="$(scutil --get ComputerName 2>/dev/null | tr -cd 'A-Za-z0-9 ._-' | cut -c1-50)"
  /usr/bin/curl -sS --max-time 30 -o "$OUT" -X POST "$API" -H 'content-type: application/json' -H 'x-doc-pair: 1' \
    -d "{\"op\":\"doc_pair_finish\",\"code\":\"$CODE\",\"label\":\"$LABEL\"}" || { rm -f "$OUT"; die "ventas-api no respondió."; }
  unset CODE
  TOKEN="$(/usr/bin/plutil -extract token raw -o - "$OUT" 2>/dev/null || true)"
  rm -f "$OUT"
  [ ${#TOKEN} -ge 32 ] || die "el código no sirvió (vencido o ya usado). Pide otro en el portal."
  printf 'SENDER_TOKEN=%s\n' "$TOKEN" > "$CONF"; chmod 600 "$CONF"
  unset TOKEN
  say "Vinculada (el token no se muestra)."
else
  say "Ya estaba vinculada; solo actualizo el archivo."
fi
DEST="$HOME/Library/PDF Services"
mkdir -p "$DEST"
rm -f "$DEST/Epson Bodega (remota)"
cp "$SRC" "$DEST/Impresora Bodega (remota)"
chmod 755 "$DEST/Impresora Bodega (remota)"
xattr -d com.apple.quarantine "$DEST/Impresora Bodega (remota)" 2>/dev/null || true
say ""
say "Listo. En cualquier app: Archivo > Imprimir > botón «PDF ▾» > «Impresora Bodega (remota)»."
say "Te pide cuántas copias (1–5) y lo manda a la impresora de bodega por el iMac. No imprimí nada."
say "Para quitarlo: borra ~/Library/PDF Services/Impresora Bodega (remota) y ~/Library/Application Support/Minecore."
