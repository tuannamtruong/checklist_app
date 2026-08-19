#!/usr/bin/env bash
# Builds the Android APK inside a container and drops it in bundles/.
#
# Nothing is installed on the host beyond the image itself — no JDK, no Android
# SDK — which is architecture.md §7.2's whole point. `make apk` is the way in;
# this script is what it runs.
#
# Usage:
#   scripts/build-apk.sh            debug APK -> bundles/checklist.apk
#   scripts/build-apk.sh clean      wipe the build output and the Gradle cache
#
# dist/ must already exist: the Gradle build copies it into the APK's assets so
# the phone cannot drift from the laptop. `make apk` builds it first.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
ANDROID="$ROOT/packaging/android"
IMAGE="${IMAGE:-checklist-android-builder}"
CACHE="$ANDROID/.gradle-cache"
OUT="$ROOT/bundles"

if [[ "${1:-}" == "clean" ]]; then
  rm -rf "$CACHE" "$ANDROID/app/build" "$ANDROID/.gradle" "$OUT/checklist.apk"
  echo "cleaned"
  exit 0
fi

# Named rather than discovered: a build that dies on `docker: not found` after
# ten minutes of Gradle is worse than one that refuses in a second.
if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not on PATH, and the APK is built inside a container." >&2
  echo "  Install Docker, or build packaging/android/ with your own Android SDK." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "docker is installed but not running (or this user cannot reach it)." >&2
  exit 1
fi

if [[ ! -d "$ROOT/dist" ]]; then
  echo "no dist/ to package. Run 'make build' first, or use 'make apk'." >&2
  exit 1
fi

echo "==> building image $IMAGE (cached after the first run)"
docker build -t "$IMAGE" "$ANDROID"

mkdir -p "$CACHE" "$OUT"

# The repo root is mounted rather than packaging/android/, because the Gradle
# build reaches up to dist/ for the web assets.
echo "==> building APK"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$ROOT":/workspace \
  -v "$CACHE":/gradle-home \
  -e GRADLE_USER_HOME=/gradle-home \
  -e ANDROID_USER_HOME=/gradle-home/.android \
  -e HOME=/gradle-home \
  -w /workspace/packaging/android \
  "$IMAGE" \
  gradle --no-daemon assembleDebug "$@"

APK="$ANDROID/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "$APK" ]]; then
  echo "the build reported success but there is no APK at $APK" >&2
  exit 1
fi

cp "$APK" "$OUT/checklist.apk"
echo
echo "==> $OUT/checklist.apk  ($(du -h "$OUT/checklist.apk" | cut -f1))"
echo "    Copy it to the phone and open it; Android asks to allow installing"
echo "    from this source the first time. It is signed with Gradle's debug"
echo "    keystore — enough to sideload, and it is not going near Play."
