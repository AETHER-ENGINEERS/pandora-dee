#!/usr/bin/env bash
# Build the web app: dist/pandora-dee.html (the claude.ai artifact / any static host),
# dist/tw.css and android/proj/assets/index.html (the phone page, CDN-free basics).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules/tailwindcss ] || { echo "Run npm ci first."; exit 1; }
python3 scripts/pack_xdc.py apps/jade-link dist/jade-link.xdc
# the Rust core for the browser; without a Rust toolchain the built copy in app/vendor is used
if command -v cargo >/dev/null && [ -x "$HOME/bin/wasm-bindgen" -o -n "$(command -v wasm-bindgen)" ]; then rust/build-wasm.sh; fi
python3 app/build.py
node app/tools/twbuild.mjs dist/pandora-dee.html dist/tw.css
python3 app/tools/build_index.py
