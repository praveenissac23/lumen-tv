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
echo "VLC_SUBTITLE_LOG_BEGIN"
adb shell ls -la /sdcard/Android/data/tv.lumen.app/files/subs/ 2>&1 | head -5 || true
grep -Ei "Lumen-|slave|\.srt|subtitle|subsdec|spu|EACCES|denied|freetype" "$ROOT/build/vlc-shots/android-logcat.txt" 2>/dev/null | tail -80 || true
adb logcat -d | grep -Ei "Lumen-|slave|\.srt|subtitle|subsdec| spu|EACCES|denied|freetype" | tail -120 || true
echo "VLC_SUBTITLE_LOG_END"
SUBTITLE_OCR="$(tesseract "$ROOT/build/vlc-shots/vlc-tests/vlc-subtitle-video.png" stdout --psm 11 2>/dev/null)"
printf '%s\n' "$SUBTITLE_OCR"
printf '%s\n' "$SUBTITLE_OCR" | grep -Eiq 'LUMEN.*SUBTITLE.*HANDOFF.*TEST' || {
  echo "VLC played the video but did not visibly render the supplied SRT" >&2
  echo "SUBTITLE_SCREENSHOT_B64_BEGIN"
  base64 -w0 "$ROOT/build/vlc-shots/vlc-tests/vlc-subtitle-video.png"
  echo
  echo "SUBTITLE_SCREENSHOT_B64_END"
  adb logcat -d -t 2500 | grep -Ei "subtitle|subrip|permission denied|no access|fileprovider" | tail -80 || true
  exit 1
}
