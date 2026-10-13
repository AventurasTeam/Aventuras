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
`lint:rust` and `check` anyway, each only when the push touches its files. None of them renders a
component, so a Svelte-level mistake passes all three and only fails when the app runs.

## Rules for every change

- **Comments**: sparingly and briefly, only what the code cannot say — an invariant, a
  non-obvious constraint, a reason. No history, measurements, self-referential prose or
  restatements. [comments.md](docs/development/comments.md)
- **Style**: match the surrounding code. Svelte 5 runes only. Import `src/lib` as `#lib/…` with
  the real extension (`#lib/services/database.ts`); there is no `$lib`.
  [code-style.md](docs/development/code-style.md)
- **Modern code**: write new code, and modernize code you are already changing, in the current
  idiom of the installed versions; name the modernizations in the commit message.
  [modern-code.md](docs/development/modern-code.md)
- **Platform floor**: nothing newer than Chrome 111 / Safari 16.4 unless MDN says it works there.
  Vite adds no polyfills and `check` will not catch it.
  [platform-support.md](docs/development/platform-support.md)
- **Docs**: read an area's doc before changing it, and update it in the same commit when the
  behaviour it describes changes.

Every other development rule — tests, network requests, migrations, UI components, the mobile
scaffolds, CI and releases — is listed in [docs/development/README.md](docs/development/README.md),
each with a link to the document that states it in full. Check that list before working in one of
those areas.

## Where the reasoning lives

`docs/` holds the architecture, one file per area. Read the relevant one **before** changing
that area.

| Touching                                                                       | Read                                                                               |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| repo layout, data model, generation phases, the side panels and their gestures | [docs/architecture/overview.md](docs/architecture/overview.md)                     |
| `services/ai/retrieval/`, `WorldStateInjector`, tiers, stickiness, memory      | [docs/architecture/context-injection.md](docs/architecture/context-injection.md)   |
| `services/ai/lorebook/`, `services/duplicates/`, the duplicates window         | [docs/architecture/lore-management.md](docs/architecture/lore-management.md)       |
| `services/prompts/`, prompt packs, block ordering                              | [docs/architecture/prompts.md](docs/architecture/prompts.md)                       |
| a new `ServiceId`, agent profiles, reasoning effort, defaults                  | [docs/architecture/ai-services.md](docs/architecture/ai-services.md)               |
| SQLite, migrations, `src-tauri/src/`, the settings blob                        | [docs/architecture/persistence.md](docs/architecture/persistence.md)               |
| `utils/dialogue.ts`, dialogue highlighting, TTS                                | [docs/architecture/dialogue-and-tts.md](docs/architecture/dialogue-and-tts.md)     |
| `services/storyTime/`, time anchors, reconciliation, a new story's start       | [docs/architecture/story-time.md](docs/architecture/story-time.md)                 |
| `services/exchange/`, vault export/import, the Aventura lorebook format        | [docs/architecture/exchange-format.md](docs/architecture/exchange-format.md)       |
| `utils/narrationClean.ts`, the Style Reviewer's input                          | [docs/architecture/narration-cleaning.md](docs/architecture/narration-cleaning.md) |
| tests, network requests, the platform floor, UI components, CI, releases       | [docs/development/README.md](docs/development/README.md)                           |

The index is [docs/README.md](docs/README.md).
