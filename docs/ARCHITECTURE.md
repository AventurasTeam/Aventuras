# Architecture

The map of the code: what the app is, where things live, and what holds across the boundaries.
It is country-level on purpose. Files, modules and types are named, not linked; find them with
symbol search. The reasons behind specific rules are in the decision records indexed in
[README.md](README.md).

Human-owned: agents may propose edits in a PR. Revisit it a few times a year, not per change.

## Bird's-eye view

Aventuras is a Tauri 2 + SvelteKit 3 interactive-fiction app: TypeScript strict, Svelte 5 runes,
SQLite, and a Rust layer for anything that would otherwise blow up the WebView heap.

<!-- TODO: what problem the app solves, for whom, and the shape of a turn of play. -->

## Codemap

<!-- TODO: the major areas (src/routes, src/lib/services, src/lib/stores, src/lib/components,
src-tauri), what each is for, and where to look for X. -->

## Boundaries and invariants

<!-- TODO: the layers and what holds across them, especially rules stated as an absence
("components never import a service's internals"). -->

## Area docs not yet migrated

These predate the decision records. Each area moves into ADRs, `docs/evidence/` and this map in its
own PR. Delete this section when the last one has.

| Document                                                    | Read it before touching                                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [overview.md](architecture/overview.md)                     | the repository layout, `StoryEntry`/branches/chapters/world state, the generation pipeline, or the side panels and their swipe gestures |
| [context-injection.md](architecture/context-injection.md)   | `services/ai/retrieval/`, `WorldStateInjector`, the three tiers, stickiness, agentic or static memory retrieval                         |
| [lore-management.md](architecture/lore-management.md)       | `services/ai/lorebook/`, `services/duplicates/`, `LoreManagementCoordinator`, the duplicates window                                     |
| [prompts.md](architecture/prompts.md)                       | anything under `services/prompts/templates/`, prompt packs, or the order blocks are assembled in                                        |
| [ai-services.md](architecture/ai-services.md)               | adding a `ServiceId`, agent profiles, reasoning effort, or a default in `ai/core/defaults.ts`                                           |
| [persistence.md](architecture/persistence.md)               | SQLite, a new migration, `src-tauri/src/`, or the shape of the settings blob                                                            |
| [dialogue-and-tts.md](architecture/dialogue-and-tts.md)     | `utils/dialogue.ts`, dialogue highlighting, or the TTS pipeline                                                                         |
| [story-time.md](architecture/story-time.md)                 | `services/storyTime/`, time anchors, timeline anomalies, reconciliation, or a new story's starting time                                 |
| [exchange-format.md](architecture/exchange-format.md)       | `services/exchange/`, exporting or importing a vault character, scenario or lorebook, the Aventura JSON format                          |
| [narration-cleaning.md](architecture/narration-cleaning.md) | `utils/narrationClean.ts`, or sending story entries to a model that should not read `<pic>` tags, HTML or layout markup                 |
| [network-transport.md](architecture/network-transport.md)   | Tauri's HTTP plugin, its Cargo features, the capability URL scopes, or the case for the WebView's `fetch`                               |

The development rules are listed in [development/README.md](development/README.md), each linked to
the document that states it in full.
