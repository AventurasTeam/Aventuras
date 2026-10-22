# Working in this repository

Aventuras is a Tauri 2 + SvelteKit 3 interactive-fiction app: TypeScript strict, Svelte 5
runes, SQLite, and a Rust layer for anything that would otherwise blow up the WebView heap.

## Commands

```bash
npm run check      # svelte-check — the type check that counts (plain tsc is not configured for .svelte)
npm test           # vitest, once
npm run lint       # eslint + prettier, then rustfmt + clippy (lint:ts / lint:rust run one side)
npx tauri dev      # run the app
```

Run `check`, `test` and `lint` before calling a change done. `pre-push` runs `lint:ts`,
`lint:rust` and `check` anyway, each only when the push touches its files.

## Comments

Comment sparingly and briefly. A comment earns its place only when the code cannot say the
thing itself: an invariant, a non-obvious constraint, a reason to do it this way rather than
the obvious way. Everything else is noise the next reader has to parse and the next editor
has to keep true.

Do not write:

- **history** — "used to be X", "the first version did Y", "this was a bug where…". Git has
  it, and the reader is looking at the present code.
- **measurements or anecdotes** — "38 rows for 31 people on a 41-chapter save", "a measured
  run spent two of five steps…". These belong in `docs/`, where they are the argument for a
  design, not scattered over the implementation.
- **self-referential prose** — "this file exists because…", "the whole reason this function
  is here…", "deliberately not X". Say the rule, not the story of the rule.
- **restatements** — a comment that repeats the line under it, or a docblock listing
  parameters the signature already names.

Prefer one line to three. If the explanation genuinely needs a paragraph, it is design
rationale: put it in the relevant `docs/architecture/*.md` and, at most, point at it.

```ts
// Good
// Indices stay valid for the whole session, so a delete leaves its slot behind.
// Bad
// A delete used to splice the array, which shifted every index the model already held and
// made the next update land on the wrong entry — see the session of 2025-11 where…
```

Existing code has plenty of the long form. Leave it alone unless you are already editing
that block; do not add more of it.

## Style

- Match the surrounding code's naming, file layout, and how much it explains itself. Where
  matching it would mean a dated idiom, [Modern code](#modern-code) wins.
- Svelte 5 runes only (`$state`, `$derived`, `$props`) — no legacy store syntax in new code.
- A `*.svelte.ts` module cannot be imported by a test. Logic that needs testing goes in a
  plain `.ts` module. See [docs/development/testing.md](docs/development/testing.md).
- Never write `?? <default>` for a value that has a default in `ai/core/defaults.ts`.
- Import a service through its `index.ts`, not its internals.
- Import from `src/lib` as `#lib/…` with the real extension: `#lib/services/database.ts`,
  `#lib/components/ui/button/index.ts`. Omitting it does not resolve. There is no `$lib`.

## Modern code

Write new code in the current idiom of the installed versions, using the newest feature each
layer's floor allows. Check the installed version's docs, not memory, for what is current.

| Layer            | Floor                                                            |
| ---------------- | ---------------------------------------------------------------- |
| JS, CSS, HTML    | Chrome 111 / Safari 16.4 ([Things that bite](#things-that-bite)) |
| Svelte, Tailwind | the installed 5.x and 4.x                                        |
| SQL              | the SQLite `libsqlite3-sys` bundles on every platform (3.46)     |
| Rust             | edition 2024                                                     |

- Svelte: `{@attach}` over `use:` actions for new code — an attachment re-runs when state it reads
  changes, an action does not — and `fromAction` to convert an existing action unchanged.
  `cn(…)` over `class:` directives, snippets and callback props over slots and dispatched events.
- HTML: the native element over a `div` with ARIA and key handlers — `<button>`, not
  `role="button"` plus `tabindex` and `onkeydown`. Where a bits-ui component exists for the job
  (dialog, popover, select), use it.
- TS/JS: `async`/`await` over `.then` chains, `$state.snapshot` for reactive state,
  `structuredClone` for plain values (it throws on a `$state` proxy) over
  `JSON.parse(JSON.stringify(…))`, `toSorted`/`toSpliced`/`with`/`at`/`findLast` over
  copy-then-mutate or index arithmetic.
- Types: make the type system carry the shape. A known shape gets a named type, not `object`,
  `Object`, `Record<string, …>` or an index signature; a lookup is keyed by a literal union
  (`Record<ServiceId, …>`), or is a `Map` when its keys are truly dynamic. Derive types with
  `keyof`, `typeof` and indexed access rather than restating them. `satisfies` and discriminated
  unions with an exhaustive `never` check over casts and boolean flags; narrow `unknown` with a
  type guard at the boundary over `as` or `any`, and over `Object.keys`/`entries` cast back to
  the key type.
- Tailwind: v4 names and syntax — `shrink-0`, `grow`, `bg-linear-to-*`, `size-*`, `bg-(--x)` —
  over v3 aliases and `[var(--x)]`. A value used twice is a token in `@theme` in `src/app.css`,
  not a repeated arbitrary value; `tv(…)` for a component with variants.
- CSS: `:has()`, container queries, `dvh`, `color-mix()`, logical properties, `gap` — over JS
  measurement, `vh`, and margin hacks.
- SQL: `RETURNING` over a follow-up `SELECT` or `last_insert_rowid()`, `->>` over
  `json_extract`, `ON CONFLICT … DO UPDATE` over `INSERT OR REPLACE` (which deletes and re-inserts
  the row). Shipped migrations stay as they are.
- Rust: `let … else` and `?` over nested `match`/`unwrap`.

Current but unavailable in Chrome 111 or Safari 16.4, so not usable yet (per MDN): the `popover`
attribute, `text-wrap: balance`, subgrid, `@starting-style`, `Object.groupBy`,
`Promise.withResolvers`, and the `Set` composition methods (`union`, `intersection`, …).

This applies to code you are already changing, not to a hunt through the codebase. When you edit
a function or component, modernize the dated idioms in it and in the code it directly touches,
keeping its behaviour the same. Some swaps change behaviour on their own:
`ON CONFLICT … DO UPDATE` keeps unlisted columns and the existing row, which `INSERT OR REPLACE`
deletes and re-inserts; `async` turns a synchronous throw into a rejection. Make one only where it
behaves the same here — every column is set, nothing depends on the delete, no caller relies on
the throw — and keep the old idiom otherwise rather than adjusting other code to fit. Leave
untouched files alone. Modernizations stay out of the commit message: it describes only the
functional change.

## Where the reasoning lives

`docs/` holds the architecture, one file per area. Read the relevant one **before** changing
that area, and update it in the same commit when behaviour it describes changes.

| Touching                                                                             | Read                                                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| repo layout, data model, generation phases, the side panels and their gestures       | [docs/architecture/overview.md](docs/architecture/overview.md)                     |
| `services/ai/retrieval/`, `WorldStateInjector`, tiers, stickiness, memory            | [docs/architecture/context-injection.md](docs/architecture/context-injection.md)   |
| `services/ai/lorebook/`, `services/duplicates/`, the duplicates window               | [docs/architecture/lore-management.md](docs/architecture/lore-management.md)       |
| `services/prompts/`, prompt packs, block ordering                                    | [docs/architecture/prompts.md](docs/architecture/prompts.md)                       |
| a new `ServiceId`, agent profiles, reasoning effort, defaults                        | [docs/architecture/ai-services.md](docs/architecture/ai-services.md)               |
| SQLite, migrations, `src-tauri/src/`, the settings blob                              | [docs/architecture/persistence.md](docs/architecture/persistence.md)               |
| `utils/dialogue.ts`, dialogue highlighting, TTS                                      | [docs/architecture/dialogue-and-tts.md](docs/architecture/dialogue-and-tts.md)     |
| `services/storyTime/`, time anchors, reconciliation, a new story's start             | [docs/architecture/story-time.md](docs/architecture/story-time.md)                 |
| `services/exchange/`, vault export/import, the Aventura lorebook format              | [docs/architecture/exchange-format.md](docs/architecture/exchange-format.md)       |
| `services/stateTracking/`, `rollbackService`, a store write method, past checkpoints | [docs/architecture/state-tracking.md](docs/architecture/state-tracking.md)         |
| `utils/narrationClean.ts`, the Style Reviewer's input                                | [docs/architecture/narration-cleaning.md](docs/architecture/narration-cleaning.md) |
| a modal, a confirmation, a feature colour, `components/shared/`                      | [docs/development/ui-components.md](docs/development/ui-components.md)             |
| a new JS, CSS or Web API, or the bundle minimums                                     | [docs/development/platform-support.md](docs/development/platform-support.md)       |
| tests                                                                                | [docs/development/testing.md](docs/development/testing.md)                         |
| the updater, CI, release scripts, Android builds                                     | [docs/development/release.md](docs/development/release.md)                         |

The index is [docs/README.md](docs/README.md).

## External documentation

Check these indexes for Tauri and AI SDK behaviour before a general web search:

- Tauri: <https://v2.tauri.app/llms.txt>
- AI SDK: <https://ai-sdk.dev/sitemap.md> — an index of the current docs; fetch a page from it with
  `.md` appended. Not `llms.txt`, which is the whole corpus in one file.

## Prompt template changes

Templates live in `src/lib/services/prompts/templates/*.ts`: `content` is the System part,
`userContent` the User part. Built-in templates a user hasn't edited update on their own; edited
ones and custom or imported packs never do, so a template change needs instructions for applying
it by hand.

On startup `backfillMissingTemplates` inserts any template id a pack lacks, so a new template
needs none. A User part added to an existing template does, since the user may have written their
own. So does a change to what a service passes to `ctx.add(…)` for a template: a variable added,
renamed or removed, or its contents moved into another.

A PR that needs them gets `## Updating your prompt pack` directly after `## Summary`:

- Open with who needs it: people who edited the template or use a custom or imported pack.
  Built-in templates they haven't touched update on their own.
- Name the template as the Vault shows it (e.g. **Lore Management**).
- One `###` step per edit, labelled **System** or **User** and **required**, **recommended** or
  **optional**. A required step says what breaks without it and names any setting that turns the
  new behaviour off.
- Verbatim "Find" and "Replace" fenced blocks, backticks unescaped. Find is the shortest text that
  occurs once; replace the whole block when the edit spans lines.
- If an earlier PR's edit is a prerequisite, link it and show the line with both applied.
- End with a line listing the variables newly available to the template.
- Check every snippet against the template before and after the change.

Otherwise leave the section out and don't mention it.

## Things that bite

- Migrations are checksummed by `sqlx`: LF line endings only, and never edit a migration
  that has shipped — add a new one.
- `src-tauri/gen/android/` and `src-tauri/gen/apple/` are tracked in git. Do not run
  `tauri android init` / `tauri ios init` on a working tree that already has them.
- Vite lowers syntax but adds no polyfills, and `check` accepts any API TypeScript knows. Anything
  newer than Chrome 111 or Safari 16.4 is out unless MDN says it works there. See
  [docs/development/platform-support.md](docs/development/platform-support.md).
- There is no DOM in the test environment, so a Svelte-level mistake passes `check`, `lint`
  and the whole suite and only fails when the app runs.
