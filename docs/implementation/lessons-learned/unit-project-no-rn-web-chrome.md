# The `unit` Vitest project cannot render RN-Web component chrome

Once a component transitively touches `@rn-primitives/*`,
`react-native-svg`, `lucide-react-native`, or `nativewind`, mounting
it under `vitest --project unit` fails with one of two compounding
errors — neither fixable from the test file.

## Why

1. **`@rn-primitives/alert-dialog` and `@rn-primitives/slot` ship
   un-transpiled JSX in their `.mjs` builds.** Vite's default esbuild
   loader mapping doesn't treat `.mjs` as JSX-capable, so once one of
   these packages gets inlined the build fails with
   `Failed to parse source... invalid JS syntax` at the JSX token.
2. **`react-native-svg`, `lucide-react-native`, and `nativewind` all
   transitively `require('react-native')`.** Vitest's default
   node_modules externalization loads that via a raw Node `import()`,
   which bypasses the project's `react-native` → `react-native-web`
   resolve alias — the alias only applies inside Vite's resolver,
   which externalized packages never reach — and lands on the real
   `react-native` package's Flow-syntax entry, throwing
   `SyntaxError: Unexpected token 'typeof'`. Reproducible in plain
   Node with `await import('react-native-svg')`, no Vite involved.

Ruled out empirically: `test.server.deps.inline`; `ssr.noExternal`
combined with SSR-level `ssr.resolve.alias`; and `resolve.extensions`
with `.web.mjs`/`.web.js` priority (which fixes resolution but then
hits the JSX-parse failure from point 1).

**Why Storybook doesn't have the problem.**
`@storybook/react-native-web-vite`'s `viteFinal` wires
`vite-plugin-rnw`, which sets `resolve.extensions` **and**
`optimizeDeps.esbuildOptions.loader: {'.js': 'jsx', '.mjs': 'jsx'}`
**and** `resolve.alias` — the full combination. The `unit` project
carries none of it; adopting the plugin there is an infra decision
the `storybook` project doesn't need repeated.

## How to apply

- Component behavior goes to Storybook, which
  [`code-conventions.md → Testing discipline`](../../code-conventions.md#testing-discipline)
  already prescribes; keep the `unit` project for `lib/*`-style
  logic (pure functions, reducers, state machines, parsers).
- Pure modules that import only **types** from a component are fine
  under `unit` — the failure is import-time, not type-level.
- If component tests in the `unit` project become a real need,
  that's an infra decision — adopt `vite-plugin-rnw` for it — not a
  per-test workaround with mocks. Mocking around either failure
  papers over the same gap for exactly one test at a time.
