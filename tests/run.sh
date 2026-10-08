#!/bin/bash
# Serve the game on port 8000, run one test script against it, then stop the server.
# Usage: bash tests/run.sh <script.js> [script args...]
cd "$(dirname "$0")/.."
python3 -m http.server 8000 >/dev/null 2>&1 & SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
sleep 1
node "tests/$1" "${@:2}"
