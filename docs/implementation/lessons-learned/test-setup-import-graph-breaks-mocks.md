# Keep `vitest.setup.ts`'s import graph thin — an eager setup import breaks per-file `vi.mock`

`vitest.setup.ts` runs `registerAllDomains()` from `@/lib/actions` before
every unit test file. Whatever that import chain transitively pulls in is
loaded **during setup**, before any test module evaluates. When a
setup-reachable module imports a module that a test later mocks, the test's
`vi.mock` can silently fail to apply — the test sees the real module, not
the mock.

## Why

`vi.mock(specifier, factory)` is hoisted to the top of the **test file** and
governs that file's module graph. But `setupFiles` execute first, in the
same worker. If setup has already evaluated the real module (and bound its
singletons) by the time the test's mock registers, the mock doesn't reliably
replace what setup loaded. The failure is silent: the mock factory never
runs, and assertions see the real implementation.

ESM makes this easy to trigger by accident: importing **one** name from a
barrel evaluates the **whole** barrel — every `export … from './x'` line
runs. Tree-shaking does not happen at vitest runtime. So a single innocuous
import can drag a large subtree into the setup graph.

Concrete instance (Slice 2.1): an action imported `AGENT_IDS` from
`@/lib/ai`. That one import evaluated the entire `@/lib/ai` barrel — the
`ai` SDK, `transport/fetch.ts`, and `model.ts` (which imports
`@/lib/stores`). The chain
`vitest.setup.ts → @/lib/actions → @/lib/ai → everything` loaded all of it
at setup time, which broke `vi.mock('@/lib/diagnostics')`,
`vi.mock('@/lib/stores')`, and `vi.mock('ai')` across three `lib/ai` test
files. The tell-tale symptom was a mock assertion reporting
`Number of calls: 0` (the real `httpCallSink` ran, not the mock), a real
store returning empty state, and a real SDK call throwing instead of the
mocked resolve.

The trap is nasty because each test passes **in isolation** and the break
only appears once two unrelated things are both true: a setup-reachable
module gained the heavy import, **and** the full setup runs. A diff that
adds `import { X } from '@/lib/heavy-barrel'` to a setup-reachable module
can break tests in files it never touched.

## How to apply

- Keep the action layer (reachable from setup via `registerAllDomains`) free
  of heavy barrels at module-load. The provider/config layers must not pull
  `@/lib/ai` (the AI SDK) into their import graph just to reach a constant.
- Need a small const or type that happens to live in a heavy barrel?
  Relocate it to a light module both layers already reach. We moved the
  agent registry to `@/lib/db` (which the action layer imports anyway, and
  which pulls no SDK), and had `@/lib/ai` re-export it so its public surface
  was unchanged.
- Diagnostic signature: a **code-unchanged** test file starts failing with
  mocks not applying. Bisect the module graph, not the test. Ask whether
  `vitest.setup.ts`'s transitive imports now reach the mocked module.
  Confirm by running the test file alone at the branch base versus `HEAD` —
  if it passes at base and the test file is byte-identical, the regression
  is in the import graph, not the file.

Related: the `lib/*` public-barrel rule in
[`code-conventions.md → Module structure`](../../code-conventions.md#module-structure)
is what makes "import one name, evaluate the whole barrel" the default —
the boundary is correct, but it means barrel weight is load-bearing for any
consumer reachable from test setup.
