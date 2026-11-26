#!/usr/bin/env bash
# Humo post-deploy del portal en vivo (Chromium + WebKit).
# Si falla, el flujo de publicación debe revertir el merge (sin --force).
# Uso: tools/post-deploy-smoke.sh [--url URL] [--expect-build N] [--out DIR]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="https://portal.minecore.ec/"
EXPECT=""
OUT="/workspace/sol-cliente-claude/shots"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --expect-build) EXPECT="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "uso: $0 [--url URL] [--expect-build N] [--out DIR]" >&2; exit 2 ;;
  esac
done
# Espera a que Pages sirva el build esperado (cache max-age ~600s).
if [[ -n "$EXPECT" ]]; then
  echo "Esperando MC_BUILD=$EXPECT en $URL ..."
  ok=0
  for i in $(seq 1 36); do
    html=$(curl -fsSL -A "Mozilla/5.0 smoke" -H "Cache-Control: no-cache" "${URL}?ts=$(date +%s)") || true
    if printf '%s' "$html" | grep -q "var MC_BUILD='${EXPECT}'"; then
      echo "Live MC_BUILD=$EXPECT"
      ok=1
      break
    fi
    live=$(printf '%s' "$html" | grep -o "var MC_BUILD='[0-9]*'" | head -1 || true)
    echo "  intento $i: ${live:-sin respuesta}"
    sleep 10
  done
  if [[ $ok -ne 1 ]]; then
    echo "FAIL: no apareció MC_BUILD=$EXPECT en $URL" >&2
    exit 1
  fi
fi
python3 "$ROOT/tools/smoke-login.py" --url "$URL" --out "$OUT" --browsers chromium,webkit --widths 390,1280
