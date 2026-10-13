# Working in this repository

Aventuras is a Tauri 2 + SvelteKit 3 interactive-fiction app: TypeScript strict, Svelte 5
runes, SQLite, and a Rust layer for anything that would otherwise blow up the WebView heap.
The map of the code is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the decisions in force are
indexed in [docs/README.md](docs/README.md).

## Commands

```bash
npm run check      # svelte-check — the type check that counts (plain tsc is not configured for .svelte)
npm test           # vitest, once
npm run lint       # eslint + prettier, then rustfmt + clippy (lint:ts / lint:rust run one side)
npm run docs:gen   # regenerate docs/README.md and the block below from decision frontmatter
npm run docs:check # validate decisions, anchors, doc links and generated output
npx tauri dev      # run the app
```

Run `check`, `test` and `lint` before calling a change done. `pre-push` runs `lint:ts`,
`lint:rust` and `check`, each only when the push touches its files, and `docs:check` on every
push. None of them renders a component, so a Svelte-level mistake passes all of them and only
fails when the app runs.

Never push or commit with `--no-verify`. When a hook fails, fix the cause; CI runs the same checks.

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
- **Docs**: read an area's decisions and doc before changing it. Record a new decision, or a change
  to one, as an ADR in the same PR (below), and update an area doc in the same commit when the
  behaviour it describes changes.

Every other development rule — tests, network requests, migrations, UI components, the mobile
scaffolds, CI and releases — is listed in [docs/development/README.md](docs/development/README.md),
each with a link to the document that states it in full. Check that list before working in one of
those areas.

## Decisions

A decision is one file in `docs/decisions/`, copied from
[docs/adr-template.md](docs/adr-template.md) and named `YYYY-MM-DD-slug.md`. The slug is its ID.

- Record intent: conventions, conditional rules, intentional gaps, and why. Never restate what the
  code says.
- Write it in the PR that makes the decision. Merging accepts it.
- Don't edit a merged ADR's ruling. Supersede it with a new one: set `superseded-by` on the old one,
  and `active: true` as well if existing code may keep following it.
- Where a decision governs specific code, put `ADR(slug)` in a comment there, with a short
  reason. Read the ADR before "fixing" code that carries one.
- Put raw material (logs, benchmarks, investigation notes) in `docs/evidence/` and link it from
  the ADR.
- After changing any frontmatter, run `npm run docs:gen` and commit the result.

## Area docs

These areas still have one doc each, until they move into decisions. Read the relevant one
**before** changing that area.

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
| Tauri's HTTP plugin, capability URL scopes, the WebView's `fetch`              | [docs/architecture/network-transport.md](docs/architecture/network-transport.md)   |
| tests, network requests, the platform floor, UI components, CI, releases       | [docs/development/README.md](docs/development/README.md)                           |

## Cross-cutting decisions

Every change follows these.

<!-- BEGIN GENERATED: decisions -->
<!-- Generated by `npm run docs:gen` from cross-cutting decisions. Do not edit. -->

- Record decisions, not descriptions: one ADR per decision in docs/decisions/, written in the PR that makes it. Never document what the code says. [decision-records](docs/decisions/2026-10-12-decision-records.md)

<!-- END GENERATED: decisions -->
