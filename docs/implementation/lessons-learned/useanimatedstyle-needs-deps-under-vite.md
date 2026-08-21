# `useAnimatedStyle` needs an explicit dependency array under Vite-built targets

`useAnimatedStyle` without an explicit dependency array works under Metro
only because `babel.config.js` enables `react-native-worklets/plugin`, which
injects `updater.__closure` for the hook to read. Every Vite-built target
misses it — `@storybook/react-native-web-vite`'s preset passes
`babel: { babelrc: false, configFile: false }`, so `babel.config.js` is
never read. The hook then throws under `__DEV__` (Storybook's dev server,
where `vite-plugin-rnw` defines `__DEV__` as `mode === 'development'`) and
silently builds `dependencies = [undefined]` under `mode: test`, where the
animation renders but never runs. One defect, two failure modes, and the
quiet one passes CI.

## Why

**Symptom.** A story renders blank with `ReanimatedError: useAnimatedStyle
was used without a dependency array or Babel plugin` in the dev-server
console, while the vitest lane is green. Because the throw escapes to
Storybook's ErrorBoundary it takes the whole component with it, not just the
animated subtree — the visible symptom is far larger than the cause.

## Fix

Pass deps explicitly at every web-reachable call site. Verified inventory as
of 2026-08-21 — all three files now comply: `accordion.tsx:66`
(`[isExpanded]`) and `:70` (`[progress]`), `toast.tsx:83` (`[dragOffset]`,
corrected in this slice — it previously passed `[]`), `entry-card.tsx:296`
(`[opacity]`).

**`[]` is worse than omitting the argument.** An empty array is truthy, so
`!dependencies` is false and the `__DEV__` throw never fires, while
`dependencies?.length` is 0 so `inputs` stays empty and the reactive mapper
never re-fires. It silences the only guard while supplying no dependency.

## Remaining latent sites

Six sites remain deps-less and are safe only by platform gating — making any
of them web-reachable reproduces this: `skeleton.tsx:44` (inside
`NativeSkeleton`, behind `Skeleton`'s web early return),
`suggestion-categories-editor.tsx:408`, `:742`, `:750`, `:751` (inside
`PhoneRowShell` / `PhoneList`, reachable only via `isNative`), and
`keyboard-inset-column.native.tsx:18` (a `.native.tsx` file, which never
resolves on web at all).

Note the sharper half: the guard string appears **only** in
`useAnimatedStyle.js` — grepping the Reanimated module tree confirms it.
`useDerivedValue` and `useAnimatedProps` have no `__DEV__` check whatsoever,
so a web-reachable deps-less one fails silently in _both_ modes, with no
loud half to catch it. Two of the six latent sites above
(`suggestion-categories-editor.tsx:742` and `:750`) are `useDerivedValue`.

## How to apply

- Every `useAnimatedStyle` / `useDerivedValue` / `useAnimatedProps` call
  that a Storybook story can reach passes its dependency array explicitly —
  never rely on the Babel-plugin closure capture, which Vite never runs.
- Never pass `[]` as a placeholder. It reads as "no dependencies" but
  actually disables the dev guard while also disabling reactivity; list the
  real values or omit the argument and let the throw catch the gap.
- Pinning `react-native-worklets/plugin` globally via
  `pluginReactOptions.babel.plugins` in `.storybook/main.ts` was considered
  and deferred — it changes every story's build output and wants its own
  verification. See
  [`triage.md`](../triage.md) for the cost analysis.

Related: [Reanimated 4 async SV write](./reanimated4-async-sv-write.md) and
[Vite eagerly bundles a runtime-guarded `require()`, Metro doesn't](./storybook-vite-eager-guarded-require.md)
— both are Vite-versus-Metro divergences in how this repo's Reanimated
surface gets built.
