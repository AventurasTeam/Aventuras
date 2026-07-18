#!/bin/bash
#
# Build the debug APK.
#
set -euo pipefail

# --- Android environment (from env vars, or auto-detected from default locations) ---
if [[ -z "${ANDROID_HOME:-}" && -n "${ANDROID_SDK_ROOT:-}" ]]; then
    export ANDROID_HOME="$ANDROID_SDK_ROOT"
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
    for d in "$HOME/Android/Sdk" "$HOME/Android/sdk" "$HOME/.local/share/Android/Sdk" /opt/android-sdk; do
        if [[ -d "$d" ]]; then export ANDROID_HOME="$d"; break; fi
    done
fi
# NDK: use NDK_HOME if set, otherwise the newest version under $ANDROID_HOME/ndk.
if [[ -z "${NDK_HOME:-}" && -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME/ndk" ]]; then
    NDK_LATEST="$(ls -1 "$ANDROID_HOME/ndk" 2>/dev/null | sort -V | tail -n1 || true)"
    [[ -n "$NDK_LATEST" ]] && export NDK_HOME="$ANDROID_HOME/ndk/$NDK_LATEST"
fi

if [[ -z "${ANDROID_HOME:-}" || -z "${NDK_HOME:-}" ]]; then
    echo "Error: SDK/NDK not found. Set ANDROID_HOME (or ANDROID_SDK_ROOT) and NDK_HOME." >&2
    exit 1
fi
echo "🔧 ANDROID_HOME=$ANDROID_HOME"
echo "🔧 NDK_HOME=$NDK_HOME"

# --- JDK compatible with Gradle (major 17-24; 25+ is not supported) ---
# Returns the major version ONLY if the dir is a real JDK (has javac).
jdk_major() {
    [[ -x "$1/bin/javac" && -r "$1/release" ]] || return 1
    sed -n 's/^JAVA_VERSION="\?\([0-9][0-9]*\).*/\1/p' "$1/release"
}
jdk_ok() {
    local m; m="$(jdk_major "$1" 2>/dev/null)" || return 1
    [[ -n "$m" && "$m" -ge 17 && "$m" -le 24 ]]
}
if [[ -z "${JAVA_HOME:-}" ]] || ! jdk_ok "${JAVA_HOME:-}"; then
    JAVA_HOME=""
    best_major=0
    # Scan all installed JVMs + the Android Studio JBR if present, picking the newest valid
    # JDK (e.g. 21 > 17). Name-agnostic (openjdk/temurin/...).
    for cand in /usr/lib/jvm/*/ "$HOME/android-studio/jbr" /opt/android-studio/jbr; do
        cand="${cand%/}"
        if jdk_ok "$cand"; then
            m="$(jdk_major "$cand")"
            if [[ "$m" -gt "$best_major" ]]; then best_major="$m"; JAVA_HOME="$cand"; fi
        fi
    done
    [[ -n "$JAVA_HOME" ]] && export JAVA_HOME
fi
if [[ -z "${JAVA_HOME:-}" ]] || ! jdk_ok "${JAVA_HOME:-}"; then
    echo "Error: a JDK 17-21 is required for Gradle (the default java, e.g. JDK 25, is not supported)." >&2
    echo "       Install a JDK 17-21 (e.g. temurin-21-jdk) or set JAVA_HOME manually." >&2
    exit 1
fi
export PATH="$JAVA_HOME/bin:$PATH"
echo "🔧 JAVA_HOME=$JAVA_HOME"

# --- Build (arm64-v8a only) ---
echo "🚀 Building APK (Debug, arm64-v8a)..."
npm run tauri -- android build --debug --target aarch64

echo "--------------------------------------------------"
echo "✅ Build completed."

# --- Locate the produced APK ---
APK_BASE="src-tauri/gen/android/app/build/outputs/apk"
APK_FILE="$(find "$APK_BASE" -name '*-debug.apk' 2>/dev/null | head -n1 || true)"
if [[ -n "$APK_FILE" ]]; then
    echo "📦 APK: $APK_FILE"
else
    echo "⚠️ APK not found under: $APK_BASE" >&2
    exit 1
fi
