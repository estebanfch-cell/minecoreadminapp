#!/usr/bin/env bash
# Guard: que ningún fixture/test con datos reales de clientes o proveedores entre al repo (el repo es PÚBLICO).
# Uso: tools/check-no-real-data.sh            → revisa lo que está en stage (pre-commit)
#      tools/check-no-real-data.sh --all      → revisa todo el árbol (CI)
# Los fixtures de pruebas deben ser ANÓNIMOS (dominio .test/example.com, teléfonos +00…). Los datos reales van fuera del repo (variable COT_FX, etc.).
set -u
mode=${1:-staged}
if [ "$mode" = "--all" ]; then files=$(git ls-files); else files=$(git diff --cached --name-only --diff-filter=ACMR); fi
fail=0
bad(){ echo "✖ $1"; fail=1; }
while IFS= read -r f; do
  [ -z "$f" ] && continue
  lf=$(printf '%s' "$f" | tr 'A-Z' 'a-z')
  # 1) rutas prohibidas: carpetas de fixtures reales, fx_*.json, *.real.*, volcados de la DB
  case "$lf" in
    tests/fixtures/*|*/fixtures-real/*|fixtures-real/*|*/fx_*.json|fx_*.json|*.real.json|*.real.*|*dump*.json|*snapshot*.json|*_before.json|*_live.json)
      bad "$f: ruta de fixture/volcado prohibida (datos reales fuera del repo)"; continue;;
  esac
  # 2) contenido: solo tests/, *.json y archivos *fixture* (index.html y el código legítimo no se escanean)
  case "$lf" in tests/*|*.json|*fixture*) ;; *) continue;; esac
  if [ "$mode" = "--all" ]; then c=$(cat -- "$f" 2>/dev/null); else c=$(git show ":$f" 2>/dev/null); fi
  [ -z "$c" ] && continue
  em=$(printf '%s' "$c" | grep -oiE '[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}\b' | grep -viE '@(minecore\.ec|example\.(com|org|net)|empresa\.com|[a-z0-9.-]*\.test|[a-z0-9.-]*\.invalid|[a-z0-9.-]*\.example)$' | sort -u | head -5)
  [ -n "$em" ] && bad "$f: email real: $(echo $em)"
  # teléfono: con prefijo internacional explícito, o en un campo phone/telefono; los de ejemplo (0991234567, 0999999999, +00…) se permiten
  ph=$( { printf '%s' "$c" | grep -oE '(^|[^0-9A-Za-z-])\+(593|51|57|56|1)[ -]?\(?[0-9]{1,3}\)?[ -]?[0-9]{3}[ -]?[0-9]{3,4}\b' ; printf '%s' "$c" | grep -oiE '"?(phone|telefono|teléfono|celular|movil|móvil|whatsapp|su-tel)"? *[:=] *["'"'"'][^"'"'"']*[0-9]{7,}' ; } | grep -vE '0991234567|0999999999|0987654321|\+0' | sort -u | head -5)
  [ -n "$ph" ] && bad "$f: teléfono real: $(echo $ph)"
  ruc=$(printf '%s' "$c" | grep -oE '"(ruc|cedula|cédula|identificacion|tax_id|tax_number)"[^,}]*' | grep -E '[0-9]{10,13}' | head -3)
  [ -n "$ruc" ] && bad "$f: RUC/cédula real: $(echo $ruc)"
  ct=$(printf '%s' "$c" | grep -oE '"(contact_name|contacto)" *: *"[^"]+"' | grep -viE 'demo|prueba|test|ejemplo|ana |juan p' | head -3)
  [ -n "$ct" ] && bad "$f: nombre de contacto real: $(echo $ct)"
done <<< "$files"
if [ $fail = 1 ]; then echo "Bloqueado: hay datos reales de clientes/proveedores. Anonimiza el fixture o déjalo fuera del repo (repo público)."; exit 1; fi
echo "OK: sin datos reales en fixtures/tests"
