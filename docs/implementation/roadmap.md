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
  [`milestones/`](./milestones/README.md). Defined today: M1 (Spine),
  [M1.5 — Data foundation](./milestones/01b-data-foundation/milestone.md)
  (inserted between M1 and M2; no renumber), and
  [M2 — First user loop](./milestones/02-first-user-loop/milestone.md).
  M1.5 front-loads
  the full relational schema, typed working-set stores, and Tier-1 CRUD
  arms, so the planned milestones below **no longer carry their own
  schema-landing slices** — they consume the M1.5 substrate and build
  feature behavior on top. Three deliberate M1.5 exclusions remain
  downstream work: the vec0 `embeddings` virtual tables (M3.1 — the one
  schema-landing job left in v1), mutators on the config tables
  (stories / branches / app_settings writes, landing with the wizard
  and settings UI), and the `story_entries` delete / content-update
  arms (M2.2).
- **Planned milestones** below are roadmap entries: a one-paragraph
  goal sketch, a likely slice list (titles only, no contracts),
  notes on what gates the milestone and what's intentionally out of
  scope, a parallel-paths sketch, and **slice-authoring notes** —
  parallelism hazards and split candidates recorded here to be
  resolved when the milestone is promoted.
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

Roadmap assumes 2–3 contributors with **one milestone in flight as
the validation focus at a time** (per
[Project · Implementation vocabulary](./conventions.md#hierarchy)).
Each milestone is sized to have at least two parallel slice paths
after an initial gate slice — same shape as M1. With the data layer
front-loaded in M1.5, that gate slice is now per-milestone wiring
(provider, route, contract), not a schema-landing slice; the tables
and CRUD the milestone needs already exist (the narrow exceptions
are named above).

**Bounded cross-milestone look-ahead is allowed.** The M1.5
substrate decouples more work than a strict one-milestone rule
assumes. A slice from a later milestone may start early when both
hold:

- it depends only on the M1.5 substrate plus already-**merged**
  milestones — nothing in flight; and
- the shapes it builds against are frozen spec (data model,
  screen docs), not implementation-discovered behavior.

Read-heavy UI qualifies most often: the DB can be seeded with mock
rows conforming to frozen shapes, so surfaces like the M4 world /
plot panels can be built before their real-data producers exist.
Two costs to weigh per pick: review focus fragments, and
settings / UX surfaces for not-yet-implemented subsystems carry
rework risk where implementation refines the spec (the M7 embedder
tab is the canonical example — it waits for M3.1; the appearance
tab has no such exposure). Look-ahead changes when work _starts_,
not when milestones _close_: a milestone's definition of done still
gates on its prerequisites' real data even where its surfaces were
built early against seeds, and the
[sequencing thesis](#sequencing-thesis) validation order is
unchanged. Milestone authoring (solo-owner work per
[conventions](./conventions.md#authorship)) overlaps the prior
milestone's tail freely.

Standing look-ahead candidates, by in-flight milestone: during M2 —
M3.1 (embedder infra, independent of the M2 loop), M3.6's editor
build (once M2.3's wizard shell merges), M4 read surfaces on seeded
rows, M7's appearance tab and M7.3 diagnostics screen (M1-era
substrate; turn-capture shape extends later); during M4 — M5.1
membership; during M7 — M8.3 vault shell; during M8 — M9.1 and
M9.3.

---

## Planned milestones

### M2 — First user loop

**Promoted** — defined in
[`milestones/02-first-user-loop/`](./milestones/02-first-user-loop/milestone.md)
(milestone + ten slice docs).

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
because UX needs **populated** entity / awareness / happening data
to render against (the tables + stores exist from M1.5; M3 fills them).

**Likely slices.**

- M3.1 — Embedder integration + the hard onboarding gate (story
  creation requires embedder per
  [`memory/model-management.md`](../memory/model-management.md));
  lands the per-type vec0 `embeddings` virtual tables — the one
  schema piece M1.5 deliberately excluded (the sqlite-vec
  extension itself loads since M1.2);
  embedder configuration in app settings;
  `embedding_stale` opportunistic drain worker (makes "retry"
  meaningful after embedder failure per
  [`memory/retrieval.md → Compute lifecycle`](../memory/retrieval.md#compute-lifecycle));
  `embedding_swap_target` two-phase stage-then-flip pipeline +
  crash-recovery resume / cancel prompt on story-open (per
  [`memory/retrieval.md → Model swap UX`](../memory/retrieval.md#model-swap-ux)).
  Adds the Matryoshka effective-dim machinery — `effectiveDim`
  resolution plus truncation + renorm at every embed-write; the
  `matryoshkaSupported` / `matryoshkaDims` capability flags
  already ship in the M1.5 app-settings Zod — per
  [`memory/retrieval.md → Matryoshka effective dim`](../memory/retrieval.md#matryoshka-effective-dim)
  and the top-bar staleness pill + Settings · Memory per-story
  resolution panel per
  [`memory/model-management.md → Staleness UI`](../memory/model-management.md#staleness-ui).
  Embedder management UI extends in M7.1.
- M3.2 — Piggyback layer: inline structured tool calls during
  main generation; scene metadata writes;
  entities + lore + happenings stub creation.
- M3.3 — Periodic classifier: background pipeline; entity
  reconciliation; awareness graph; happenings extraction. Drives the
  `character_relationships` UPSERT-merge / canonical-ordering write
  primitive landed in M1.5 per
  [`data-model.md → Character-to-character relationships`](../data-model.md#character-to-character-relationships).
  Classifier writes `metadata.worldTime` to each new entry —
  first non-zero values flow through the calendar renderer
  shipped in M2.5. Auto-retry policy (30s → 2m → 5m backoff,
  3-strike failed-persistent state per
  [`memory/classifier.md → Auto-retry policy`](../memory/classifier.md#auto-retry-policy))
  - per-branch `classifier_status` persistence (the column landed in
    M1.5; this slice writes lifecycle into it). Sets
    `entities.name_collision_flag` on collision (the column landed in
    M1.5; drives the M4 collision-review surface) per
    [`memory/classifier.md → Disambiguation`](../memory/classifier.md#disambiguation-on-new-character-mentions).
  - Survival-anchor logic (makes the classifier reversible-correct):
    stamps `periodic_classifier` source + per-fact provenance into
    `deltas.entry_id` (the `source` value landed in M1.5); maintains
    `processedThrough` in `classifier_status` plus its reversal clamp;
    and the reversal predicate that refines M2.5's naive suffix sweep
    so a lagging fact about a surviving turn isn't over-reversed, per
    [`data-model.md → Survival anchor`](../data-model.md#survival-anchor).
  - Happening reconcile cascades to the FK-less link tables: deleting
    or merging a happening must also drop / reattach its
    `happening_involvements` and `happening_awareness` rows. The M1.5
    `deleteHappening` arm removes only the `happenings` row, orphaning
    them — cascade lands with whichever consumes it first (this
    reconcile or the M4 Plot delete-flow).
- M3.4 — Retrieval: embedding queries; ranker; budgets;
  context-bundle assembly into the per-turn prompt. Memory pack
  templates extend the Liquid engine to inject retrieved bundles.
  Per-injection `retrieval_count` increment on awareness rows
  (the delta-logged column landed in M1.5; load-bearing for
  chapter-close phase 3d in M5.2 per
  [`memory/chapter-close.md → 3d awareness pin tuning`](../memory/chapter-close.md#3d--awareness-pin-tuning)).
  Drives the `lore.keywords` column (distinct from `lore.tags`; landed
  in M1.5) through the keyword-retrieval pathway per
  [`memory/retrieval.md → Keywords schema`](../memory/retrieval.md#keywords-schema).
  `js-tiktoken` install lands here as the first budget-accounting
  consumer (per [`tech-stack.md`](../tech-stack.md)).
- M3.5 — Minimal developer-only retrieval probe: log / inspect
  retrieval scores during impl. User-facing probe surface
  deferred to M7. Consumes the `probe_captures` table +
  `app_settings.diagnostics.enabled` + `stories.settings.probe_mode_active`
  (all landed in M1.5) and writes the first captures per
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
  Adds the Story Settings · Composer categories editor (consuming
  the shipped `SuggestionCategoriesEditor`) over
  `app_settings.default_suggestion_categories` — the column and
  its seed default landed in the M1.5 gate — plus a
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

**Parallel paths.** Day-one startable: {M3.1} || {M3.2} || {M3.6} —
M3.6's editor build needs only the M1.5 lore / entity layer and
M2.3's wizard shell; the earlier "after M3.2" gate was about the
classifier consuming seeded cast, which is verification, not a
build dependency. M3.3 runs in parallel with M3.4 once M3.2's stub
writes populate retrievable rows (M3.4 also needs M3.1's
embeddings); M3.5 follows M3.4; M3.7 gates on M3.2 + M3.3; M3.8
gates on M3.3; M3.9 gates on M3.3 (needs the survival-anchor
reversal substrate).

**Slice-authoring notes.** M3.3 as sketched exceeds the
days-not-weeks sizing rule. First split to take: the reversal
predicate and `processedThrough` clamp are undo-side code — move
them to M3.9 (which owns undo semantics), leaving M3.3 the
stamp / provenance side, and pin that seam explicitly since both
slices touch the survival anchor. If M3.3 still stretches, its
output processors (entity reconciliation vs awareness /
happenings / cascade) can split against a pinned classifier
structured-output shape.

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
  (for `triggered_at_entry_id` / `resolved_at_entry_id` /
  `occurred_at_entry_id` / `learned_at_entry_id` fields) ships here as
  the first consumer; pattern reused across later entry-ref
  surfaces.
- M4.4 — Story settings real (basic): model overrides + basic
  per-story config — the settings depth users need with real data
  flowing. Deep settings tabs land in M7.
- M4.5 — Reader-composer awareness affordances: peek drawer +
  awareness chips on entries per
  [`reader-composer.md → Peek drawer`](../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters).
  Gates on M3.3 awareness writes.
- M4.6 — Per-row imports: first wiring of the already-built
  `ImportDialog` compound — World / Plot per-row entity / lore /
  thread / happening import per
  [`patterns/import-dialog.md`](../ui/patterns/import-dialog.md);
  adds the per-row `.avts` envelope kinds (`aventuras-entity`,
  `aventuras-lore`, `aventuras-thread`, `aventuras-happening`)
  with kind-narrowed Zod payload schemas per
  [`data-model.md → Aventuras file format`](../data-model.md#aventuras-file-format-avts).
  Implementation prerequisite: `expo-document-picker` +
  `expo-file-system` install and a dev-client rebuild **before
  the slice runs** (web has no native-build step). Pattern reused
  by vault calendar import (M8.3) and story import (M9.4).

**Parallel paths.** {M4.1, M4.2} || {M4.3} || {M4.4} || {M4.5};
M4.6 once the M4.1 / M4.3 shells exist to host the import
affordances.

**Gates.** M3 for real-data validation (no entities without the
classifier; no awareness without it; no retrieval scores without
retrieval). The UI build itself can look ahead against seeded mock
rows — the entity / lore / happening / awareness shapes are frozen
in [`data-model.md`](../data-model.md) — making M4 the strongest
cross-milestone look-ahead candidate (see
[Multi-contributor model](#multi-contributor-model)); surfaces
ready mid-M3 also serve the human-inspection need named in
[Milestones that may merge or split](#milestones-that-may-merge-or-split).
M4's definition of done still requires rendering real classifier
output.

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

- M5.1 — Chapter membership and boundaries (thin gate): assigns
  `story_entries.chapter_id` across closed ranges, detects
  boundaries (token-threshold crossing, auto-close), and lands the
  manual-boundary primitive consumed by M5.4's insert-break. An
  earlier sketch absorbed this into M5.2 as too thin to stand alone
  (the M1.5 chapters slice shipped the full updatable-column
  primitive surface) — reinstated because a thin gate is the
  intended gate-then-parallel milestone shape, and the absorption
  made the close pipeline gate every UI slice in the milestone.
- M5.2 — Chapter-close pipeline: phases 3a–3e, agent invocations,
  delta writes. Chapter-close consolidates `threads` rows that
  M3's classifier wrote sparsely; surface (plot panel threads
  tab) already exists from M4.3. Per-chapter `retrieval_count`
  reset under the chapter-close `action_id` (paired with M3.4's
  per-injection increment). Extends the M1.5 awareness upsert arm
  with an earliest-wins `learned_at_entry_id` merge path — the
  shipped arm keeps-first with no write path to that column
  (forward seam named in the M1.5 happenings slice), and the
  lore-mgmt phase needs it. This is the first real `chainsTo`
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

**Parallel paths.** M5.1 is the gate, and it's thin; then
{M5.2} || {M5.3} || {M5.4} || {M5.5}. M5.3's timeline renders
membership-populated chapters; M5.4's insert-break consumes M5.1's
boundary primitive; M5.5's reverse-replay walks the delta log
regardless of which action wrote the deltas, so it develops against
synthetic close deltas and integration-validates the cascade
warning once M5.2's real close output exists.

**Slice-authoring notes.** M5.3's chapter delete routes through
M5.5's deep-rollback surface — pin that surface's API as a slice
contract so the two parallel slices don't collide.

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
filtering, branch-copy semantics, FK rewriting) so they need the full
data layer in place — present since M1.5, and exercised by the feature
milestones in between. Diff cache is bespoke compute caching;
building it after the rest of the substrate stabilizes avoids
churn.

**Likely slices.**

- M6.1 — Branch-copy at fork time + FK rewriting (the `branches` table,
  incl. `classifier_status`, landed in M1.5; this slice is the fork
  orchestration), including the survival-anchor partition of post-fork
  deltas (copy lagging `periodic_classifier` facts about kept entries
  instead of rewinding them) per
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

**Parallel paths.** {M6.1} || {M6.2} — a
[doc-as-contract](./conventions.md#sequencing-vs-doc-as-contract)
pair: the lineage shape both build against is fixed by the
[branch-copy manifest](../data-model.md#branch-model), so M6.2's
lineage-scoped reads develop against hand-seeded branch rows before
fork orchestration exists. {M6.3, M6.4, M6.5} parallel once branch
reads work; M6.6 follows M6.1.

**Slice-authoring notes.** M6.1 and M6.6 share a copy-core — either
M6.1 owns it and M6.6 sequences after, or authoring extracts the
core as a pinned contract and M6.6 parallelizes too.

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
  block + `assignments` key removal + `providers[].length ≥ 1`
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
  with the calendar tab's era-flips list (the `branch_era_flips`
  table + CRUD landed in M1.5). Any flow here that batches multiple
  `at_worldtime` updates into one action must handle the
  non-`DEFERRABLE` `uniqueIndex(branch_id, at_worldtime)` (migration
  `0003`): batched reverse-replay can transiently violate uniqueness
  mid-undo even when the final state is valid, so it needs
  deferred-constraint handling or per-row sequencing (single-action
  writes today are collision-free). Memory tab adds the classifier
  panel
  (cadence in-place
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
  Seeds `app_settings.ui_language` from the OS locale on first launch:
  the config schema ships a static `'en'` fallback, and the
  data-model's "OS locale on first launch" behavior is this
  boot/onboarding seed (not a schema default).
- M7.5 — Memory probe (rich, user-facing) per
  [`docs/ui/screens/memory-probe/memory-probe.md`](../ui/screens/memory-probe/memory-probe.md).
  Pairs with diagnostics as the transparency / tuning surface
  group.
- M7.6 — App-settings auxiliary surfaces (provider-detection
  override UX, full-backup AlertDialog with key-leak
  acknowledgment).

**Parallel paths.** Sketch: {M7.1, M7.2, M7.3, M7.4, M7.5} nearly
independent; M7.6 finishes once M7.1 is in.

**Slice-authoring notes.** M7.1 as sketched is several weeks of
work — split it per tab (sizing rule: days, not weeks), which also
load-balances the milestone. The per-tab slices have different true
gates: appearance and data tabs need nothing newer than
foundations; the providers tab needs M2.1's config mutators and
capability detection; the models tab needs M3.7's suggestion slot;
the embedder tab needs M3.1. The first tab slice owns the settings
shell; the rest consume it. The data tab's backup / restore actions
front-run the M9.3 backup pipeline — pin the invocation seam or
ship those actions stubbed. The spec-stable tabs (appearance, data
chrome) plus M7.3's diagnostics screen are look-ahead candidates
long before M7 opens (see
[Multi-contributor model](#multi-contributor-model)); the embedder
tab is the canonical _don't_ — M3.1's implementation will refine
its spec.

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
  display-translation lookup against the M1.5 substrate — the
  `translations` table, its CRUD arms, and the indexed store with
  its synchronous `getTranslation` selector all landed in the
  M1.5 content slice; the reactive subscription was explicitly
  deferred to M8 and lands in M8.2.
  `translation-retry` pipeline declaration (separate v1 pipeline
  kind with `hard-gate` concurrency per
  [`generation-pipeline.md → V1 declarations`](../generation-pipeline.md#v1-declarations))
  lands alongside.
- M8.2 — Translation UI: the reactive `useTranslation`
  subscription over the M1.5 store (render reactivity was scoped
  out of the content slice to land with this display-translation
  reader), language picker in story settings,
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

**Parallel paths.** {M8.1} || {M8.2-bulk} || {M8.3} — M8.2's
reactive `useTranslation` subscription and language picker sit over
the M1.5 store and story settings, not the pipeline; only its
miss-toast and sticky retry pill (which invoke `translation-retry`)
wait on M8.1. M8.4 follows M8.1, parallel with M8.3.

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
  the `ImportDialog` compound, built in foundations and first
  wired at M4.6); cross-version
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

**Parallel paths.** {M9.1} || {M9.2} || {M9.3, M9.4} || {M9.5};
M9.6 gates on all. M9.3 → M9.4 stays sequenced: the packaging-shape
sub-design pass in M9.3 decides asset handling the `.avts` envelope
inherits.

**Slice-authoring notes.** M9.2 shards naturally per screen-group —
author it as 2–3 slices so the audit spreads across contributors
instead of serializing on one.

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
    picker into the registry). The pointer ships nullable (null at
    first init); whether to seed a built-in default here versus
    require an explicit pick is an open M7.1 decision.
  - **M7.2** — Story settings calendar tab deep: picker + summary
    - era-flips list + swap-warning UX (the `branch_era_flips` table +
      CRUD landed in M1.5).
  - **M8.3** — `vault_calendars` CRUD + vault calendar editor (the
    table landed in M1.5; its `CalendarSystem` Zod ships with
    `lib/calendar`); registry init extends to merge bundled +
    `vault_calendars` rows.
- **Pack-template / Liquid engine**
  ([`architecture.md → Prompt templates`](../architecture.md#prompt-templates-and-authoring)).
  - **M2.6** — Engine lands: minimal Liquid runtime + macro
    resolver + variable binding, the bundled pack, the
    include-compatibility validator. First renders: the wizard's
    opening generation (M2.3) and the per-turn pipeline call
    (M2.7).
  - **M3.4** — Memory templates extend the engine to inject
    retrieved bundles (entities / lore / happenings) into
    rendered context.
  - **M5.2** — Chapter-close templates render against
    chapter-scoped context.
  - **M7.2** — Pack tab in story settings edits live packs
    (runtime validation surface partial — full pack-format editor
    parked post-v1 per
    [`parked.md`](../parked.md#prompt-pack-editor-desktop-spec--mobile-retrofit)).
    Live packs are the first user-authored macros, so the
    include-compatibility validator must extend here: it scans
    template sources only, leaving macro→macro includes
    (transitive group mismatch, macro-sourced missing-macro refs)
    unchecked — inert while the pack is bundled-only and immutable,
    a real gap once packs are editable. Pack selection also lands
    here as a separate render argument, never encoded in the template
    id (a closed static union — see
    [`architecture.md`](../architecture.md#template-and-macro-id-space)).
- **Observability sinks beyond the logger**
  ([`observability.md`](../observability.md)).
  - **M1.3 / M1.4 / M1.5a** — `logger`, `httpCallSink` (fully
    implemented with value-matching header redaction at sink
    boundary against `app_settings.providers` known keys; no
    denylist), `turnCaptureSink` land and accept their first
    emissions during the stub-LLM smoke. Redaction vitest suite
    (raw / prefixed / query-string / short-key cases) lands with
    the sink in M1.4.
  - **M2.1 / M2.7** — Real OAI-compat provider HTTP traffic flows
    through `httpCallSink` (extends the M1.4 redaction suite with
    OAI-compat scenarios); real per-turn captures populate via
    `turnCaptureSink`.
  - **M3 / M5** — Per-pipeline-kind turn-capture shape extends
    for memory + chapter-close pipelines (classifier / retrieval
    / chapter-close phases each contribute capture content). Each
    capture carries the `kind` + `anchorEntryId` turn-grouping
    stamp per
    [`observability.md → turnCaptureSink`](../observability.md#turncapturesink),
    set generically by the orchestrator.
  - **M7.1 / M7.3** — Settings-side controls land in M7.1's
    diagnostics tab (master + `debug_level_enabled` toggles,
    Actions-menu `Open Diagnostics Hub` entry) per
    [`observability.md → UI placement`](../observability.md#ui-placement);
    diagnostics screen consumes `logEntries`, `httpCallSink`
    history, run timeline in M7.3, and the per-turn inspector
    consumes `turnCaptures` grouped by turn.
  - **M7.5** — Memory probe consumes its own entry-keyed
    `probe_captures` (per [`probe.md`](../memory/probe.md)), **not**
    `turnCaptureSink` — the turn-grouped per-turn inspector that
    consumes `turnCaptureSink` is the M7.3 Diagnostics Hub surface.
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
  ([exploration record](../explorations/2026-05-26-import-dialog.md));
  the compound itself is already built (foundations, with
  stories). Consumers wire it:
  - **M4.6** — First consumer: World / Plot per-row entity / lore /
    thread / happening import, the per-row `.avts` envelope kinds,
    and the `expo-document-picker` + `expo-file-system` install
    with its dev-client rebuild prerequisite (details in the M4.6
    slice entry).
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
