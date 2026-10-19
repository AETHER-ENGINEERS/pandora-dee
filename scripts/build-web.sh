#!/usr/bin/env bash
# Build the web app: dist/jade-vault.html (the claude.ai artifact / any static host),
# dist/tw.css and android/proj/assets/index.html (the phone page, CDN-free basics).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules/tailwindcss ] || { echo "Run npm ci first."; exit 1; }
python3 scripts/pack_xdc.py apps/jade-link dist/jade-link.xdc
python3 app/build.py
node app/tools/twbuild.mjs dist/jade-vault.html dist/tw.css
python3 app/tools/build_index.py
