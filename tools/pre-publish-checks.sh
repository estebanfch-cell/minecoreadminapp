#!/usr/bin/env bash
# Checks locales antes de publicar un build del portal.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "== sintaxis JS =="
bash tools/check-js-syntax.sh --all
echo "== parser sintético =="
if [[ -f tests/solicitud-parse.mjs ]]; then
  node tests/solicitud-parse.mjs
fi
echo "OK pre-publish-checks"
