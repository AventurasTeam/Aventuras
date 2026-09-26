#!/bin/bash
#
# Build an UNSIGNED iOS-device (ARM64) .ipa for Aventuras.
#
# macOS only (Xcode/PlistBuddy/codesign). Run from the repo root — the Tauri CLI
# and cargo config discovery (.cargo/config.toml) both depend on the cwd.
#
# Usage: scripts/build-ios-unsigned.sh [--config <file> ...]
# Any arguments are forwarded verbatim to `tauri ios build`, so the --config list
# from .github/actions/build-version flows through unchanged.
#
# Produces: Aventuras_v<version>_ios-arm64-unsigned.ipa (and echoes its path).
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "Error: iOS builds require macOS (xcodebuild, PlistBuddy, codesign)." >&2
    exit 1
fi
if [[ ! -f src-tauri/tauri.conf.json ]]; then
    echo "Error: run from the repository root (src-tauri/tauri.conf.json not found)." >&2
    exit 1
fi
for tool in xcodebuild plutil lipo codesign; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Error: $tool not found. Install Xcode (xcode-select --install)." >&2
        exit 1
    fi
done
PLIST_BUDDY="$(command -v PlistBuddy || echo /usr/libexec/PlistBuddy)"
if [[ ! -x "$PLIST_BUDDY" ]]; then
    echo "Error: PlistBuddy not found. Install Xcode (xcode-select --install)." >&2
    exit 1
fi

echo "🚀 Building unsigned iOS archive (aarch64-apple-ios)..."
# --archive-only: stop after `xcodebuild archive`, skip the CLI's IPA-export phase
# (which requires signing assets we deliberately do not have). With no signing
# configuration, the Tauri CLI itself passes CODE_SIGNING_ALLOWED=NO,
# CODE_SIGNING_REQUIRED=NO and CODE_SIGN_IDENTITY="" to xcodebuild.
# --target aarch64: iOS device ARM64 (the CLI's shorthand for aarch64-apple-ios;
# it also accepts aarch64-sim and x86_64).
# "$@" (the --config list) stays before `--`: everything after it is passed to
# xcodebuild as build settings, which override the project's automatic signing
# and make the team requirement moot — this is what actually disables signing
# (the CLI's env defaults do not reach the archive).
npx tauri ios build --target aarch64 --archive-only "$@" -- \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY=""

ARCHIVE="$(find src-tauri/gen/apple/build -name '*_iOS.xcarchive' -type d 2>/dev/null | sort | tail -n1)"
if [[ -z "$ARCHIVE" ]]; then
    # cargo-mobile2 sometimes archives into DerivedData instead of gen/apple/build.
    ARCHIVE="$(find "$HOME/Library/Developer/Xcode/DerivedData" -name '*_iOS.xcarchive' -type d 2>/dev/null | sort | tail -n1)"
fi
if [[ -z "$ARCHIVE" ]]; then
    echo "Error: no *_iOS.xcarchive found under src-tauri/gen/apple/build or Xcode DerivedData." >&2
    exit 1
fi
APP="$(find "$ARCHIVE/Products/Applications" -maxdepth 1 -name '*.app' -type d 2>/dev/null | head -n1)"
if [[ -z "$APP" ]]; then
    echo "Error: no .app found in $ARCHIVE/Products/Applications." >&2
    exit 1
fi
echo "📦 App bundle: $APP"

# iOS-specific permission/ATS metadata, mirrored from gen/android's
# AndroidManifest.xml. Merged here (not committed into gen/apple) so a fresh
# `tauri ios init` never needs hand-editing before a build. Idempotent.
INFO_PLIST="$APP/Info.plist"
inject_plist() {
    local key="$1" type="$2" value="$3"
    if ! "$PLIST_BUDDY" -c "Print :$key" "$INFO_PLIST" >/dev/null 2>&1; then
        "$PLIST_BUDDY" -c "Add :$key $type $value" "$INFO_PLIST"
    fi
}
inject_plist NSCameraUsageDescription string "Scan QR codes to pair devices for local story sync."
inject_plist NSLocalNetworkUsageDescription string "Aventuras uses the local network to sync stories directly between your devices."
inject_plist ITSAppUsesNonExemptEncryption bool false
"$PLIST_BUDDY" -c "Add :NSAppTransportSecurity dict" "$INFO_PLIST" 2>/dev/null || true
"$PLIST_BUDDY" -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$INFO_PLIST" 2>/dev/null || true

VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
IPA_NAME="Aventuras_v${VERSION}_ios-arm64-unsigned.ipa"
rm -rf Payload "$IPA_NAME"
mkdir Payload
cp -R "$APP" Payload/
zip -qry "$IPA_NAME" Payload
rm -rf Payload

# --- Verify the artifact actually is what it claims to be ---
BINARY="$APP/$(basename "$APP" .app)"
if [[ ! -f "$BINARY" ]]; then
    echo "Error: executable $BINARY not found in app bundle." >&2
    exit 1
fi
ARCH="$(lipo -info "$BINARY")"
if [[ "$ARCH" != *arm64* ]]; then
    echo "Error: binary is not arm64 (lipo says: $ARCH)." >&2
    exit 1
fi
if codesign -dv "$APP" >/dev/null 2>&1; then
    echo "Error: app bundle is signed; expected unsigned." >&2
    exit 1
fi
if ! unzip -l "$IPA_NAME" | grep -qE 'Payload/[^/]+\.app/(Aventuras|Info\.plist)'; then
    echo "Error: $IPA_NAME is missing Payload/<app>/Aventuras or Info.plist." >&2
    exit 1
fi

echo "✅ Unsigned IPA: $IPA_NAME"
echo "$IPA_NAME"
