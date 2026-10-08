#!/bin/bash
# Fetch a Node whose V8 is >= 15 for the node sim runner (tests/node_sim.js) into ~/.cache/fleet-battle/node.
# Why: Chrome >= 150 (V8 15) computes Math.sin/cos/atan2/exp/pow/... with LLVM libc; every stable Node up to 26.x
# (V8 14) still uses fdlibm, which differs in the last bit and makes seeded rounds diverge from the browser.
# Until a stable Node ships V8 15, this takes a nodejs.org v8-canary build (official, unsigned nightly).
# The pinned build below was verified bit-identical to the Playwright headless shell 1243 (Chrome 153, V8 15.3) with
#   node tests/determinism.js --cross 1,2,3 300 --modes browser,node
# Usage: bash tests/get_node.sh [version]   (default: the pinned version; DEST=dir overrides the install dir)
set -euo pipefail
VER=${1:-v27.0.0-v8-canary202610080b48125b51}
DEST=${DEST:-$HOME/.cache/fleet-battle/node}
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLAT=darwin-arm64 ;;
  Darwin-x86_64) PLAT=darwin-x64 ;;
  Linux-x86_64) PLAT=linux-x64 ;;
  Linux-aarch64) PLAT=linux-arm64 ;;
  *) echo "unsupported platform $(uname -s)-$(uname -m)"; exit 1 ;;
esac
URL=https://nodejs.org/download/v8-canary/$VER/node-$VER-$PLAT.tar.gz
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "downloading $URL"
curl -fL --progress-bar -o "$TMP/node.tar.gz" "$URL"
mkdir -p "$TMP/x"
tar xzf "$TMP/node.tar.gz" -C "$TMP/x"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$TMP/x/node-$VER-$PLAT" "$DEST"
echo "installed: $DEST/bin/node  (V8 $("$DEST/bin/node" -p process.versions.v8))"
