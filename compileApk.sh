#!/bin/bash

# Configurazione ambiente Android
export ANDROID_HOME="/home/pento/Android/Sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"

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
