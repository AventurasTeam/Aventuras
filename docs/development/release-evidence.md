# Release and CI: evidence

The measurements, upstream source readings and alternatives behind the rules in
[release.md](release.md). What the CI caches hold and why is in [ci-caching.md](ci-caching.md);
how the iOS target was added is in [ios-build-target.md](ios-build-target.md).

## One release per tag

Without a known `releaseId`, each of the four desktop matrix legs asks `tauri-action` to find or
create the release for the same tag. Two legs that both get "not found" in the same moment each
create one, and the platform assets split across duplicate drafts. Passing the ID from
`create-release` skips that lookup. `build-android.yml` takes no `releaseId`, because
`action-gh-release` has no such input, so it depends on `create-release` and looks the release up
by tag once exactly one exists.

The release guard runs again before each upload because "Re-run failed jobs" skips
`create-release`: a re-run after the release was published would otherwise overwrite live assets
or `latest.json` under the old tag. The guard calls `gh api graphql` with `--jq`, which is built
into `gh`; `ubuntu:22.04` packages `gh` 2.4.0, which is too old, so the Linux desktop leg installs
one from GitHub's own apt repository.

## npm cache

`scripts/release.js` bumps the version in `package.json` and `package-lock.json` on every release.
`actions/setup-node`'s cache key is a plain hash of `package-lock.json` with no fallback, so a
release always missed that cache and then saved a fresh entry nothing else could restore. Hashing
the lockfile without its version fields keeps the key across releases.

## Windows Dev Drive and Defender

The Dev Drive is not marked trusted or added to Defender's exclusions. The runner image
[turns off Defender's real-time monitoring](https://github.com/actions/runner-images/blob/main/images/windows/scripts/build/Configure-WindowsDefender.ps1)
machine-wide, not just for its `C:\` and `D:\` exclusions, and a run that logged
`Get-MpComputerStatus` on the Dev Drive leg reported `RealTimeProtectionEnabled: False`.

## Android builds

- **APK only.** The AAB was built and discarded on every run.
- **No 32-bit `x86`.** It served only old emulators. Why `armv7` stays is in
  [ci-caching.md](ci-caching.md#armv7).
- **Release builds drop the `devtools` feature.** On Android, the CLI's own plugin-init build and
  Gradle's build ended up on different feature sets for the same target, so one target compiled
  twice. `tauri.release.conf.json` sets `build.features` to `[]` for both.

**Deferred: per-ABI parallel builds.** The three Android ABIs are built one after another by a
single `tauri android build`. A matrix job per target — each building its Rust `.so` and uploading
it with the tauri/wry-generated Gradle sources, then a packaging job that runs Gradle with the
`rustBuild*Release` tasks excluded — would build them in parallel. It bypasses the CLI's supported
build flow, and with a warm cache each target's Rust build takes only 1–1.5 minutes, so the likely
saving is a few minutes. Not worth the maintenance surface yet.

## rpm compression

`xz` level 6 produces the smaller archive, as expected, and it also bundles faster on this runner:
the `Bundling ... .rpm` step dropped from ~60 s (`gzip`, run 35175189321) to ~14–18 s (`xz`, runs
35229623700 and 35230697779). `flate2`'s pure-Rust deflate is apparently the slow path, not `xz`'s
liblzma binding. Any `rpm` from 4.8 on reads `xz` payloads.

## Build version

Without an override, every `publish: false` run would reuse the version `master` last shipped,
giving the same bundle filenames and in-app About text for every commit since.

The suffix is appended to the version, not substituted for it, because both consumers need a valid
`X.Y.Z` prefix: Tauri's config deserializer validates `version` as semver (a bare SHA fails to
parse), and `isNewerVersion` in `src/lib/utils/version.ts` (the mobile update check) refuses to
compare anything without a `major.minor.patch` shape.

The suffix is `sha<short-sha>` rather than the bare SHA because a short SHA that is all digits with
a leading zero (about 0.4% of commits) is not a valid semver identifier. `sha` makes it
alphanumeric, so it always parses.

## No updater on mobile

`tauri-plugin-updater` declares Android support level `none` and has no iOS support either: its
`updater_os()` has branches for linux, macos and windows only, so `check()` fails with
`UnsupportedOs` before a request is sent. There is no install path either. An APK or IPA is
installed by the system (package installer, sideloading tool), not by the app it replaces.

## Release notes in `latest.json`

`tauri-action` writes `latest.json`'s `notes` at build time from the fixed `releaseBody` string in
`build-desktop.yml`. The notes are written after the build, so that string can only ever be a
placeholder.

## Installs not updated in place

- **`.deb`**: the plugin's `install_deb` writes the package to a temp dir and runs `dpkg -i`
  through `pkexec`, falling back to zenity/kdialog and finally to a terminal `sudo` that a windowed
  app has no terminal for. That chain has too many ways to end half-finished for something the user
  starts with one click.
- **Unpackaged builds**: on Linux the plugin's `extract_path` is the running executable. In
  `tauri dev`, "Download and install" moves the dev binary into a `TempDir`, writes the release
  AppImage over it, then drops the `TempDir`, deleting the backup, and reports success. The
  developer is left with a 100 MB AppImage where their build was. `getBundleType()` returns `null`
  for a build the bundler never touched, which is exactly this case. On macOS `bundle_type()` falls
  back to `App` rather than `None`.
- **`.rpm`** goes through the same privileged-helper chain as `.deb` and still installs in place.

## The wry class-extension hook

wry's `build.rs` substitutes an env var named `WRY_<FILE_STEM>_CLASS_EXTENSION` (the file stem
uppercased, so `WRY_RUSTWEBVIEW_CLASS_EXTENSION` for `RustWebView.kt`) into a `{{class-extension}}`
placeholder in the generated file. This is undocumented, verified by reading `wry-0.55.1`'s
`build.rs`. After a wry bump, search the vendored crate's registry checkout for `CLASS_EXTENSION`.

That cargo finds the repo-root `.cargo/config.toml` during an Android build was confirmed by
tracing `BuildTask.kt`'s `workingDir`: both `npx tauri android ...` and `./compileApk.sh` run with
the repo root as their working directory.
