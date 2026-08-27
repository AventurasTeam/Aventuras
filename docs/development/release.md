# Release, CI and Updates

How a build reaches a user, and why publishing the draft is the step that ships it.

## Git Hooks

Managed by [lefthook](https://github.com/evilmartians/lefthook) (`lefthook.yml`):

- **pre-commit**: runs `scripts/check_migrations.js` against staged `src-tauri/migrations/*.sql` files to
  reject CRLF line endings.
- **pre-push**: runs `npm run lint` and `npm run check` (type-checking).

## Continuous Integration

GitHub Actions workflows in `.github/workflows/`:

- **`lint-and-typecheck.yml`** - runs `build`, `lint`, and `check` on every pull request targeting
  `master`, `develop`, or `dev`.
- **`release.yml`** - triggered by pushing a stable version tag (`vX.Y.Z`). Builds signed desktop
  binaries for Linux, Windows, macOS (Intel + Apple Silicon) via `tauri-apps/tauri-action`, plus a signed
  Android APK, and publishes them as a draft GitHub release with auto-updater metadata.
- **`ci.yml`** ("Pre-release") - triggered by pushing a pre-release tag (`vX.Y.Z-pre.N`). Same build
  matrix as `release.yml`, but publishes a non-draft **pre-release** without updater metadata.

Both release workflows expect `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` and the `ANDROID_KEYSTORE_*` /
`ANDROID_KEY_*` secrets to be configured on the repository.

## The Updater

`src/lib/services/updater.ts` answers one question on two platforms that share no machinery
for it. `UpdateInfo.canInstallInApp` is the flag that tells them apart, and the dialog
(`src/lib/components/updater/UpdateDialog.svelte`) branches on it rather than on the platform.

**Desktop** uses `@tauri-apps/plugin-updater`: it fetches the `latest.json` named by the
`updater.endpoints` entry in `tauri.conf.json`, verifies its signature against the `pubkey`
there, and installs the new build itself.

**Android has no updater at all, and this is not a configuration problem.**
`tauri-plugin-updater` declares Android support level `none`, and its `updater_os()` has
branches for linux/macos/windows only — on Android `target_os` is `"android"`, so `check()`
returns `UnsupportedOs` before a single request is sent. There is no install path either: an
APK is installed by the system package installer, not by the app it replaces. The Android
path therefore calls the GitHub Releases API directly, compares the tag against `getVersion()`
using `src/lib/utils/version.ts`, and opens the `.apk` asset in the browser. String comparison
is not adequate for that — `'0.10.0' > '0.9.0'` is false lexically — which is why the
comparison is a tested module of its own.

Two things must stay in step, or the platforms will offer different versions to their users:
the `RELEASE_REPO` constant in `updater.ts` and the `updater.endpoints` URL in
`tauri.conf.json`.

**A draft release is invisible to the updater.** `release.yml` publishes with
`releaseDraft: true`, and both paths resolve `/releases/latest`, which GitHub defines as the
latest **published, non-pre-release** release. Until the draft is published by hand, the
desktop endpoint 404s and the API returns the previous release — so the last step of every
release is publishing the draft on GitHub. Nothing reaches users before that.

The desktop check surfaces that state honestly rather than as a generic failure: a 404 becomes
the `no-release` kind ("it may still be a draft"), distinct from `network` and `unsupported`.

**The release notes users read are the GitHub release body, on both platforms.** They are not
taken from `latest.json`, whose `notes` field is written by `tauri-action` at build time from
the fixed `releaseBody` string in `release.yml` — which is a placeholder, not a changelog, and
cannot be otherwise, since the notes are written after the build. `releaseNotesFor` therefore
fetches the release from the API and uses its body, falling back to `latest.json` if the call
fails; the update installs either way. Two consequences:

- Editing a published release's text on GitHub changes what every client shows, with no
  rebuild and no new version.
- The notes must be written **before** the draft is published, because publishing is what
  makes the release visible to the check. A release published with the placeholder still in
  it will show that placeholder.

The fetched notes are used only when the release tag matches the version being offered —
notes belonging to a different release are worse than none.

**A `.deb` install is deliberately not updated in place.** The plugin would attempt it —
`install_deb` writes the package to a temp dir and runs `dpkg -i` through `pkexec`, falling
back to zenity/kdialog and finally to a terminal `sudo` that a windowed app has no terminal
for — but that chain has too many ways to end half-finished for something the user starts
with one click, and the package manager is the thing that owns that install anyway. So the
check reports `canInstallInApp: false` with `manualInstallReason: 'deb-package'` and the
dialog opens the releases page instead.

**An unpackaged build never installs either, and this one is a safety guard.** On Linux the
plugin's `extract_path` _is_ the running executable, so in `tauri dev` "Download and install"
moves the dev binary into a `TempDir`, writes the release AppImage over it, then drops the
`TempDir` — deleting the backup — and reports success. The developer is left with a 100 MB
AppImage where their build was. `getBundleType()` returns `null` for a build the bundler never
touched, which is exactly that case, so it is routed to the browser with
`manualInstallReason: 'unpackaged'`.

Note that on macOS `bundle_type()` falls back to `App` rather than `None`, so this guard does
not fire there.

`.rpm` currently still installs in place, through the same privileged-helper chain.

One more limit: **the Android check is unauthenticated**, so it shares GitHub's per-IP rate
limit. A 403 is reported as a network-kind error.

## Building Release Binaries

### Cutting a New Release

`npm run release -- <patch|minor|major|prerelease|x.y.z> [--dry-run] [--no-merge-back]`
(wraps `scripts/release.js`) automates version bumps:

1. Creates a `release/vX.Y.Z` branch.
2. Bumps the version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `Cargo.toml`,
   and `Cargo.lock`.
3. Commits, tags `vX.Y.Z`, and pushes the branch + tag together.
4. Fast-forwards the branch it was run from onto the bump and pushes it, so the version on `master`
   is the version released. Skip with `--no-merge-back`.

Note the `--`: without it npm consumes the flags before the script sees them.

Every precondition — a clean tree, a version that moves forward, and a tag/branch that does not
already exist locally **or on the remote** — is checked before anything is written, and a failure
after that point deletes the branch and tag it created and returns to the original branch. Use
`--dry-run` to run the checks and stop.

Only `X.Y.Z` and `X.Y.Z-pre.N` are accepted. Other pre-release spellings are valid semver but match
neither workflow trigger, so they would tag and build nothing.

Pushing a stable tag (`vX.Y.Z`) triggers `release.yml`; pushing a pre-release tag (`vX.Y.Z-pre.N`, via the
`prerelease` bump type) triggers `ci.yml`. See [Continuous Integration](#continuous-integration).

**The script does not finish the release.** `release.yml` publishes a **draft**, and a draft is
invisible to `/releases/latest` — which is where both the desktop updater and the Android check
look. Publishing the draft on GitHub is the step that actually ships it; until then no existing
install will see the new version. See [The Updater](#the-updater).

`scripts/version.js` holds the version arithmetic and `scripts/version.test.js` covers it
(`vitest.config.ts` includes `scripts/**/*.test.js` for this).

### Building Desktop

```bash
npx tauri build
```

### Building Android

**IMPORTANT**: The Android project scaffold (`src-tauri/gen/android/`) is tracked in git.
**Do NOT run `npx tauri android init`** as it will overwrite customizations.

```bash
# One-time: detect/export ANDROID_HOME and NDK_HOME
source scripts/android-setup.sh

# Dev build + deploy to device/emulator
npx tauri android dev

# Release build (unsigned APK)
npx tauri android build

# Or: quick local debug APK build (auto-detects SDK/NDK/JDK)
./compileApk.sh
```

The unsigned release APK will be at:

```text
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
```

**Injecting Kotlin into the generated WebView.** wry generates
`src-tauri/gen/android/app/src/main/java/com/karelian/aventura/generated/RustWebView.kt` fresh on
every build — it's gitignored and must never be hand-edited. wry's `build.rs` substitutes an
env var named `WRY_<FILE_STEM>_CLASS_EXTENSION` (file stem uppercased, e.g.
`WRY_RUSTWEBVIEW_CLASS_EXTENSION` for `RustWebView.kt`) into a `{{class-extension}}` placeholder in
that file. The repo-root `.cargo/config.toml` sets this to inject a one-line
`onCreateInputConnection` override (used for the incognito-keyboard setting) that delegates to a
normal, git-tracked Kotlin class. `cargo`'s config discovery walks up from the build's working
directory, so this only works because both `npx tauri android ...` and `./compileApk.sh` run with
the repo root as their working directory — confirmed by tracing `BuildTask.kt`'s `workingDir`.

This substitution is undocumented wry internals, not a public API — verified by reading
`wry-0.55.1`'s `build.rs` directly (search the vendored crate's registry checkout for
`CLASS_EXTENSION` if this ever needs re-verifying after a wry bump). If the override silently
stops appearing in the generated `RustWebView.kt`, that build script — not any docs page — is
where the renamed placeholder or env var will be found.

`scripts/check_wry_injection.js` runs after `tauri android build` in both Android CI jobs and
fails the build if the lines `.cargo/config.toml` injects are absent from the generated
`RustWebView.kt`, so a wry bump that breaks the substitution stops the release instead of
shipping a dead setting.

### Signing APK

```bash
# Create keystore (first time only)
keytool -genkey -v -keystore release.keystore -alias myalias -keyalg RSA -keysize 2048 -validity 10000

# Align APK
zipalign -v 4 app-universal-release-unsigned.apk app-aligned.apk

# Sign APK
apksigner sign --ks release.keystore --ks-key-alias myalias --out app-release.apk app-aligned.apk
```
