# Working in this repository

Aventuras is a Tauri 2 + SvelteKit 2 interactive-fiction app: TypeScript strict, Svelte 5
runes, SQLite, and a Rust layer for anything that would otherwise blow up the WebView heap.

## Commands

```bash
npm run check      # svelte-check — the type check that counts (plain tsc is not configured for .svelte)
npm test           # vitest, once
npm run lint       # eslint + prettier
npx tauri dev      # run the app
```

Run `check`, `test` and `lint` before calling a change done. `pre-push` runs `lint` and
`check` anyway.

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

- Match the surrounding code: naming, structure, and how much it explains itself.
- Svelte 5 runes only (`$state`, `$derived`, `$props`) — no legacy store syntax in new code.
- A `*.svelte.ts` module cannot be imported by a test. Logic that needs testing goes in a
  plain `.ts` module. See [docs/development/testing.md](docs/development/testing.md).
- Never write `?? <default>` for a value that has a default in `ai/core/defaults.ts`.
- Import a service through its `index.ts`, not its internals.

## Where the reasoning lives

`docs/` holds the architecture, one file per area. Read the relevant one **before** changing
that area, and update it in the same commit when behaviour it describes changes.

| Touching                                                                     | Read                                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| repo layout, story/branch/chapter data model, generation phases              | [docs/architecture/overview.md](docs/architecture/overview.md)                   |
| `services/ai/retrieval/`, `WorldStateInjector`, tiers, stickiness, memory     | [docs/architecture/context-injection.md](docs/architecture/context-injection.md) |
| `services/ai/lorebook/`, `services/duplicates/`, the duplicates window        | [docs/architecture/lore-management.md](docs/architecture/lore-management.md)     |
| `services/prompts/`, prompt packs, block ordering                            | [docs/architecture/prompts.md](docs/architecture/prompts.md)                     |
| a new `ServiceId`, agent profiles, reasoning effort, defaults                 | [docs/architecture/ai-services.md](docs/architecture/ai-services.md)             |
| SQLite, migrations, `src-tauri/src/`, the settings blob                       | [docs/architecture/persistence.md](docs/architecture/persistence.md)             |
| `utils/dialogue.ts`, dialogue highlighting, TTS                              | [docs/architecture/dialogue-and-tts.md](docs/architecture/dialogue-and-tts.md)   |
| tests                                                                        | [docs/development/testing.md](docs/development/testing.md)                       |
| the updater, CI, release scripts, Android builds                             | [docs/development/release.md](docs/development/release.md)                       |

The index is [docs/README.md](docs/README.md).

## Things that bite

- Migrations are checksummed by `sqlx`: LF line endings only, and never edit a migration
  that has shipped — add a new one.
- `src-tauri/gen/android/` is tracked in git. Do not run `tauri android init`.
- There is no DOM in the test environment, so a Svelte-level mistake passes `check`, `lint`
  and the whole suite and only fails when the app runs.
