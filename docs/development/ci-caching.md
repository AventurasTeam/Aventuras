# CI caching

What the CI caches hold, how well each build reuses them, and why they are configured the way
they are. The rules themselves are summarised in
[release.md → Build caching and speed](release.md#build-caching-and-speed); this file is the
evidence behind them.

The constraint is GitHub's **10 GB per-repository Actions cache quota**, shared by every branch
(including `main`). Over the limit, GitHub evicts the least-recently-used entries. Build time
matters less: run-to-run timing noise on hosted runners is too large to track small savings, so
everything below is judged on cache hits and on what cargo actually recompiles.

## Decisions

| Decision                                                                                             | Why                                                                                                      | Section                                               |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Every rust-cache `key` carries a hash of the Rust dependency set (`scripts/ci/cargo-deps-hash.js`)   | rust-cache otherwise keeps every old dependency version forever; the Rust caches had doubled to 8 GB     | [Rust cache growth](#rust-cache-growth)               |
| Gradle is cached with `setup-gradle`'s basic provider                                                | Without it the Android job, already the longest, takes ~1m45s more; the dependency hash freed the 843 MB | [Gradle](#gradle)                                     |
| Desktop Linux and Android share one npm entry (`.npm-cache` in the checkout on Linux)                | The container's different home directory otherwise splits one key into two identical ~140 MB entries     | [npm](#npm)                                           |
| Android's Rust cache also stores the generated Kotlin (`cache-directories`, key suffix `android-v2`) | Without it `tauri`, `wry` and every plugin recompile in each of the four cargo builds                    | [Android generated Kotlin](#android-generated-kotlin) |
| The second `aarch64` app-crate rebuild on Android stays                                              | About a minute; no fix without reaching into the Tauri CLI's build internals                             | [Android generated Kotlin](#android-generated-kotlin) |
| `armv7` stays an Android target                                                                      | It is the only build 32-bit-userspace phones can install, and those are still sold new                   | [armv7](#armv7)                                       |
| iOS cache reuse is not investigated further                                                          | Timings say the cache works; confirming it costs cold-cache runs                                         | [iOS](#ios)                                           |

## Diagnostic runs (2026-10-01)

Four `workflow_dispatch` runs of `ci.yml` on the `ci/cache-efficiency` branch, all on rustc 1.99.0:

| Run                                                                                | Commit    | Change from `master` at the time                                                                                                     |
| ---------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [36933714700](https://github.com/AventurasTeam/Aventuras/actions/runs/36933714700) | `aa5ac67` | `CARGO_LOG=cargo::core::compiler::fingerprint=info` on the Android and iOS build steps                                               |
| [36935024332](https://github.com/AventurasTeam/Aventuras/actions/runs/36935024332) | `b0c921f` | plus `CARGO_TERM_VERBOSE=true`, fingerprint log level `debug`                                                                        |
| [36936312984](https://github.com/AventurasTeam/Aventuras/actions/runs/36936312984) | `993625a` | Android only: key `android-v2`, `cache-directories` for the generated Kotlin, `save-if: true`, verbose; no `CARGO_LOG`. Starts cold. |
| [36938029867](https://github.com/AventurasTeam/Aventuras/actions/runs/36938029867) | `993625a` | same as the previous run, restoring what it saved                                                                                    |

**`CARGO_LOG` printed nothing** in either run: the Tauri CLI does not pass cargo's tracing output
through. Everything known about why a unit was rebuilt comes from `CARGO_TERM_VERBOSE`, which
prints a `Fresh` or `Dirty … : <reason>` line per unit. Desktop builds are not verbose, so for them
the measure is the number of `Compiling` lines against the ~700 packages in `Cargo.lock`.

### Results

Every cache was an exact key hit in every run. Nothing was saved except by run 36936312984 (the
only one with `save-if: true`). Sizes are the compressed archive.

| Build                            | npm                        | Rust cache | Gradle home | Recompiled                                    |
| -------------------------------- | -------------------------- | ---------- | ----------- | --------------------------------------------- |
| Linux                            | 141 MB                     | 654 MB     | —           | `aventura` only, 4/4 runs                     |
| Windows (Dev Drive)              | 140 MB                     | 594 MB     | —           | `aventura` only, 4/4                          |
| macOS arm                        | 138 MB                     | 558 MB     | —           | `aventura` only, 4/4                          |
| macOS intel                      | 138 MB (same key as arm)   | 558 MB     | —           | `aventura` only, 4/4                          |
| iOS                              | 138 MB (same key as macOS) | 652 MB     | —           | unknown — see [iOS](#ios)                     |
| Android, key `android`           | 141 MB                     | 901 MB     | 843 MB      | 12 of 354 units in each of the 4 cargo builds |
| Android, key `android-v2` (warm) | 141 MB                     | 901 MB     | 843 MB      | `aventura` only, all 353 dependencies `Fresh` |

`aventura` always recompiles: the checkout gives its sources fresh mtimes, `build-version` injects a
per-commit version, and rust-cache deliberately does not cache workspace crates.

Smaller observations, none acted on:

- The **macos-intel** leg runs on the same arm64 runner image as macos-arm and cross-compiles to
  `x86_64-apple-darwin` (its cache key says `Darwin-arm64`). There is no Intel hardware involved.
- The macOS image ships rustc 1.98.1 and `dtolnay/rust-toolchain@stable` updates it to 1.99.0 each
  job (6–13 s). rust-cache runs after that, so its key always sees 1.99.0 and is unaffected. 1.99.0
  was released the day of these runs; the image catches up on its own schedule.
- Every Rust job spends 2–9 s on `Updating crates.io index` with nothing to download, although
  `Cargo.lock` is in sync (`cargo metadata --locked` succeeds).
- On Windows every cache path (`E:\.cargo`, `E:\.npm`, the Dev Drive `target/`) restores onto the
  Dev Drive, and rust-cache's post step runs before the Dev Drive is removed, so saving from
  `master` works. rust-cache hashes the original checkout's `.cargo/config.toml` rather than the
  Dev Drive copy; the contents are identical.
- Uncached per-run downloads: Linux `apt` (50–65 s), NSIS tooling on Windows, `xcodegen` and
  `libimobiledevice` via Homebrew on iOS.

### Android generated Kotlin

The build scripts of `tauri` and `wry` write Kotlin into the gitignored
`src-tauri/gen/android/app/src/main/java/com/karelian/aventura/generated/` and declare
`rerun-if-changed` on those files. With only `target/` cached, the files are missing or newer than
the cached fingerprints on every run:

- first `aarch64` build: `Dirty wry v0.55.1: the file …/generated/PermissionHelper.kt is missing`
  (and `TauriActivity.kt` for `tauri`);
- second `aarch64` build: `… has changed (… 138998485ns after last build …)` — the build scripts
  wrote the files after the build-script-run timestamp;
- `armv7` and `x86_64`: `… has changed (… 3h 18m 10s after last build …)` against fingerprints
  from the `master`-saved cache.

`tauri` then dirties the 8 `tauri-plugin-*` crates and `wry` dirties `tauri-runtime-wry`, so 12 of
354 units rebuilt in each of the four cargo builds. The file contents do not change between builds;
only their mtimes do.

`cache-directories` stores that directory in the same entry as `target/`, so the files come back
with the mtimes the cached fingerprints expect. In the warm `android-v2` run, `tauri` and `wry` were
`Fresh` in all four builds and only `aventura` compiled. The time saved is small beside the app
crate's own release compile (about 70–95 s per build) and lost in run-to-run noise; the point is
that the restored cache is actually used. The option is not part of rust-cache's key,
so an exact hit never re-saves: adding a path or changing what is persisted means bumping the key
suffix (`android-v2`), which makes the next `master` run cold.

**Four cargo builds per job.** `tauri android build` runs one `aarch64` build itself, then Gradle
runs one per target (`aarch64`, `armv7`, `x86_64`) through `android-studio-script`. The second
`aarch64` build still recompiles `aventura`: the CLI rewrites `gen/android/tauri.settings.gradle`
between the two, and the app's build script declares `rerun-if-changed` on it
(`Dirty aventura: the file gen/android/tauri.settings.gradle has changed`). That costs about a
minute and only ever touches the app crate. Avoiding it means bypassing the CLI's build flow, so it
stays.

**Gradle work is not cached at all.** `./gradlew :app:lintUniversalDebug` ran 225 tasks: 210
executed, 15 up-to-date, none `FROM-CACHE`. Gradle's build cache and configuration cache are off,
and lint's Debug variant shares no task output with the Release assemble anyway.

To see dirty reasons again, set `CARGO_TERM_VERBOSE: true` on the Android build step.

### iOS

The iOS logs contain no cargo output at all: cargo runs inside Xcode's build phase
(`tauri ios xcode-script`), and `scripts/build-ios-unsigned.sh` calls `tauri ios build` without
`-v`, so the CLI hides `xcodebuild`'s output. Setting cargo environment variables cannot change
that.

The best available evidence says the cache works. Xcode's archive phase took 124–164 s across
the four runs. Building `aventura` alone takes 73–110 s on the macOS desktop legs, while a cold
`aarch64` Android build took 4 min 31 s. As far as is known, neither `tauri` nor `wry` generates
files into `gen/apple` the way they do into `gen/android`. The worst plausible case is
Android's old 12-unit rebuild, which cost 10–20 s per build over `aventura` alone.

To confirm it, run the iOS leg with `-v` added to `tauri ios build` and `CARGO_TERM_VERBOSE: true`
on the step.

## Rust cache growth

On 2026-10-11 the repository held 9.57 GB of caches:

| Entry                                           | 2026-10-01 | 2026-10-11 |
| ----------------------------------------------- | ---------- | ---------- |
| Rust, Android (`android-v2`)                    | 901 MB     | 1,866 MB   |
| Rust, iOS                                       | 652 MB     | 1,370 MB   |
| Rust, Linux                                     | 654 MB     | 1,355 MB   |
| Rust, Windows                                   | 594 MB     | 1,196 MB   |
| Rust, macOS arm                                 | 558 MB     | 1,120 MB   |
| Rust, macOS intel                               | 558 MB     | 1,120 MB   |
| Gradle home                                     | 843 MB     | 843 MB     |
| `main` branch (pnpm, Playwright, Electron, e2e) | —          | 921 MB     |

The 2026-10-01 sizes are clean: rustc 1.99.0 shipped that day, so every Rust cache had just been
rebuilt from nothing. Between the two dates, two `Cargo.lock` changes landed — #559 (2026-10-09)
and #610 (2026-10-11, 248 package versions changed). The Linux cache grew 654 → 935 → 1,355 MB.
`master` run [38176263193](https://github.com/AventurasTeam/Aventuras/actions/runs/38176263193)
for #610 shows the mechanism: `Restored from cache key "…-94ac442b" full match: false`, then
312 `Compiling` lines, then a save of everything.

### How rust-cache builds and prunes a cache

Read from [Swatinem/rust-cache](https://github.com/Swatinem/rust-cache) v2.9.2, which `@v2`
resolves to:

```
v0-rust-x86_64-unknown-linux-gnu-build-Linux-x64-4161e879-9086ef08
└─ prefix: `key` input, job, OS, arch, hash of rustc -vV ─┘ └ lock ┘
   and CARGO*/RUST*/CC* env vars                              hash
```

- **The lock hash** (`config.ts:155-263`) covers `Cargo.toml` with `package.version` zeroed,
  `Cargo.lock` minus workspace crates, `.cargo/config.toml` and `rust-toolchain*`. A release's
  version bump therefore keeps the key.
- **Restore** (`restore.ts:41`) asks for the exact key and falls back to the newest entry with
  the same prefix. There is no input to turn that fallback off.
- **Save** (`save.ts:24-27`) skips an exact hit. Otherwise it cleans `target/` and saves it under
  the new key. The cleanup (`cleanup.ts:39-79`) keeps every `build/`, `.fingerprint/` and `deps/`
  entry whose name, with the trailing `-<hash>` stripped, matches a crate _name_ in the current
  lockfile. It ignores versions and hashes.

So a dependency update restores the previous cache, cargo builds the new versions beside the old
ones, and the save keeps both. Each new entry inherits everything its predecessor held. The
duplication is wider than the list of changed versions: cargo's artifact hash includes the
versions of a crate's dependencies, so one bump deep in the tree (`syn`, `serde`) re-hashes
everything above it. Only a new rustc, which changes the prefix, starts a cache from nothing.

rust-cache has one pruning step and it is broken. On a partial match (`restore.ts:50-56`) it runs
the cleanup with a one-week age check, but the loop in `rmExcept` (`cleanup.ts:259-271`) returns
after the first entry of each directory. That is
[#375](https://github.com/Swatinem/rust-cache/issues/375), fixed on rust-cache's `master` by
[#377](https://github.com/Swatinem/rust-cache/pull/377) (commit `258712b`, 2026-08-12) and not
released as of 2026-10-11. Even fixed, it deletes everything built more than a week before the
restore (restored files keep their original mtimes), which after any real gap between dependency
updates is nearly a cold build. Upstream calls the growth expected
([#181](https://github.com/Swatinem/rust-cache/issues/181): "Its pretty much impossible which
ones are needed"). An exact-match-only restore mode
([#381](https://github.com/Swatinem/rust-cache/issues/381)) and a cargo-sweep-style cleanup
([#43](https://github.com/Swatinem/rust-cache/issues/43)) are open requests.

### Options weighed

| Option                                               | Verdict                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Hash the dependency set into `key`**               | **Chosen.** The hash lands in the prefix, so a dependency change has nothing to fall back to: one cold build per platform, and every saved entry holds one generation. Dependencies are updated rarely and in bulk, so the cold builds are acceptable. |
| Pin rust-cache to `258712b` for the #377 fix         | Bounded but not zero growth (two updates in a week still stack), and in practice nearly as cold as the chosen option. Pins an unreleased commit.                                                                                                       |
| Scheduled deletion of the Rust caches                | Growth returns between deletions; one cold build per platform per cycle regardless of whether anything changed.                                                                                                                                        |
| [cargo-sweep](https://github.com/holmgr/cargo-sweep) | Unmaintained per its README, and decides by file access time, which restored caches and runner filesystems do not track reliably.                                                                                                                      |
| `cargo clean gc` / `-Zgc`                            | Nightly-only, and cleans `~/.cargo`, not `target/`. Cargo has no target-dir GC.                                                                                                                                                                        |
| A custom pre-save prune                              | Needs to know which artifacts the build used. Cargo can report that, but the Tauri CLI, Gradle and Xcode wrap it, so the output is hard to capture. Fragile.                                                                                           |

### The dependency hash

`scripts/ci/cargo-deps-hash.js` hashes `Cargo.lock`'s registry and git packages (dropping
`aventura`, the same filter rust-cache uses) and `src-tauri/Cargo.toml` without the `[package]`
version line, and prints the first 16 hex characters. The `.github/actions/rust-cache` composite action appends it to
the `key` of all four rust-cache users (`build-desktop.yml`, `build-android.yml`, `build-ios.yml`,
`rust-lint.yml`'s Clippy job), and fails the step if the script fails. The manifest is included because a feature or profile change with an unchanged
`Cargo.lock` re-hashes the affected crates just as a version bump does.

Consequences:

- A dependency, feature or profile change starts every Rust cache cold: on the first `master` run
  after it merges, and on any PR that makes it (a PR cannot fall back to the old entry either).
- A release version bump changes neither hash, so release runs keep hitting.
- A new rustc still starts everything cold through rust-cache's own prefix. Clippy pins its
  toolchain, so for it the dependency hash is the only reset.
- A partial match is still possible within one dependency hash, when only `.cargo/config.toml` or
  `rust-toolchain*` changes. Those change rarely.
- During a dependency-update merge, the new entries are saved while the old ones still exist
  until GitHub evicts them (unused for 7 days, or least-recently-used once over 10 GB). The old
  ones are the least recently used, so they go first. Deleting them by hand
  (`gh cache list --key v0-rust-` then `gh cache delete <id>`) frees the space immediately.

Expected footprint: about 3.9 GB of platform Rust caches at 2026-10-01 sizes, plus Clippy's
`target/` (~600 MiB) and the `main` branch's ~0.9 GB.

**Re-check** if rust-cache ships #381 (an exact-match restore would make the hash unnecessary), or
if dependency updates become frequent enough that the cold builds hurt.

## Gradle

`build-android.yml` uses `gradle/actions/setup-gradle@v6` with the **basic** provider: one 843 MB
entry holding `~/.gradle/caches` and `~/.gradle/wrapper`, keyed on a hash of the build files,
restored as an exact hit on every run. It saved only dependency and wrapper downloads; the task
work ran regardless (see [Android generated Kotlin](#android-generated-kotlin)).

The **enhanced** provider ([docs](https://github.com/gradle/actions/blob/main/docs/setup-gradle.md#enhanced-caching))
was considered instead:

- It is free for this repository. DISTRIBUTION.md: "Public Repositories: Both **Basic** and
  **Enhanced** caching are free forever." It needs no key or account, but its component is under a
  proprietary licence ("solely for internal CI/CD purposes", no reverse engineering); basic is MIT.
- It stores more, not less. Its key includes the commit and job, so it writes "a new cache entry on
  every GitHub Actions run", and old entries leave only through eviction. Its deduplication pays off
  across many jobs and branches; this repository has one Android job.
- Neither provider turns on Gradle's build cache. That would need `org.gradle.caching=true` and
  would add another entry, for little: lint and assemble share almost no task output, and the Rust
  `.so` files change with every commit.
- Basic offers no cleanup and no include/exclude paths, so it is on or off.

#612 turned caching off to save quota. Uncached runs
([38192218726](https://github.com/AventurasTeam/Aventuras/actions/runs/38192218726),
[38197882367](https://github.com/AventurasTeam/Aventuras/actions/runs/38197882367)) against warm
ones ([38111960581](https://github.com/AventurasTeam/Aventuras/actions/runs/38111960581),
[38071840978](https://github.com/AventurasTeam/Aventuras/actions/runs/38071840978)):

| Android phase                            | Uncached    | Cached      |
| ---------------------------------------- | ----------- | ----------- |
| `setup-gradle` (restore)                 | 1–2.5 s     | 12–17 s     |
| Gradle startup to the first Rust handoff | 92 s / 96 s | ~24 s       |
| Packaging after the last Rust target     | ~120 s      | ~79 s       |
| `./gradlew :app:lintUniversalDebug`      | 49 s / 46 s | 37 s / 36 s |

The distribution zip itself downloads in ~1.5 s; the rest is Maven dependency resolution, which
Gradle does not log without `--info`. Net cost uncached: about 1m45s per run, on the job that
already finishes last.

**Decision:** cached, `cache-provider: basic` so the proprietary component is never selected.
It saves only from the default branch, like the other caches.

## npm

`.github/actions/npm-install` keys on `npm-<os>-<arch>-<lockfile hash>`. Desktop Linux runs in an
`ubuntu:22.04` container where `HOME=/github/home`; Android runs on the host. With the default
`~/.npm`, the two jobs produced the same key but two ~140 MB entries, because `actions/cache` keeps
entries apart by a version hashed from the literal `path` input and the compression method. Their
contents were the same: one lockfile, one Node version, both linux-x64-glibc.

Passing the same literal path is not enough. `actions/cache` stores tar entries relative to
`GITHUB_WORKSPACE` and extracts with `tar -P -C <workspace>`, so a `~/.npm` archive saved in the
container would restore on the host to `/home/runner/github/home/.npm`. That is reported as a hit,
which also skips the save.

On Linux the action therefore points `npm_config_cache` at `.npm-cache` inside the checkout:
`/__w/Aventuras/Aventuras/.npm-cache` in the container and
`/home/runner/work/Aventuras/Aventuras/.npm-cache` on the host. Those are the same directory, and
the literal path and the relative position match. A sibling `../.npm-cache` would restore but
never save: `actions/cache/save` resolves its paths with `@actions/glob`, which rejects `..`
segments, and the action reports that only as a warning.

Windows keeps the Dev Drive path `build-desktop.yml` sets, and macOS has no container split, so
neither changes. Desktop Linux installs `zstd` before this action; without it, the compression
method would differ and split the entry again.

## armv7

i686 was already dropped. Dropping `armv7` (`armeabi-v7a`) as well would save about a third of the
Android Rust cache (~600 MB) and 1–1.5 minutes per build.

Who would lose the app:

- With `minSdk = 26` (Android 8.0), almost no phones with 32-bit chips remain in range.
- Phones with 64-bit chips running a **32-bit-only** Android remain, and they are still sold new.
  The [Android 16](https://source.android.com/docs/compatibility/16/android-16-cdd) and
  [Android 17](https://source.android.com/docs/compatibility/17/android-17-cdd) compatibility
  definitions (§7.6.1) strongly recommend 32-bit-only userspace for handhelds with 2–4 GB of RAM and
  require a single ABI below 2 GB. In practice that is Android Go and budget phones, mostly in
  emerging markets. Google expects 32-bit-only devices to stay important for Go, TV and Wear
  ([Android Developers Blog, 2022](https://android-developers.googleblog.com/2022/10/64-bit-only-devices.html)).
- There is no public data on their share. The only figure found is an unsourced "9–10%".
- They would likely run the app, since the model runs remotely. The APK is sideloaded and
  universal, so without `armv7` they would get a bare "App not installed".

**Decision:** keep `armv7`. The dependency hash recovers more space than dropping it would.
`x86_64` stays for Chromebooks and emulators.
