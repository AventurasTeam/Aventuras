# One `exhaustive-deps` suppression opts the whole component out of React Compiler

React Compiler is on for this app (`app.json` → `expo.experiments.reactCompiler`).
A single `// eslint-disable-next-line react-hooks/exhaustive-deps` anywhere
inside a component makes the compiler skip **the entire component**, not the
one effect the comment sits above — and nothing in lint, CI or a Storybook
build says so.

## Why

The compiler refuses to optimize code whose React-rule compliance it cannot
trust, and a suppression comment is exactly that signal. Run it over a file
carrying one and it reports:

```
React Compiler has skipped optimizing this component because one or more
React ESLint rules were disabled
  Found suppression `eslint-disable-next-line react-hooks/exhaustive-deps`
```

The suppression is the cheap, local-looking fix for "this effect should fire
once" — which is why it spreads — and its cost is invisible at the call site.

There is a second, larger class the compiler bails on that lint cannot see at
all, because it is not a rule violation: `try … finally` in a handler, reading
a ref during render, manual memoization whose inferred deps don't match the
written ones, and a handful of incompatible-library cases. Those bail silently
too.

## How to apply

- **Never add the suppression.** Write honest deps; when an effect genuinely
  must fire once, latch it with a ref _inside_ the effect body, or use React's
  "adjust state when a prop changes" pattern during render instead of an effect.
- **To find the invisible bail-outs**, run the compiler yourself with
  `panicThreshold: 'all_errors'` — it turns every silent skip into a thrown
  error naming the file, the line and the reason:

```js
babel.transformSync(source, {
  filename,
  babelrc: false,
  configFile: false,
  presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
  plugins: [['babel-plugin-react-compiler', { panicThreshold: 'all_errors' }]],
})
```

`pnpm compiler:check` (`scripts/compiler-bailouts.ts`) runs exactly this
in CI, with the compiler `babel-preset-expo` builds with, over `app/`,
`components/`, `hooks/` and `lib/`. It ratchets against
`scripts/compiler-bailouts.baseline.json`: a file that newly bails fails
the build, and so does a baseline entry that now compiles, until it is
removed. `pnpm compiler:check --list` prints every current bail-out with
its reason. Lint still can't see these — `eslint-plugin-react-hooks` 5.2.0
ships no compiler rule — and `.storybook/main.ts` adds only the worklets
plugin, so plays exercise uncompiled components. Surfaced in Slice 4.4,
where it was a standing rule for every task.
