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

- **Svelte**: `{@attach}` over `use:` actions, `cn(…)` over `class:` directives, snippets and
  callback props over slots and dispatched events.
- **HTML**: the native element over a `div` with ARIA and key handlers — `<button>`, not
  `role="button"` plus `tabindex` and `onkeydown`. Where a bits-ui component exists for the job
  (dialog, popover, select), use it ([ui-components.md](ui-components.md)).
- **TS/JS**: `async`/`await` over `.then` chains, `$state.snapshot` or `structuredClone` over
  `JSON.parse(JSON.stringify(…))`, `toSorted`/`toSpliced`/`with`/`at`/`findLast` over
  copy-then-mutate or index arithmetic, `satisfies` and discriminated unions with an exhaustive
  `never` check over casts and boolean flags.
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
as long as the result behaves the same; leave untouched files alone. Name the modernizations in
the commit message so a reviewer can tell them from the change itself.
