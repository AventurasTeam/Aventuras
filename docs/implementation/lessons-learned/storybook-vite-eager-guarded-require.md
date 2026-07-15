# Vite eagerly bundles a runtime-guarded `require()`, Metro doesn't

A module-scope `if (typeof window !== 'undefined') { ... } else { require('some-node-only-pkg') }`
guard is safe under Metro (the `require()` genuinely never executes in a
browser context) but can crash under Vite, which pre-bundles dependencies by
static scan rather than runtime branch.

## Why

Metro's CJS `require()` is lazy and runtime-executed — if `window` is
defined, the `else` branch's `require()` call is simply never reached, so
the dependency it names never runs, even though it may still ship in the
bundle as dead weight.

Vite's dependency pre-bundler (`optimizeDeps`, used by both
`storybook dev`/`storybook build` and the `@storybook/addon-vitest` browser
test project via `@storybook/react-native-web-vite`) works differently: it
scans source for `require`/`import` specifiers ahead of time and pre-bundles
whatever it finds into an ESM-compatible chunk, independent of whether the
runtime branch guarding that specifier is ever taken. If the dependency's
own module-scope code assumes a Node environment (e.g. `jsdom` touching
`SharedArrayBuffer`, unavailable in a non-cross-origin-isolated browser
tab), that code still runs, and it crashes — even though the guard is
logically correct and the branch is never _supposed_ to execute there.

Concrete instance: `lib/markdown/sanitize.ts`'s `typeof window !== 'undefined'`
guard (added for Metro's Node-based Expo Router static prerender, where
`window` really is undefined) crashed **every** Storybook story that
imports `EntryCard` — not just ones exercising the new markdown render path
— with `ReferenceError: SharedArrayBuffer is not defined`, thrown from
Vite's pre-bundled `jsdom` chunk before any component ever rendered.

## How to apply

- Don't "fix" the guard itself if it's correct for the bundler that
  actually needs it (Metro, here) — changing it risks regressing the real
  production path (SSR/SSG) it exists for.
- Scope the fix to the tool that can't respect the guard. For Storybook's
  Vite config specifically: alias the offending bare specifier to a stub
  module via `viteFinal`'s `resolve.alias`, so Vite's pre-bundler never
  sees the real package in that context. See `.storybook/main.ts` /
  `.storybook/jsdom-stub.ts` for the working shape (including normalizing
  `resolve.alias`'s array-vs-object form, and giving the stub a CJS-shaped
  `default` export so bundler CJS-interop doesn't warn on it).
- Prefer a throwing stub over a silent no-op one when the guarded branch is
  security- or correctness-sensitive (sanitization, here) — a throw can
  only ever surface as a loud Storybook crash if the assumption "this
  branch is unreachable in a browser" ever turns out to be wrong; a silent
  no-op could instead make an unreachable-in-theory branch dangerous if it
  were ever reached.
- Diagnostic signature: a component that has never imported the affected
  module before suddenly makes every one of its Storybook stories crash
  with an error pointing at an unrelated-looking Node/browser API
  (`SharedArrayBuffer`, `require is not defined`, etc.) the moment it
  starts importing something that has this pattern anywhere in its own
  import graph.
