# Release, CI and Updates

How a build reaches a user. Publishing the draft release is the step that ships it.

The measurements, upstream source readings and alternatives behind these rules are in
[release-evidence.md](release-evidence.md), the CI caches' in [ci-caching.md](ci-caching.md), and
the iOS target's in [ios-build-target.md](ios-build-target.md).

## Git Hooks

Managed by [lefthook](https://github.com/evilmartians/lefthook) (`lefthook.yml`):

- **pre-commit**: runs `scripts/check_migrations.js` against staged `src-tauri/migrations/*.sql` files to
  reject CRLF line endings.
- **pre-push**: runs `lint:ts` (ESLint), `check` (type-checking) and `lint:rust` (`cargo fmt
  --check` and `cargo clippy -D warnings`) via `scripts/pm.js`. Each runs only when the commits
  being pushed touch a file its `glob` matches, and then runs over the whole project, not just
  those files.

`lint` runs `lint:ts` and `lint:rust`; `lint:fix` runs their `:fix` counterparts. Hooks, CI and
`scripts/release.js` call the per-language scripts, so a JS-only path never needs the Rust
toolchain and a release never rewrites Rust code.

`scripts/pm.js` picks the package manager at run time: `aube` when it did the install
(`node_modules/.aube-state` exists) and is still on `PATH`, `npm` otherwise. It also drives
Tauri's `beforeDevCommand`/`beforeBuildCommand`, the `format`/`lint:ts:fix` steps in
`scripts/release.js`, and the `lint`/`lint:fix` aggregates, so those work unchanged for npm users
and route through aube wherever aube did the install. `scripts/release.js` always bumps the
version with npm directly, so when it hands `format`/`lint:ts:fix` to aube it adds
`--no-install --frozen-lockfile`, keeping aube from re-resolving the `package-lock.json` npm just
wrote.

## Continuous Integration

GitHub Actions workflows in `.github/workflows/`:

- **`lint-and-typecheck.yml`** - runs `lint:ts`, `check`, `test`, and `build` on every pull request
  targeting `master`, except one that touches only `src-tauri/`, `docs/` or Markdown.
- **`rust-lint.yml`** ("Rust Lint") - runs `cargo fmt --check` and `cargo clippy -D warnings` on
  pull requests targeting `master`, and pushes to `master`, that touch Rust sources or the Cargo
  manifest or lockfile.
  Clippy runs on a pinned toolchain, so a new stable's lints cannot fail an unrelated PR. The
  version appears in both `rust-lint.yml` and the `lint:rust`/`lint:rust:fix` scripts in
  `package.json`; bump them together and fix whatever the new lints report. Builds and rustfmt use latest stable.
- **`release.yml`** - triggered by pushing a stable version tag (`vX.Y.Z`). Leaves a draft GitHub
  release with auto-updater metadata; publishing it by hand is the step that ships it.
- **`pre-release.yml`** ("Pre-release") - triggered by pushing a pre-release tag (`vX.Y.Z-pre.N`).
  Builds as a draft, without updater metadata, and its own `publish` job turns it into a
  **pre-release** once every build has succeeded.
- **`build-desktop.yml`**, **`build-android.yml`** and **`build-ios.yml`** - reusable workflows that hold the
  build jobs for all of the above, switched by a single `prerelease` input. Desktop builds signed binaries
  for Linux, Windows and macOS (Intel + Apple Silicon) via `tauri-apps/tauri-action`; Android builds,
  lints and signs the APK; iOS builds an unsigned device `.ipa` (`build-ios.yml` also takes a
  `prerelease` input, but no signing inputs at all). All take a `publish` input (default `true`);
  `false` skips the GitHub Release upload, which is what `ci.yml` uses. Every workflow uploads its
  build output as a workflow-run Artifact regardless of `publish` — desktop via `tauri-action`'s
  `uploadWorkflowArtifacts`, Android and iOS via their own `actions/upload-artifact` steps — so even a
  non-publishing run leaves every platform's build downloadable from the run summary.
- **`bootstrap-ios.yml`** - one-shot manual-dispatch workflow that regenerates the tracked
  `src-tauri/gen/apple` Xcode scaffold (see [Building iOS](#building-ios)).
- **`ci.yml`** - builds `master` with `publish: false` so the Rust and npm caches a
  release restores from are warm, and so every push/schedule leaves downloadable per-platform builds.
  See [Build caching and speed](#build-caching-and-speed) and [Build version](#build-version).

Both release workflows expect `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` and the `ANDROID_KEYSTORE_*` /
`ANDROID_KEY_*` secrets to be configured on the repository. The iOS build needs none — it is
unsigned by design.

**One release per tag.** Both `release.yml` and `pre-release.yml` run a `create-release` job before
the build matrix. It creates or reuses the GitHub release for the tag and passes its numeric ID to
`build-desktop.yml` as `releaseId`, so the parallel desktop legs never look the release up
themselves. `build-android.yml` depends on `create-release` and looks the release up by tag
([why](release-evidence.md#one-release-per-tag)).

**Nothing ever uploads to an already-published release.** `create-release` starts with
`.github/actions/release-guard`, which refuses the run when the tag's release is already
published, or when a pushed tag doesn't match the version in `tauri.conf.json`. `build-desktop.yml`
and `build-android.yml` each run the same guard again before their own upload step, because
"Re-run failed jobs" skips `create-release`. The guard needs a current `gh`; the Linux desktop leg
installs one from GitHub's own apt repository.

**Only a publish step or a human makes a release public.** Both workflows create their release as
a **draft**, and every upload step (`build-desktop.yml`'s `releaseDraft`, `build-android.yml`'s
`draft`) sets `draft: true`, regardless of `prerelease`. In `pre-release.yml`, a `publish` job gated
on the desktop and Android builds turns the draft into a pre-release with
`gh release edit --draft=false`; iOS is best-effort, so its failure leaves the `.ipa` missing
without blocking the other platforms. A stable release is published by hand (see
[Cutting a New Release](#cutting-a-new-release)).

The release body is set once, in `create-release`, only when the draft is first created — softprops
keeps the existing body on an empty `body` input, so a re-run never overwrites notes already typed
into the draft.

The repository should also have **release immutability** turned on (Settings → General →
Releases): it locks a release's assets and Git tag once published, so GitHub itself refuses an
asset upload or tag move the guard above might have missed. It does not lock the title, release
notes, or the `prerelease` flag, all still editable after publishing; the guard above is still what
stops a stable release from being flipped to a pre-release. A deleted immutable release's tag name
cannot be reused.

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
iOS builds pin `macos-15` like the macOS desktop legs: the archive must be produced by a
Xcode version the project is actually tested against.

Dependabot (`.github/dependabot.yml`) opens one grouped PR a month for `github-actions` updates, so
action versions don't drift the way the runner pins are meant to prevent.

### Build caching and speed

GitHub Actions caches can only be restored from the current branch, the base branch of a PR, or the
**default branch** (`master`) — never across different tag names. Since nothing builds on `master`
by itself, every tag-triggered release would start every cache cold. `ci.yml` exists to
prevent that: it runs `build-desktop.yml`, `build-android.yml` and `build-ios.yml` with
`publish: false` on a weekly schedule (Fridays, the day after Rust's stable release day), on pushes
to `master` that touch dependency or workflow files, and on manual dispatch, so the caches those
jobs leave behind on `master` are the ones a release restores. It skips the push
`scripts/release.js` makes when it pushes a version bump to `master`: every cache key below
already ignores the app's own version, so that push can only rebuild for nothing.

- **Rust** (`swatinem/rust-cache`) goes through the `.github/actions/rust-cache` composite action in
  both build workflows and `rust-lint.yml`'s Clippy job, the one place that sets
  `save-if: ${{ github.ref == 'refs/heads/master' }}`. Only `ci.yml` (or a run of
  `release.yml`/`pre-release.yml` if one is ever dispatched from `master` directly) writes the build
  caches, and Clippy's `master` push run saves its own while PRs only restore, so a PR's ~600 MiB
  `target/` never lands in a scope no other run can read. The action also ends every `key` in a hash
  of the Rust dependency set (`scripts/ci/cargo-deps-hash.js`), so a dependency, feature or profile
  change starts each Rust cache cold instead of saving the new artifacts beside the old ones. See
  [ci-caching.md](ci-caching.md#rust-cache-growth).
- **Gradle** is cached by `setup-gradle`'s basic provider, which saves only from `master`. See
  [ci-caching.md](ci-caching.md#gradle).
- **npm**, across all three CI workflows, uses the `.github/actions/npm-install` composite action
  instead of `actions/setup-node`'s built-in cache. The action keys on
  `scripts/ci/lockfile-hash.js`, which hashes the lockfile with the version fields removed, so a
  release's version bump keeps the cache ([why](release-evidence.md#npm-cache)). It falls back to
  the newest same-OS/arch entry on a miss, and only saves on `master`. On Linux it caches
  `.npm-cache` inside the checkout, so the containerized desktop job and the Android job share one
  entry. See [ci-caching.md](ci-caching.md#npm).
- **Android's Rust cache also persists the `tauri`/`wry`-generated Kotlin** (`cache-directories`),
  without which `tauri`, `wry` and every plugin recompile in each of the four cargo builds. The
  option is not part of the key: change what is persisted by bumping the `android-v2` suffix. See
  [ci-caching.md](ci-caching.md#android-generated-kotlin).

The **Windows** desktop leg builds on a ReFS [Dev Drive](https://learn.microsoft.com/en-us/windows/dev-drive/)
created by `samypr100/setup-dev-drive` (a dynamic VHDX, recreated every run — the drive itself is
not cached). The action copies the checkout onto it and exports `DEV_DRIVE_WORKSPACE`; the npm
install, `build-version`, `rust-cache` and `tauri-action` steps all take that directory (falling
back to `.` on the other legs, where it is unset), so `node_modules`, `build/` and `target/` live on
the Dev Drive. `CARGO_HOME` and `npm_config_cache` are pointed there too, so the cache restores land
on it. The rustup toolchain stays on `C:`. Local actions (`uses: ./.github/actions/...`) and
`release-guard` still resolve against the original checkout, which has the same contents. The
Dev Drive is not marked trusted or added to Defender's exclusions, because real-time monitoring is
already off on the runner image
([evidence](release-evidence.md#windows-dev-drive-and-defender)).

`build-android.yml` builds `--apk` only and targets `aarch64`, `armv7` and `x86_64`
([why](release-evidence.md#android-builds)). Both build workflows pass
`--config src-tauri/tauri.release.conf.json`, which sets `build.features` to `[]` for that build:
`tauri.conf.json`'s own `features: ["devtools"]` is only meant for `tauri dev` (the plugin is
registered under `debug_assertions` in `src-tauri/src/lib.rs`).

The `.rpm` payload is compressed with `xz` level 6 (`bundle.linux.rpm.compression` in
`tauri.conf.json`) instead of Tauri's default `gzip` level 6: it is smaller and, on this runner,
faster to bundle ([timings](release-evidence.md#rpm-compression)). The other formats have no
compression setting in Tauri's config except NSIS, whose default is already `lzma`.

### Build version

A non-publishing run (`ci.yml`) versions its build `<base>-sha<short-sha>`, so each commit's bundle
filenames and in-app "About" text are distinct. Both build workflows call
`.github/actions/build-version`, which on a non-publishing run writes `ci-version.conf.json` (a
`{"version": "<base>-sha<short-sha>"}` override, gitignored, never committed) and emits the
`--config` list that carries it to `tauri build`/`tauri android build`, merged on top of
`tauri.release.conf.json`. Both workflows take that list from the action's `config-args` output, so
the rule lives in one place. `tauri-action` re-resolves the same `--config` list itself to name
workflow artifacts and set its `appVersion` output, so the desktop and Android legs, the bundle
filenames, and `getVersion()` inside the running app all agree on one string.

Keep both prefixes: the `X.Y.Z` base and the `sha` before the commit hash. Tauri and
`isNewerVersion` both need valid semver ([why](release-evidence.md#build-version)). Since a CI
build's version is then a semver pre-release of the last release, its own update check correctly
reports the real release as newer.

A real release (`release.yml`/`pre-release.yml`, `publish: true`) never takes this path —
its version is the one `scripts/release.js` bumped, and it must stay exactly what the pushed
tag names.

## The Updater

`src/lib/services/updater.ts` answers one question on two platforms that share no machinery
for it. `UpdateInfo.canInstallInApp` is the flag that tells them apart, and the dialog
(`src/lib/components/updater/UpdateDialog.svelte`) branches on it rather than on the platform.

**Desktop** uses `@tauri-apps/plugin-updater`: it fetches the `latest.json` named by the
`updater.endpoints` entry in `tauri.conf.json`, verifies its signature against the `pubkey`
there, and installs the new build itself.

**Mobile has no in-app updater**: the plugin supports neither Android nor iOS, and the system,
not the app, installs an APK or IPA ([evidence](release-evidence.md#no-updater-on-mobile)). The
mobile path calls the GitHub Releases API directly, compares the tag against `getVersion()` using
`src/lib/utils/version.ts`, and opens the platform's own package asset (`.apk` on Android, `.ipa`
on iOS) in the browser. The comparison is semver, not string order (`'0.10.0' > '0.9.0'` is false
lexically), which is why it is a tested module of its own. The check is unauthenticated, so it
shares GitHub's per-IP rate limit; a 403 is reported as a network-kind error.

Keep the `RELEASE_REPO` constant in `updater.ts` and the `updater.endpoints` URL in
`tauri.conf.json` in step, or the platforms will offer different versions to their users.

**A draft release is invisible to the updater.** Both paths resolve `/releases/latest`, which
GitHub defines as the latest **published, non-pre-release** release. Until the draft is published
by hand, the desktop endpoint 404s and the API returns the previous release, so the last step of
every release is publishing the draft on GitHub. The desktop check reports that 404 as the
`no-release` kind ("it may still be a draft"), distinct from `network` and `unsupported`.

**The release notes users read are the GitHub release body, on both platforms.** `latest.json`'s
`notes` field is a placeholder ([why](release-evidence.md#release-notes-in-latestjson)), so
`releaseNotesFor` fetches the release from the API and uses its body, falling back to
`latest.json` if the call fails; the update installs either way. So:

- Write the notes **before** publishing the draft. Publishing is what makes the release visible to
  the check, and a release published with the placeholder still in it shows that placeholder.
- Editing a published release's text on GitHub changes what every client shows, with no rebuild
  and no new version.
- The fetched notes are used only when the release tag matches the version being offered — notes
  belonging to a different release are worse than none.

**Some installs are never updated in place.** The check reports `canInstallInApp: false` and the
dialog opens the releases page instead for:

- **a `.deb` install** (`manualInstallReason: 'deb-package'`): the plugin's privileged install
  chain can end half-finished, and the package manager owns that install anyway;
- **an unpackaged build** (`getBundleType()` returns `null`, `manualInstallReason: 'unpackaged'`):
  on Linux the plugin would replace the dev binary with the release AppImage. On macOS
  `bundle_type()` never returns `None`, so this guard does not fire there.

`.rpm` still installs in place, through the same privileged-helper chain. The plugin internals
behind all three are in [release-evidence.md](release-evidence.md#installs-not-updated-in-place).

## Building Release Binaries

### Cutting a New Release

`npm run release -- <patch|minor|major|prerelease|x.y.z> [--dry-run]`
(wraps `scripts/release.js`) automates version bumps:

1. Bumps the version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `Cargo.toml`,
   and `Cargo.lock`.
2. Commits the bump on `master` and tags it `vX.Y.Z`. It refuses to run from any other branch.
3. Pushes the branch and the tag in one atomic push, so the version on `master` is the version
   released and the tag can never point at a commit `master` lacks.

Note the `--`: without it npm consumes the flags before the script sees them.

Every precondition — a clean tree, a version that moves forward, a tag that does not already exist
locally **or on the remote**, and a remote branch that is an ancestor of the local one — is checked
before anything is written. A failure after that point resets the branch to where it started and
deletes the tag. Use `--dry-run` to run the checks and stop.

Only `X.Y.Z` and `X.Y.Z-pre.N` are accepted. Other pre-release spellings are valid semver but match
neither workflow trigger, so they would tag and build nothing.

Pushing a stable tag (`vX.Y.Z`) triggers `release.yml`; pushing a pre-release tag (`vX.Y.Z-pre.N`, via the
`prerelease` bump type) triggers `pre-release.yml`. See [Continuous Integration](#continuous-integration).

**The script does not finish the release.** `release.yml` publishes a **draft**, and a draft is
invisible to `/releases/latest` — which is where the desktop updater and the mobile check
look. Publishing the draft on GitHub is the step that actually ships it; until then no existing
install will see the new version. See [The Updater](#the-updater).

`scripts/version.js` holds the version arithmetic and `scripts/version.test.js` covers it
(`vitest.config.ts` includes `scripts/**/*.test.js` for this).

### Building Desktop

```bash
npx tauri build
```

### Building iOS

The iOS build produces an **unsigned** ARM64 device `.ipa`: no Apple certificates,
provisioning profiles or signing secrets are involved at any step, and none are configured
in CI. An unsigned `.ipa` cannot be installed with Xcode or Finder — it targets
sideloading tools (AltStore, Sideloadly, TrollStore) or a future signing step.

**The Xcode scaffold (`src-tauri/gen/apple/`) is meant to be tracked in git, like `gen/android/`,
but is not committed yet**, so CI generates it on every build (see below). Once it is committed,
do NOT run `npx tauri ios init` on a working tree that has it. To (re)generate it —
first setup, or after a major Tauri CLI upgrade — run the **"Bootstrap iOS scaffold"**
workflow (`.github/workflows/bootstrap-ios.yml`, manual dispatch): it runs `tauri ios init`
on `macos-15`, smoke-tests a full unsigned build, and uploads the scaffold plus the test
`.ipa` as workflow artifacts for a maintainer to commit.

The iOS-specific `Info.plist` keys (camera permission for QR pairing, local-network
permission and the `NSAllowsLocalNetworking` ATS exception for LAN sync and local LLM
servers, export-compliance) live in **`src-tauri/Info.ios.plist`**, which the Tauri CLI
merges into every iOS build's `Info.plist` — `tauri ios dev`, Xcode builds and the CI
script alike — so the keys are not tied to any one build path.

```bash
# macOS only, from the repo root
npx tauri ios init --skip-targets-install        # first time only (or bootstrap workflow)

# Unsigned release .ipa (any --config args are forwarded, e.g. the CI version rule)
scripts/build-ios-unsigned.sh --config src-tauri/tauri.release.conf.json
```

The `.ipa` is written to the repo root as
`Aventuras_v<version>_ios-arm64-unsigned.ipa` and verified (arm64 binary, unsigned,
`Payload/` layout) before the script exits 0.

Mechanics worth knowing:

- The script temporarily patches `project.yml` with the four signing-disabled settings and
  runs `tauri ios build --target aarch64 --archive-only`, which
  stops after `xcodebuild archive` and skips the CLI's IPA-export phase (the part that
  requires signing). Do not
  rely on the CLI's own `CODE_SIGNING_*` defaults or xcodebuild runner args for this:
  neither reaches the signing validation inside `xcodebuild archive` — the patch is what
  disables signing, and it is restored on exit.
- The archive lands at `src-tauri/gen/apple/build/<target>_iOS.xcarchive`, and the app
  bundle at `Products/Applications/Aventuras.app` inside it.
- The app icon comes from **`src-tauri/icons/ios/`**. `tauri ios init` fills
  `gen/apple/Assets.xcassets/AppIcon.appiconset` with Tauri's placeholder logo, so
  `scripts/sync-ios-icons.sh` copies the Aventuras set over it; the build script and the
  bootstrap workflow both run it. Run it yourself before a local `tauri ios dev` or Xcode
  build on a freshly initialised scaffold.
- `tauri ios dev` drops the desktop-only `devtools` feature automatically through
  `src-tauri/tauri.ios.conf.json`, which Tauri merges into every `tauri ios` command.

CI builds iOS in `.github/workflows/build-ios.yml` (reusable, on `macos-15`), wired into
`release.yml`, `pre-release.yml` and `ci.yml` exactly like the Android leg. If `gen/apple`
is not committed, that workflow runs `tauri ios init` on the runner itself — builds work
from a bare checkout — but a committed scaffold (via the bootstrap workflow) is the
preferred, reviewed state. Both workflows install XcodeGen (`brew install xcodegen`) when
missing: the Tauri CLI only auto-installs it interactively, which a runner cannot do.

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
every build — it's gitignored and must never be hand-edited. The repo-root `.cargo/config.toml`
sets `WRY_RUSTWEBVIEW_CLASS_EXTENSION`, which wry's `build.rs` substitutes into a
`{{class-extension}}` placeholder in that file, to inject a one-line `onCreateInputConnection`
override (used for the incognito-keyboard setting) that delegates to a normal, git-tracked Kotlin
class. Run Android builds from the repo root, as `npx tauri android ...` and `./compileApk.sh` do:
cargo finds `.cargo/config.toml` by walking up from the build's working directory.

The substitution is undocumented wry internals, not a public API.
`scripts/check_wry_injection.js` runs after `tauri android build` in `build-android.yml` and
fails the build if the lines `.cargo/config.toml` injects are absent from the generated
`RustWebView.kt`, so a wry bump that breaks the substitution stops the release instead of
shipping a dead setting. When it fires, wry's `build.rs` is where the renamed placeholder or env
var will be found ([how it was verified](release-evidence.md#the-wry-class-extension-hook)).

### Signing APK

```bash
# Create keystore (first time only)
keytool -genkey -v -keystore release.keystore -alias myalias -keyalg RSA -keysize 2048 -validity 10000

# Align APK
zipalign -v 4 app-universal-release-unsigned.apk app-aligned.apk

# Sign APK
apksigner sign --ks release.keystore --ks-key-alias myalias --out app-release.apk app-aligned.apk
```
