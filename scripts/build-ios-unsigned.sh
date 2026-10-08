#!/bin/bash
#
# Build an UNSIGNED iOS-device (ARM64) .ipa for Aventuras.
#
# macOS only (Xcode/PlistBuddy/codesign). Run from the repo root — the Tauri CLI
# and cargo config discovery (.cargo/config.toml) both depend on the cwd.
#
# Usage: scripts/build-ios-unsigned.sh [--config <file> ...]
# Any arguments are forwarded verbatim to `tauri ios build`, so the --config list
# from .github/actions/build-version flows through unchanged. IPA_VERSION
# overrides the version in the .ipa filename (CI passes the resolved version,
# including the -sha suffix of a non-publishing build).
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

# Disable signing at the project level: neither the CLI's env defaults nor its
# `--` runner args reach `xcodebuild archive`, which fails on the missing
# development team otherwise. project.yml is what xcodegen re-renders the
# .xcodeproj from on every build, so patching it is what actually turns signing
# off. The patch is TEMPORARY: the original is backed up before patching and
# restored on exit, so a run never leaves a signing-disabled edit in the
# working tree for someone to commit by accident (gen/apple is tracked).
PROJECT_YML="src-tauri/gen/apple/project.yml"
if [[ ! -f "$PROJECT_YML" ]]; then
    echo "Error: $PROJECT_YML not found (run 'tauri ios init' first)." >&2
    exit 1
fi
# The restore trap is registered only after the backup copy succeeds: an empty
# or partial mktemp file must never be moved over the original on a failed run.
PROJECT_YML_BACKUP="$(mktemp)"
if ! cp "$PROJECT_YML" "$PROJECT_YML_BACKUP"; then
    rm -f "$PROJECT_YML_BACKUP"
    exit 1
fi
# BUILD_START (created below, before the build) is removed here too; guarded so
# the trap stays valid before it exists.
trap 'if [[ -f "$PROJECT_YML_BACKUP" ]]; then mv "$PROJECT_YML_BACKUP" "$PROJECT_YML"; echo "project.yml restored"; fi
if [[ -n "${BUILD_START:-}" ]]; then rm -f "$BUILD_START"; fi' EXIT
python3 - "$PROJECT_YML" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    lines = f.readlines()
if any('CODE_SIGNING_ALLOWED' in l for l in lines):
    sys.exit(0)
try:
    t = next(i for i, l in enumerate(lines) if l.rstrip('\n') == 'targets:')
    ios = next(i for i in range(t + 1, len(lines))
               if lines[i].rstrip('\n').endswith('_iOS:') and lines[i].startswith('  '))
    settings = next(i for i in range(ios + 1, len(lines))
                    if lines[i].rstrip('\n') == '    settings:')
except StopIteration:
    sys.exit('project.yml: iOS target settings section not found')
if lines[settings + 1].rstrip('\n') != '      base:':
    sys.exit('project.yml: unexpected settings layout')
lines[settings + 2:settings + 2] = [
    '        CODE_SIGNING_ALLOWED: NO\n',
    '        CODE_SIGNING_REQUIRED: NO\n',
    '        CODE_SIGN_IDENTITY: ""\n',
    '        CODE_SIGN_STYLE: Manual\n',
]
with open(path, 'w') as f:
    f.writelines(lines)
print('Patched project.yml for unsigned build (restored on exit)')
PYEOF
scripts/sync-ios-icons.sh
(cd src-tauri/gen/apple && xcodegen generate)
echo "🚀 Building unsigned iOS archive (aarch64)..."
# --archive-only: stop after `xcodebuild archive`, skip the CLI's IPA-export phase
# (which requires signing assets we deliberately do not have).
# --target aarch64: iOS device ARM64 (the CLI's shorthand for aarch64-apple-ios;
# it also accepts aarch64-sim and x86_64).
# BUILD_START scopes archive selection to THIS invocation: only an archive whose
# Info.plist was written after this point qualifies, so a stale archive left in
# a reused workspace (while the fresh one lands in DerivedData) can never be
# packaged by mistake.
# --ignore-version-mismatches: a minor-version skew between the tauri npm packages
# and crates is an error here, and the shared lockfiles are not this script's to fix.
BUILD_START="$(mktemp)"
npx tauri ios build --target aarch64 --archive-only --ignore-version-mismatches "$@"

# cargo-mobile2 sometimes archives into DerivedData instead of gen/apple/build,
# so search both in one pass. An archive qualifies only through a file written
# inside it during this run (every xcarchive has an Info.plist at its root) —
# not by directory mtime, which a reused workspace may have touched, and not by
# searching one location before the other, which let a stale build-dir archive
# win over the fresh DerivedData one.
ARCHIVE="$(
    find src-tauri/gen/apple/build "$HOME/Library/Developer/Xcode/DerivedData" \
        -name '*_iOS.xcarchive' -type d 2>/dev/null | while IFS= read -r d; do
        f="${d%/}/Info.plist"
        if [[ -f "$f" && "$f" -nt "$BUILD_START" ]]; then printf '%s\n' "$d"; fi
    done | sort | tail -n1
)"
if [[ -z "$ARCHIVE" ]]; then
    echo "Error: no *_iOS.xcarchive from this build found under src-tauri/gen/apple/build or Xcode DerivedData (archives from earlier runs are ignored)." >&2
    exit 1
fi
APP="$(find "$ARCHIVE/Products/Applications" -maxdepth 1 -name '*.app' -type d 2>/dev/null | head -n1)"
if [[ -z "$APP" ]]; then
    echo "Error: no .app found in $ARCHIVE/Products/Applications." >&2
    exit 1
fi
echo "📦 App bundle: $APP"

# Permission/ATS metadata live in src-tauri/Info.ios.plist, which the Tauri CLI
# merges into every build's Info.plist (including tauri ios dev and Xcode builds
# that never run this script). Assert they made it through rather than assume.
INFO_PLIST="$APP/Info.plist"
for key in NSCameraUsageDescription NSLocalNetworkUsageDescription ITSAppUsesNonExemptEncryption; do
    if ! "$PLIST_BUDDY" -c "Print :$key" "$INFO_PLIST" >/dev/null 2>&1; then
        echo "Error: $key missing from the built Info.plist (expected via src-tauri/Info.ios.plist)." >&2
        exit 1
    fi
done
if ! "$PLIST_BUDDY" -c 'Print :NSAppTransportSecurity:NSAllowsLocalNetworking' "$INFO_PLIST" >/dev/null 2>&1; then
    echo "Error: NSAppTransportSecurity:NSAllowsLocalNetworking missing from the built Info.plist (expected via src-tauri/Info.ios.plist)." >&2
    exit 1
fi

# The .ipa name takes the RESOLVED version (base + -sha suffix on CI builds) so
# its name matches the other platforms' assets and can never collide with a
# published release's. The built Info.plist itself carries only the base semver
# — the CLI refuses the -sha suffix there — so the version comes from IPA_VERSION
# (the workflow sets it from steps.version.outputs.version). It defaults to
# tauri.conf.json's version, the same source the --config list is merged from,
# so a plain local build names its .ipa correctly without extra setup.
IPA_VERSION="${IPA_VERSION:-$(node -p "require('./src-tauri/tauri.conf.json').version")}"
IPA_NAME="Aventuras_v${IPA_VERSION}_ios-arm64-unsigned.ipa"
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
# Each required path is checked on its own: an alternation would pass on either
# one alone.
IPA_LISTING="$(unzip -l "$IPA_NAME")"
for required in 'Payload/[^/]+\.app/Aventuras' 'Payload/[^/]+\.app/Info\.plist'; do
    if ! grep -qE "$required" <<<"$IPA_LISTING"; then
        echo "Error: $IPA_NAME is missing $required." >&2
        exit 1
    fi
done

echo "✅ Unsigned IPA: $IPA_NAME"
echo "$IPA_NAME"
