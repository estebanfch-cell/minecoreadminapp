#!/bin/bash
# El stub de /usr/bin/python3 no debe ejecutarse. Bash con set -eu, como el instalador.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
. "$ROOT/etiq/pick-python.sh"

fail() { printf 'FAIL %s\n' "$1" >&2; exit 1; }

MARK="$(mktemp)"
rm -f "$MARK"
FIX="$(mktemp -d)"
mkdir -p "$FIX/usr/bin" "$FIX/good"

cat > "$FIX/usr/bin/python3" <<'EOF'
#!/bin/sh
printf 'DIALOG\n' >> "$MINECORE_MARK"
exit 1
EOF
cat > "$FIX/good/python3-stub" <<'EOF'
#!/bin/sh
# libxcselect.dylib
printf 'DIALOG\n' >> "$MINECORE_MARK"
exit 1
EOF
cat > "$FIX/good/python2.7" <<'EOF'
#!/bin/sh
case "$2" in
  *stdout.write*) printf '2.7'; exit 0 ;;
  *version_info*) exit 0 ;;
esac
exit 1
EOF
cat > "$FIX/good/python3" <<'EOF'
#!/bin/sh
case "$2" in
  *stdout.write*) printf '3.8'; exit 0 ;;
  *version_info*) exit 0 ;;
esac
exit 1
EOF
chmod 755 "$FIX/usr/bin/python3" "$FIX/good/python3-stub" "$FIX/good/python2.7" "$FIX/good/python3"

export MINECORE_MARK="$MARK"
export MINECORE_USR_PYTHON3="$FIX/usr/bin/python3"

export MINECORE_PY_LIST="$FIX/usr/bin/python3:$FIX/good/python3-stub:$FIX/good/python2.7"
got="$(minecore_pick_python)"
[ "$got" = "$FIX/good/python2.7" ] || fail "eligio $got"
[ ! -s "$MARK" ] || fail "ejecuto un stub"

export MINECORE_PY_LIST="$FIX/usr/bin/python3:$FIX/good/python3:$FIX/good/python2.7"
got="$(minecore_pick_python)"
[ "$got" = "$FIX/good/python3" ] || fail "no prefirio python3 real: $got"
[ ! -s "$MARK" ] || fail "el stub corrio al haber python3"

# python3 que no arranca: se sigue con 2.7, sin tocar el stub
cat > "$FIX/good/python3-roto" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod 755 "$FIX/good/python3-roto"
export MINECORE_PY_LIST="$FIX/usr/bin/python3:$FIX/good/python3-roto:$FIX/good/python2.7"
got="$(minecore_pick_python)"
[ "$got" = "$FIX/good/python2.7" ] || fail "no cayo a 2.7: $got"

if [ -x /tmp/py27root/usr/bin/python2.7 ] && [ -x /usr/bin/python3.12 ]; then
  export LD_LIBRARY_PATH="/tmp/py27root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export MINECORE_PY_LIST="$FIX/usr/bin/python3:/usr/bin/python3.12:/tmp/py27root/usr/bin/python2.7"
  got="$(minecore_pick_python)"
  [ "$got" = /usr/bin/python3.12 ] || fail "runtime 3: $got"
  export MINECORE_PY_LIST="$FIX/usr/bin/python3:/tmp/py27root/usr/bin/python2.7"
  got="$(minecore_pick_python)"
  [ "$got" = /tmp/py27root/usr/bin/python2.7 ] || fail "runtime 2.7: $got"
  [ ! -s "$MARK" ] || fail "stub durante el runtime real"
fi

CMD="$ROOT/etiq/instalar-bodega.command"
grep -q 'command -v' "$CMD" && fail "el instalador usa command -v"
grep -q 'demasiado viejo' "$CMD" && fail "el instalador sigue diciendo demasiado viejo"
grep -q 'minecore_pick_python' "$CMD" || fail "no usa el selector"
grep -q 'echo "$TOKEN"' "$CMD" && fail "imprime TOKEN"
grep -q 'BRIDGE_TOKEN' "$CMD" && fail "el instalador arma el token"
grep -q '\-\-vincular' "$CMD" || fail "no vincula por archivo"
[ -x "$CMD" ] || fail "el .command no es ejecutable"

rm -rf "$FIX" "$MARK"
printf 'etiq-pick-python OK\n'
