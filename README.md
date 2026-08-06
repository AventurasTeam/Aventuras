# Aventuras

## Overview

Aventuras is a desktop and mobile interactive fiction application offering multiple story modes (Adventure Mode, Creative Writing Mode), deep AI integration via major providers, an advanced Memory System, dynamic Lorebook, and an autonomous Lore Management Agent. The app provides a robust set of writing tools and world tracking features, ensuring contextually rich and coherent AI-generated narratives.

## Features

### Story Modes

- **Adventure Mode** - Interactive fiction with multiple-choice actions and world tracking
- **Creative Writing Mode** - Freeform collaborative writing with AI-generated suggestions
- **POV Options** - First, second, or third person perspective
- **Tense Control** - Past or present tense narrative style

### AI Integration

- First-class providers via the Vercel AI SDK: OpenRouter, OpenAI, Anthropic, Google, xAI (Grok),
  Groq, DeepSeek, Mistral, Z.AI/GLM (Zhipu), NanoGPT, Chutes, Pollinations, NVIDIA NIM
- Local backends: llama.cpp, LM Studio, Ollama — plus a generic `openai-compatible` option for any
  other gateway (requires a custom base URL)
- Streaming responses with real-time text generation
- Configurable models, temperature, and token limits
- Extended thinking/reasoning support with configurable effort levels (or a token budget on the
  models that use one, e.g. Gemini 2.x and Anthropic)
- API profiles for saving multiple provider/key configurations
- Agent Profiles: assign different models/providers to individual AI subsystems (retrieval, classification, suggestions, memory, wizard, translation, etc.) independently of the main narrator

### Memory System

- Automatic chapter summarization to manage context windows
- Configurable token thresholds and chapter buffers
- Manual chapter creation and resummarization
- AI-powered memory retrieval for relevant past events
- Chapter metadata tracking (keywords, characters, locations, plot threads)
- In-story time tracking per chapter

### Lorebook

- Unified entry system for characters, locations, items, factions, concepts, and events
- Dynamic state tracking (relationships, inventory, discoveries)
- Keyword-based and relevance-based context injection
- Hidden information and secrets system
- Aliases for flexible entry referencing
- Import/export support (JSON, YAML, SillyTavern format)
- SillyTavern character card import (V1/V2 JSON and PNG)
- AI-assisted autonomous lore management agent

### The Vault

A cross-story library, separate from any single playthrough:

- **Characters**, **Lorebooks** and **Scenarios** as reusable, taggable entities
- Cross-entity linking (a scenario referencing a character and a lorebook)
- An **Interactive Vault Assistant** — a tool-calling agent that creates and edits vault entities
  on request, proposing changes as pending operations with a diff view you approve or reject
- Fandom/wiki lookup tools for populating entries from an existing source
- **Prompt pack editor**: every prompt the app sends is a Liquid template, editable here, with
  per-template reset-to-default

### Writing Tools

- Local grammar checking powered by Harper.js (WebAssembly)
- AI-powered style analysis for repetitive words and phrases
- Action suggestions that match player writing style
- Persistent action suggestions between sessions

### World Tracking

- Character relationships and dispositions with portrait support
- Location visits and changes with automatic discovery
- Inventory management with equipment tracking
- Quest/story beat progression (milestones, revelations, plot points)
- In-story time tracking (years, days, hours, minutes)
- Collapsible UI cards for all world elements

### Templates

- Built-in genre templates (fantasy, sci-fi, mystery, horror, slice of life)
- Custom template creation with system prompts
- Initial state configuration (protagonist, locations, items)
- Opening scene text support

### Image Generation

- Inline `<pic …>` image generation embedded in story entries
- AI-powered imageable scene detection
- Background/scene images generated alongside the narration
- Nine image backends (`src/lib/services/ai/image/providers/`): NanoGPT, OpenAI, OpenRouter,
  Google, Chutes, Zhipu, Pollinations, plus local ComfyUI (workflow-based) and A1111
- Character portrait support for visual consistency
- Configurable image size — the available sizes are per provider (Pollinations, for example,
  offers 512×512, 1024×1024 and 1536×1536)
- Images are stored as base64 in SQLite; export/import of a story with images (`.avt`) is handled
  natively in Rust so the payloads never enter the WebView heap

### Translation

- Optional translation layer over narration, player input, action suggestions and the UI itself
- Each surface (`translation:narration`, `translation:input`, `translation:ui`,
  `translation:suggestions`, `translation:actionChoices`, `translation:wizard`) is its own
  `ServiceId`, so they can use different models
- Non-fatal: a failed translation leaves the original text in place

### Save and Restore

- Named checkpoints with full state snapshots
- Retry system for undoing actions and generating alternatives
- Character and time state preservation on retry
- Full database backup/restore and `.avt` story export/import, streamed natively in Rust

### Network Sync

- Local network sync between devices
- QR code connection for easy pairing
- Push/pull stories between devices
- Server mode for sharing stories

### UI Customization

- 26 themes (`src/themes/`): dark, light, light solarized, OLED, retro console, fallen down,
  botanical, cyberpunk, dracula, fantasy, ocean breeze, pastel dreams, royal, nord /
  nord light, gruvbox dark / light, tokyo night / light, rosé pine / dawn / moon, and the four
  catppuccin flavours
- Adjustable text size (small, medium, large)
- Word count display toggle

### Cross-Platform

- Desktop (Windows, macOS, Linux)
- Android (APK)
- iOS (planned)

## Installation

### Download Pre-built Binaries

Pre-compiled binaries are available on the [Releases](https://github.com/AventurasTeam/Aventuras/releases) page:

| Platform | Download                                  |
| -------- | ----------------------------------------- |
| Windows  | `aventuras_x.x.x_x64-setup.exe`           |
| macOS    | `aventuras_x.x.x_x64.dmg`                 |
| Linux    | `aventuras_x.x.x_amd64.deb` / `.AppImage` |
| Android  | `aventuras-release.apk`                   |

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Frontend Framework**: SvelteKit 2
- **State Management**: Svelte 5 runes (`$state`, `$derived`, `$props`)
- **Backend Framework**: Tauri 2 (Desktop/Android via Rust)
- **Styling**: Tailwind CSS, shadcn-svelte
- **Database**: SQLite (via `@tauri-apps/plugin-sql` on the JS side, `sqlx` on the Rust side)
- **AI**: Vercel AI SDK (`ai` + the `@ai-sdk/*` provider packages), local NLP via Harper.js (WASM)
- **Prompting**: LiquidJS — every prompt is a Liquid template, editable in-app
- **Editor**: CodeMirror 6 (`@codemirror/lang-liquid`) for the template/Vault editors
- **Schema/validation**: Zod (tool inputs and structured outputs)
- **Misc**: `marked` (markdown rendering), `gpt-tokenizer` (token estimates), `jsonrepair`
  (salvaging malformed model JSON), `html5-qrcode` (sync pairing)
- **Testing**: Vitest
- **Package Manager**: npm

## Development

### Requirements

- Node.js 22+ (CI is pinned to Node 22)
- Rust (latest stable)
- (Optional, for Android builds) Android SDK, NDK r27, Java (JDK) 17-24

### Setup & Run Commands

```bash
# Clone the repository
git clone https://github.com/AventurasTeam/Aventuras.git
cd aventuras

# Install dependencies
npm install

# Start Tauri development window (Desktop)
# Hot-reloading is fully supported for all Svelte/TypeScript code changes
npx tauri dev
```

### Scripts

Available `npm run` scripts:

- `dev`: Start Vite dev server (frontend only, no Tauri shell)
- `build`: Build for production
- `preview`: Preview a production build
- `check`: Run `svelte-check` (type checking)
- `check:watch`: Watch mode type checking
- `tauri`: Tauri CLI commands
- `test`: Run the test suite once (Vitest)
- `test:watch`: Run tests in watch mode
- `release`: Run release script (`node scripts/release.js`)
- `lint`: Run ESLint
- `lint:fix`: Fix ESLint issues
- `format`: Format code with Prettier

### Tests

Vitest (`vitest.config.ts`), covering targeted units under `src/lib/` — not a full-coverage suite. Run
with `npm test`.

**Rune modules cannot be imported by tests.** `vitest.config.ts` deliberately omits the SvelteKit plugin
to keep the suite fast and stable, so any `*.svelte.ts` file fails at import with `$state is not defined`.
Services reach the stores through `vi.mock('$lib/stores/…')`; logic that needs testing on its own is
extracted into a plain `.ts` module instead (`settingsMigrations.ts`, `advancedPanelView.ts`,
`stickiness.ts`, `recentTail.ts` are all this pattern). Those modules are production code with real
callers, not test scaffolding.

There is also no DOM environment (`environment: 'node'`), so components are not rendered by any test. A
Svelte-level mistake — a `bind:` to an undefined value, for instance — passes `check`, `lint` and the
whole suite, and only fails when the app runs.

### Database & Migrations

- **Engine**: SQLite, accessed from the frontend via `@tauri-apps/plugin-sql` and from the Rust side via
  `sqlx` (see `tauri-plugin-sql` / `sqlx` in `src-tauri/Cargo.toml`).
- **Location**: `tauri-plugin-sql` resolves `sqlite:aventura.db` against Tauri's **app config dir**
  (`~/.config/<bundle-id>` on Linux), not the app data dir. Rust code that opens the same file
  directly — `backup.rs`, `avt_import.rs`, and the migration checksum patch in `lib.rs` — must use
  `app_config_dir()` for the same reason, or it silently operates on a database that does not exist.
- **Migrations**: Sequentially numbered SQL files in `src-tauri/migrations/` (e.g. `001_initial.sql`,
  `002_chapters_checkpoints.sql`, ...), applied in order at startup.
- **Line endings matter**: `sqlx` checksums each migration file to detect drift, so migrations must use LF
  line endings on every platform. This is enforced by `.gitattributes` (forces `eol=lf` for
  `src-tauri/migrations/*.sql`) and by the `check_migrations` pre-commit hook below.

### Git Hooks

Managed by [lefthook](https://github.com/evilmartians/lefthook) (`lefthook.yml`):

- **pre-commit**: runs `scripts/check_migrations.js` against staged `src-tauri/migrations/*.sql` files to
  reject CRLF line endings.
- **pre-push**: runs `npm run lint` and `npm run check` (type-checking).

### Continuous Integration

GitHub Actions workflows in `.github/workflows/`:

- **`lint-and-typecheck.yml`** - runs `build`, `lint`, and `check` on every pull request targeting
  `master`, `develop`, or `dev`.
- **`release.yml`** - triggered by pushing a stable version tag (`vX.Y.Z`). Builds signed desktop
  binaries for Linux, Windows, macOS (Intel + Apple Silicon) via `tauri-apps/tauri-action`, plus a signed
  Android APK, and publishes them as a draft GitHub release with auto-updater metadata.
- **`ci.yml`** ("Pre-release") - triggered by pushing a pre-release tag (`vX.Y.Z-pre.N`). Same build
  matrix as `release.yml`, but publishes a non-draft **pre-release** without updater metadata.

Both release workflows expect `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` and the `ANDROID_KEYSTORE_*` /
`ANDROID_KEY_*` secrets to be configured on the repository.

### Environment Variables

There are no required `.env` files for local development or the built app:

- `import.meta.env.DEV` is set automatically by Vite and only gates debug logging
  (`src/lib/log.ts`) — nothing to configure.
- **API Keys**: for AI providers, configured at runtime via the UI (Settings -> API Settings), not via
  environment variables.
- Android builds read `ANDROID_HOME` (or `ANDROID_SDK_ROOT`), `NDK_HOME`, and `JAVA_HOME` from the shell
  environment. `scripts/android-setup.sh` and `compileApk.sh` will auto-detect these from common install
  locations if unset.

### AI Context Injection

Two independent services select what gets injected into the narrator prompt each turn — the split is crucial because they operate on completely distinct data domain boundaries:

- **Entry Retrieval** (`src/lib/services/ai/retrieval/EntryRetrievalService.ts`) — operates on static, authored **Lorebook** `Entry[]` records (characters, locations, items, factions, concepts, events).
- **World State Injection** (`src/lib/services/ai/generation/WorldStateInjector.ts`) — operates on **live-tracked** `Character[]`/`Location[]`/`Item[]`/`StoryBeat[]` entities that the classifier updates dynamically after every turn (present characters, current location, inventory, active quests/milestones). Runs on every narrator call regardless of retrieval mode.

The world-state block's sections split on **two different axes**, and conflating them is a live hazard.
`[PROTAGONIST]`, `[CURRENT LOCATION]`, `[INVENTORY]` and `[ACTIVE THREADS]` are claims about _current
state_; `[RELEVANT ...]` are claims about _relevance only_. Tier 1 once held nothing but the former, so
reading "tier 1" as "current state" was safe — until stickiness was added, at which point Tier 1 also
held entities carried forward _because_ their state condition stopped holding. Routing those through the
state sections told the narrator the player carries a dropped item and is pursuing a finished quest, and
left sticky locations rendered nowhere at all while `formatAlreadyInContext` still announced them.
The rule is now explicit: state sections take Tier 1 **minus** the sticky carry-over, and sticky entries
join Tier 2/3 in the relevance sections.

Anything in the result's `all` must be renderable somewhere in the block, because `all` is what the
retrieval agent is told the narrator already has. `WorldStateInjector.test.ts` pins that invariant.

Both services implement a three-tier injection architecture (Tier 1: sticky/always-on, Tier 2: name/keyword fuzzy matching, Tier 3: LLM candidate selection via `src/lib/services/ai/retrieval/tier3Selection.ts`) and are independently configurable in Advanced Settings.

**Agentic Retrieval** (`src/lib/services/ai/retrieval/AgenticRetrievalService.ts`) is an alternative
to the static chapter memory fill (`TimelineFillService`). Which one runs is decided by
`timelineFill.mode` (`'static' | 'agentic'`) via `aiService.shouldUseAgenticRetrieval` — the setting
is surfaced as the **Memory** mode in Advanced Settings, and the current default for a fresh install
is `'agentic'`.

It runs an agent loop (Vercel AI SDK) whose tools are built by
`src/lib/services/ai/sdk/tools/retrieval.ts`:

| Tool                  | Registered when                                           | Cost                            |
| --------------------- | --------------------------------------------------------- | ------------------------------- |
| `search_entries`      | always                                                    | free (string matching)          |
| `get_entry`           | always                                                    | free                            |
| `finish_retrieval`    | always (terminal tool)                                    | free                            |
| `grep_chapters`       | `canGrepChapters()` — chapters, flag, and an entry reader | free (literal text search)      |
| `query_chapter`       | `chapters.length > 0`                                     | one full chapter read by an LLM |
| `inspect_world_state` | a non-empty live `WorldState`                             | free                            |

On the last step `finish_retrieval` becomes the only callable tool and is required
(`finishOnlyOnLastStep`, via `prepareStep`). A run that hit the ceiling without calling it used to
produce nothing at all — its findings live in the agent's own message history and nowhere else — so
the step that was going to happen anyway is spent on the summary instead, at no extra call. A run
that _dies_ is a different case: there is nobody left to ask, and it falls through to the salvage
below.

The loop stops on `finish_retrieval` or at `maxIterations` (`AGENTIC_RETRIEVAL_DEFAULTS`, default
10 — measured runs finish in 3-5, so the ceiling only bounds the worst case). `query_chapter` has
its own hard cap of `MAX_CHAPTER_QUERIES` (3) per run, because `maxIterations` counts steps, not
whole-chapter reads, and a run could otherwise spend every step on one. A run that dies part-way is
salvaged rather than discarded — chapter answers cost an LLM call each, and throwing would leave the
turn with no retrieval at all.

`finish_retrieval`'s `synthesis` and `chapterSummary` both reach the narrator, and the prompt says
so — `chapterSummary` is optional in the schema, and a run that put its findings in `synthesis`
instead used to be discarded wholesale. What is suppressed is narrower: a run that _did not_ reach
`finish_retrieval` and salvaged nothing, whose only output would be a note about the retrieval
agent's own troubles. Grep excerpts are never carried out of the run.

It **selects nothing**. The agent reads lore to reason about the past and returns a prose summary; which
Lorebook entries reach the narrator is decided by Entry Retrieval, in every mode. Both selection services
above therefore run on every narrator turn regardless of retrieval mode — Agentic Retrieval never sees
live `WorldState` at all, so it cannot stand in for either of them.

**A tool's registration condition and the prompt text describing it must be the same expression.** Two
tools are conditional — `grep_chapters` on `agenticRetrieval.grepEnabled` (on by default) and
`inspect_world_state` on there being any live state — and both once had the condition written twice, so
the flag reached the template while the tool list ignored it. The model was handed a callable tool its
instructions denied existed. Both conditions are now single exported predicates, `canGrepChapters` and
`hasLiveWorldState`, read by the tool registration, the prompt template, and the tail split alike.

Each tool is built by its own factory (`createSearchEntriesTool`, `createGrepChaptersTool`, …); what they
share is a small `RunState` holding the grep result cache and the `query_chapter` counter.

`grep_chapters` is a **literal substring** search over the raw story text, not a keyword search: a
multi-word query only matches where those words appear consecutively. It reports per-chapter match counts
alongside a sampled spread of excerpts, so the agent can narrow rather than page. Excerpts are labelled
`ACTION` or `NARRATIVE`, because the corpus includes what the player typed and handing that back to the
narrator as established fact is a real failure mode.

**A substring search on a short name is mostly noise, and the tool handles that itself.** A character
called "Ren" matched 1,000+ paragraphs — "rendered", "surrender", "children" — and the answer was 40
excerpts of unrelated prose plus a per-chapter table saying only that the letters occur throughout. Two
guards, both in `createGrepChaptersTool`:

- **Auto-narrowing.** When the agent leaves `wholeWord` unset and the search exceeds
  `GREP_NOISE_RATIO` (5) matches per excerpt slot, the search is re-run on word boundaries. The
  whole-word result replaces the substring one only if it removes at least half the matches
  (`AUTO_NARROW_MAX_SHARE`) without falling to zero — so a short name collapses to its real mentions
  while a stem the agent meant loosely, `"rune"` finding `"runes"` and `"runic"`, barely moves and is
  left alone. That threshold is the whole reason there is no rule on query _length_: `"rune"` is four
  characters and is exactly the search a length rule would break. An explicit `wholeWord: false` is a
  decision and is always honoured; the result reports the flag it actually ran under, plus an
  `autoNarrowed` note, since every count in it is the narrowed search's.
- **A noise signal.** A search still past the threshold quotes `NOISY_EXCERPT_LIMIT` (8) excerpts
  instead of the full allowance and carries a `tooManyMatches` note naming the narrowings that would
  help. Spending 40 excerpts on prose that matched by accident is the expensive half of the failure,
  and it is paid into a prompt on every turn. The per-chapter counts stay complete either way — they
  are what tells the agent where to narrow _to_. This is a separate note from the ordinary
  "more matched than fit" one, because it needs a different fix: narrowing the query rather than the
  chapter range.

`truncateAroundMatch` takes the same `wholeWord` flag, so a whole-word search cannot position its
excerpt on a substring occurrence it never counted — otherwise a passage returned for "Ren" opens on
"surrender".

Density is what the budget follows, in three places at once. `sampleMatches` shares excerpt _slots_
by hit count rather than by passage count — `findTextMatches` merges neighbouring matching
paragraphs, so counting passages penalises exactly the chapters where a term concentrates. Each
passage's _word_ allowance is then proportional to the hits it holds, and `truncateAroundMatch` keeps
the whole span of occurrences when it fits rather than re-cutting around the first — otherwise the
truncation undoes the merge that made the passage worth showing, and the agent gets a fragment where
it had a scene. Each excerpt reports its own `hits`, so a quote covering five mentions is
distinguishable from one covering a passing reference.

Sampling (`grepSampling.ts`) switches strategy on whether covering every matching chapter is _achievable_.
Up to `groups <= limit` it covers them all, one excerpt each, then spends the rest on the densest. Past
that it shares the budget in proportion to hit counts instead — because coverage is unreachable either
way, and paying full price for it produced one fragment per chapter from 28 chapters, which the agent
could not answer from. It then fell back to `query_chapter` twice, at 51% of the turn's total cost.

**Static mode** (`TimelineFillService`) is the other half of the same setting. It asks a model for
up to `timelineFill.maxQueries` (default 5) questions, resolves each one to the chapters it names,
groups questions that resolved to the same chapter set, and answers each group in one batched call —
falling back to per-question calls when the batch comes back incomplete, because a provider with
weak JSON-schema support would otherwise lose every answer in the group instead of one.

Two properties of that path are worth knowing before tuning it:

- **A chapter's full text is expensive, and the read is bounded in code, not by the prompt.** A
  chapter measures ~17,000 tokens of verbatim entry text on a real save, so a query naming three
  chapters built a 50,000-token prompt and one naming four built 68,000 — both rejected outright by
  a 49,152-token server. The query generator was already told to name few chapters and asked for
  four anyway. `chapterContentBudget.ts` is where the bound holds: entries are taken in order until
  the budget is spent, and a leading `[TRUNCATED: ...]` marker names the chapters that got no text,
  because an answering model that is not told will report on chapters it never saw. Still exactly
  one call — `query_chapter` is never multiplied.

  **The cut is a single stop point.** Once a chapter cannot be finished the read ends rather than
  filling later chapters from whatever tokens are left: spending the remainder produced a text that
  opened three chapters and finished none, which answers nothing and multiplies the risk that the
  model reports on a chapter it saw only the first entry of. At most one chapter is ever partial,
  which is what makes the marker's wording true.

  The budget is `CHAPTER_READ_BUDGET_RATIO` (2.5) × the story's own `memoryConfig.tokenThreshold`,
  not a number chosen here: a chapter _is_ roughly `tokenThreshold` tokens by construction, since
  `ChapterBatchPlanner` accumulates entries until it crosses it. So it reads as "about 2.5 chapters"
  and scales with the user's setting. Token counts come from `metadata.tokenCount`, stored per entry
  when it was written, so the bound costs a sum of integers rather than a tokenizer pass.

- **A question whose chapters are a subset of another's is answered from that group.**
  `groupByChapterCoverage` folds them together, so a question about chapter 18 and one about 17-19
  assemble and send chapter 18's text once instead of twice. Strictly subsets — unioning merely
  overlapping sets would widen both and make every member pay for a chapter it did not ask about.

  **Only while the wider group fits the budget.** "A subset is answerable from the superset's
  content" holds only if that content is sent whole, and the read above is cut from its highest
  chapter down — so a question about chapter 19 folded into {17,18,19} could be answered from a
  text that stops inside chapter 18, where alone it would have had the entire budget for chapter 19. `runTimelineFill` therefore passes a predicate: a candidate host whose own chapters exceed
  `maxChapterTokens` stops absorbing narrower questions. Identical sets still fold either way —
  they get the same truncation whether they share a call or not, and two open-ended questions
  both resolve to every chapter.

- **An unanswered question does not reach the narrator.** `answerQuestionWithContent` returns
  `confidence: 0` for both give-up paths (a failed call, and no chapters resolved), and
  `runTimelineFill` drops those responses — otherwise `buildChapterSummariesBlock` writes them into
  the prompt as `A: Unable to answer the question.` under a heading claiming the material is
  relevant to the current scene.

### Prompt Packs and Template Resolution

Every prompt the app sends is a Liquid template. The code baseline lives in
`src/lib/services/prompts/templates/`; at runtime templates are served from a **prompt pack** stored in
SQLite, which the user can edit in the Vault.

Resolution order (`ContextBuilder.resolveTemplate`), first hit wins:

1. the active pack's own row
2. `default-pack`'s row
3. the compiled-in baseline in `PROMPT_TEMPLATES`

A template has a system half (`content`) and an optional user half (`userContent`). The user half is
stored under the id `<template-id>-user`, and `ContextBuilder.render(id)` returns `{ system, user }` by
resolving both. A service that destructures only `system` silently drops the user half — every service
except the two whose templates deliberately have none.

`PackService.initialize()` does two distinct things on startup, and they are not interchangeable:

- **`refreshDefaultPackTemplates`** updates `default-pack` when the code baseline changes, so shipped
  prompt improvements reach existing installs.
- **`backfillMissingTemplates`** inserts templates _added_ by a later app version into every pack, so the
  user has something to open in the editor. Custom packs are never otherwise auto-updated.

**Never overwrite a user's edit.** `pack_templates` carries both `content_hash` (the hash of what is
stored) and `baseline_hash` (the hash of the baseline it was last written from). They are equal while a
template is untouched and diverge the moment someone saves an edit, and only `PackService` writes
`baseline_hash` — `database.setPackTemplateContent` takes a required `isBaseline` flag to force the
distinction at every call site. The refresh skips any row where the two differ. Comparing the stored
content's own hash against the baseline instead, as it once did, reads every user edit as a stale default
and reverts it on the next app start.

### Prompt Ordering and Prefix Caching

Inference servers reuse the KV cache for the longest prefix a request shares with the previous one, and
reprocess everything after the first differing token. **Prompt templates are therefore ordered by how
often each block changes, not by how the prompt reads.** Stable material first, volatile material last.

This is not cosmetic. On a 40-chapter story the narrator prompt is ~156k characters, of which the chapter
summaries are ~54k and byte-identical between turns; with the per-turn world state in front of them, the
reusable prefix was 3.6% of the request. The same inversion cost the retrieval agent, the classifier and
both Tier 3 selections their entire prefix — two consecutive classifier calls shared 201 characters of
40,000.

Two consequences worth knowing before editing a template:

- The system message is sent before the user message, so a divergence inside the system prompt
  invalidates the user message too, however stable that is on its own.
- Instructions belong at the end anyway, which is also where the volatile content wants to be. The two
  goals rarely conflict.

`src/lib/services/prompts/templates/narrative.test.ts` pins this ordering, since reversing it breaks
nothing visible — it just quietly costs thousands of tokens of reprocessing every turn.

**Ordering is necessary but not sufficient, and on some servers it buys nothing.** "Reuse the
longest shared prefix" is the ideal; a real server may only reuse a prefix it can reach without
_truncating_ a cached state. Measured against `llama-server` with a sliding-window model (Gemma 4):
a prompt that extends a cached one reuses everything, a prompt that diverges a few thousand tokens
from the end still reuses everything, and a prompt that diverges ~8k tokens or more from the end
reuses **nothing at all** — the whole request is reprocessed. `--ctx-checkpoints` /
`--checkpoint-min-step` did not move that boundary.

The consequence for template authoring is stronger than "stable first": the volatile block has to be
_near the end_, not merely after the stable one. The narrator prompt currently diverges at
`</story_history>` — about 37% in — because `[CURRENT STORY TIME]` and the per-turn world state sit
in front of ~30k characters of otherwise byte-identical lorebook and scene material. That 37% is
what the ordering bought; on a truncation-averse server it is also 37% too early to be worth
anything.

### Data Model

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
  every turn. It is _not_ the Lorebook: `Entry[]` records are authored lore that changes only when
  someone edits them. The two pools never overlap, and two different services inject them.
- **`worldStateDelta`** on an entry records what its classification changed, which is what makes
  retry, time-travel delete and regenerate reversible (`rollbackService`).
- **Checkpoints** are full state snapshots; **retry backups** are in-memory only and do not
  survive an app restart or a story switch.

### Activation Tracking and Stickiness

Both selection services carry an entity forward for a few story positions after it was last
activated, so context does not vanish the instant its "always include" condition stops holding.
The fading priority band is shared (`retrieval/stickiness.ts`); the durations per type are not.

The unit is **story positions, not turns** — positions come from `story.entries.length`, and a
turn appends both an action and a narration, so a duration of N covers roughly N/2 turns.
Activations are persisted per story under `lorebook_activation_<storyId>` and restored on load.

### Generation Pipeline

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

### Agent Profiles and Service Resolution

Every AI task is a `ServiceId` — the keys of `DEFAULT_SERVICE_PRESET_ASSIGNMENTS` in
`src/lib/stores/settings.svelte.ts`: `classifier`, `lorebookClassifier`, `entryRetrieval`,
`worldStateInjection`, `characterCardImport`, `memory`, `chapterQuery`, `timelineFill`,
`suggestions`, `actionChoices`, `styleReviewer`, `loreManagement`, `agenticRetrieval`,
`interactiveVault`, `imageGeneration`, `bgImageGeneration`, plus the namespaced
`wizard:*` and `translation:*` families.

Resolution is two hops, and conflating them is the usual source of confusion:

```text
ServiceId ──(servicePresetAssignments)──▶ presetId ──(generationPresets)──▶ GenerationPreset
```

A `GenerationPreset` is what the UI calls an **Agent Profile**: it carries the model, the API
profile, temperature and reasoning effort. Several services share one by default — everything
classification-shaped points at the `classification` preset, the memory pipeline at `memory`, and
so on — so retargeting one profile moves every service assigned to it.

Most services extend `BaseAIService`, which does nothing but hold the `ServiceId` and expose
`presetId`; the model is never hardcoded. **`narrative` is a preset id, not a `ServiceId`** —
`NarrativeService` does not extend `BaseAIService` and streams through `generate.ts` with
`presetId: 'narrative'` directly.

`ServiceFactory` is the only place services are constructed, so a new task needs a `ServiceId`
(i.e. an entry in `DEFAULT_SERVICE_PRESET_ASSIGNMENTS`), a factory method, and a settings entry,
in that order.

Defaults that both the settings store and `AI_CONFIG` need live in
`src/lib/services/ai/core/defaults.ts`, a leaf module that imports nothing — `core/config.ts`
imports the settings store, so the store cannot import back from it.

### The Native (Rust) Layer

Most of the app is TypeScript; Rust owns the jobs that would otherwise blow up the WebView heap —
which on Android is a hard cap, not a soft one. The rule throughout is **JS owns the structure,
Rust owns the bytes**: only small parameters (paths, ids) cross the IPC bridge.

- **`backup.rs`** — database backup/restore and image export. Payloads are streamed file-to-file or
  DB-to-file and never enter the JS heap.
- **`avt_import.rs`** — `.avt` story import in two streaming passes. `avt_read_light` returns the
  JSON with every `imageData` stripped, JS parses that and runs the normal import (id remapping,
  ordering and foreign keys stay in TypeScript where they are tested), then `avt_import_images`
  re-reads the file and streams each base64 payload straight into SQLite. Peak memory is one image
  regardless of file size.
- **`migration_patch.rs`** — patches `sqlx`'s stored migration checksums (see
  [Database & Migrations](#database--migrations)).
- **`sync/`** — the LAN sync server (`start_sync_server`, `sync_connect`, `sync_pull_story`,
  `sync_push_story`, …), paired via QR code.

`backup.rs`, `avt_import.rs` and `migration_patch.rs` (via the `lib.rs` setup hook) open
`sqlite:aventura.db` under Tauri's **app config dir** — see the migrations section for why that is
not the app data dir. `sync/` never touches the database directly; it moves stories over the
`tauri-plugin-sql` connection on the JS side.

### Settings Migrations

Settings are persisted as one JSON blob, and nothing removes legacy keys from it. Reshaping runs on
the way from disk into the store, in `src/lib/stores/settingsMigrations.ts` — kept out of the rune
store precisely so it can be tested. Two properties every migration there must hold:

- **Idempotent**, because it runs on every load, not just the first after an upgrade. A migration
  that keeps firing silently reverts whatever the user changed in between.
- **Silent about untouched values**, because a stored value equal to the old default was never a
  choice, and carrying it across pins everyone who never opened the panel to a stale number.

### Project Structure

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

### Building Release Binaries

<details>
<summary>Click to expand build instructions</summary>

#### Cutting a New Release

`npm run release -- <patch|minor|major|prerelease|x.y.z> [--dry-run] [--no-merge-back]`
(wraps `scripts/release.js`) automates version bumps:

1. Creates a `release/vX.Y.Z` branch.
2. Bumps the version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `Cargo.toml`,
   and `Cargo.lock`.
3. Commits, tags `vX.Y.Z`, and pushes the branch + tag together.
4. Fast-forwards the branch it was run from onto the bump and pushes it, so the version on `master`
   is the version released. Skip with `--no-merge-back`.

Note the `--`: without it npm consumes the flags before the script sees them.

Every precondition — a clean tree, a version that moves forward, and a tag/branch that does not
already exist locally **or on the remote** — is checked before anything is written, and a failure
after that point deletes the branch and tag it created and returns to the original branch. Use
`--dry-run` to run the checks and stop.

Only `X.Y.Z` and `X.Y.Z-pre.N` are accepted. Other pre-release spellings are valid semver but match
neither workflow trigger, so they would tag and build nothing.

Pushing a stable tag (`vX.Y.Z`) triggers `release.yml`; pushing a pre-release tag (`vX.Y.Z-pre.N`, via the
`prerelease` bump type) triggers `ci.yml`. See [Continuous Integration](#continuous-integration) above.

`scripts/version.js` holds the version arithmetic and `scripts/version.test.js` covers it
(`vitest.config.ts` includes `scripts/**/*.test.js` for this).

#### Building Desktop

```bash
npx tauri build
```

#### Building Android

**IMPORTANT**: The Android project scaffold (`src-tauri/gen/android/`) is tracked in git.
**Do NOT run `npx tauri android init`** as it will overwrite customizations.

```bash
# One-time: detect/export ANDROID_HOME and NDK_HOME
source scripts/android-setup.sh

# Dev build + deploy to device/emulator
npx tauri android dev

# Release build (unsigned APK)
npx tauri android build

# Or: quick local debug APK build (auto-detects SDK/NDK/JDK)
./compileApk.sh
```

The unsigned release APK will be at:

```text
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
```

#### Signing APK

```bash
# Create keystore (first time only)
keytool -genkey -v -keystore release.keystore -alias myalias -keyalg RSA -keysize 2048 -validity 10000

# Align APK
zipalign -v 4 app-universal-release-unsigned.apk app-aligned.apk

# Sign APK
apksigner sign --ks release.keystore --ks-key-alias myalias --out app-release.apk app-aligned.apk
```

</details>

## Acknowledgments

- [Tauri](https://tauri.app/) - Desktop/mobile app framework
- [SvelteKit](https://kit.svelte.dev/) - Frontend framework
- [OpenRouter](https://openrouter.ai/) - LLM API aggregator
- [Harper](https://writewithharper.com/) - Grammar checking
- [Lucide](https://lucide.dev/) - Icon library

## License

AGPL-3.0
