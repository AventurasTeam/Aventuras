#!/bin/bash
#
# Copy the Aventuras app icons (src-tauri/icons/ios) into the Xcode asset catalog.
#
# `tauri ios init` fills AppIcon.appiconset with Tauri's placeholder logo and no
# CLI step replaces it, so run this after init and before every build.
set -euo pipefail

SRC="src-tauri/icons/ios"
DEST="src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset"
if [[ ! -d "$DEST" ]]; then
    echo "Error: $DEST not found (run 'tauri ios init' first)." >&2
    exit 1
fi

cp "$SRC"/AppIcon-*.png "$DEST"/

# Every slot the catalog names must come from $SRC, or that slot keeps the Tauri logo.
python3 - "$SRC" "$DEST/Contents.json" <<'PYEOF'
import json, os, sys
src, contents = sys.argv[1], sys.argv[2]
with open(contents) as f:
    names = {i['filename'] for i in json.load(f)['images'] if 'filename' in i}
missing = sorted(n for n in names if not os.path.isfile(os.path.join(src, n)))
if missing:
    sys.exit(f'{contents} references icons missing from {src}: {", ".join(missing)}')
PYEOF
echo "iOS app icons synced from $SRC"
