# Vite-built targets never read `babel.config.js` — wire worklets yourself

`useAnimatedStyle` without an explicit dependency array works under Metro
only because `babel.config.js` enables `react-native-worklets/plugin`, which
injects the `updater.__closure` the hook reads. A Vite-built target sees none
of that: `@storybook/react-native-web-vite`'s preset hardcodes
`babel: { babelrc: false, configFile: false }`, so the repo's Babel config is
unreachable no matter what it contains.

Storybook — the repo's one Vite target — now passes the plugin explicitly via
`framework.options.pluginReactOptions.babel.plugins` in `.storybook/main.ts`.
The preset spreads that object _after_ its own two flags, so it merges without
ever re-opening `babel.config.js`. **A new Vite-built target starts from zero
again and must do the same.**

## Why it stayed hidden

One defect, two failure modes, and the quiet one passes CI. The hook throws
under `__DEV__` — Storybook's dev server, where `vite-plugin-rnw` defines
`__DEV__` as `mode === 'development'` — and silently builds
`dependencies = [undefined]` under `mode: test`, where the animation renders
but never runs. CI runs `pnpm test:run` alone, so it only ever saw the quiet
half.

**Symptom of the loud half.** A story renders blank with `ReanimatedError:
useAnimatedStyle was used without a dependency array or Babel plugin` in the
dev-server console while the vitest lane stays green. The throw escapes to
Storybook's ErrorBoundary and takes the whole component with it, not just the
animated subtree, so the visible symptom is far larger than the cause.

## The traps that survive the fix

**`[]` is worse than omitting the argument.** An empty array is truthy, so
`!dependencies` is false and the `__DEV__` throw never fires, while
`dependencies?.length` is 0 so `inputs` stays empty and the reactive mapper
never re-fires. It silences the only guard while supplying no dependency.

**Only `useAnimatedStyle` has a guard at all.** The dev-throw string appears
solely in `useAnimatedStyle.js` — grepping the Reanimated module tree confirms
it. `useDerivedValue` and `useAnimatedProps` have no `__DEV__` check
whatsoever, so if a target ever loses the plugin again, those fail silently in
_both_ modes with no loud half to catch it.

## How to apply

- Any new Vite-built target that compiles this repo's components declares
  `react-native-worklets/plugin` in its own Babel plugin list. Assume
  `babel.config.js` is invisible to it.
- Never pass `[]` as a placeholder dependency array. List the real values, or
  omit the argument.
- Explicit dependency arrays remain the house style at web-reachable call
  sites — they are correct independent of which bundler ran, and they keep the
  hook honest if the plugin wiring regresses.

Related: [Reanimated 4 async SV write](./reanimated4-async-sv-write.md) and
[Vite eagerly bundles a runtime-guarded `require()`, Metro doesn't](./storybook-vite-eager-guarded-require.md)
— both are Vite-versus-Metro divergences in how this repo's Reanimated
surface gets built.
