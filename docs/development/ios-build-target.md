# Adding iOS as a Build Target — the Full Account

How iOS became a build target producing an **unsigned** ARM64-device `.ipa` in GitHub
Actions, without breaking Windows, Debian/Fedora Linux, Android, or macOS (Intel/ARM64).
Written as a complete record: the audit, every design decision, every CI failure and its
fix, and what remains untested.

The user-facing build instructions live in
[release.md → Building iOS](release.md#building-ios). This document is the _why and how it
happened_.

---

## 1. Goals and constraints

- Produce an **unsigned iOS-device ARM64 `.ipa`** on GitHub Actions' `macos-15` runner,
  with **no Apple certificates, provisioning profiles, or signing secrets** anywhere.
- **Zero regressions** to the existing platforms: Windows (`nsis`), Linux (`.deb`,
  `.AppImage`, `.rpm`), Android (signed `.apk`), macOS desktop (`.dmg`, Intel + ARM64).
- Keep changes minimal and iOS-specific. In the end, **no existing file under `src-tauri/` was
  modified** — no `Cargo.toml`, no `Cargo.lock`, no `tauri.conf.json`, no capabilities, no Rust
  sources. `src-tauri/Info.ios.plist` and `src-tauri/icons/ios/` were added, both new,
  iOS-only files the CLI only reads for an iOS build (see §4).

## 2. The compatibility audit (what was already iOS-ready)

Before writing anything, the repository was audited end to end. The conclusion was that
the app was unusually close to iOS-ready:

| Area               | Finding                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile entry point | [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) already had `#[cfg_attr(mobile, tauri::mobile_entry_point)]` — the same hook Android builds use.                                                                                          |
| Crate types        | [`src-tauri/Cargo.toml`](../src-tauri/Cargo.toml) already built `staticlib` (required by the iOS Xcode project to link the Rust library).                                                                                                   |
| Rust dependencies  | `ring` (via rustls), `sqlx`/libsqlite3-sys, `axum`, `tokio`, `reqwest` (rustls-no-provider), `zip`, `image`, `local-ip-address`, `qrcode`, `uuid` — all support `aarch64-apple-ios`. Nothing to change.                                     |
| iOS icons          | `src-tauri/icons/ios/AppIcon-*.png` — the full set was already generated; `scripts/sync-ios-icons.sh` copies it into the Xcode asset catalog, which `tauri ios init` fills with Tauri's logo.                                               |
| Frontend           | `viewport-fit=cover` in `src/app.html`; the `AndroidBridge` insets script no-ops when the bridge is absent; `swipe.ts` matches iPhone user agents and defers to `isIos()` for iPads; layout hooks are capability-based, not platform-based. |
| Updater            | `tauri-plugin-updater` has no iOS support, but `src/lib/services/updater.ts` already mapped `UnsupportedOs` to a graceful "not supported here" error, and the mobile path (GitHub Releases API + manual install) is platform-agnostic.      |
| Capabilities       | The permission list in `src-tauri/capabilities/default.json` resolves on mobile — proven daily by Android building with the identical list.                                                                                                 |
| Desktop-only code  | Already gated: `is_nvidia_wayland` under `#[cfg(target_os = "linux")]`, the devtools plugin under `debug_assertions` + feature flag.                                                                                                        |
| Database           | `db_path` uses `app_config_dir()` → iOS `Library/Application Support`. Works.                                                                                                                                                               |

Two genuine gaps existed:

1. **No Xcode scaffold.** `tauri ios init` only runs on macOS, and this work was done from
   a Linux machine — so `src-tauri/gen/apple/` could not be generated locally.
2. **No unsigned-packaging path.** The CLI's normal `tauri ios build` export phase assumes
   signing, and iOS lacked the `Info.plist` metadata Android's manifest already had
   (camera permission for QR pairing, local-network permission + ATS exception for LAN
   sync and local LLM servers, export-compliance declaration).

A third, discovered only in CI: **the CLI's signing defaults don't reach
`xcodebuild archive`** (see §6, failure #4).

## 3. Design decisions

- **Scaffold strategy** — a one-shot [`bootstrap-ios.yml`](../../.github/workflows/bootstrap-ios.yml)
  (manual dispatch, `macos-15`) runs `tauri ios init`, smoke-tests the full unsigned build,
  and uploads the scaffold as a workflow artifact for a maintainer to commit — mirroring
  the tracked `src-tauri/gen/android/` convention. In practice, `build-ios.yml` also
  self-heals by running `init` on the runner when the scaffold is absent (see §6,
  failure #1), so a bare checkout builds; a committed scaffold remains the preferred,
  reviewed state.
- **Publication scope** — full integration: a reusable
  [`build-ios.yml`](../../.github/workflows/build-ios.yml) wired into
  [`release.yml`](../../.github/workflows/release.yml),
  [`pre-release.yml`](../../.github/workflows/pre-release.yml) (including its
  `publish.needs`), and [`ci.yml`](../../.github/workflows/ci.yml), exactly matching
  the Android leg's shape. iOS is best-effort: the CI leg runs
  `continue-on-error`, and the pre-release `publish` job gates only on the desktop and
  Android legs, so an iOS-only failure never blocks a release or marks `master` red.
- **Devtools feature** — left alone. `tauri.release.conf.json` already empties
  `build.features` for CI/release builds, and iOS only builds in CI. Local
  `tauri ios dev` needs `--config src-tauri/tauri.release.conf.json` to drop the
  desktop-only `tauri-plugin-devtools`.
- **Pre-verification on Linux** — every CLI flag used was verified by inspecting the
  actual `@tauri-apps/cli-darwin-arm64@2.11.4` binary (downloaded via `npm pack` and
  examined with `grep`/`python` over its embedded strings) rather than guessed from
  docs. This caught several things early (e.g. `--archive-only` exists; `--ci` does
  **not** exist on `ios init`; the target shorthand is `aarch64`, not the Rust triple).

## 4. What was added

### `scripts/build-ios-unsigned.sh` — the whole iOS pipeline in one script

macOS-only (guards on `uname`, repo root, tool availability). Steps:

1. **Patch `src-tauri/gen/apple/project.yml`** (idempotent Python block): insert
   `CODE_SIGNING_ALLOWED: NO`, `CODE_SIGNING_REQUIRED: NO`, `CODE_SIGN_IDENTITY: ""`,
   `CODE_SIGN_STYLE: Manual` into the `aventura_iOS` target's `settings.base`, then
   regenerate the `.xcodeproj` with `xcodegen generate`. This is **the** thing that
   actually disables signing — see §6, failure #4, for why nothing else worked.
2. **`tauri ios build --target aarch64 --archive-only`** — `aarch64` is the CLI's
   shorthand for the iOS-device target (`aarch64-sim` and `x86_64` are the others);
   `--archive-only` stops after `xcodebuild archive`, skipping the CLI's IPA-export
   phase that requires signing assets. All extra arguments (`--config …` from the
   build-version action) are forwarded verbatim, so the CI version rule stays in one
   place.
3. **Locate the archive** — newest `*_iOS.xcarchive` under
   `src-tauri/gen/apple/build/`, with an Xcode `DerivedData` fallback; the `.app` is at
   `Products/Applications/Aventuras.app` inside it.
4. **Assert the iOS `Info.plist` keys are present**: `NSCameraUsageDescription`
   (html5-qrcode), `NSLocalNetworkUsageDescription` (the LAN sync server binds
   `0.0.0.0`), `NSAppTransportSecurity:NSAllowsLocalNetworking` (local LLM servers over
   `http://`), `ITSAppUsesNonExemptEncryption=false`. These live in
   `src-tauri/Info.ios.plist`, which the Tauri CLI merges into **every** iOS build's
   `Info.plist` (`tauri ios dev` and Xcode builds included — none of which run this
   script); the script asserts they made it through rather than assume.
5. **Package** `Payload/Aventuras.app` →
   `Aventuras_v<IPA_VERSION>_ios-arm64-unsigned.ipa`. `IPA_VERSION` is the resolved
   build version (base + `-sha` on CI builds), passed by the workflow from the
   build-version action — the built `Info.plist` only ever carries the base semver
   (the CLI refuses the suffix there), so naming from the plist would make CI builds
   indistinguishable from a release. It defaults to `tauri.conf.json`'s version so a
   plain local build needs no extra setup.
6. **Verify before exiting 0**: binary is `arm64` (`lipo -info`), bundle is _not_
   signed (`codesign -dv` must fail), `.ipa` contains `Payload/<app>/Aventuras` and
   `Info.plist`, each checked separately.

### `.github/workflows/build-ios.yml` — the reusable CI leg

Mirrors `build-android.yml`: `workflow_call` with `prerelease`/`publish` inputs;
`macos-15`; checkout → npm install → release-guard (when publishing) → Rust stable with
`aarch64-apple-ios` → `rust-cache` (`key: ios`, saved from `master` only) → **Ensure
XcodeGen** (`brew install xcodegen` — the CLI only auto-installs it interactively,
impossible on a runner) → build-version action → **generate the scaffold if not
committed** (`tauri ios init --skip-targets-install` when `gen/apple/project.yml` is
absent) → run the build script → upload the `.ipa` as a workflow artifact (glob path —
see failure #5) → upload to the draft release when `publish`. No signing secrets are
referenced anywhere.

### `.github/workflows/bootstrap-ios.yml` — one-shot scaffold generator

Manual dispatch on `macos-15`: npm install, Rust + target, ensure XcodeGen,
`tauri ios init --skip-targets-install`, upload the **pristine** scaffold immediately
(before the smoke test patches `project.yml` and leaves compiled outputs behind),
then smoke-test the full unsigned build and upload the test `.ipa`.

### Orchestrator wiring (additive)

- `release.yml` / `pre-release.yml`: a `build-ios` job (`needs: create-release`).
  `pre-release`'s `publish` job keeps `build-ios` in `needs` for ordering but gates
  only on the desktop and Android results (iOS is best-effort).
- `ci.yml`: a `build-ios` job with `publish: false` and the same version-bump skip
  guard. No iOS-specific path triggers: iOS builds run on the weekly schedule and
  manual dispatch, so a change confined to iOS files doesn't rebuild every desktop
  and Android leg whose caches don't depend on them.

### Frontend (additive branch, no behavior change elsewhere)

- [`src/lib/utils/platform.ts`](../../src/lib/utils/platform.ts): `isIos()` — UA-based,
  same style as the existing `isAndroid()`. An iPad's WKWebView sends a Mac UA by default,
  so a `Macintosh` UA with `maxTouchPoints > 1` also counts as iOS. Backup restore opens
  the picked `file://` URL directly (`open_src` in `backup.rs`); only `content://` is staged.
- [`src/lib/services/updater.ts`](../../src/lib/services/updater.ts): the mobile update
  check (`checkViaGitHub`) now dispatches on `isAndroid() || isIos()` and picks the
  release asset by platform — `.apk` on Android, `.ipa` on iOS. Everything else
  (timeout, semver comparison, `manualInstallReason: 'mobile-platform'`) was already
  platform-agnostic.

### New `src-tauri/` files

- **`src-tauri/Info.ios.plist`** — see §4, item 4. Read only by `tauri ios *` commands.
- **`src-tauri/icons/ios/`** — the full iOS icon set (`AppIcon-*.png`), consumed by
  `scripts/sync-ios-icons.sh` into a freshly initialised `gen/apple` scaffold. Read only by
  that script.
- **`src-tauri/tauri.ios.conf.json`** — a Tauri v2 platform-config override, merged
  automatically for every `tauri ios *` command (unlike `tauri.release.conf.json`, which only
  applies when passed explicitly via `--config`). Sets `bundle.iOS.minimumSystemVersion` to
  `16.4` (the frontend's actual WebKit floor — Tailwind v4's `@property`/cascade-layer usage
  and `color-mix()` need it; Tauri's own default is lower) and empties `build.features`, so
  the devtools-feature workaround below (§7) is no longer needed by hand.

None of the three is referenced by, or changes the output of, a Windows, Linux, macOS-desktop
or Android build.

### Docs

- `docs/development/release.md`: "Building iOS" section, workflow list, runner-pinning
  note, secrets paragraph (iOS needs none), updater wording ("mobile" not "Android").
- `README.md`: iOS row in the install table (with the sideload caveat), build
  prerequisites, doc links.
- `docs/architecture/overview.md`: `gen/apple/` in the repo tree.
- `CLAUDE.md`: the "do not run init over a tracked scaffold" warning now covers both
  mobile targets.

## 5. What deliberately did NOT change

`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`,
`src-tauri/capabilities/`, and every existing Rust source. The regression surface for the
five existing platforms is limited to three additive YAML job blocks, two additive TS
branches guarded by user-agent checks, and two new iOS-only files under `src-tauri/`
(`Info.ios.plist`, `icons/ios/`) that no other platform's build reads.

## 6. Every CI failure, in order — and what each taught

The target repo was a scratch fork (`TheDWz/AventurasiOStest`) pushing straight to
`master`, so `ci.yml` ran the full matrix on every fix. Five failures, five lessons:

1. **"src-tauri/gen/apple is not committed"** — the original workflow required the
   bootstrap scaffold to be committed first. _Fix:_ `build-ios.yml` now runs
   `tauri ios init` on the runner itself when the scaffold is absent; the bootstrap
   workflow remains the way to produce a reviewed, committed scaffold.
2. **`tauri ios init: unexpected argument '--ci'` (latent, caught by binary
   inspection)** — `--ci` belongs to `tauri init`, not `tauri ios init`. _Fix:_ dropped
   the flag before it ever reached CI. Lesson: verify flags against the actual binary,
   not blog posts.
3. **`Permission denied: scripts/build-ios-unsigned.sh`** — the executable bit wasn't in
   git. _Fix:_ `git update-index --chmod=+x`. Lesson: `chmod +x` on the working tree
   does nothing once the file is committed with mode `100644`.
4. **"Signing for aventura_iOS requires a development team"** — the big one. The CLI's
   documented signing defaults (`CODE_SIGNING_ALLOWED=NO` etc.) did not reach
   `xcodebuild archive`; passing the same settings as runner args after `--` didn't
   either (signing is validated before any build phase runs). _Fix:_ patch
   `project.yml` (the source xcodegen renders the `.xcodeproj` from on **every** build,
   so the patch survives regeneration) with the four signing settings at the
   `aventura_iOS` target level, then `xcodegen generate`. The patcher was tested
   locally against a faithful mock of the template, including idempotency.
5. **"No files were found: Aventuras_v0.7.11-shae23df95_ios-arm64-unsigned.ipa"** — the
   `.ipa` was **built and verified successfully**; the upload steps computed their
   expected name from the build-version action (`0.7.11-shae23df95`) while the iOS CLI
   stamps the Xcode project with the base semver (`0.7.11` — the `-sha` suffix is not a
   valid `CFBundleShortVersionString`). _Fix (final):_ the workflow passes the resolved
   version to the script via `IPA_VERSION` and the script names the `.ipa` from it, so
   the name always matches what the upload steps expect, on every kind of run. (An
   earlier fix globbed the upload paths; the explicit version made that unnecessary
   and the globs were reverted to exact names.)

After #5: **the iOS leg went green** — `tauri ios init` → Rust compile for
`aarch64-apple-ios` → `xcodebuild archive` (unsigned) → `.ipa` packaging → artifact
upload, all on a stock `macos-15` runner with zero Apple credentials.

One **non-iOS** failure appeared in the same runs: the macOS desktop legs failed at
`failed to decode secret key: incorrect updater private key password` — the scratch
repo's `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` secrets were misconfigured. The build and
all bundles had already succeeded; nothing in the iOS work touches that path.

## 7. Known limitations (honest list)

- **The `.ipa` is unsigned by design.** Stock iOS will not install it; it targets
  sideloading tools (AltStore, Sideloadly, TrollStore) or a future signing step. The
  README says so next to the download.
- **No in-app updater on iOS.** `tauri-plugin-updater` supports neither Android nor
  iOS; the mobile path offers the release page / `.ipa` asset in the browser. The
  existing `unsupported` error kind covers any future platform gap.
- **No background generation on iOS.** Android's `GenerationForegroundService` has no
  iOS equivalent (the Android-only Kotlin/bridge code is inert on iOS).
- **Local `tauri ios dev`** used to require `--config src-tauri/tauri.release.conf.json` to
  drop the desktop-only devtools feature; `src-tauri/tauri.ios.conf.json` (§4) now does this
  automatically for every iOS command. The explicit `--config` flag still works and is
  harmless to keep using, but should no longer be necessary — this has not been confirmed on
  an actual `tauri ios dev` run, only against the CLI's documented config-merging behavior.
- **Simulator builds** (`aarch64-sim`) are possible with the same script but are not
  wired into CI; only the device target is built.
- **The committed `gen/apple` scaffold is still pending** — CI currently self-heals via
  `tauri ios init` on every run (adds ~1–2 minutes per iOS build). Running the
  bootstrap workflow once and committing its artifact removes that overhead and gives
  the scaffold code review.

## 8. Verification performed

On the Linux dev machine (as far as Linux allows):

- `npm run check` (0 errors), `npm test` (1890 passed), `npm run lint` (0 errors),
  `npm run build` — all green after the frontend changes.
- `cargo check` on the host target — green (no Rust changed, but verified).
- `bash -n` on the build script; YAML parse of every touched workflow with a job-graph
  assertion; the `project.yml` patcher unit-tested against a template mock.
- Flag-level verification of `tauri ios build/init` behavior against the real 2.11.4
  darwin CLI binary.

In CI (the real proof, on `macos-15`):

- The full iOS pipeline end-to-end: scaffold generation, Rust cross-compile,
  unsigned archive, `.ipa` packaging, structural verification, artifact upload.
- Existing platforms: Android green throughout; desktop legs green except for the
  pre-existing (unrelated) updater-secret misconfiguration on the scratch repo.

## 9. Quick reference

```bash
# macOS, from the repo root — one-time scaffold (or use the bootstrap workflow)
npx tauri ios init --skip-targets-install

# Unsigned device .ipa (any --config args are forwarded to tauri ios build)
scripts/build-ios-unsigned.sh --config src-tauri/tauri.release.conf.json

# Result: Aventuras_v<version>_ios-arm64-unsigned.ipa in the repo root,
# verified arm64 + unsigned + correct Payload layout before exit 0.
```

| Artifact                        | Where                                                |
| ------------------------------- | ---------------------------------------------------- |
| Build script                    | `scripts/build-ios-unsigned.sh`                      |
| CI build leg                    | `.github/workflows/build-ios.yml`                    |
| One-shot scaffold generator     | `.github/workflows/bootstrap-ios.yml`                |
| Xcode scaffold (once committed) | `src-tauri/gen/apple/`                               |
| Per-user build instructions     | [release.md → Building iOS](release.md#building-ios) |
