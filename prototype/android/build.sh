#!/usr/bin/env bash
# Builds the APK inside a container and drops it on the host. Nothing is
# installed on the host beyond the image itself — no JDK, no Android SDK.
#
#   ./build.sh              debug APK -> prototype/android/out/
#   ./build.sh clean        wipe build output and the Gradle cache
#
# The image doubles as the Jenkins agent; see README §6.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTOTYPE="$(dirname "$HERE")"
IMAGE="${IMAGE:-checklist-android-builder}"
CACHE="$HERE/.gradle-cache"
OUT="$HERE/out"

if [[ "${1:-}" == "clean" ]]; then
  rm -rf "$CACHE" "$OUT" "$HERE/app/build" "$HERE/.gradle"
  echo "cleaned"
  exit 0
fi

echo "==> building image $IMAGE (cached after the first run)"
docker build -t "$IMAGE" "$HERE"

mkdir -p "$CACHE" "$OUT"

# The whole prototype/ is mounted, not just android/: the Gradle build copies
# public/, core/ and adapters/ into the APK's assets, so there is one copy of
# the sync core and the phone can never drift from the laptop.
echo "==> building APK"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$PROTOTYPE":/workspace \
  -v "$CACHE":/gradle-home \
  -e GRADLE_USER_HOME=/gradle-home \
  -e ANDROID_USER_HOME=/gradle-home/.android \
  -e HOME=/gradle-home \
  -w /workspace/android \
  "$IMAGE" \
  gradle --no-daemon assembleDebug "$@"

APK="$HERE/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$APK" ]]; then
  echo "build reported success but no APK at $APK" >&2
  exit 1
fi

cp "$APK" "$OUT/checklist-sync.apk"
echo
echo "==> $OUT/checklist-sync.apk  ($(du -h "$OUT/checklist-sync.apk" | cut -f1))"
echo "    copy it to the phone and open it; Android will ask to allow installing"
echo "    from this source the first time."
