#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/build/vlc-shots"
trap 'timeout 20 adb pull /sdcard/Android/data/tv.lumen.app/files/vlc-tests "$ROOT/build/vlc-shots/" || true; timeout 20 adb logcat -d -t 2500 > "$ROOT/build/vlc-shots/android-logcat.txt" || true' EXIT
adb install -r -g /tmp/lumen-vlc-test.apk
adb install -r "$ROOT/android/app/build/outputs/apk/release/app-release.apk"
adb install -r "$ROOT/android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk"
# UTP can wait indefinitely after a runner startup crash. Run the same compiled
# release instrumentation directly, with a strict process timeout and explicit results.
timeout --signal=INT --kill-after=15s 300 adb shell am instrument -w -r -e timeout_msec 90000 tv.lumen.app.test/androidx.test.runner.AndroidJUnitRunner | tee "$ROOT/build/vlc-shots/instrumentation.txt"
python3 "$ROOT/tools/check-instrumentation.py" "$ROOT/build/vlc-shots/instrumentation.txt"
