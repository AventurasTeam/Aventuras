# React Compiler shares a capture-free handler across every instance

React Compiler hoists a function that captures nothing from its component or
hook to module scope. Two instances of the hook then hold the **same**
function, and anything keyed on function identity treats them as one.
`addEventListener` is: it dedupes a listener added twice by reference, and
removes it for everyone on the first `removeEventListener`.

`useUnsavedChangesGuard` hit it. Each dirty surface added its own
`beforeunload` handler, `(event) => event.preventDefault()`, with a comment
saying per-surface was the point. Compiled, every surface added one shared
function, so the first surface to go clean unhooked the prevent for every other
still-dirty one. The shipped bundle showed it directly:
`const t=p;window.addEventListener("beforeunload",t)`, with `p` at module
scope. The fix holds one module-level listener while a set of per-instance
tokens is non-empty, which no hoisting can merge.

## Why it stayed hidden

Neither test project ran the compiler. The unit project used vite's plain
transform, and Storybook's babel pass carried only the worklets plugin (see
[Vite-built targets never read `babel.config.js`](./vite-targets-dont-read-babel-config.md)).
The guard's two-surface test passed against code that never ships.

## How to apply

- Both projects now run the build's own compiler over app sources
  (`scripts/react-compiler.ts`, resolved through `babel-preset-expo`). A new
  Vite-built target must wire it too, first among its babel plugins.
- Compiled code imports `react/compiler-runtime`. Keep it in the browser
  project's `optimizeDeps.include`: discovered mid-run, it re-optimizes the
  dependency bundle and fails every story file importing at that moment with
  "Vitest failed to find the current suite", while every test reports green.
- A per-instance listener, timer or subscription keyed on a function must not
  rest on the function being distinct. Key it on an object the instance owns.
- A test that calls a component as a plain function breaks once the component
  is compiled: it reads its memo cache, which needs a render. Call it inside
  `renderHook`.
