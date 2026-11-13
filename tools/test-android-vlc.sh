#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/build/vlc-shots"
trap 'adb pull /sdcard/Android/data/tv.lumen.app/files/vlc-tests "$ROOT/build/vlc-shots/" || true; adb logcat -d -t 2000 > "$ROOT/build/vlc-shots/android-logcat.txt"' EXIT
adb install -r -g /tmp/lumen-vlc-test.apk
cd "$ROOT/android"
chmod +x gradlew
./gradlew --no-daemon -PtorrentAbi=x86_64 -PtestVariant=release connectedReleaseAndroidTest
