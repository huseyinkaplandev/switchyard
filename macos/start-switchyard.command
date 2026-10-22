#!/bin/bash
# Double-click in Finder (or run from a terminal) to build if needed, start Switchyard and open it.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d node_modules ]; then npm ci; fi
if [ ! -f ui/.next-build/BUILD_ID ]; then npm run build; fi
if ! curl -s -o /dev/null http://127.0.0.1:3010/; then
  (npm start >/dev/null 2>&1 &)
  for _ in $(seq 1 60); do
    curl -s -o /dev/null http://127.0.0.1:3010/ && break
    sleep 1
  done
fi
open "http://127.0.0.1:3010/"
