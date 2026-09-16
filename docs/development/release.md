# Release, CI and Updates

How a build reaches a user, and why publishing the draft is the step that ships it.

## Git Hooks

Managed by [lefthook](https://github.com/evilmartians/lefthook) (`lefthook.yml`):

- **pre-commit**: runs `scripts/check_migrations.js` against staged `src-tauri/migrations/*.sql` files to
  reject CRLF line endings.
- **pre-push**: runs `npm run lint` and `npm run check` (type-checking).

## Continuous Integration

GitHub Actions workflows in `.github/workflows/`:

- **`lint-and-typecheck.yml`** - runs `lint`, `check`, `test`, and `build` on every pull request
  targeting `master`, `develop`, or `dev`.
- **`release.yml`** - triggered by pushing a stable version tag (`vX.Y.Z`). Publishes a draft GitHub
  release with auto-updater metadata.
- **`pre-release.yml`** ("Pre-release") - triggered by pushing a pre-release tag (`vX.Y.Z-pre.N`).
  Publishes a non-draft **pre-release** without updater metadata.
- **`build-desktop.yml`** and **`build-android.yml`** - reusable workflows that hold the build jobs for
  both of the above, switched by a single `prerelease` input. Desktop builds signed binaries for Linux,
  Windows and macOS (Intel + Apple Silicon) via `tauri-apps/tauri-action`; Android builds, lints and
  signs the APK. Both also take a `publish` input (default `true`); `false` skips the GitHub Release
  upload, which is what `ci.yml` uses. Both workflows always upload their build output as a
  workflow-run Artifact regardless of `publish` — desktop via `tauri-action`'s
  `uploadWorkflowArtifacts`, Android via its own `actions/upload-artifact` step — so even a
  non-publishing run leaves every platform's build downloadable from the run summary.
- **`ci.yml`** - builds `master` with `publish: false` so the Rust, Gradle and npm caches a
  release restores from are warm, and so every push/schedule leaves downloadable per-platform builds.
  See [Build caching and speed](#build-caching-and-speed).

Both release workflows expect `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` and the `ANDROID_KEYSTORE_*` /
`ANDROID_KEY_*` secrets to be configured on the repository.

Both `release.yml` and `pre-release.yml` run a `create-release` job before the build matrix, which creates (or
reuses) the GitHub release for the tag and passes its numeric ID to `build-desktop.yml` as `releaseId`.
Without this, each of the four desktop matrix legs asks `tauri-action` to find-or-create the release
for the same tag independently; two legs hitting "not found" within the same moment each create a
release, splitting the platform assets across duplicate drafts. Passing a known `releaseId` skips that
lookup entirely. `build-android.yml` doesn't take a `releaseId` — `action-gh-release` has no such
input — but its job depends on `create-release` too, so by the time it looks the release up by tag,
`create-release` has already guaranteed exactly one exists.

### Runner pinning

Release binaries must not silently start depending on a newer host than the one they were tested
against, so `build-desktop.yml`'s matrix pins its runners rather than tracking `-latest`:

- **Linux** builds on the `ubuntu-latest` host inside an `ubuntu:22.04` container, so the glibc
  baseline (2.35) stays fixed even after GitHub retires the `ubuntu-22.04` runner image
  (deprecation begins 2026-09-17, removal 2027-04-17). The container supplies everything but the
  kernel and Docker itself, both provided by the host.
- **macOS** builds pin `macos-15` (Xcode 16.4). Tauri sets `MACOSX_DEPLOYMENT_TARGET=10.13` by
  default, and Xcode 26 (the default on `macos-latest`) only supports macOS 11+ deployment
  targets — building there would silently raise the minimum supported macOS version.
- **Windows** builds pin `windows-2025`, the same image `windows-latest` currently resolves to, so
  a future move to a newer image is a deliberate version bump rather than a silent one.

Android and the lint job stay on `ubuntu-latest`: their output doesn't depend on the host OS.

Dependabot (`.github/dependabot.yml`) opens one grouped PR a month for `github-actions` updates, so
action versions don't drift the way the runner pins are meant to prevent.

### Build caching and speed

GitHub Actions caches can only be restored from the current branch, the base branch of a PR, or the
**default branch** (`master`) — never across different tag names. Since nothing builds on `master`
by itself, every tag-triggered release would start every cache cold. `ci.yml` exists to
prevent that: it runs `build-desktop.yml` and `build-android.yml` with `publish: false` on a weekly
schedule (Fridays, the day after Rust's stable release day), on pushes to `master` that touch
dependency or workflow files, and on manual dispatch, so the caches those jobs leave behind on
`master` are the ones a release restores. It skips the push `scripts/release.js` makes when it
fast-forwards a version bump onto `master`: every cache key below already ignores the app's own
version, so that push can only rebuild for nothing.

- **Rust** (`swatinem/rust-cache`) sets `save-if: ${{ github.ref == 'refs/heads/master' }}` in both
  build workflows, so only `ci.yml` (or a run of `release.yml`/`pre-release.yml` if one is ever
  dispatched from `master` directly) writes it.
- **Gradle**, in `build-android.yml`, uses `gradle/actions/setup-gradle` with
  `cache-provider: basic` — the MIT-licensed provider, not the default proprietary one — which
  already defaults to read-only off the default branch. It also caches the Gradle wrapper
  distribution download, which `actions/setup-java`'s `cache: gradle` option did not.
- **npm**, across all three CI workflows, uses the `.github/actions/npm-install` composite action
  instead of `actions/setup-node`'s built-in cache. `scripts/release.js` bumps the version in
  `package.json`/`package-lock.json` on every release, and `setup-node`'s cache key is a plain hash
  of `package-lock.json` with no fallback — so a release always missed that cache and then saved a
  fresh entry nothing else could restore. The action keys on `scripts/ci/lockfile-hash.js`, which
  hashes the lockfile with the version fields removed, and falls back to the newest same-OS/arch
  entry on a miss; it also only saves on `master`.

`build-android.yml` also builds `--apk` only (the AAB was built and discarded on every run) and
targets `aarch64`, `armv7` and `x86_64` (32-bit `x86` served only old emulators). Both build
workflows pass `--config src-tauri/tauri.release.conf.json`, which sets `build.features` to `[]` for
that build: `tauri.conf.json`'s own `features: ["devtools"]` is only meant for `tauri dev` (the
plugin is registered under `debug_assertions` in `src-tauri/src/lib.rs`), and on Android the CLI's
own plugin-init build and Gradle's build used to end up on different feature sets for the same
target, forcing one target to compile twice.

**Deferred: per-ABI parallel Android builds.** The four (now three) Android ABIs are still built one
after another by a single `tauri android build` invocation. A matrix job per target — each building
its Rust `.so` and uploading it plus the tauri/wry-generated Gradle sources, followed by a packaging
job that runs Gradle with the `rustBuild*Release` tasks excluded — would let them build in parallel.
It is deferred: it bypasses the CLI's supported build flow, and with a warm cache each target's Rust
build is already only 1-1.5 minutes, so the likely saving is a few minutes, not worth the added
maintenance surface yet.

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

**A draft release is invisible to the updater.** `release.yml` publishes a draft (a
non-pre-release run of `build-desktop.yml` sets `releaseDraft`), and both paths resolve `/releases/latest`, which GitHub defines as the
latest **published, non-pre-release** release. Until the draft is published by hand, the
desktop endpoint 404s and the API returns the previous release — so the last step of every
release is publishing the draft on GitHub. Nothing reaches users before that.

The desktop check surfaces that state honestly rather than as a generic failure: a 404 becomes
the `no-release` kind ("it may still be a draft"), distinct from `network` and `unsupported`.

**The release notes users read are the GitHub release body, on both platforms.** They are not
taken from `latest.json`, whose `notes` field is written by `tauri-action` at build time from
the fixed `releaseBody` string in `build-desktop.yml` — which is a placeholder, not a changelog, and
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
`prerelease` bump type) triggers `pre-release.yml`. See [Continuous Integration](#continuous-integration).

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

`scripts/check_wry_injection.js` runs after `tauri android build` in `build-android.yml` and
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
