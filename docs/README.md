# Aventuras — internal documentation

How the app is put together and why it is put together that way. The user-facing page is
the [repository README](../README.md); this is for whoever is changing the code.

These documents carry the reasoning that does not fit in a comment: the measured numbers,
the failure a design exists to prevent, the two things that must stay in step. Code
comments stay short and say only what the next reader cannot infer — see
[CLAUDE.md](../CLAUDE.md).

## Architecture

| Document                                                  | Read it before touching                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [overview.md](architecture/overview.md)                   | the repository layout, `StoryEntry`/branches/chapters/world state, or the generation pipeline and its phases    |
| [context-injection.md](architecture/context-injection.md) | `services/ai/retrieval/`, `WorldStateInjector`, the three tiers, stickiness, agentic or static memory retrieval |
| [lore-management.md](architecture/lore-management.md)     | `services/ai/lorebook/`, `services/duplicates/`, `LoreManagementCoordinator`, the duplicates window             |
| [prompts.md](architecture/prompts.md)                     | anything under `services/prompts/templates/`, prompt packs, or the order blocks are assembled in                |
| [ai-services.md](architecture/ai-services.md)             | adding a `ServiceId`, agent profiles, reasoning effort, or a default in `ai/core/defaults.ts`                   |
| [persistence.md](architecture/persistence.md)             | SQLite, a new migration, `src-tauri/src/`, or the shape of the settings blob                                    |
| [dialogue-and-tts.md](architecture/dialogue-and-tts.md)   | `utils/dialogue.ts`, dialogue highlighting, or the TTS pipeline                                                 |

## Development

| Document                             | Read it before                                                        |
| ------------------------------------ | --------------------------------------------------------------------- |
| [testing.md](development/testing.md) | writing a test — the suite has real constraints on what it can import |
| [release.md](development/release.md) | cutting a release, or changing the updater, CI or the build scripts   |

## Keeping them true

If a change alters behaviour a document describes, update the document in the same commit.
A document nobody trusts costs more than no document: the numbers in these files were
measured, and a stale one is read as a measurement.
