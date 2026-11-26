#!/usr/bin/env bash
# Guard permanente: todo <script> inline de las páginas del portal y todo .js
# del árbol debe parsear. Un SyntaxError aquí es lo que en b730 dejó a EFCH
# sin poder entrar (el script del login no llegaba a cargarse).
# Uso:
#   tools/check-js-syntax.sh            → index.html + .js del repo (o solo staged si hay GIT_INDEX)
#   tools/check-js-syntax.sh --all      → todo el árbol publicado (CI / publish)
#   tools/check-js-syntax.sh --self-test
set -u
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$root"
mode=${1:-}
fail=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

bad(){ echo "✖ $1"; fail=1; }
ok(){ echo "OK $1"; }

# Extrae scripts inline (sin src) y los chequea con node --check.
# No usa el parser de HTML de un navegador: un </script> dentro de un string
# JS cortaría el bloque (igual que en el navegador). Eso es deseable.
extract_and_check() {
  local html=$1
  python3 - "$html" "$tmp" <<'PY' || return 1
import sys, re, subprocess, pathlib
html_path, tmp = sys.argv[1], sys.argv[2]
raw = pathlib.Path(html_path).read_text("utf-8", "replace")
# Quitar comentarios HTML para no extraer scripts comentados
# (no tocamos JS).
fail = 0
scripts = []
# Scripts sin atributo src (con o sin type=text/javascript)
for i, m in enumerate(re.finditer(r"<script(\s[^>]*)?>(.*?)</script>", raw, re.I | re.S)):
    attrs = m.group(1) or ""
    if re.search(r"\bsrc\s*=", attrs, re.I):
        continue
    typ = ""
    tm = re.search(r"""\btype\s*=\s*['"]([^'"]+)['"]""", attrs, re.I)
    if tm:
        typ = tm.group(1).strip().lower()
        if typ and typ not in ("text/javascript", "application/javascript", "module", "text/ecmascript"):
            continue
    body = m.group(2)
    if not body.strip():
        continue
    start = raw[:m.start()].count("\n") + 1
    scripts.append((i, start, body, typ == "module"))
out_dir = pathlib.Path(tmp)
nfail = 0
for i, start, body, is_mod in scripts:
    p = out_dir / f"inline_{pathlib.Path(html_path).name}_{i}_L{start}.js"
    p.write_text(body)
    cmd = ["node", "--check", str(p)]
    # node --check no distingue module; SyntaxError es lo que nos importa
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "error").strip().splitlines()
        # node prints the temp path; show html line instead
        msg = " | ".join(err)[:400]
        print(f"✖ {html_path}: script inline en línea {start}: {msg}")
        nfail += 1
if nfail:
    sys.exit(1)
print(f"OK {html_path}: {len(scripts)} script(s) inline")
PY
}

check_js_file() {
  local f=$1
  if node --check "$f" 2>"$tmp/err"; then
    ok "$f"
  else
    # redact long paths but keep the error
    bad "$f: $(tr '\n' ' ' < "$tmp/err" | head -c 400)"
  fi
}

self_test() {
  mkdir -p "$tmp/self"
  printf '<script>var ok = 1;</script>\n' > "$tmp/self/ok.html"
  # El recorte de b730: un return { ... }; cierra el IIFE y deja "arseSolicitud:" suelto (Unexpected token ':').
  printf '%s\n' '<script>' 'return { parsear: function (t) { return t; }, parserOk: 1 };' '});' 'arseSolicitud: parseSolicitud, parsear: function (t) { return t; }' '});' '</script>' > "$tmp/self/bad.html"
  printf 'var ok=1;\n' > "$tmp/self/ok.js"
  printf '%s\n' 'return { parsear: 1 };' '});' 'arseSolicitud: 1,' > "$tmp/self/bad.js"
  extract_and_check "$tmp/self/ok.html" || { echo "self-test: ok.html debería pasar"; exit 1; }
  if extract_and_check "$tmp/self/bad.html"; then echo "self-test: bad.html debería fallar"; exit 1; fi
  node --check "$tmp/self/ok.js" || { echo "self-test: ok.js debería pasar"; exit 1; }
  if node --check "$tmp/self/bad.js" 2>/dev/null; then echo "self-test: bad.js debería fallar"; exit 1; fi
  echo "OK self-test del guard de sintaxis"
  exit 0
}

if [ "$mode" = "--self-test" ]; then self_test; fi

htmls="index.html preview.html firmar.html soporte.html privacidad.html"
# js del portal (no tests de fixtures binarios). Incluye assets/, caja.js, sw.js, etc.
if [ "$mode" = "--all" ] || [ "$mode" = "" ]; then
  for h in $htmls; do
    [ -f "$h" ] || continue
    extract_and_check "$h" || fail=1
  done
  # .js rastreados, salvo los que no son JS de runtime (ninguno especial)
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # ls-files + sin seguimiento (p. ej. un assets/*.js nuevo en el mismo commit)
    files=$( { git ls-files "*.js"; git ls-files --others --exclude-standard "*.js"; } | sort -u )
  else
    files=$(find . -name "*.js" -not -path "./.git/*" -not -path "./node_modules/*")
  fi
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      tests/*) continue ;;  # los tests se corren aparte; algunos son ESM con import
    esac
    check_js_file "$f"
  done <<< "$files"
fi

if [ "$fail" = 1 ]; then
  echo "Bloqueado: hay un error de sintaxis JavaScript. No publiques: en b730 esto dejó el login inútil."
  exit 1
fi
echo "OK: sintaxis JS del portal"
