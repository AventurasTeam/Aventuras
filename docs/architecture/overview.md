# Overview

The shape of the repository, the data the app is built around, and the path a turn takes through it.

## Project Structure

```text
aventuras/
├── src/                     # SvelteKit frontend source
│   ├── routes/              # SvelteKit pages (+page.svelte, +layout.svelte)
│   ├── themes/              # Theme definitions (dark, light, solarized, ...)
│   └── lib/                 # Shared application logic and components
│       ├── components/      # UI components (PascalCase.svelte)
│       ├── services/        # Business logic modules (AI, generation, import/export, etc.)
│       ├── stores/          # Svelte stores (*.svelte.ts for runes) — story, ui, settings, debug
│       ├── hooks/           # Reusable Svelte hooks/composables
│       ├── constants/       # Shared constant values
│       ├── types/           # TypeScript types
│       └── utils/           # Utility functions
├── src-tauri/               # Rust backend (Tauri 2)
│   ├── src/                 # Rust source (main.rs, lib.rs, backup.rs, avt_import.rs, sync/)
│   ├── migrations/          # Numbered SQLite migrations (sqlx)
│   ├── capabilities/        # Tauri ACL/permission definitions
│   ├── icons/               # App icons per platform (incl. iOS)
│   ├── gen/android/         # Android scaffold files (tracked in git — DO NOT OVERWRITE)
│   ├── Cargo.toml           # Rust dependencies
│   └── tauri.conf.json      # Tauri configuration
├── static/                  # Static web assets
├── scripts/                 # Build, release, and Android setup scripts
├── third-party-licenses/    # License texts for bundled third-party code (e.g. Harper)
├── .github/workflows/       # CI/CD (lint/typecheck, release, pre-release)
├── lefthook.yml             # Git hooks configuration
├── components.json          # shadcn-svelte component generator config
└── package.json             # Node dependencies and scripts
```

## Data Model

The story is an append-only list of `StoryEntry` rows (`user_action`, `narration`, `system`,
`retry`), each carrying a `position` and a `branchId`. Almost everything else hangs off that list:

- **Branches** fork at a `forkEntryId`. `story.entries` is the current branch's view, assembled
  from the branch's own rows plus everything inherited from its ancestors; `visibleEntries` is
  that list minus what has been folded into chapters.
- **Chapters** cover a contiguous run of entries (`startEntryId`/`endEntryId`) and replace them
  in the prompt with a summary. Entries after the last chapter's end are the **un-chapterized
  tail** (`story.getUnchapterizedEntries()`) — the newest material, and the part chapter-oriented
  tools would otherwise be blind to.
- **World state** (`Character`/`Location`/`Item`/`StoryBeat`) is rewritten by the classifier after
  every turn. A lorebook `Entry` carries no live state of its own: the type has `state` fields
  per entry type, but every creation path initialised them blank and nothing ever wrote one
  (0 of 16 character entries on a measured 41-chapter save), so the four Tier 1 conditions that
  read them never fired and are gone. Presence is `WorldStateInjector`'s claim to make. The
  never-produced `mentionCount`/`firstMentioned`/`lastMentioned` are gone from the model too;
  their columns stay, with their defaults. It is _not_ the Lorebook: `Entry[]` records are
  authored lore that changes only when someone edits them. The two pools never overlap, and
  two different services inject them.

  **A rendered entity line must never be re-readable as a name.** The classifier is shown
  the entities that already exist and writes names back, so `- Eira (claimed as a consort)
[inactive]` came back as the name, missed `sameEntityName`, and created a second
  character — four of thirty-eight on a measured 41-chapter save, two carrying the
  subject's own `relationship` verbatim. Name and attributes are now separate lines
  (`relationship:`, `status:`, `appearance:`), in every list `ClassifierService` renders —
  characters, locations, items, story beats — and in `WorldStateInjector`'s narrator block,
  whose prose the classifier also reads. One name per line also holds names a
  comma-separated list could not: locations and items were CSV until they carried state.

  **State reaches the classifier only where it can act on it.** `appearance:` goes with a
  character in the scene, `description:` with the current location, and an item's
  `quantity`/`equipped`/`location` only when they differ from the default — because each of
  those is a whole-value replacement, and a model cannot rewrite what it was not shown. The
  same rule sizes the prompt: on a large cast the omitted halves are most of it.

  **`scene.currentLocationName` is the only thing that moves the scene.** It creates the
  location if the name is new, marks it `current` and `visited`, and clears the previous
  one. `locationUpdates.changes.current` and `newLocations[].current` did the same job from
  two other places, applied in an order the model could not see, so a response naming two
  places kept whichever ran last — and the merge path set a second `current` without
  clearing the first. Both are gone from the schema.

  **Presence is reported, departure is inferred.** The classifier answers one question about the
  cast — `scene.presentCharacterNames`, every *other* character in the scene at the end of the
  passage; the protagonist is in every scene by definition and is added by the consumers — and
  `resolveCharacterPresence` (`services/generation/characterPresence.ts`) turns the complement into
  `inactive`. Asking a model to name thirty absent characters produces nothing; asking it to name
  the three in front of it is the question the passage answers. The inference is refused whenever
  the list carries no signal: a salvaged or failed classification, or an empty array — which the
  schema defaults, so "the model said nobody" and "the model did not answer" arrive identically.
  `characterUpdates.status` stays for what the scene states outright, `deceased` above all, and
  wins over the inference. `appearance:` is sent to the classifier only for characters in the
  scene, and the template forbids rewriting an appearance it was not shown, so a returning
  character keeps the descriptors it accumulated.

- **`worldStateDelta`** on an entry records what its classification changed, which is what makes
  retry, time-travel delete and regenerate reversible (`rollbackService`).
- **Checkpoints** are full state snapshots; **retry backups** are in-memory only and do not
  survive an app restart or a story switch. A checkpoint is anchored to its `lastEntryId` and is
  deleted with that entry - in the same transaction, alongside the chapters and embedded images
  that reference it. It is the fork point a branch would be created from, so an orphaned one
  yields a branch pointing at an entry the database no longer holds.
- **Removing an entry a branch forks from is refused**, and the check runs before anything else
  the operation would rewind - a rollback, or the lorebook activation a retry restores - because
  a refusal raised afterwards would leave that half applied. Editing and deleting are refused the
  same way while a generation or a retry restore is running: the store throws, and the caller is
  expected to say so rather than treat the untouched story as a completed edit.

## Generation Pipeline

A narrator turn is a sequence of phases under `src/lib/services/generation/phases/`, each an async
generator that yields typed events and returns a result. Dependencies are injected, which is what makes
them testable without a provider.

`Retrieval → Narrative → Classification → Translation → Image / BackgroundImage → PostGeneration`, with
`PreGeneration` preparing the retry backup first.

Only the narrative phase is fatal on failure — there is no turn without a narration. Every other phase
degrades: a failed classification leaves world state untouched, a failed translation keeps the original
text, failed images leave the entry without one.

`RetrievalPhase` runs in two stages on purpose. Stage A (world state + lorebook selection) must finish
before stage B (memory retrieval), because the memory step is told what the narrator's prompt already
contains, and a _partial_ list of that is worse than none — it is read as a statement, so naming half of
it invites work on the other half.

Phases are wired by `GenerationPipeline`, but the dependency objects are built in
`src/lib/components/story/ActionInput.svelte` (`buildPipelineDependencies`). That is where the
store, the settings and `aiService` are bound together; the phases themselves import none of them,
which is what keeps them testable.

Alongside the pipeline, `BackgroundTaskRunner` handles what happens _after_ a turn — the chapter
threshold check, lore management and the style review — on its own dependency object.

## Images

Nine backends live under `src/lib/services/ai/image/providers/` — NanoGPT, OpenAI, OpenRouter,
Google, Chutes, Zhipu, Pollinations, plus local ComfyUI (workflow-based) and A1111.

Resolution is chosen as an **intent** — orientation (1:1 / 16:9 / 9:16) plus one of four size
steps — and each adapter turns it into what its backend accepts: an aspect ratio for Google and
OpenRouter, the model's own published resolution list for NanoGPT, real dimensions for
ComfyUI/A1111/Pollinations (`src/lib/utils/image.ts`). A backend that is handed pixel dimensions
it does not offer answers with the nearest thing it does, which is not the same picture.

Images are stored as base64 in SQLite. Export and import of a story with images (`.avt`) is
handled natively in Rust so the payloads never enter the WebView heap — see
[persistence.md](persistence.md).

## Environment

There are no required `.env` files for local development or the built app:

- `import.meta.env.DEV` is set automatically by Vite and only gates debug logging
  (`src/lib/log.ts`) — nothing to configure.
- **API Keys**: for AI providers, configured at runtime via the UI (Settings -> API Settings), not via
  environment variables.
- Android builds read `ANDROID_HOME` (or `ANDROID_SDK_ROOT`), `NDK_HOME`, and `JAVA_HOME` from the shell
  environment. `scripts/android-setup.sh` and `compileApk.sh` will auto-detect these from common install
  locations if unset.
