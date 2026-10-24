# electron-builder packs every production dependency; exclude in a per-platform `files` list

In a single Expo app every React Native library is a production
dependency, and electron-builder copies every production dependency
into the desktop app whatever `files` says. Only exclusions apply to
`node_modules`. React Native libraries build Android in place, under
`node_modules/<pkg>/android/build`, and electron-builder moved those
packages, native binaries and all, out of the asar into
`app.asar.unpacked` without any `asarUnpack` entry naming them. So once a machine has run a local Android build,
its Linux packages carry the Gradle output: the 2026-07 deb was
2.2 GB, 10.3 of its 11.3 GB payload under `node_modules/*/android`.
CI packages a clean checkout and never sees it.

[`electron-builder.ts`](../../../electron-builder.ts) now keeps only
the dependency closure of what `electron/dist` loads, which took the
deb to under 150 MB. Getting there hit the traps below, all verified
against electron-builder 26.8.1.

## Trap 1: a `build` key in `package.json` shadows the config file

When `package.json` has a `build` key, electron-builder uses it and
never reads `electron-builder.ts`, without a warning. The config has
to live in one place, and the file needs the `package.json` key gone.

## Trap 2: `onNodeModuleFile` cannot exclude

The docs say returning `false` force-excludes a file. In 26.8.1
`NodeModuleCopyHelper` only reads a truthy return, to skip the default
ignores; `false` changes nothing. Exclusion has to be a `files`
negation. Those match the packaged, hoisted layout
(`node_modules/<pkg>/...`), not pnpm's `.pnpm` store paths, with
minimatch's `dot: true`.

## Trap 3: root `files` plus platform `files` packs the whole repo

electron-builder turns a root `files` list into a separate matcher.
A platform list (`linux.files`) then becomes the default matcher on
its own, and when it holds only exclusions electron-builder prepends
`**/*`, so the asar picks up `android/app`, `storybook-static`, `docs`
and the rest of the checkout. Keep one complete list per platform
instead of a root list with platform additions.

## Trap 4: `${platform}` is the build host, and `dir/**` keeps the dir

The `${platform}` file macro expands to the host's `process.platform`,
so a cross-build would apply the host's patterns; `${arch}` does
follow the target. Write the platform literally per target.

A negation ending in `dir/**` misses `dir` itself, so the walker still
descends into it and leaves it behind empty. End it in the `${/*}`
macro, which expands to `{,/**/*}`.

## Trap 5: typing the config breaks the app's typecheck

The repo's root tsconfig takes every `**/*.ts`, so the config file
joins the app's program. Importing electron-builder's `Configuration`
type drags its type graph in with it, which flips global overloads
elsewhere: `setTimeout` starts returning `Timeout` and `fetch` mocks
stop assigning. The config stays untyped; electron-builder
schema-validates it on load, so an unknown key still fails the build.

## How to apply

After a dependency change, measure `release/linux-unpacked` and list
the asar, not just the final package size. When patterns misbehave,
run with `DEBUG=electron-builder` and read the computed
`firstOrDefaultFilePatterns` and `nodeModuleFilePatterns` in
`release/builder-debug.yml`; that is what exposed trap 3. Test a new
pattern against hoisted sample paths with app-builder-lib's own
minimatch before spending a build on it, and run the packaged E2E
suite after any change to the kept set: a dependency a package uses
without declaring it fails only in the packaged app.
