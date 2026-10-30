#!/usr/bin/env bash
# Bundles the TV interface into build/web and copies it into the Android assets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/web"
rm -rf "$OUT" && mkdir -p "$OUT/fonts"
npx --prefix "$ROOT" esbuild "$ROOT/web/src/app.js" --bundle --format=iife --target=chrome69 --minify --legal-comments=none --outfile="$OUT/app.js"
npx --prefix "$ROOT" esbuild "$ROOT/web/app.css" --minify --target=chrome80 --outfile="$OUT/app.css" --log-level=warning
cp "$ROOT/web/index.html" "$OUT/"
cp "$ROOT"/web/fonts/*.woff2 "$OUT/fonts/"
cp "$ROOT/assets/demo.mp4" "$OUT/"
ASSETS="$ROOT/android/app/src/main/assets/web"
if [ -d "$ROOT/android/app/src/main" ]; then
  rm -rf "$ASSETS" && mkdir -p "$ASSETS" && cp -r "$OUT"/. "$ASSETS"/
  mv "$ASSETS/demo.mp4" "$ROOT/android/app/src/main/assets/demo.mp4"
fi
du -sh "$OUT"/* | sed "s|$OUT/||"
