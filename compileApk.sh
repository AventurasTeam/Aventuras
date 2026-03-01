#!/bin/bash

# Android environment must come from the host machine/CI.
# Prefer ANDROID_HOME, but allow ANDROID_SDK_ROOT as a fallback.
if [[ -z "${ANDROID_HOME:-}" && -n "${ANDROID_SDK_ROOT:-}" ]]; then
    export ANDROID_HOME="$ANDROID_SDK_ROOT"
fi

if [[ -z "${ANDROID_HOME:-}" || -z "${NDK_HOME:-}" ]]; then
    echo "Error: ANDROID_HOME (or ANDROID_SDK_ROOT) and NDK_HOME environment variables must be set." >&2
    exit 1
fi

echo "🚀 Avvio della compilazione APK (Debug)..."

# Esecuzione build Tauri
npm run tauri -- android build --debug

# Verifica se la build ha avuto successo
if [ $? -eq 0 ]; then
    echo "--------------------------------------------------"
    echo "✅ Compilazione completata con successo!"

    OUTPUT_DIR="src-tauri/gen/android/app/build/outputs/apk/universal/debug/"
    APK_FILE="$OUTPUT_DIR/app-universal-debug.apk"

    if [ -f "$APK_FILE" ]; then
        echo "📦 APK generato: $APK_FILE"
        echo "📂 Apertura cartella di output..."
        xdg-open "$OUTPUT_DIR"
    else
        echo "⚠️ Build terminata ma non trovo il file APK in: $OUTPUT_DIR"
    fi
else
    echo "--------------------------------------------------"
    echo "❌ Errore durante la compilazione."
    exit 1
fi
