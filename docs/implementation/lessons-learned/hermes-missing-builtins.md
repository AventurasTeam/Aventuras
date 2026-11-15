# Hermes lacks some recent builtins

**Symptom.** Code that runs on web and in the unit tests throws
`TypeError: undefined is not a function` on Android. 5.9 shipped
`Array.prototype.toSorted` into close code; only review caught it.

**Why.** The Android app runs on Hermes 0.14.1 (RN 0.83's bundled
engine; Hermes V1 is opt-in). Node 24 and Chromium carry builtins it
lacks. Read from the release runtime's `libhermesvm.so` (the
`hermes-android-0.14.1-release.aar` Gradle caches), not run on a device:
the names `toSorted`, `isWellFormed`, `toWellFormed`, `groupBy`,
`withResolvers`, `fromAsync`, `structuredClone` and Set's `union`,
`intersection`, `difference`, `symmetricDifference`, `isSubsetOf`,
`isSupersetOf` and `isDisjointFrom` are absent, while `toReversed`,
`toSpliced`, `findLast`, `flatMap`, `replaceAll` and `hasOwn` are
present. `hermesc` (the `hermes-compiler` package) holds no builtin
names at all, so it can't answer the question.

**How to apply.**

- `eslint.config.js`'s `HERMES_BUILTIN_BANS` rejects the absent names
  it can match safely in code that ships to the app; tests, scripts,
  Electron main, E2E and stories are exempt, since they run on Node or
  in the browser.
- The lint can't see Set's methods: `union` is also zod's `z.union`, and
  ESLint has no types here. Don't call them on a `Set`.
- `structuredClone` is absent too; `lib/diagnostics`'s HTTP sink keeps a
  fallback for it.
- Before reaching for a builtin newer than ES2022, check the runtime
  the same way (unzip the aar, `grep -ao <name> jni/*/libhermesvm.so`,
  and compare against a builtin known to exist).

Found 2026-11-14 in a triage pass, from 5.9's clustering review.
