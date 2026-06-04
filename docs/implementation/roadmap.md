# Roadmap

Planned milestone arc for Aventuras v2 from Milestone 2 through the
v1 ship gate. **This is provisional.** Per
[`conventions.md → When milestones change`](./conventions.md#when-milestones-change),
the _goal_ of a milestone is stable once a `milestone.md` is
authored — but a roadmap entry is the **pre-author** state: each
entry is a working hypothesis about what that milestone will be,
not a commitment to its goal. Roadmap entries can be edited,
re-sequenced, split, or merged freely until they're promoted to a
defined `milestone.md`.

## How to read this doc

- **Defined milestones** with full `milestone.md` files live under
  [`milestones/`](./milestones/README.md). M1 (Spine) is the only
  defined milestone today.
- **Planned milestones** below are roadmap entries: a one-paragraph
  goal sketch, a likely slice list (titles only, no contracts), and
  notes on what gates the milestone and what's intentionally out of
  scope.
- When a milestone is ready to author, its roadmap entry is
  **promoted**: a `milestones/NN-name/milestone.md` is written, and
  the roadmap entry shrinks to a one-line pointer at the section
  header.

## Sequencing thesis

After M1 (Spine), the largest open question is **whether the base
systems (real-provider integration, memory pipeline, retrieval,
chapter-close, branches) work as their specs describe** when wired
against real story data. Validation, not tuning — prompt + ranker
tuning belongs in a polish era after every base system is online,
and the rich tuning surfaces (memory probe in particular) ship
alongside diagnostics in M7 rather than mid-build. The roadmap is
therefore ordered to build the smallest feasible end-to-end story
loop first (M2), then layer the memory pipeline against real story
data for correctness (M3–M5), then branches (M6), then
settings + diagnostics + onboarding + the rich memory-probe surface
(M7), then translation + vault parent shell (M8), then the ship
gate (M9).

Three consequences worth naming up front:

- **M2 ships a deliberately degraded experience.** No memory, no
  awareness graph, no chapter close — just "send recent entries as
  context." Stories made in M2 are short-and-incoherent by design.
  The point is to validate the loop, not the storytelling.
- **Large UI screens ship incrementally across milestones.** The
  wizard, reader-composer, world panel, plot panel, app settings,
  story settings, and memory probe each span 2–4 milestones rather
  than landing in one shot. See
  [Surfaces that ship incrementally](#surfaces-that-ship-incrementally)
  for the per-screen breakdown.
- **Each milestone applies the visual identity foundations to its
  own surfaces as it ships them** — no batched "VI audit" milestone
  at the end. Foundations are shipped (per
  [`ui/foundations/sessions.md`](../ui/foundations/sessions.md));
  the per-surface work is small enough to fit inside each
  milestone's UI slices.
- **Each milestone ships Storybook stories alongside the compounds
  it introduces.** Same convention as VI application — story
  authorship lives in the slice that adds the compound, not a
  batched end-of-v1 pass. M9.1 is a CI gate that catches gaps,
  not the place stories are written.

## Multi-contributor model

Roadmap assumes 2–3 contributors working on **one milestone at a
time** (per
[Project · Implementation vocabulary](./conventions.md#hierarchy)).
Cross-milestone parallelism is not used. Each milestone is sized to
have at least two parallel slice paths after an initial
gate-and-schema slice — same shape as M1.

---

## Planned milestones

### M2 — First user loop

**Goal.** Smallest end-to-end story loop with a real provider.
User completes the wizard's minimum-viable path, writes entries in
the reader, gets responses from a real LLM, saves the story, sees
it on the story list. No memory pipeline, no awareness, no
chapter management — each turn sends the last N entries verbatim
as context.

**Why now.** Validates the full request path (UI → action layer →
pipeline framework → real provider → entry write → diagnostics)
end-to-end with a human-perceptible outcome, replacing M1's
fault-injection stub. Produces the first real-story data the
memory pipeline (M3) needs to tune against.

**Likely slices.**

- M2.1 — Provider abstraction filled in; provider config types;
  **OAI-compat as the first provider** (most universal, covers
  the contributor test cases). Other providers add incrementally
  in M7 alongside the providers settings tab. Extends the M1.4
  redaction vitest suite with OAI-compat scenarios — value-match
  catches the key in OAI-compat's auth headers without per-
  provider configuration.
- M2.2 — Entry data layer: `story_entries` + the entry kinds the
  M2 loop exercises (`opening`, `user_action`, `ai_reply`); `system`
  stub. CRUD actions through the action layer. Full enum per
  [`data-model.md`](../data-model.md). Action layer enforces the
  opening-entry position invariants and the `undo_payload` /
  `log_position` / `encoding_version` delta-encoding rules per
  [`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback).
- M2.3 — Story creation, minimum-viable wizard: step 1
  (definition + model + pack picks), step 2 (calendar — bundled
  calendars only), step 5 (opening generation via real provider),
  wizard auto-save + draft persistence. Steps 3 (lore) and 4
  (cast) deferred to M3 alongside the data layers they manipulate;
  refine / regenerate on opening deferred to M3. `react-hook-form`
  install lands with wizard step 1 (per
  [`tech-stack.md`](../tech-stack.md)).
- M2.4 — Story list as a real surface: list real stories, navigate
  to reader, basic store. Removes the M1 `__DEV__` landing
  "Open reader (debug)" button (Slice 1.7b's only path into the
  reader) once this real reader path exists.
- M2.5 — Reader-composer minimum: entry list rendering (with
  load-older pagination + scroll-anchoring on prepend per
  [`reader-composer.md → Loaded-set model`](../ui/screens/reader-composer/reader-composer.md#loaded-set-model)),
  composer below, trigger generation, basic edit / delete entry
  actions, rollback-confirm modal compound (single-entry cascade
  preview per
  [`reader-composer/rollback-confirm/`](../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md);
  extends to multi-chapter deep rollback in M5).
  Markdown rendering pipeline (htmlStreaming port from old app
  per [`tech-stack.md`](../tech-stack.md) — `marked`/`markdown-it`
  - `juice` + `DOMPurify` + `react-native-render-html` + streaming
    buffer-until-tag-boundary). Harper.js spellcheck install +
    composer wiring (per tech-stack). CTRL-Z basic single-action
    undo + redo stack (extends to action-batched undo in M3 once
    classifier writes share `action_id`). Calendar renderer for
    in-world time chrome lands here (see
    [Subsystems → Calendar](#subsystems-that-ship-incrementally)).
    Deferred to later milestones: refine / regenerate (M3), peek
    drawer + awareness chips (M4), chapter management (M5), branch
    picker (M6).
- M2.6 — End-to-end wiring: user action → translation
  short-circuit → pipeline → provider → entry write → UI refresh.
  Pack-template / Liquid engine lands here (minimal runtime +
  macro resolver + variable binding) since the pipeline call
  needs a rendered prompt. Bundled-pack `active+in-scene-entity`
  injection invariant test (per
  [`architecture.md → Structural floor — always inject`](../architecture.md#structural-floor--always-inject))
  lands alongside the bundled pack. Substrate that lands
  alongside: ID placeholder substitution (`IdBiMap`,
  `substituteIds`, reverse-substitution on parse) per
  [`generation-pipeline.md → ID placeholder substitution`](../generation-pipeline.md#id-placeholder-substitution);
  per-pipeline-kind config pre-flight scope with
  `run_complete(failed)` emission before phase 0 per
  [`generation-pipeline.md → Config pre-flight validation`](../generation-pipeline.md#config-pre-flight-validation)
  — needs two framework pieces M1 didn't ship: phases declaring their
  resolver inputs (a `Pipeline` / `PhaseNode` addition; M1 phases are
  opaque generators) and the agent→profile→provider resolution chain
  (M1's `lib/ai/model.ts` resolves only an explicit `providerId` and
  `modelId`);
  crash-recovery modal (`pendingRecoveryReport` slot, boot
  ordering migrations → stores → recovery → render, loading screen until render) per
  [`generation-pipeline.md → Recovery modal`](../generation-pipeline.md#recovery-modal);
  pack include-compatibility validator at pack load per
  [`architecture.md → Macros`](../architecture.md#macros--reusable-liquid-snippets-not-code-side-formatters);
  settings parse-failure recovery surfaces (`app_settings`
  blocking screen, per-story badge with `Open file` /
  `Reset settings`) per
  [`architecture.md → Settings`](../architecture.md#settings-strict-types-defaults-at-load).
  `jsonrepair` install lands with the structured-output parse
  path (per [`tech-stack.md`](../tech-stack.md)). The first real phase
  to call `callWithRetry` lands here, so the `CallRetryError →
PipelineError` mapping (test-only in Slice 1.5b) is promoted to a
  shipped helper. That phase's AI-SDK call config is settled (checked
  against v1 + the AI SDK v6 docs): `maxRetries: 0` (SDK default is 2 —
  `callWithRetry` is the sole retry authority), the SDK-native `timeout`
  (`totalMs` / `stepMs`, `chunkMs` for streams) instead of a fetch-level
  timeout, and Retry-After-aware backoff added to `callWithRetry` —
  suppressing `maxRetries` also drops the SDK's exponential backoff, which
  `callWithRetry` currently lacks.

**Parallel paths after M2.1 + M2.2.** {M2.3, M2.4} || {M2.5}, then
M2.6 wires.

**Gates.** Nothing; M1 spine is the only prereq.

**Scope: out.** Memory pipeline, entity tracking, branches,
chapters, translation, story settings depth, app settings depth,
multiple providers, vault.

---

### M3 — Memory floor

**Goal.** The memory pipeline is online: piggyback writes scene
metadata + structured tool calls during main generation; periodic
classifier reconciles entities + lore + happenings + awareness in
the background; retrieval surfaces relevant context into each
turn's prompt. Stories made in M3 are coherent across a session.

**Why now.** Real story data exists from M2; this milestone is
where classifier prompt engineering and retrieval ranking get
their first contact with real inputs. Lands before the rich UX
because UX needs the data layer (entities, awareness, happenings)
to render against.

**Likely slices.**

- M3.1 — Embedder integration + the hard onboarding gate (story
  creation requires embedder per
  [`memory/model-management.md`](../memory/model-management.md));
  embedder configuration in app settings;
  `embedding_stale` opportunistic drain worker (makes "retry"
  meaningful after embedder failure per
  [`memory/retrieval.md → Compute lifecycle`](../memory/retrieval.md#compute-lifecycle));
  `embedding_swap_target` two-phase stage-then-flip pipeline +
  crash-recovery resume / cancel prompt on story-open (per
  [`memory/retrieval.md → Model swap UX`](../memory/retrieval.md#model-swap-ux)).
  Adds Matryoshka effective-dim machinery (capability flags
  `matryoshkaSupported` / `matryoshkaDims`, `effectiveDim`,
  truncation + renorm at every embed-write) per
  [`memory/retrieval.md → Matryoshka effective dim`](../memory/retrieval.md#matryoshka-effective-dim)
  and the top-bar staleness pill + Settings · Memory per-story
  resolution panel per
  [`memory/model-management.md → Staleness UI`](../memory/model-management.md#staleness-ui).
  Embedder management UI extends in M7.1.
- M3.2 — Piggyback layer: inline structured tool calls during
  main generation; scene metadata writes;
  entities + lore + happenings stub creation.
- M3.3 — Periodic classifier: background pipeline; entity
  reconciliation; awareness graph; happenings extraction;
  `character_relationships` table + UPSERT-merge writes per
  [`data-model.md → Character-to-character relationships`](../data-model.md#character-to-character-relationships).
  Classifier writes `metadata.worldTime` to each new entry —
  first non-zero values flow through the calendar renderer
  shipped in M2.5. Auto-retry policy (30s → 2m → 5m backoff,
  3-strike failed-persistent state per
  [`memory/classifier.md → Auto-retry policy`](../memory/classifier.md#auto-retry-policy))
  - per-branch `classifier_status` persistence.
    `entities.name_collision_flag INTEGER` column lands here
    (drives the M4 collision-review surface) per
    [`memory/classifier.md → Disambiguation`](../memory/classifier.md#disambiguation-on-new-character-mentions).
  - Survival-anchor substrate (makes the classifier reversible-correct):
    `deltas.source += 'periodic_classifier'`; per-fact provenance
    stamped into `deltas.entry_id`; `processedThrough` in
    `classifier_status` plus its reversal clamp; and the reversal
    predicate that refines M2.5's naive suffix sweep so a lagging fact
    about a surviving turn isn't over-reversed, per
    [`data-model.md → Survival anchor`](../data-model.md#survival-anchor).
- M3.4 — Retrieval: embedding queries; ranker; budgets;
  context-bundle assembly into the per-turn prompt. Memory pack
  templates extend the Liquid engine to inject retrieved bundles.
  Per-injection `retrieval_count` increment on awareness rows
  (load-bearing for chapter-close phase 3d in M5.2 per
  [`memory/chapter-close.md → 3d awareness pin tuning`](../memory/chapter-close.md#3d--awareness-pin-tuning)).
  Schema adds the `lore.keywords TEXT` column (distinct from
  `lore.tags`) per
  [`memory/retrieval.md → Keywords schema`](../memory/retrieval.md#keywords-schema).
  `js-tiktoken` install lands here as the first budget-accounting
  consumer (per [`tech-stack.md`](../tech-stack.md)).
- M3.5 — Minimal developer-only retrieval probe: log / inspect
  retrieval scores during impl. User-facing probe surface
  deferred to M7. Schema delta lands here: `probe_captures`
  table + `app_settings.diagnostics.enabled` +
  `stories.settings.probe_mode_active` per
  [`memory/probe.md → Schema delta`](../memory/probe.md#schema-delta).
  Simulator-vs-prod-pass parity test ships alongside.
- M3.6 — Wizard step 3 (lore editor) + step 4 (full bespoke cast
  editor — all 4 per-kind editors with `▼ Visual` / `▼ More
options` disclosures, status / lead / staged logic,
  pick-from-cast pickers): pre-author opening's lore + entities
  at story creation; opening generation consumes seeded context.
  Refine / regenerate affordances on opening land here. The
  wizard editor is bespoke (its own tier shape, excludes
  classifier-managed fields per the authorship contract); not a
  precursor to the world panel.
- M3.7 — Next-turn suggestions: pipeline emission (sibling
  `<suggestions>` block alongside narrative in piggyback mode
  and/or alongside `<state>` in classifier mode per
  [`reader-composer.md → Next-turn suggestions`](../ui/screens/reader-composer/reader-composer.md#next-turn-suggestions)),
  reader-composer suggestions panel between AI replies and the
  next composer input, `suggestionsEnabled` story setting toggle.
  Adds `app_settings.default_suggestion_categories` and the
  Story Settings · Composer categories editor (consuming the
  shipped `SuggestionCategoriesEditor`) plus a
  `kind: 'suggestion-refresh'` pipeline declaration per
  [`next-turn-suggestions exploration`](../explorations/2026-05-19-next-turn-suggestions.md).
  Suggestion agent profile slot in app-settings extends M7.1.
- M3.8 — Per-entry worldTime click-to-edit overlay (TierTupleInput)
  - monotonicity-break flag (O(N) walk feeding
    `worldTimeMonotonicityBreak` into EntryCard per
    [`reader-composer.md → Per-entry world-time footer`](../ui/screens/reader-composer/reader-composer.md#per-entry-world-time-footer)).
    Needs classifier writes from M3.3 to be useful.
- M3.9 — CTRL-Z action-batched extension: extends M2.5's basic
  single-action undo so undoing a prose turn reverses the positional
  suffix from the turn's start — carrying its piggyback deltas, skipping
  `periodic_classifier` deltas (never undo targets), and sparing
  surviving turns' facts via the survival anchor — per
  [`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback).
  Redo stack semantics unchanged.

**Parallel paths.** {M3.1, M3.2} are sequential against entry
schema; M3.3 runs in parallel with M3.4 once classifier writes
populate retrievable rows; M3.6 runs in parallel with M3.3 / M3.4
after M3.2 lands the lore + entity stub writes; M3.7 gates on
M3.2 + M3.3; M3.8 gates on M3.3; M3.9 gates on M3.3 (needs the
survival-anchor reversal substrate).

**Gates.** M2 (entries + real provider needed before classifier
has anything to classify).

**Scope: out.** Chapter-close, rich world panel, rich plot panel,
multi-axis salience, pinning policy refinements, rich
user-facing memory probe (M7).

---

### M4 — World + Plot read surfaces

**Goal.** Users can browse and edit the entity graph the memory
pipeline produces. World panel renders entities by kind with
overview + state tabs; Plot panel renders happenings with
awareness; story settings exposes the controls users need now
that real data exists (model overrides, basic per-story config).

**Why now.** M3 produces entity / lore / happening / awareness
rows; without surfaces to browse + edit them, the memory pipeline
is invisible. This milestone is read-heavy with light edit; full
chapter-management is M5.

**Likely slices.**

- M4.1 — World panel shell + per-kind tabs (characters /
  locations / items / factions / etc.) + entity list rows.
- M4.2 — Entity detail surface: overview tab, state tab, per-kind
  fields per
  [`docs/ui/screens/world/world.md`](../ui/screens/world/world.md).
  Collision-review + entity-merge driver wires the shipped
  `CollisionResolveDialog` against `name_collision_flag` rows
  per [`patterns/collision-resolve.md`](../ui/patterns/collision-resolve.md).
  `LocationState.parent_location_id` cycle-guard (action-layer
  pre-commit walk, depth-cap 100) per
  [`data-model.md → LocationState`](../data-model.md#locationstate-shape).
  Entity search scope across `state` JSON via `json_extract` /
  `json_each` per
  [`patterns/entity.md → Search scope`](../ui/patterns/entity.md#search-scope).
- M4.3 — Plot panel shell + threads tab + happenings tab; happenings
  list with awareness tab on detail per
  [`docs/ui/screens/plot/plot.md`](../ui/screens/plot/plot.md).
  Threads data may be sparse until M5's chapter-close populates it
  reliably; the surface ships in M4. Entry-ref picker primitive
  (for `triggered_at_entry` / `resolved_at_entry` /
  `occurred_at_entry` / `learned_at_entry` fields) ships here as
  the first consumer; pattern reused across later entry-ref
  surfaces.
- M4.4 — Story settings real (basic): model overrides + basic
  per-story config — the settings depth users need with real data
  flowing. Deep settings tabs land in M7.
- M4.5 — Reader-composer awareness affordances: peek drawer +
  awareness chips on entries per
  [`reader-composer.md → Peek drawer`](../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters).
  Gates on M3.3 awareness writes.

**Parallel paths.** {M4.1, M4.2} || {M4.3} || {M4.4} || {M4.5}.

**Gates.** M3 (no entities without classifier; no awareness
without classifier; no retrieval scores without retrieval).

**Scope: out.** Bulk operations (parked); character-side awareness
tab (parked); image generation; chapter-close UX (M5).

**Note.** Entity / happening / thread history tabs render against
raw delta-log queries in M4 — functional but uncached. Diff-cache
acceleration lands in [M6.4](#m6--branches--diff-cache).

---

### M5 — Chapters + chapter-close

**Goal.** Chapter timeline ships as a real surface; chapter-close
pipeline runs at chapter boundaries doing the
[`memory/chapter-close.md`](../memory/chapter-close.md) phase
sequence (3a–3e). Threads management lands. Reader gains chapter
management affordances (insert break, view chapter context, etc.).

**Why now.** Chapter-close is the second-largest piece of memory-
pipeline complexity after the per-turn classifier. It's a boundary
event, so it can be developed and tested independently of per-turn
flow. The threads model and chapter-timeline UI are natural
companions.

**Likely slices.**

- M5.1 — Chapter data layer: chapter rows, chapter-membership on
  entries, chapter boundaries.
- M5.2 — Chapter-close pipeline: phases 3a–3e, agent invocations,
  delta writes. Chapter-close consolidates `threads` rows that
  M3's classifier wrote sparsely; surface (plot panel threads
  tab) already exists from M4.3. Per-chapter `retrieval_count`
  reset under the chapter-close `action_id` (paired with M3.4's
  per-injection increment). This is the first real `chainsTo`
  consumer (per-turn → chapter-close): M5.2 declares per-turn's
  `chainsTo` predicate and builds the chapter-close pipeline. The
  orchestrator's chained-execution capability (driving the successor
  through its own commit, threading its fresh `actionId` and
  active-run pointer) already landed in 1.5a during post-M1
  reconciliation, so M5.2 needs no orchestrator change.
- M5.3 — Chapter timeline screen per
  [`docs/ui/screens/chapter-timeline/chapter-timeline.md`](../ui/screens/chapter-timeline/chapter-timeline.md);
  chapter delete routes through the deep-rollback surface (M5.5).
- M5.4 — Reader chapter affordances: insert break, navigate by
  chapter, chapter context badge.
- M5.5 — Deep rollback surface: multi-chapter reverse-replay
  flow extending M2.5's rollback-confirm modal with cascade
  warning for rollback spanning closed chapters (per
  [`data-model.md → Branch model`](../data-model.md#branch-model)).
  Consumed by chapter delete (M5.3) and rollback-to-entry-N from
  the reader.

**Parallel paths.** {M5.1, M5.2} are sequential against schema;
{M5.3, M5.5} || {M5.4} once data layer exists.

**Gates.** M4 (chapter-close compacts entities + lore the world
panel renders; surfaces would be invisible without M4).

**Scope: out.** Cross-chapter semantic dedup (parked); lore-mgmt
cross-arc callback detection (parked).

---

### M6 — Branches + diff cache

**Goal.** Branches work: fork creates a new branch with a
branch-copy of the relevant data per the
[branch-copy manifest](../data-model.md#branch-model). Reader has
a branch picker. The diff cache (Zustand + React Query off-label
per
[Project · State placement](./conventions.md))
populates so branch comparisons are fast.

**Why now.** Branches touch every domain table (delta-log
filtering, branch-copy semantics, FK rewriting) so they need the
data layer mostly built. Diff cache is bespoke compute caching;
building it after the rest of the substrate stabilizes avoids
churn.

**Likely slices.**

- M6.1 — Branch schema + branch-copy at fork time + FK rewriting,
  including the survival-anchor partition of post-fork deltas (copy
  lagging `periodic_classifier` facts about kept entries instead of
  rewinding them) per
  [`data-model.md → Branch model`](../data-model.md#branch-model).
- M6.2 — Delta-log branch filtering (reads scope to current
  branch's lineage).
- M6.3 — Reader branch picker + branch creation flow.
- M6.4 — Diff cache: query layer, eviction, deps on branch +
  entry events. Renderer iteration walks `keys(old.<column>)`
  (not `keys(new.<column>)`), and cache-miss path falls back to
  an `undo_payload`-keys-only summary per
  [`architecture.md → Delta history diff resolution`](../architecture.md#delta-history-diff-resolution).
- M6.5 — Multi-story branching: story list shows branch count,
  navigation handles the branch-aware URL shape.
- M6.6 — Story duplicate (overflow menu on story cards): clone
  story row + current branch's entries + entities / lore
  snapshot per
  [`story-list.md → Story card`](../ui/screens/story-list/story-list.md#story-card--text-first).
  Structurally similar to branch-copy (M6.1) but story-scoped.

**Parallel paths.** {M6.1, M6.2} sequential; {M6.3, M6.4, M6.5}
parallel once branch reads work.

**Gates.** M5 (chapter-close writes that branches must respect
need to exist first).

**Scope: out.** Per-branch definition override (parked);
sophisticated merge / cherry-pick (out of v1).

---

### M7 — App settings + diagnostics + onboarding

**Goal.** The app's chrome is complete. App settings exposes
provider management, embedder management, theme picker, density
toggle, data tab (backup / export / restore). Diagnostics screen
ships. Onboarding flow runs on first launch and walks the user
through provider + embedder configuration.

**Why now.** Settings depth is most useful once features are
built (settings without features to configure are noise);
diagnostics is most useful once there's real generation traffic
to inspect; onboarding gates first-launch so it has to ship before
v1 — but it can ship near the end because it's a thin facade over
the underlying configuration surfaces.

**Likely slices.**

- M7.1 — App settings deep: **providers tab** full surface
  (multi-provider config, per-provider collapsible rows, two
  capability-section model lists with virtual scrolling for large
  catalogs like OpenRouter 340+, capability badge click-to-
  override, per-section staggered refresh, `Add custom model id`,
  provider `⋯` menu with deletion-semantics AlertDialog,
  reset-profiles action) — deletion runs the full embedding-story
  block + `assignments` key removal + `profiles.length ≥ 1`
  invariant per
  [`data-model.md → App settings storage`](../data-model.md#app-settings-storage);
  **embedder tab** full surface (curated catalog + HF-id import +
  custom-file import paths, per-model EP picker, cross-story
  staleness aggregate, download dialog with license fetch +
  SHA256 verify + `.attestation`, remove / test flows);
  **models tab** (agent-to-profile assignments including the
  `suggestion` slot from M3.7); **appearance tab** (theme picker
  - density toggle + reader font scale + `deriveAccent`
    implementation with `accentFg` auto-flip per
    [`accent-hover-contrast exploration`](../explorations/2026-05-21-accent-hover-contrast.md));
    **diagnostics tab** (master toggle + `debug_level_enabled` +
    Actions-menu `Open Diagnostics Hub` entry hidden when toggle
    is off, per
    [`observability.md → UI placement`](../observability.md#ui-placement));
    **data tab** (backup / export / restore / clear caches).
- M7.2 — Story settings deep: pack tab, definition tab, models
  tab, awareness tab, calendar tab, **Advanced tab** (story id,
  timestamps, branch info, export JSON, view raw settings per
  [`story-settings.md → Section split`](../ui/screens/story-settings/story-settings.md)).
  Era-flip reader affordances (time-chip popover, per-entry
  icon, Actions menu entry, flip-era modal) land here paired
  with the calendar tab's era-flips list + `branch_era_flips`
  table. Memory tab adds the classifier panel (cadence in-place
  edit, buffer-aware cadence indicator, status block,
  `[Run classifier now]`, top-bar error pill routed back) per
  [`memory/classifier.md → Settings · Memory · Classifier panel`](../memory/classifier.md#settings--memory--classifier-panel).
  Pack tab gates on the `templateContextMap.ts` integrity
  validator per
  [`architecture.md → Variable registry`](../architecture.md#variable-registry-for-the-prompt-editor).
- M7.3 — Diagnostics screen per
  [`docs/ui/screens/diagnostics/diagnostics.md`](../ui/screens/diagnostics/diagnostics.md).
  The Diagnostics UI renders the structured `action-layer` error fields
  (`tableName` / `targetId` / `constraintViolated`) when present per
  [`generation-pipeline.md → Fatal error categories`](../generation-pipeline.md#fatal-error-categories);
  populating them needs an engine-side SQLite-error mapper to extract
  them from a constraint throw (Slice 1.5b ships those fields optional
  and unpopulated).
- M7.4 — Onboarding flow per
  [`docs/ui/screens/onboarding/onboarding.md`](../ui/screens/onboarding/onboarding.md).
- M7.5 — Memory probe (rich, user-facing) per
  [`docs/ui/screens/memory-probe/memory-probe.md`](../ui/screens/memory-probe/memory-probe.md).
  Pairs with diagnostics as the transparency / tuning surface
  group.
- M7.6 — App-settings auxiliary surfaces (provider-detection
  override UX, full-backup AlertDialog with key-leak
  acknowledgment).

**Parallel paths.** Internal ordering + parallelism handled at
milestone-authoring time. Sketch: {M7.1, M7.2, M7.3, M7.4, M7.5}
nearly independent; M7.6 finishes once M7.1 is in.

**Gates.** M6 (settings should reflect real branching + multi-
story behavior; diagnostics should inspect real branch-aware
flows).

**Scope: out.** Prompt-pack editor (parked post-v1);
user-authored themes (parked-until-signal); OS dark/light follow
(parked-until-signal).

---

### M8 — Translation + vault parent shell

**Goal.** Translation pipeline runs (per-turn
user-action-translation and display-translation per
[`architecture.md → Translation`](../architecture.md#user-action-translation-pre-narrative)).
Story settings exposes the translation controls. Vault parent
shell ships (calendars already shipped per
[`docs/ui/screens/vault/calendars/calendars.md`](../ui/screens/vault/calendars/calendars.md));
vault navigation surfaces from the story list.

**Why now.** Translation is critical-path for multilingual users
but additive for English-only users — fits well as a late v1
milestone. Vault parent shell is a small wrapping job around the
already-shipped calendar editor.

**Likely slices.**

- M8.1 — Translation pipeline: user-action-translation phase,
  display-translation lookup, `translations` table.
  `translation-retry` pipeline declaration (separate v1 pipeline
  kind with `hard-gate` concurrency per
  [`generation-pipeline.md → V1 declarations`](../generation-pipeline.md#v1-declarations))
  lands alongside.
- M8.2 — Translation UI: language picker in story settings,
  graceful degradation contract per
  [`architecture.md`](../architecture.md); miss-toast +
  sticky generation-status-pill surface for user-driven retry
  (invokes the `translation-retry` pipeline from M8.1).
- M8.3 — Vault parent shell: vault home navigation, vault entry
  point from story list, vault chrome. Vault calendar editor
  adds `displayFormat` preview-on-save plus a render-time
  fallback (raw integer + warning chip on template throw), and
  a "this story's origin needs re-confirmation" affordance
  when a tier add / remove invalidates an in-use
  `worldTimeOrigin`, per
  [`calendar-systems/spec.md → Adversarial check`](../calendar-systems/spec.md#adversarial-check).
- M8.4 — Translation-aware retrieval / classifier-on-translation
  edge cases per
  [`memory/edge-cases.md`](../memory/edge-cases.md).

**Parallel paths.** {M8.1, M8.2} sequential; {M8.3} || {M8.4}.

**Gates.** M7 (settings surfaces translation toggles).

**Scope: out.** Outage-mode fallback (parked); translation-miss
persistence table (parked); user-controllable narrative language
(parked); translation wizard (parked); vault import/export at
vault level (parked).

---

### M9 — Storybook + per-surface visual polish + ship gate

**Goal.** Every shipped UI compound has a Storybook story; every
shipped screen has had its per-surface visual identity audit
(replace remaining "deferred to visual identity" notes with final
glyphs / spacing / accents). Full backup + export round-trips
work. v1 ships.

**Why now.** Storybook feature components were gated on visual
identity foundations landing; that gate is met as of 2026-05-01
per
[`ui/foundations/sessions.md`](../ui/foundations/sessions.md).
The per-surface VI audit can only happen once the surface exists.
Backup + export round-trip is the highest-value ship-blocker that
isn't a per-feature concern.

**Likely slices.**

- M9.1 — Storybook story-coverage CI gate (asserts every
  compound has a story). Stories themselves ship per-compound
  inside the milestone that introduces each compound; this slice
  catches gaps + lands the gate.
- M9.2 — Per-surface visual identity audit: each screen reviewed
  against shipped foundations (`ui/foundations/`); final glyph
  picks, spacing finalization, accent application, monochrome
  wireframe holes filled.
- M9.3 — Backup pipeline: `VACUUM INTO` snapshot + failsafe JSON
  dump; restore. Asset trash-can sweep + orphan GC boot-time
  passes per
  [`data-model.md → Assets`](../data-model.md#assets-images--future-media)
  (prevents disk leaks from rolled-back / branch-deleted asset
  rows). First sub-design pass: backup / export packaging shape
  (JSON sidecar location, asset base64-inline vs sidecar) per
  [`parked.md → Backup / export packaging shape`](../parked.md#backup--export-packaging-shape).
- M9.4 — Per-story export `.avts` envelope; per-story import
  `.avts` (story list `[Import story…]` affordance routes through
  the `ImportDialog` compound landed at M4); cross-version
  resilience. Bulk-import embed batching with progress UI for
  `.avts` import and DB-migration paths per
  [`memory/retrieval.md → Compute lifecycle`](../memory/retrieval.md#compute-lifecycle)
  (naive 100k rows would take ~16 min).
- M9.5 — Cross-platform parity smoke (Linux desktop + Android),
  performance budget audit, accessibility audit
  ([`accessibility skill`](./conventions.md) checks).
- M9.6 — v1 ship: changelog, release notes, distribution
  packaging; **app icon + splash screen** replacing Expo
  placeholders (per
  [`tech-stack.md → Pre-launch polish`](../tech-stack.md)).

**Parallel paths.** {M9.1, M9.2} || {M9.3, M9.4} || {M9.5}; M9.6
gates on all.

**Gates.** M8 (every user-facing surface must exist before the
visual audit, and translation must round-trip cleanly through
backup / export).

**Scope: out.** Image generation, prompt-pack editor, FTS5
upgrade, asset gallery, all post-v1 confirmed work — those are
explicit post-v1 milestones not in this roadmap.

---

## Cross-milestone notes

### Surfaces that ship incrementally

Large UI screens land across multiple milestones rather than
shipping all at once. Each milestone implements only the slice of
the screen its goal requires; later milestones extend.

- **Wizard** ([wizard.md](../ui/screens/wizard/wizard.md)).
  - **M2.3** — Step 1 (definition + model + pack picks); step 2
    (calendar picker against bundled-only registry); step 5
    (opening generation); auto-save + draft persistence.
  - **M3.6** — Step 3 (lore editor) + step 4 (full bespoke cast
    editor — all 4 per-kind editors with disclosures, status /
    lead / staged logic, pick-from-cast pickers); refine /
    regenerate on opening.
  - **M7.1 / M7.2** — Pack selection across multi-provider config;
    provider-plurality in model picker; full settings reflection.
  - **M8.3** — Step 2 picker gains vault-imported calendars once
    the registry merges `vault_calendars` rows. Picker code
    unchanged; this is a registry-side extension, not a wizard
    slice.
- **Reader-composer**
  ([reader-composer.md](../ui/screens/reader-composer/reader-composer.md)).
  - **M2.5** — Entry list (load-older pagination +
    scroll-anchoring on prepend), composer, trigger generation,
    basic edit / delete entry actions, rollback-confirm modal
    compound (single-entry cascade), markdown rendering pipeline,
    Harper.js spellcheck, CTRL-Z basic single-action undo.
  - **M3** — Refine / regenerate affordances on entries (consume
    memory context); next-turn suggestions panel between AI
    replies and the composer (M3.7); per-entry worldTime
    click-to-edit + monotonicity flag (M3.8); CTRL-Z
    action-batched extension across classifier writes (M3.9).
  - **M4** — Peek drawer + awareness chips on entries.
  - **M5** — Chapter management affordances (insert break,
    navigate by chapter, chapter context badge); deep-rollback
    surface extends rollback-confirm with multi-chapter cascade
    warning.
  - **M6** — Branch picker + branch creation flow.
  - **M7.2** — Era-flip reader affordances (time-chip popover,
    per-entry icon, Actions menu entry, flip-era modal).
- **World panel** ([world.md](../ui/screens/world/world.md)).
  - **M4.1 / M4.2** — Full v1 scope (shell, per-kind tabs, entity
    detail overview + state tabs).
- **Plot panel** ([plot.md](../ui/screens/plot/plot.md)).
  - **M4.3** — Plot panel shell + threads tab + happenings tab +
    happening awareness tab. Threads data sparse until M5.2
    chapter-close populates it reliably.
- **App settings**
  ([app-settings.md](../ui/screens/app-settings/app-settings.md)).
  - **M3.1** — Embedder integration with minimal app-settings
    embedder surface (gate-required for story creation).
  - **M7.1 / M7.6** — Full v1 scope (providers tab + embedder tab
    full surfaces + models tab agent assignments + appearance +
    data + auxiliary surfaces). M2.1 ships OAI-compat-only
    config as part of provider abstraction, no dedicated settings
    surface yet.
- **Story settings**
  ([story-settings.md](../ui/screens/story-settings/story-settings.md)).
  - **M4.4** — Basic surface (model overrides, basic per-story
    config).
  - **M7.2** — Deep tabs (pack, definition, models, awareness,
    calendar, translation, **Advanced**); era-flip surfaces
    here.
- **Memory probe**
  ([memory-probe.md](../ui/screens/memory-probe/memory-probe.md)).
  - **M3.5** — Minimal developer-only inspector (logs / impl
    debug).
  - **M7.5** — Rich user-facing probe surface.

When a milestone is promoted to a full `milestone.md`, that doc
owns the precise slice-of-screen contract; this table is
indicative only.

### Subsystems that ship incrementally

Some subsystems thread through multiple milestones — partial
runtimes land early to support the first consumer, then extend as
later consumers arrive. Tracking them here keeps slice
descriptions scannable while making the cross-cutting wiring
explicit.

- **Calendar system**
  ([`calendar-systems/spec.md`](../calendar-systems/spec.md),
  [`patterns/calendar-picker.md`](../ui/patterns/calendar-picker.md)).
  - **M2.3** — Calendar registry (built-ins from code only;
    no `vault_calendars` merging yet); calendar-picker primitive;
    bundled calendar definitions in code. `lib/calendar/`
    arithmetic substrate (`worldTimeToTuple`, era arithmetic,
    per-year cumulative-day cache) scaffolds here per
    [`spec.md → Rendering pipeline`](../calendar-systems/spec.md#rendering-pipeline).
  - **M2.5** — Renderer (`worldTime + worldTimeOrigin → tier-tuple
→ Liquid render`) for reader chrome. Exercised meaningfully
    only after M3.3 begins writing non-zero `worldTime` values.
  - **M3.3** — Classifier writes `metadata.worldTime` on each new
    entry; first non-zero worldTime values flow through the
    renderer.
  - **M3.6** — Wizard's calendar-summary preview samples the
    renderer to show how dates will format.
  - **M5.3** — Chapter timeline time column consumes the renderer.
  - **M7.1** — App settings calendar tab (`default_calendar_id`
    picker into the registry).
  - **M7.2** — Story settings calendar tab deep: picker + summary
    - era-flips list + swap-warning UX; `branch_era_flips` table
      lands here.
  - **M8.3** — `vault_calendars` schema + CRUD + vault calendar
    editor; registry init extends to merge bundled +
    `vault_calendars` rows.
- **Pack-template / Liquid engine**
  ([`architecture.md → Prompt templates`](../architecture.md#prompt-templates-and-authoring)).
  - **M2.6** — First pipeline call renders a pack template
    (bundled pack only) into the provider call; minimal Liquid
    runtime + macro resolver + variable binding.
  - **M3.4** — Memory templates extend the engine to inject
    retrieved bundles (entities / lore / happenings) into
    rendered context.
  - **M5.2** — Chapter-close templates render against
    chapter-scoped context.
  - **M7.2** — Pack tab in story settings edits live packs
    (runtime validation surface partial — full pack-format editor
    parked post-v1 per
    [`parked.md`](../parked.md#prompt-pack-editor-desktop-spec--mobile-retrofit)).
- **Observability sinks beyond the logger**
  ([`observability.md`](../observability.md)).
  - **M1.3 / M1.4 / M1.5a** — `logger`, `httpCallSink` (fully
    implemented with value-matching header redaction at sink
    boundary against `app_settings.providers` known keys; no
    denylist), `turnCaptureSink` land and accept their first
    emissions during the stub-LLM smoke. Redaction vitest suite
    (raw / prefixed / query-string / short-key cases) lands with
    the sink in M1.4.
  - **M2.1 / M2.6** — Real OAI-compat provider HTTP traffic flows
    through `httpCallSink` (extends the M1.4 redaction suite with
    OAI-compat scenarios); real per-turn captures populate via
    `turnCaptureSink`.
  - **M3 / M5** — Per-pipeline-kind turn-capture shape extends
    for memory + chapter-close pipelines (classifier / retrieval
    / chapter-close phases each contribute capture content).
  - **M7.1 / M7.3** — Settings-side controls land in M7.1's
    diagnostics tab (master + `debug_level_enabled` toggles,
    Actions-menu `Open Diagnostics Hub` entry) per
    [`observability.md → UI placement`](../observability.md#ui-placement);
    diagnostics screen consumes `logEntries`, `httpCallSink`
    history, run timeline in M7.3.
  - **M7.5** — Memory probe consumes `turnCaptureSink`
    retrieval-score content for per-turn inspection.
- **Undo / rollback system**
  ([`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback)).
  - **M2.5** — Rollback-confirm modal compound (single-entry
    cascade preview); CTRL-Z basic single-action undo + redo
    stack.
  - **M3.9** — CTRL-Z action-batched extension: prose-turn undo
    reverses the positional suffix from the turn's start, skipping
    `periodic_classifier` deltas (survival-anchor-gated).
  - **M5.5** — Deep rollback surface: multi-chapter reverse-replay
    flow extending the rollback-confirm modal with cascade
    warning for rollback spanning closed chapters; consumed by
    chapter delete (M5.3) and rollback-to-entry-N from reader.
- **Import / `ImportDialog` compound**
  ([`patterns/import-dialog.md`](../ui/patterns/import-dialog.md)).
  Design pass landed 2026-05-26
  ([exploration record](../explorations/2026-05-26-import-dialog.md)).
  Compound scaffolds at first consumer and threads through the
  rest:
  - **M4** — First consumer: World / Plot per-row entity import.
    Implementation prerequisite: add `expo-document-picker` +
    `expo-file-system` and trigger a dev-client rebuild before
    the slice runs (web has no native-build step). Adds per-row
    `.avts` envelope kinds (`aventuras-entity`,
    `aventuras-lore`, `aventuras-thread`, `aventuras-happening`)
    with kind-narrowed Zod payload schemas per
    [`data-model.md → Aventuras file format`](../data-model.md#aventuras-file-format-avts).
  - **M8.3** — Vault calendars import.
  - **M9.4** — Story `.avts` import on the story list.

When a milestone is promoted to a full `milestone.md`, that doc
owns the precise per-slice extension; this table is indicative
only.

### Milestones that may merge or split

- **M3 + M4 might merge** if memory-pipeline implementation reveals
  that the world / plot surfaces are needed mid-correctness-check
  (e.g., human inspection of classifier output is faster than log
  reads). Defer the decision until M3 is authored.
- **M9 might split** if Storybook + per-surface audit + backup +
  ship gate are too much for one milestone. Natural split: M9a
  (Storybook + VI audit) → M9b (backup + ship).

### What this roadmap does not commit to

- Specific slice contracts (interfaces, types, behavioral
  boundaries) — those land in each milestone's authored
  `milestone.md`.
- Slice ordering inside a milestone beyond the gate-then-parallel
  shape sketched here.
- Definition-of-done specifics per milestone — those are also
  milestone-level decisions.
- Calendar / timeline commitments — sequencing only.

### What's intentionally out of v1

Everything in
[`parked.md → Post-v1 confirmed`](../parked.md#post-v1-confirmed)
and
[`parked.md → Parked until signal`](../parked.md#parked-until-signal)
is out of v1 by default. If a roadmap milestone needs an item
currently parked, that item moves to
[`followups.md`](../followups.md) and the milestone's authored
`milestone.md` reflects the inclusion.
