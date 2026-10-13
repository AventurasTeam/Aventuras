# Development rules

The rules for changing this codebase, one line each. Each links to the document that states the
rule in full: where it applies, what to do, and the short reason. That document links the
measurements and sources behind it.

[AGENTS.md](../../AGENTS.md) repeats the rules under [Every change](#every-change). The
architecture of each area is in [ARCHITECTURE.md](../ARCHITECTURE.md), and the decisions in force
are indexed in [docs/README.md](../README.md).

## Every change

- Run `check`, `test` and `lint` before calling a change done. None of them renders a component,
  so run the app for anything the UI shows. [testing.md](testing.md)
- Comment only what the code cannot say: an invariant, a non-obvious constraint, a reason. No
  history, measurements, self-referential prose or restatements. [comments.md](comments.md)
- Match the surrounding code, unless that means a dated idiom. [code-style.md](code-style.md)
- Write new code, and code you are already changing, in the current idiom of the installed
  versions, and name the modernizations in the commit message. [modern-code.md](modern-code.md)
- Use no JS, CSS or Web API newer than Chrome 111 / Safari 16.4 unless MDN says it works there.
  [platform-support.md](platform-support.md)
- Read an area's decisions and architecture doc before changing it. Record a decision as an ADR in
  the PR that makes it, and update an area doc in the same commit when the behaviour it describes
  changes. [ARCHITECTURE.md](../ARCHITECTURE.md), [docs/README.md](../README.md)

## TypeScript and Svelte

- Svelte 5 runes only, no legacy store syntax. [code-style.md](code-style.md#svelte)
- Import `src/lib` as `#lib/…` with the file's real extension; there is no `$lib`.
  [code-style.md](code-style.md#imports)
- Import a service through its `index.ts`, not its internals. [code-style.md](code-style.md#imports)
- Never write `?? <default>` for a value that has a default in `ai/core/defaults.ts`.
  [code-style.md](code-style.md#defaults)
- Build a new UI primitive on bits-ui by hand; do not run the shadcn-svelte generator.
  [ui-components.md](ui-components.md)

## Tests

- Put logic that needs a test in a plain `.ts` module; a `*.svelte.ts` module cannot be imported
  by a test. [testing.md](testing.md)
- Opt a test into the DOM per file with `// @vitest-environment jsdom`; every other file stays on
  `node`. [testing.md](testing.md)
- Keep live provider tests out of required CI. [testing.md](testing.md#discovery-provider-tests)

## Network

- Send remote HTTP through the plugin helpers, never the WebView's `fetch`.
  [network-requests.md](network-requests.md)
- After an abort, check `signal.aborted`; the plugin never throws an `AbortError`.
  [network-requests.md](network-requests.md#what-the-helpers-do-not-do-yet)
- Bring in no second TLS provider on the Rust side. [network-requests.md](network-requests.md#rust-side)

## Database

- Never edit a migration that has shipped; add a new one, with LF line endings.
  [persistence.md](../architecture/persistence.md#database-and-migrations)
- Never `BEGIN` from the frontend; send statements that must land together through
  `database.transaction()`. [persistence.md](../architecture/persistence.md#database-and-migrations)

## Builds and releases

- Never run `tauri android init` over the tracked `src-tauri/gen/android/`. Generate
  `src-tauri/gen/apple/` only with the bootstrap workflow. [release.md](release.md#building-android),
  [release.md](release.md#building-ios)
- Never hand-edit the generated `RustWebView.kt`; inject Kotlin through `.cargo/config.toml`.
  [release.md](release.md#building-android)
- Write the release notes before publishing the draft; publishing is what ships the release.
  [release.md](release.md#the-updater)
- Keep `RELEASE_REPO` in `updater.ts` and `updater.endpoints` in `tauri.conf.json` in step.
  [release.md](release.md#the-updater)
- Bump the pinned Clippy toolchain in `rust-lint.yml` and `package.json` together.
  [release.md](release.md#continuous-integration)
- Move a release runner to a newer image only by a deliberate bump.
  [release.md](release.md#runner-pinning)
- Bump the `android-v2` key suffix to change what Android's Rust cache stores.
  [release.md](release.md#build-caching-and-speed)
- When upgrading Tailwind or Vite, check whether the platform floor moved, and keep the
  repository README's install table in step. [platform-support.md](platform-support.md#what-sets-the-floor)
