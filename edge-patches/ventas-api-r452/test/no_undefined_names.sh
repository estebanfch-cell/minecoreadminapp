#!/bin/bash
# r452: ninguna variable sin declarar en ventas-api (TS2304). Uso: bash test/no_undefined_names.sh
cd "$(dirname "$0")/.." && n=$(deno check src/index.ts 2>&1 | grep -c "TS2304"); echo "TS2304: $n"; [ "$n" = "0" ]
