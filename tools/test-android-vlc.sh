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
adb pull /sdcard/Android/data/tv.lumen.app/files/vlc-tests "$ROOT/build/vlc-shots/"
if ! command -v tesseract >/dev/null; then sudo apt-get update -qq && sudo apt-get install -y tesseract-ocr; fi
# The real check: VLC itself must report that it opened Lumen's subtitle file and is decoding it.
VLC_SUB_LOG="$(adb logcat -d | grep -E "spu-es slave: file://.*Lumen-|demux: loaded [0-9]+ subtitles|using spu decoder module" || true)"
echo "VLC_SUBTITLE_LOG_BEGIN"; printf '%s\n' "$VLC_SUB_LOG" | tail -12; echo "VLC_SUBTITLE_LOG_END"
printf '%s\n' "$VLC_SUB_LOG" | grep -q "spu-es slave: file://.*Lumen-" || { echo "VLC never opened the subtitle file Lumen handed over" >&2; exit 1; }
printf '%s\n' "$VLC_SUB_LOG" | grep -Eq "demux: loaded [1-9][0-9]* subtitles" || { echo "VLC opened the subtitle file but found no lines in it" >&2; exit 1; }
printf '%s\n' "$VLC_SUB_LOG" | grep -q "using spu decoder module" || { echo "VLC did not start a subtitle decoder" >&2; exit 1; }
echo "VLC opened, parsed and selected the subtitle handed over by Lumen"
# Extra, informational: the words read off the tiny emulator screenshot (too small to rely on).
SUBTITLE_OCR="$(tesseract "$ROOT/build/vlc-shots/vlc-tests/vlc-subtitle-video.png" stdout --psm 11 2>/dev/null || true)"
printf '%s\n' "$SUBTITLE_OCR" | grep -Eiq 'LUMEN.*SUBTITLE.*HANDOFF.*TEST' && echo "Subtitle text also read off the screenshot" || echo "Subtitle text not legible in the 320-pixel screenshot (not a failure)"
