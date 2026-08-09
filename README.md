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
- Resolution is chosen as an **intent** — orientation (1:1 / 16:9 / 9:16) plus one of four
  size steps — and each provider adapter turns it into what that backend accepts: an aspect
  ratio for Google and OpenRouter, the model's own published resolution list for NanoGPT,
  real dimensions for ComfyUI/A1111/Pollinations (`src/lib/utils/image.ts`)
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
- Dialogue highlighting: quoted speech coloured in the story text, in a custom colour
  or the theme's accent (Settings -> Interface). Off for Visual Prose stories

### Updates

- Optional check on startup (Settings -> Interface -> Updates), rate-limited by
  `checkInterval`, plus a manual **Check for Updates** button
- An available update opens a dialog with the version, release date and rendered release
  notes — a dialog on desktop, a bottom sheet on Android
- Desktop downloads and installs in place, with a progress bar and a restart prompt
- **Android cannot self-update** and the dialog says so: it opens the release APK in the
  browser and lets Android's package installer take over. See
  [The Updater](#the-updater) for why

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

### The Updater

`src/lib/services/updater.ts` answers one question on two platforms that share no machinery
for it. `UpdateInfo.canInstallInApp` is the flag that tells them apart, and the dialog
(`src/lib/components/updater/UpdateDialog.svelte`) branches on it rather than on the platform.

**Desktop** uses `@tauri-apps/plugin-updater`: it fetches the `latest.json` named by the
`updater.endpoints` entry in `tauri.conf.json`, verifies its signature against the `pubkey`
there, and installs the new build itself.

**Android has no updater at all, and this is not a configuration problem.**
`tauri-plugin-updater` declares Android support level `none`, and its `updater_os()` has
branches for linux/macos/windows only — on Android `target_os` is `"android"`, so `check()`
returns `UnsupportedOs` before a single request is sent. There is no install path either: an
APK is installed by the system package installer, not by the app it replaces. The Android
path therefore calls the GitHub Releases API directly, compares the tag against `getVersion()`
using `src/lib/utils/version.ts`, and opens the `.apk` asset in the browser. String comparison
is not adequate for that — `'0.10.0' > '0.9.0'` is false lexically — which is why the
comparison is a tested module of its own.

Two things must stay in step, or the platforms will offer different versions to their users:
the `RELEASE_REPO` constant in `updater.ts` and the `updater.endpoints` URL in
`tauri.conf.json`.

**A draft release is invisible to the updater.** `release.yml` publishes with
`releaseDraft: true`, and both paths resolve `/releases/latest`, which GitHub defines as the
latest **published, non-pre-release** release. Until the draft is published by hand, the
desktop endpoint 404s and the API returns the previous release — so the last step of every
release is publishing the draft on GitHub. Nothing reaches users before that.

The desktop check surfaces that state honestly rather than as a generic failure: a 404 becomes
the `no-release` kind ("it may still be a draft"), distinct from `network` and `unsupported`.

**The release notes users read are the GitHub release body, on both platforms.** They are not
taken from `latest.json`, whose `notes` field is written by `tauri-action` at build time from
the fixed `releaseBody` string in `release.yml` — which is a placeholder, not a changelog, and
cannot be otherwise, since the notes are written after the build. `releaseNotesFor` therefore
fetches the release from the API and uses its body, falling back to `latest.json` if the call
fails; the update installs either way. Two consequences:

- Editing a published release's text on GitHub changes what every client shows, with no
  rebuild and no new version.
- The notes must be written **before** the draft is published, because publishing is what
  makes the release visible to the check. A release published with the placeholder still in
  it will show that placeholder.

The fetched notes are used only when the release tag matches the version being offered —
notes belonging to a different release are worse than none.

**A `.deb` install is deliberately not updated in place.** The plugin would attempt it —
`install_deb` writes the package to a temp dir and runs `dpkg -i` through `pkexec`, falling
back to zenity/kdialog and finally to a terminal `sudo` that a windowed app has no terminal
for — but that chain has too many ways to end half-finished for something the user starts
with one click, and the package manager is the thing that owns that install anyway. So the
check reports `canInstallInApp: false` with `manualInstallReason: 'deb-package'` and the
dialog opens the releases page instead.

**An unpackaged build never installs either, and this one is a safety guard.** On Linux the
plugin's `extract_path` _is_ the running executable, so in `tauri dev` "Download and install"
moves the dev binary into a `TempDir`, writes the release AppImage over it, then drops the
`TempDir` — deleting the backup — and reports success. The developer is left with a 100 MB
AppImage where their build was. `getBundleType()` returns `null` for a build the bundler never
touched, which is exactly that case, so it is routed to the browser with
`manualInstallReason: 'unpackaged'`.

Note that on macOS `bundle_type()` falls back to `App` rather than `None`, so this guard does
not fire there.

`.rpm` currently still installs in place, through the same privileged-helper chain.

One more limit: **the Android check is unauthenticated**, so it shares GitHub's per-IP rate
limit. A 403 is reported as a network-kind error.

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

Both services implement a three-tier injection architecture (Tier 1: sticky/always-on, Tier 2:
name/keyword fuzzy matching, Tier 3: the leftover) and are independently configurable in Advanced
Settings.

**Tier 3 is two branches, and the volume question is asked before the relevance one.** A leftover
small enough to send whole is sent whole, uncapped and with no LLM call; only one too big is worth
asking a model about, via `src/lib/services/ai/retrieval/tier3Selection.ts`. The boundary is a
**word budget on the candidate text** (`tier3WholesaleWordBudget`), the same unit on both sides —
but not the same number: a live world-state record runs ~16 words and a lorebook entry ~69, so the
budgets are 500 and 1000. A record count could not express that difference, which is why the
world state's old `llmThreshold` is gone rather than converted. Switching LLM selection off removes
the call, not the tier: a leftover under the budget still goes in.

**Only a leftover the model _chose_ counts as an activation.** Wholesale inclusion means "there was
little of it", which says nothing about relevance — and since the branch holds every uncovered
record, recording it would make the entire pool sticky on every turn of any story under the budget,
so Tier 1 would absorb it and stickiness would never expire. Both services exclude it; the world
state side once claimed to and did not.

**Tier 2 runs twice, and the second pass is where indirect relevance lives.** The first pass matches
what the scene _says_ — the player's action and the recent story. The second matches whatever is
left against _names_: those the first pass found (`retrieval/tier2SecondPass.ts`), plus what World
State Injection put in the scene. That second source is a **one-way handover**: `WorldStateInjector`
publishes its Tier 1 + Tier 2 via `onSceneEntities` before its own Tier 3 runs, so the lorebook pass
starts from what is present without waiting on an LLM call. It never travels back — lore names read
as scene state would have the narrator acting on characters who are not there. It is a second-pass
seed rather than a first-pass one because a lore entry that matched only because someone is standing
in the room is relevance at one remove, and ranking it with a word the player typed made it
indistinguishable from one. Governed by **Match Against What Is in the Scene** (on by default): the
seed set is every active character, item, quest and the current location, which on a mature story is
most of what a lorebook is about.

`tier3Selection.ts` caches the last selection per caller. The key is complete by content — caller,
candidate pool in order, player action, and the ids of the recent entries the prompt was built from
— because two situations sharing a repeated action and an unmoved pool are otherwise the same
question as far as a cache can see, which is reachable across consecutive turns and across a branch
switch. It is also cleared on story load and branch switch.

What each tier actually contributed is recorded on the narration entry as
`metadata.retrievalSnapshot` (`retrieval/retrievalSnapshot.ts`) and shown in the **Active Context**
panel. Diagnostic only: nothing reads it back into a prompt.

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
below. Lore management uses the same policy for `finish_lore_management`: its changes are already
written when the ceiling is reached, but the summary is the only account the user is shown.

The loop stops on `finish_retrieval` or at `maxIterations` (`AGENTIC_RETRIEVAL_DEFAULTS`, default
10 — measured runs finish in 3-5, so the ceiling only bounds the worst case). A run that dies
part-way is salvaged rather than discarded — chapter answers cost an LLM call each, and throwing
would leave the turn with no retrieval at all. The salvage is read back off the run's own event
log, which is the only record of what was paid for.

**The whole-chapter read is governed in one place for both agents**
(`sdk/tools/chapterQueries.ts`), because `maxIterations` counts steps and a run could otherwise
spend every one of them on a ~17,000-token read. `ChapterQueryBudget` holds three things: a
per-run allowance, a cache so a repeated question is replayed instead of re-read, and failures
cached like answers so a question the provider cannot answer is not re-asked until the step
ceiling is gone. Two numbers, not one — retrieval spends `MAX_CHAPTER_QUERIES_RETRIEVAL` (3) per
turn with `grep_chapters` as the free fallback; lore management spends
`MAX_CHAPTER_QUERIES_LORE` (6) per session, a pass that runs once per chapter and has no cheaper
tool. The refusal names that fallback **only where it is registered**, from the same
`canGrepChapters` the tool list reads: sending the model to a tool its instructions deny is the
failure that predicate exists to prevent. What is deliberately not shared is the tool itself —
the two agents have different contexts and different result shapes, and merging them would drag
`onEvent`/`describeProgress` into the lorebook.

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

### Duplicate Entities

Two pools accumulate duplicates, and until recently only one of them was looked at.
`src/lib/services/duplicates/` now owns both: `names.ts` is the comparison itself (exact
name, shared alias, token containment, length-scaled edit distance, grouped transitively),
`index.ts` applies it per pool and filters what the user has already ruled on. Its own
service and not a corner of the lorebook's, because `ai/lorebook`'s barrel pulls in the SDK
and through it a rune store, which no plain module can be imported alongside.

**The world state is the pool that actually grows.** The classifier mints a new `Character`
whenever the story calls someone by a different title, so one measured save held
`Baron Kaelen` and `Forge-Master Kaelen`, `Captain Vor'koth`, `General Vor'koth` and
`The Captain` — thirty-eight rows for about thirty-one people. The **Duplicates** window in
the Active Context panel is where those are resolved: one group at a time, with the members
side by side and a radio for which name survives. A group, not a pair — grouping is
transitive, and those four Vor'koth rows are one decision.

**A merge is shown before it is written**, because it deletes rows and `deleteCharacter` is
not undoable. `generation/mergeEntities.ts` builds a _plan_ rather than a result: every
field carries where its value came from — `only` (one row had it), `agreed`, `union`, or
`conflict` — and the conflicts are settled in the preview, with a third option for prose
("keep both, one after the other").

Only the defaults a machine can justify survive: a field one row has is that row's, lists
(traits, aliases, keywords) are unioned, and everything else defaults to the row the user
chose to keep. There is deliberately **no "the newer row wins"** — `characters`, `locations`
and `items` have no creation timestamp, so which of two conflicting values is more recent is
a question the data cannot answer.

The first version returned a finished object and preferred the primary field by field. It
dropped a description silently whenever both rows had one, and it put `status` outside the
user's reach entirely — any non-`active` value from any row won, so merging a character the
story had brought back marked them dead again whichever row was kept. For the lorebook the
absorbed names still become **aliases** on the survivor, which is what stops the same
duplicate being re-created.

**A dismissal is remembered, in `kept_separate`** (migration 037), keyed by normalized
**name pair** and scoped to a branch. Names rather than ids, so a later rename cannot
resurrect a settled decision; per pair rather than per group, because a group of three can
reappear as a group of two once one member is merged away. The lore agent reads the same
table — groups the user has closed never reach it — and its own `keep_separate` writes to
it, so a decision made once is not re-argued by either side.

### Lore Management

`src/lib/services/ai/lorebook/LoreManagementService.ts` is the one agent that _writes_ to the
Lorebook on its own. It runs after a chapter is created — automatically at the token threshold,
manually from the Memory view, and once per batch during `chapterizeFromBeginning` (the
SillyTavern import path) — and on demand from the **Tidy lorebook** button in the Active Context
panel (`runManualLoreManagement`, shared by both manual callers).

**Its failure mode is growth.** A model that cannot see its own past sessions re-creates what it
already wrote, so a lorebook accumulates "Kaelen", "Kaelen the Bold" and "Kaelan" and never loses
one. Several things hold that down, and only the last is optional:

- **Deletes and merges are applied.** They used to be approved by the tool, logged, and then
  dropped — the session's change loop handled `create` and `update` only — so every run
  re-proposed the same consolidation it had already "done". `merges` and `deletedEntries` now
  come back with the result and reach the caller's existing `onMergeEntries` / `onDeleteEntry`.
- **Changes land in the snapshot as they are made.** The array the tools read is the array the
  session mutates, so an entry created on step 2 is visible to `list_entries` on step 3. It is
  never spliced: the model holds indices from the prompt and from every listing it has read, so
  a delete keeps its slot and joins `removedIndices` — hidden from listings, refused by
  everything that takes an index.
- **`create_entry` refuses a name that already exists**, matching on names and aliases through
  `foldName`. The refusal says to update that index instead. The vault assistant does not
  get this guard: there a human reads the change before it lands.
- **An index outlives the array it came from.** `create_entry` and `merge_entries` append, so
  the agent legitimately holds indices past the end of the list the session started with, and a
  delete leaves its slot in place rather than shifting everything under it.
  `lorebook/sessionChanges.ts` owns that mapping: one slot per index, each knowing whether
  writing it back means an insert, an update, a merge or nothing at all. That is what makes a
  create-then-update land as one create, an update-then-delete land as one delete, and a second
  update to the same entry keep the first — all of which were silently dropped when the write
  side looked the index up in the original list, after the tool had already answered
  `success: true`. A merge also carries `hiddenInfo` from every source, since the agent is never
  shown the field and cannot carry it itself.
- **The entry tools do not take a `lorebookId`.** A story's lorebook is not an entity with an
  id — it is the `entries` rows for a story and a branch, and the branch-resolved view of them
  is what the service passes in. The id belongs to the Vault, where there really are several
  lorebooks to choose between. Left in the schema it was not merely unused: a parameter that
  exists asks to be filled, and a measured run invented `"lorebook_1"` on every call.
  `resolveTargetEntries` answers an unknown id with an error, so every read and edit tool
  failed while `create_entry` — the one that does not validate it — went through. An agent
  that can only create is an agent that only grows the lorebook. It is stripped by
  `withoutFields`, the same mechanism that removes `injectionMode`.
- **Duplicate candidates are found in code, before the call** (`lorebook/duplicates.ts`), by
  exact name, shared alias, token containment and a length-scaled edit distance, grouped
  transitively. The list goes into the prompt as a worklist. Under **Require duplicate
  consolidation** (Advanced → Lore Management, off by default) `finish_lore_management` also
  refuses to complete while a group is unresolved — which is why the loop stops on
  `stopOnCompletedTerminalTool`, reading the tool's answer rather than its call. The refusal is
  capped at two: the agent may be right that the groups are distinct, and a run that cannot end
  returns nothing. `keep_separate` is how it says so, and it must name **every** index of a
  group: closing on one shared index dismissed neighbours the agent had never read.

  **Resolved means the group collapsed**, not that a member was touched. An update is what the
  agent does anyway on its next task, so counting it opened the gate without consolidating
  anything — a group is open until deletes and merges have left it one surviving member.

The setting gates only the obligation. The worklist and the create guard cost nothing and are
always on.

**One session per branch at a time**, enforced in `LoreManagementCoordinator` and not in the UI.
Three callers can start one and none of them sees the others; two agents on one lorebook write
over each other, because each takes an index snapshot at the start and edits by index. The lock
is at the funnel they all pass through — `ui.loreManagementActive` could not be it, since it
lingers two seconds after a run so the summary can be read. Keyed by branch rather than story,
because a branch has its own resolved view of the entries. The same reasoning covers chapters:
a turn's background tasks create one, so `ui.backgroundTasksActiveFor(storyId, branchId)`
disables **Create Chapter Now** and `createManualChapter` refuses outright, or two chapters get
built over overlapping ranges of the same entries.

**The session's inputs are read when it starts, not when the turn did.** Everything in them
moves during a turn: the classifier writes lorebook entries, and the chapter check that decides
whether lore management runs at all creates the chapter. A snapshot taken up front handed the
agent a lorebook missing what was just classified, a chapter list missing the chapter that
triggered the run, and a "recent story" still holding the entries that chapter had absorbed. Both
the background path and the batch importer now pass a thunk.

`query_chapter` here shares `ChapterQueryBudget` with the retrieval agent — see
[Agentic Retrieval](#ai-context-injection) — at its own allowance of six per session, and with no
`grep_chapters` to name in the refusal. It does **not** echo the chapter summary back: every
summary is already in the instructions untruncated, so returning one is the same text twice in one
prompt, which is the reason there is no `list_chapters` either.

**There is no `list_chapters` tool.** The prompt carries the complete chapter list with
untruncated summaries, so the same material never exists in two places for the agent to
reconcile — the rule `AgenticRetrievalService` already follows. A measured run spent two of its
five steps calling the tool and injecting 47,000 characters of summaries it had already been
given, because the prompt's copy was cut to 200 characters and the tool's was not. Removing the
cut is what costs: on a 41-chapter story the block goes from ~9k characters to ~47k. It is worth
it because those summaries are this task's input (the median summary is 1,223 characters, so the
cut showed 16% of one), because the block is the cacheable head of the prompt, and because the
only other way to recover the missing text is `query_chapter` — a whole chapter read by a second
model. `list_entries` stays: after a merge or a delete it is the only view of the list as it now
stands, and the prompt says so, so it is not called before there is anything to see. It takes a
`query` and a `limit` — the query matches names, aliases, keywords and descriptions through the
same `entityNameMatches` the retrieval side searches with, and the cap exists because a tool
result stays in the prompt for the rest of the run. It is deliberately **not**
`search_entries`: that tool addresses entries by id, and every write here goes by index, so
mixing the two addressing schemes is how the `lorebookId` bug happens again.

**What each field is for is a contract, and it is split between the code and the prompt.**
`EntryRetrievalService` matches an entry's name, its aliases _and_ its keywords against the
scene, all three, on word boundaries — so those three fields are one budget, and two mistakes in
them are decidable rather than debatable: an alias identical to the entry's name, and a keyword
that repeats the name or an alias. Neither can ever add a match. `lorebook/entryFields.ts` drops
them on the way through `create_entry`/`update_entry` and reports what it dropped in the tool
result, so the model reads the rule applied to its own output; nothing is rejected, because
losing a whole call over one redundant keyword is the failure this file exists to avoid. The
comparison is `foldName`, which folds case and punctuation but keeps articles — `"The Citadel"`
and `"Citadel"` are the same subject but not the same trigger, which is `normalizeName`'s
distinction to make, not this one's. `foldName` is also what `create_entry`'s duplicate refusal
matches on, deliberately and not `normalizeName`: the detector is lenient because being wrong
there costs one question, while being wrong in a hard refusal costs an entry.

Both fold on `\p{L}\p{N}`, not `a-z0-9`. An ASCII class folds every Cyrillic, Greek and CJK
name to the empty string, and empty compares equal to every other one — which made two
unrelated characters read as duplicates, and, through `sameEntityName`, collapsed the whole
world-state cast of a non-Latin story into its first member.

Everything requiring judgement stays in the prompt, where the field contract is written out: a
name is the form the story actually uses (never `Name / Title`), other forms are aliases, and a
keyword must be a term written in the story — never a common word like `guard` or `loyalty` that
matches ordinary prose and puts the entry in every prompt, never a phrase the model composed
(matching is literal), never another entry's name. Descriptions describe their own subject in the
present, without parenthetical glosses or chapter recaps that the chapter summaries already
carry.

**The prompt is ordered for prefix caching** like the narrator's: chapter summaries first (they
change only when a chapter is written), then the entry list, then the duplicate worklist and the
recent story. Entries are listed oldest-first for the same reason — a new entry appends instead
of shifting every line under it — and that order is also what makes the indices stable within a
session. Blacklisted entries (`loreManagementBlacklisted`) are filtered out of the pool
entirely; showing them was worse than useless, since the agent cannot act on one but can
re-create it.

**An agent with no story text must not create.** Chapters are the usual material, but a manual
run can happen before any chapter exists, so every caller passes `recentEntries` — the
un-chapterized tail, bounded by `runLoreManagement` to
`recentStoryCharsForLoreManagement` (16,384). It was hardcoded to `[]` on all three paths. With
neither chapters nor a tail, the prompt says so and restricts the run to consolidating what is
already written; anything it "identified as missing" would be invented.

**Characters, not entries, and through the same helper the retrieval tail uses**
(`splitRecentTail`). An entry count is not a budget: ten entries is 1,000 characters of terse
exchanges or 27,000 of long prose, and what is being bounded is the prompt. The floor of
`MIN_RECENT_ENTRIES_FOR_LORE` (4) is not belt and braces — measured entries averaged 2,688
characters, so a character budget alone can collapse to the player's last action.

All three callers go through `LoreManagementCoordinator` with the same
`buildLoreManagementCallbacks()`, which is the only place that says what a lore change does to
the story. Each used to write those five callbacks out itself, and they had drifted — one merged
by passing the entry whole, another by copying fourteen fields by hand.

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
  every turn. A lorebook `Entry` carries no live state of its own: the type has `state` fields
  per entry type, but every creation path initialised them blank and nothing ever wrote one
  (0 of 16 character entries on a measured 41-chapter save), so the four Tier 1 conditions that
  read them never fired and are gone. Presence is `WorldStateInjector`'s claim to make. The
  never-produced `mentionCount`/`firstMentioned`/`lastMentioned` are gone from the model too;
  their columns stay, with their defaults. **A rendered entity line must never be re-readable as a name.** The classifier is
  shown the entities that already exist and writes names back, so `- Eira (claimed as a consort)
[inactive]` came back as the name, missed `sameEntityName`, and created a second character —
  four of thirty-eight on a measured 41-chapter save, two carrying the subject's own
  `relationship` verbatim. Name and attributes are now separate lines (`relationship:`,
  `status:`, `appearance:`), in `ClassifierService.formatExistingCharacters`, in the story-beat
  list beside it, and in `WorldStateInjector`'s narrator block, whose prose the classifier also
  reads. It is _not_ the Lorebook: `Entry[]` records are authored lore that changes only when
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
turn appends both an action and a narration, so a duration of N covers roughly N/2 turns. The UI
converts for display; the services stay in positions because that is what they measure.
Activations are persisted per story under `lorebook_activation_<storyId>` and restored on load.

What creates an activation is Tier 2 and a _chosen_ Tier 3 — see the Tier 3 note above for why the
wholesale branch does not. The timer is **not** refreshed while an entry is sticky, and cannot be: a
sticky entry sits in Tier 1, Tier 1 is excluded from the candidate pool, and only Tier 2/3 record.
So an entry named every single turn still drops out when its window expires and is re-matched the
turn after. That is deliberate — it is what stops a once-relevant entry pinning itself in the prompt
forever — but it makes the duration a hard ceiling on continuous presence, not a sliding one.

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

**Two rules keep that file the single source.** A constant a user can change — anything with
a control in Advanced Settings — goes there as a named `*_DEFAULTS` object; a constant that
guards a failure mode and has no control (`GREP_NOISE_RATIO`, `MAX_LIST_ENTRIES`,
`MAX_CHAPTER_QUERIES_*`) stays next to the code it protects, where the reasoning lives. And
**a consumer never writes `?? <default>`**: the store merges every block over its defaults
on load, so the key is always present, and a fallback at the call site is a second copy of
the number that nothing forces to agree. That form had put four stale values in the tree at
once — a `maxIterations` of 50 in the store, 3 in a constructor, 50 again in the slider.

### Reasoning Effort

Every question about thinking effort is answered by `src/lib/services/ai/core/reasoning.ts`, a
leaf module that imports only types. It exists because those questions were once answered in
seven places, and the copies drifted.

Three things about it are not obvious:

- **The disabled level is `'none'`, and `'Off'` is not a value.** The levels are the AI SDK's
  own names minus `provider-default`, which is why `'off'` was renamed in 0.7.x. The old
  spelling survives in exactly one place — `LEGACY_REASONING_OFF` in `settingsMigrations.ts` —
  because installs older than that have the literal string on disk, and refusing to read it
  would discard the user's setting and fall back to the legacy `enable_thinking` flag, which
  means `'high'`.
- **`'none'` is sent, not omitted.** It is the value that switches thinking off:
  NanoGPT documents `reasoning_effort: "none"` as the way to disable reasoning, and
  `@ai-sdk/openai-compatible` would *drop* the parameter for `'none'` on its own `reasoning`
  field. That is why the effort travels in provider options, which take precedence. Omitting
  the parameter asks for the model's default instead — a different request.
- **Only NanoGPT's `:thinking` variants are `enforced`.** Those ids *are* the reasoning model,
  so asking one for `'none'` is self-contradictory, and `clampReasoningToCapability` lifts it to
  `ENFORCED_REASONING_FLOOR` (`'medium'` — a floor, not a preference). Every other model that
  merely *supports* reasoning can be turned off. Reading "supports" as "enforces" is what made
  reasoning impossible to disable on NanoGPT for an entire release: the UI learned the
  distinction while the store that forced the level did not.

`clampReasoningToCapability` is the single rule for what a capability does to a chosen level,
which is what keeps the settings effect that applies it two lines long and testable.

Alongside it, `sdk/presetResolution.ts` resolves preset → profile → model for all three
callers — the services, the narrator and the agent factory — plus `buildProviderOptions`,
`resolveStructuredOutputs` and `thinkingNudgeApplies`. Each of those was previously written
per-caller. The **Thinking nudge** setting needs all three of a think-tag provider, reasoning
on, and no native structured output; the UI asks the same predicate before offering the toggle,
so it cannot be switched on where it does nothing.

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

### Dialogue Detection

`src/lib/utils/dialogue.ts` is the only definition of "this text is a spoken line",
and two unrelated-looking features read it: the story renderer colours dialogue, and
the TTS pipeline can speak it in a second voice. Written as two regexes they would
drift apart at the first edge case, so both go through `matchDialogueAt`.

It recognises `"…"`, `“…”` and `«…»` — the guillemets are not decoration, translated
narration comes back with them. Single quotes are excluded (`don't`, `l'uomo`), as is
an unterminated quote, which is also what keeps a streaming line neutral until its
closing quote arrives instead of flickering.

**A dialogue span never crosses a blank line.** On the renderer side that is free —
marked's inline lexer works per block — but the TTS path segments the whole entry at
once, where one unterminated quote would otherwise swallow half a scene into the
character's voice. The rule lives in the shared core so the two paths agree by
construction rather than by coincidence.

**An HTML tag is stepped over whole, and this is not the renderer's protection.** The
`marked` extension runs at tokenizer level, which is often described as making it
immune to a quote inside an attribute — but that only ever covered the quote that
_opens_ a span. The extension runs before marked's `tag` tokenizer, so an unterminated
quote in prose would close on the next `class="`, splitting the tag: half escaped into
text, half left as a stray end tag, and a `<pic prompt="…">` mangled that way is no
longer recognised, so its image vanishes from the entry. Meanwhile the two _scanners_
(`dialogueSpans`, `segmentDialogue`) have no tokenizer in front of them at all and will
happily open a span on `class="x"`, which is a well-formed pair read on its own — that
is how an attribute value reaches the dialogue voice, and why Visual Prose forces tag
removal below. `matchDialogueAt` therefore skips tags rather than stopping at them, so
raw HTML _inside_ a quote still renders as HTML while attribute quotes stop being
candidates everywhere at once.

Colouring is emitted unconditionally as `<span class="dialogue-line">` and gated
entirely in CSS (`data-dialogue-highlight` plus `--dialogue-color` on the root), so
flipping the toggle or dragging the colour picker repaints without re-rendering a
single story entry. The per-entry `.dialogue-highlight` class carries the story's
`visualProseMode`, which is what keeps the feature off there — including for player
actions, which are plain markdown even in a Visual Prose story.

**An embedded image marker and a quote can overlap, and the image pipeline has to
give ground.** `processUnified` lifts each agentic marker's text out of the content
before rendering and splices it back afterwards, so text inside a marker never
reached the renderer at all — markdown in there stayed literal, and a quote stayed
uncoloured. Two consequences, both fixed in `ImageEmbeddingService`:

- Marker text is now rendered rather than spliced back raw, through a renderer the
  caller supplies — inline story markdown for the markdown path, and identity for
  Visual Prose, whose marker text is already HTML.
- `snapMarkersToDialogue` widens any marker that would end mid-quote. Half a quote is
  an unterminated one, which is deliberately not dialogue, so the line lost its
  colour with nothing on screen to explain why. It widens rather than trims because a
  `sourceText` is often mostly dialogue and trimming can cut an image's anchor down to
  a few words. A marker that cannot grow without colliding with another is left
  untouched: overlapping markers corrupt both replacements, which is worse. Checking
  the grown marker against the _original_ others is enough, and not by luck: the
  widening loop runs to a fixed point, so a marker ends up closed under every span it
  touches — which makes it impossible for two grown markers to overlap without at
  least one also reaching an original.
- Snapping is off for Visual Prose and for `getPlacedImageIds`, via `snapToDialogue`.
  Visual Prose content is generated HTML where dialogue is not a concept, and widening
  cannot change _which_ images are placed, only where.

The colour yields inside an image marker whose status is not `complete`. Those markers
say _generating_, _pending_ or _failed_ in their colour, and a widened marker is mostly
quote by design, so the dialogue colour would repaint away the only signal the status
has.

For TTS the voice is a property of each **chunk**, not of the call
(`TTSSegment` in `TTSService.ts`). Playing narrator and dialogue as separate
`streamAndPlay` calls would restart the producer/consumer queue at every quote — an
audible gap per line — and would leave `stopAudio` able to stop only the segment
currently sounding. As chunks, the existing pipeline, retry and progress are unchanged.

Two order-dependent rules, both silent when broken and both covered by
`ttsText.test.ts`:

- **Sanitize, then split, then drop excluded characters.** Adding `"` to
  `excludedCharacters` is a legitimate way to silence the quote marks; run that filter
  before the split and it erases the very marks the split reads, collapsing playback
  to one voice with no error anywhere.
- **Visual Prose forces tag removal**, whatever `removeHtmlTags` says. That content is
  generated HTML with a `<style>` block, and the toggle defaults to false — so the
  reader otherwise hears markup read aloud.

`excludedCharacters` is compiled into a regex character class, which needs a stricter
escape than the shared `escapeRegex`: that one does not touch `-`, so a hyphen listed
between two other characters becomes a **range**. `'*, -, ~'` — an entirely reasonable
thing to exclude — compiled to `[\*-~]`, every printable ASCII character from `*` to
`~`, and erased the whole entry. It cannot be fixed in `escapeRegex` itself, whose
output also feeds unicode-mode patterns where `\-` outside a class is a SyntaxError.
An entry that comes out with nothing left to say now reports that rather than leaving
the play button to do nothing.

The Google Translate provider is excluded: its "voice" is a language code, so a second
one would read the dialogue in another language. `supportsDialogueVoice` is a single
predicate shared by the settings UI that hides the control and the playback path that
ignores the setting.

### Settings Migrations

Settings are persisted as one JSON blob, and nothing removes legacy keys from it. Reshaping runs on
the way from disk into the store, in `src/lib/stores/settingsMigrations.ts` — kept out of the rune
store precisely so it can be tested. A rename goes through here too: `recentEntriesForRetrieval`
became `recentEntriesForSuggestions`, because it named the one thing it does not drive — neither
retrieval service ever read it, `SuggestionsService` is its only consumer, and the slider was
already labelled "Plot Suggestions". Two properties every migration there must hold:

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

**The script does not finish the release.** `release.yml` publishes a **draft**, and a draft is
invisible to `/releases/latest` — which is where both the desktop updater and the Android check
look. Publishing the draft on GitHub is the step that actually ships it; until then no existing
install will see the new version. See [The Updater](#the-updater).

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
