/**
 * Fail the build if wry stopped injecting the incognito-keyboard override into the generated
 * `RustWebView.kt`.
 *
 * The override is fed in through `.cargo/config.toml`'s `WRY_RUSTWEBVIEW_CLASS_EXTENSION` env
 * var, which wry substitutes into a `{{class-extension}}` placeholder in a gitignored,
 * regenerated-every-build file. That substitution is undocumented wry internals: a wry bump
 * that renames the env var or placeholder makes the override silently vanish, and the APK
 * still builds. Run this after `tauri android build` so that regression fails CI instead of
 * shipping a dead setting. See docs/development/release.md.
 *
 * Usage: node scripts/check_wry_injection.js [path/to/RustWebView.kt]
 */

import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

const configPath = resolve(rootDir, '.cargo/config.toml')
const generatedPath =
  process.argv[2] ??
  resolve(
    rootDir,
    'src-tauri/gen/android/app/src/main/java/com/karelian/aventura/generated/RustWebView.kt',
  )

function fail(message) {
  console.error(`check_wry_injection: ${message}`)
  process.exit(1)
}

const config = readFileSync(configPath, 'utf8')
const block = config.match(/WRY_RUSTWEBVIEW_CLASS_EXTENSION\s*=\s*"""\r?\n([\s\S]*?)"""/)?.[1]
if (!block) {
  fail(`WRY_RUSTWEBVIEW_CLASS_EXTENSION not found in ${configPath} — nothing to verify against`)
}

// Anchor the check to whatever the config injects today, so an edit to the snippet is
// tracked automatically rather than drifting from a hardcoded copy.
const required = block
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0)

for (const marker of ['onCreateInputConnection', 'IncognitoIme.apply(outAttrs)']) {
  if (!required.some((line) => line.includes(marker))) {
    fail(`${configPath} no longer injects \`${marker}\` — the incognito-keyboard hook was removed`)
  }
}

if (!existsSync(generatedPath)) {
  fail(
    `${generatedPath} does not exist — run \`npx tauri android build\` first, or pass the path as an argument`,
  )
}

const generated = readFileSync(generatedPath, 'utf8')
const missing = required.filter((line) => !generated.includes(line))
if (missing.length > 0) {
  fail(
    `${generatedPath} is missing the injected class extension:\n` +
      missing.map((line) => `  - ${line}`).join('\n') +
      `\n\nwry likely renamed the CLASS_EXTENSION env var or placeholder in a version bump; ` +
      `check wry's build.rs (see docs/development/release.md).`,
  )
}

console.log('check_wry_injection: incognito-keyboard override present in generated RustWebView.kt')
