# Modern code

Write new code in the current idiom of the installed versions, using the newest feature each
layer's floor allows. Check the installed version's docs, not memory, for what is current.

| Layer            | Floor                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| JS, CSS, HTML    | Chrome 111 / Safari 16.4 ([platform-support.md](platform-support.md)) |
| Svelte, Tailwind | the installed 5.x and 4.x                                             |
| SQL              | the SQLite `libsqlite3-sys` bundles on every platform (3.46)          |
| Rust             | edition 2024                                                          |

## Per layer

- **Svelte**: `{@attach}` over `use:` actions for new code — an attachment re-runs when state it
  reads changes, an action does not — and `fromAction` to convert an existing action unchanged.
  `cn(…)` over `class:` directives, snippets and callback props over slots and dispatched events.
- **HTML**: the native element over a `div` with ARIA and key handlers — `<button>`, not
  `role="button"` plus `tabindex` and `onkeydown`. Where a bits-ui component exists for the job
  (dialog, popover, select), use it ([ui-components.md](ui-components.md)).
- **TS/JS**: `async`/`await` over `.then` chains, `$state.snapshot` for reactive state,
  `structuredClone` for plain values (it throws on a `$state` proxy) over
  `JSON.parse(JSON.stringify(…))`, `toSorted`/`toSpliced`/`with`/`at`/`findLast` over
  copy-then-mutate or index arithmetic.
- **Types**: make the type system carry the shape. A known shape gets a named type, not `object`,
  `Object`, `Record<string, …>` or an index signature; a lookup is keyed by a literal union
  (`Record<ServiceId, …>`), or is a `Map` when its keys are truly dynamic. Derive types with
  `keyof`, `typeof` and indexed access rather than restating them. `satisfies` and discriminated
  unions with an exhaustive `never` check over casts and boolean flags; narrow `unknown` with a
  type guard at the boundary over `as` or `any`, and over `Object.keys`/`entries` cast back to
  the key type.
- **Tailwind**: v4 names and syntax — `shrink-0`, `grow`, `bg-linear-to-*`, `size-*`, `bg-(--x)` —
  over v3 aliases and `[var(--x)]`. A value used twice is a token in `@theme` in `src/app.css`,
  not a repeated arbitrary value; `tv(…)` for a component with variants.
- **CSS**: `:has()`, container queries, `dvh`, `color-mix()`, logical properties, `gap` — over JS
  measurement, `vh`, and margin hacks.
- **SQL**: `RETURNING` over a follow-up `SELECT` or `last_insert_rowid()`, `->>` over
  `json_extract`, `ON CONFLICT … DO UPDATE` over `INSERT OR REPLACE` (which deletes and re-inserts
  the row). Shipped migrations stay as they are.
- **Rust**: `let … else` and `?` over nested `match`/`unwrap`.

Some current features are still newer than the floor; the list is in
[platform-support.md](platform-support.md#the-rule).

## Scope

This applies to code you are already changing, not to a hunt through the codebase. When you edit
a function or component, modernize the dated idioms in it and in the code it directly touches,
keeping its behaviour the same. Some swaps change behaviour on their own:
`ON CONFLICT … DO UPDATE` keeps unlisted columns and the existing row, which `INSERT OR REPLACE`
deletes and re-inserts; `async` turns a synchronous throw into a rejection. Make one only where it
behaves the same here — every column is set, nothing depends on the delete, no caller relies on
the throw — and keep the old idiom otherwise rather than adjusting other code to fit. Leave
untouched files alone. Modernizations stay out of the commit message: it describes only the
functional change.
