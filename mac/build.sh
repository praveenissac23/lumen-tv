#!/usr/bin/env bash
# Builds "Lumen TV.app" for Apple-chip Macs. Runs on GitHub's macOS machines (see .github/workflows/build-mac.yml).
# Needs the interface already bundled into build/web (tools/build-web.sh).
set -euo pipefail
cd "$(dirname "$0")"
# Report failures as annotations (readable through the GitHub API) as well as in the log.
note() { echo "::error title=$1::$(printf '%s' "$2" | head -c 3500 | awk 'BEGIN{ORS="%0A"}{gsub(/%/,"%25");gsub(/\r/,"");print}')"; }
trap 'note "build.sh failed at line $LINENO" "$(tail -40 build.log 2>/dev/null)"' ERR
ROOT="$(cd .. && pwd)"
BUILD="${BUILD_NUMBER:-1}"
VLC_URL="https://download.videolan.org/pub/cocoapods/prod/VLCKit-3.7.3-319ed2c0-79128878.tar.xz"
VLC_SHA="019afdae4e2e2d0f3ac325fac8f7ba0af25dca70b9d157df7d60db88e0be8e5d"

# 1. VLC engine (cached between builds)
mkdir -p vendor
if [ ! -d vendor/VLCKit.xcframework ]; then
  curl -fL --retry 3 -o vendor/vlckit.tar.xz "$VLC_URL"
  echo "$VLC_SHA  vendor/vlckit.tar.xz" | shasum -a 256 -c -
  mkdir -p vendor/x && tar -xJf vendor/vlckit.tar.xz -C vendor/x
  mv "$(find vendor/x -type d -name VLCKit.xcframework | head -1)" vendor/VLCKit.xcframework
  rm -rf vendor/x vendor/vlckit.tar.xz
fi
SLICE="$(find vendor/VLCKit.xcframework -maxdepth 1 -type d -name 'macos*' | head -1)"
echo "VLCKit slice: $SLICE"; ls "$SLICE"
file "$SLICE/VLCKit.framework/VLCKit" | tee build.log || true
echo "::notice title=VLCKit::$(ls "$SLICE" | tr '\n' ' ') | $(file -b "$SLICE/VLCKit.framework/VLCKit" | head -c 300) | headers: $(ls "$SLICE/VLCKit.framework/Headers" | head -5 | tr '\n' ' ') | modules: $(ls "$SLICE/VLCKit.framework/Modules" 2>/dev/null | tr '\n' ' ')"

# 2. Compile
APP="build/Lumen TV.app"
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks"
if ! swiftc -O -swift-version 5 -target arm64-apple-macos11.0 \
  -import-objc-header Bridging.h -F "$SLICE" -Xcc -F -Xcc "$SLICE" \
  -framework VLCKit -framework Cocoa -framework WebKit -lsqlite3 \
  -Xlinker -rpath -Xlinker @executable_path/../Frameworks \
  Sources/*.swift -o "$APP/Contents/MacOS/LumenTV" > build.log 2>&1; then
  cat build.log
  grep -E "error:|Undefined symbol|ld: |referenced from" build.log | head -25 > errors.txt || true
  i=0; while IFS= read -r line; do i=$((i+1)); echo "::error title=swift $i::$line"; done < errors.txt
  trap - ERR
  exit 1
fi
cat build.log
test -x "$APP/Contents/MacOS/LumenTV"

# 3. Bundle
ditto "$SLICE/VLCKit.framework" "$APP/Contents/Frameworks/VLCKit.framework"
ditto "$ROOT/build/web" "$APP/Contents/Resources/web"
cp shim.js "$APP/Contents/Resources/shim.js"
sed "s/__BUILD__/$BUILD/g" Info.plist > "$APP/Contents/Info.plist"
ICONSET=build/AppIcon.iconset; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ROOT/design/icon-512.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); sips -z $d $d "$ROOT/design/icon-512.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# 4. Ad-hoc signature (required to run on Apple chips) and zip
codesign --force --deep --sign - "$APP"
codesign --verify --deep --verbose=2 "$APP"
(cd build && ditto -c -k --keepParent "Lumen TV.app" lumen-tv-mac.zip)
ls -la build
