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
  (inserted between M1 and M2; no renumber),
  [M2 — First user loop](./milestones/02-first-user-loop/milestone.md),
  and [M3 — Memory floor](./milestones/03-memory-floor/milestone.md).
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

**Promoted** — defined in
[`milestones/03-memory-floor/`](./milestones/03-memory-floor/milestone.md)
(milestone + fourteen slice docs).

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

Carried deferrals, routed out of [`triage.md`](./triage.md)
2026-08-18 and 2026-08-20, verified against the code first. The
swap-prompt item is placed provisionally: it names only "a future
reader/settings slice", and story-open is not owned by any M4 slice as
sketched.

- **M4.4 — "Upgrade to current default" story-open prompt deferred from 3.1b.**
  Canon ([`retrieval.md → Model swap UX`](../memory/retrieval.md#model-swap-ux))
  names a second dialog entry point: a prompt when opening a story whose
  embedding model differs from the current app default; accepting it fires
  the swap dialog. Slice 3.1b shipped only the Story Settings entry point
  (planning decision 2026-07-24) — the prompt needs its own "stops nagging
  until the next manual swap attempt" persistence decision. Owner: a future
  reader/settings slice. Surfaced by M3.1b Task 14 (2026-07-24).
- **M4.4 — The phone list state hides a dirty save bar.** `StorySettingsShell`
  renders the bar inside the detail pane, and `MasterDetailLayout`
  drops that pane on phone when no tab is selected. No data loss —
  panels stay mounted, and `←` and window-close both route through
  the guard — but the unsaved state is invisible. Canon argues
  against the obvious fix:
  [`save-sessions.md → Save bar`](../ui/patterns/save-sessions.md#save-bar--the-visible-ui)
  says the bar "spans the editable pane only — never the rail," and
  [`story-settings.md → Mobile expression`](../ui/screens/story-settings/story-settings.md#mobile-expression)
  puts it at "the bottom edge of the detail-route's scroll region."
  Accepted at M3.7b planning; the call belongs to M4.4, the surface's
  real owner. Surfaced by M3.7b implementation (2026-07-31).
- **M4.4 — M2.5's composer modes are unreachable on every real story.**
  `composerModesEnabled` defaults to `false` in
  `lib/db/stories/story-settings-defaults.ts`, and app-level
  `defaultStorySettings` carries only `activePackId`, so no story is
  ever created with it on and no UI can flip it — the same
  dead-feature shape M3.7b just fixed for `suggestionsEnabled`. Canon
  puts its toggle and wrap-POV in the same Authoring aids grouping
  M3.7b's section lives in, so M4.4 completing that grouping is the
  natural owner. Surfaced by M3.7b implementation (2026-07-31).
- **M4.2 — The wizard commits `parent_location_id` without the documented
  cycle guard.**
  [`data-model.md → LocationState shape`](../data-model.md#locationstate-shape)
  assigns cycle prevention to the action-layer mutator that writes
  the field: walk the proposed parent chain, depth-cap 100, reject
  with `reason: 'parent-cycle'`. Finish is such a writer and does no
  walk, and neither authoring path blocks it — the editor's picker
  and `cast-import.ts` each exclude only self, so `A → B` plus
  `B → A` authors and commits cleanly. Inert today: nothing walks the
  chain, and the only reader canon names is M4's prompt rendering
  (`Aria is in [Shop in Town Square in City]`). Close by adopting M4's
  shared guard rather than writing a wizard-local copy of it. Raised
  2026-08-14.
- **M4.2 — The first delete surface has to sweep the row's vectors.**
  `deleteVecOps` (`lib/db/embeddings/ops.ts`) exists and is exported
  through both barrels, but has **no production caller**, and there are
  no SQL triggers in `lib/db/migrations/`, so nothing else reaches the
  vec tables per row. Story delete is already covered — it calls the
  branch-scoped `deleteBranchVecOps` — and `deleteEntity`, `deleteLore`,
  `deleteHappening` and `deleteChapter` have no production caller yet, so
  nothing leaks today; the leak starts with the first delete button.
  Whichever slice ships that button owns wiring the four handlers, and it
  is not only the delete arm: reverse-replay restores the row and
  Slice 3.12a already forces it dirty so the drain re-embeds it, but
  `applyRedo` re-applies the delete and would need to re-sweep. Retrieval
  never serves orphans — its candidate pools are built from source rows —
  so this is unbounded dead weight that survives an embedder swap, not
  wrong results. Surfaced by Slice 3.12a review (2026-08-19), verified and
  routed 2026-08-20.
- **M4.5 — Custody of a failed turn's text rests on one deletable system entry.**
  A failed or refused turn reverse-replays its own `user_action` with the
  rest of its action group (`abortRun` → `reverseReplayDeltas`, and
  `submitTurn`'s own rejected arm), so the text the user typed survives
  only as `metadata.systemFailure.submission` on the failure entry that
  replaces it — pinned by `submit-turn.test.ts`'s
  `expect(branchEntries('b1')).toHaveLength(0)`. Two paths then delete
  that entry with no restore: **Dismiss** (`dismissSystemEntry` is a bare
  `clearSystemEntry` plus `reload`, and dismissing an error is not a
  request to discard the draft behind it), and the pre-dispatch tail clear
  (fixed for regenerate's rejected arm in M3.10, still uncompensated when
  the dispatch throws). In-session `lastSubmission` masks both; after a
  restart the text is gone. The alternative shape to weigh: keep the
  `user_action` standing on failure and let Retry re-dispatch against it —
  which is exactly what regenerate already does — so only an explicit
  cancel reverses it, returning the text to the composer. That would make
  the failure entry a pure notice with no custody role and delete this
  class of bug rather than patching its instances. Wants a reader-composer
  design pass, not a local fix. Raised 2026-08-16.

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
  Slice-authoring note: the reader's regenerate confirm resolves its
  cascade counts when the modal opens and never re-resolves them
  (M3.10). No M3 writer can widen the window while the modal sits
  open, but a background chapter close can — so this slice must
  re-derive the counts under the branch queue at confirm time, or
  invalidate an open modal when a close lands.
  Slice-authoring note: `orchestrator.handleEvent` stamps
  `turnCaptureSink.recordTargetEntry` on **any** `createStoryEntry`
  delta with per-turn anchor semantics — correct while `per-turn`
  is the only registered kind, but chapter-close also emits
  `createStoryEntry` deltas, so this slice must gate the stamping
  on `run.kind === 'per-turn'` (or "beginTurn set no anchor") or
  its runs mis-stamp their anchors (surfaced by Slice 2.7).
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

Carried deferrals, routed out of
[`followups.md`](../followups.md) 2026-08-18, verified against the
code first. The four token-progress entries are one work item: a
DB-backed `openRegionTokens` resolves all of them.

- **M5.1 — `metadata.tokens.completion` is the wrong measure for the chapter
  threshold, on four independent counts.** M5 needs
  `openRegionTokens(branchId)` as a DB read
  ([`generation-pipeline.md → chainsTo on predecessor`](../generation-pipeline.md#chainsto-on-predecessor)),
  and `story_entries.metadata.tokens` already looks like the answer.
  It is not. (1) **Stale on edit** — `updateStoryEntryContent`
  (`lib/actions/story-entries/operational.ts:45`) sets only `{ content }`,
  so the count survives a rewrite unchanged. (2) **Wrong text even when
  fresh** — it is provider `usage.outputTokens`
  (`lib/pipeline/definitions/per-turn.ts:256`), counting everything the
  model emitted, including the state block stripped before persist; the
  world-state-block work under [UX](../followups.md#ux) widens that gap deliberately. (3) **Wrong tokenizer** — provider-side, whichever
  one that provider uses, while `chapterTokenThreshold` and the
  token-progress strip measure in o200k via `countTokens`. A story that
  switches providers mid-run would sum two incompatible token scales.
  (4) **AI entries only** — `usage` exists only on a generation call, so
  `user_action` rows carry no count at all, and they are part of the open
  region (`kind !== 'system'`). A SUM over `completion` undercounts by
  every user turn. The decision is therefore a **new field, not a
  rename**: `tokens.{prompt, completion, reasoning}` is a coherent
  provider-usage triple worth keeping for cost provenance, and
  repurposing one leg of it to mean "o200k count of the stored content"
  makes the other two incoherent. Open sub-questions: a real
  `story_entries` column (SUM-able and indexable, which a JSON field is
  not — and M5's trigger reads this per turn) versus another metadata
  key; which write paths must maintain it (generation, edit, prose
  reversal, system entries, import/seed); backfill for existing rows;
  whether a translated story counts the original or the translation
  (the original feeds the prompt buffer, so presumably that); and which
  number the entry card shows now that "reply tokens" and "content
  tokens" diverge
  ([`entry-card.md`](../ui/patterns/entry-card.md#reasoning-expansion)).
  Sits with the three token-progress-strip entries below, which the same
  change would resolve. Surfaced by review discussion (2026-08-06).
- **M5.1 — The token-progress strip reads a 50-entry window, so it cannot
  reach its own threshold.** `useOpenRegionTokens` sums the open region
  out of `entriesStore`, which holds a trailing `ENTRIES_WINDOW_SIZE`
  (50) slice rather than the branch. Measured: 50 entries at realistic
  length is **37.7%** of the default 24 000 `chapterTokenThreshold`, and
  reaching 100% would need ~132 entries. Once the open region exceeds 50
  — the normal state, since nothing closes a chapter before M5 — the
  strip reports a fraction of the truth and reads "plenty of room" while
  chapter-close is overdue. `generation-pipeline.md → Chapter close`
  sketches `openRegionTokens(branchId)` reading from the **DB**, so the
  two will diverge the moment M5 wires the real trigger. The strip is
  still better than the hardcoded `0` it replaced; the number is not
  trustworthy. Surfaced by M3.4 Task 19 (2026-08-02).
- **M5.1 — The same strip is non-monotonic across a reload.** `entriesStore`
  grows within a session (`patch` never evicts) but `reload()`
  re-hydrates to the trailing 50, discarding paged-in older rows.
  `reload()` fires on turn failure, on submit-with-system-tail, and on
  system-entry dismissal — so **dismissing a system entry visibly
  shrinks the progress strip**, as does restarting the app. Same story,
  same open region, different number. Follows from the entry above and
  is fixed by the same change. Surfaced by M3.4 Task 19 (2026-08-02).
- **M5.1 — `countEntryTokens` now runs on the reader's first render, adding a
  synchronous tiktoken encoder build before first paint.** It had zero
  production callers before M3.4 Task 19 — `countTokens` was reached
  only through the ranker, inside the async per-turn retrieval phase.
  The BPE map build measured **116ms** on desktop under Node
  (`lib/retrieval/tokens.ts` documents ~135ms) and will be worse on
  Android. If story-open shows a hitch, this is it, and the fix is to
  warm the encoder during story open rather than to change the hook.
  **Unmeasured on device.** Surfaced by M3.4 Task 19 (2026-08-02).
- **M5.1 — `countEntryTokens`' memo is never pruned.** `lib/retrieval/tokens.ts`
  keys an unbounded module-level `Map` on entry id and holds it for the
  process lifetime, across deletes, rollbacks, branch switches and story
  switches; `__resetTokenCache` has no production caller. Deleting an
  entry and later reinstating that id — reverse-replay of a delete
  re-inserts with the original id — resurrects a memo entry written
  before the deletion. The content check on read bounds the damage to a
  stale-content miss rather than a wrong count, so this is a leak rather
  than a defect today, but it is precisely the shape
  [lessons-learned → No "harmless" id leaks](./lessons-learned/no-harmless-id-leaks.md)
  records. Surfaced by the M3.4 whole-slice review (2026-08-03).

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

Carried deferrals, routed out of [`triage.md`](./triage.md)
2026-08-18, verified against the code first. Resolve with the slice
each names.

- **M6.1 — The fork-exclusion guard is structural and goes stale the moment
  fork lands.** Branch fork is unimplemented (M6.1), so Slice 3.5 could
  not test the real behavior: `lib/probe/fork.test.ts` instead
  source-scans `lib/**` for `probe_captures` references outside an
  audited list, plus a direct query assertion that a sibling branch
  stays empty. Neither catches the regression most likely to actually
  happen — if M6.1 copies branches **generically** (iterating a manifest
  or introspecting branch-scoped tables from the schema), the fork code
  will never contain the literal `probe_captures`, the scan stays green,
  and captures copy anyway. The manifest row now exists in
  [`data-model.md → Branch model`](../data-model.md#branch-model), so
  a generic copier has a canonical exclusion to read. **When M6.1 lands
  branch fork, replace the structural scan with the both-sides
  behavioral test** the slice AC originally described. Surfaced by the
  Slice 3.5 Task 14 review (2026-08-09).

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
load-balances the milestone. The appearance tab exposes
`appearance.showJumpToBottom` (landed DB-only post-M2; the reader
already consumes it). The per-tab slices have different true
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

Carried deferrals, routed out of [`triage.md`](./triage.md)
2026-08-18 and 2026-08-20. Each was verified against the code before it
moved; resolve with the slice it names.

- **M7.3 — Electron main has no unhandled-rejection handler.**
  Slice 3.12a installed one in the renderer (`lib/boot/rejection-handler.ts`),
  but `electron/main.ts` registers no `process.on('unhandledRejection')` —
  and main is where SQLite and the local embedder actually run, so a
  rejection escaping a `db:transaction` or `embedder:embed` handler is
  invisible on the process that owns the data. Not a renderer fix: main
  has no access to the renderer's diagnostics store, so the entry has to
  travel over IPC.
  [`observability.md → Cross-platform`](../observability.md#cross-platform)
  already anticipates a main-process emit path, which is where the design
  should start. Surfaced by Slice 3.12a review (2026-08-19), routed
  2026-08-20.
- **M7.1 — Every future model-removal path must evict the native session cache.**
  `lib/embedder/local/runtime.native.ts` holds a lazy `bundles`
  `Map<modelId, SessionBundle>`; a removed then re-downloaded model reuses
  its dir, so without eviction the cache keeps serving inferences from the
  deleted model — and the resulting vectors land tagged with the _new_
  model id, so nothing marks them for re-embedding. The hook now exists
  (`evictBundle`) and is wired into the native driver's `deletePartial`,
  mirroring desktop's `evictPipeline`; what remains is that the M7.1
  model-remove flow, and any other future deletion path, must call it too.
  Nothing enforces that mechanically. Surfaced by M3.1a implementation
  (2026-07-20), partially resolved during M3.1a review (2026-07-21).
- **M7.1 — Custom-import file set may need `config.json` on desktop.**
  [`model-management.md → Custom file import`](../memory/model-management.md#custom-file-import)
  specifies three files (`model.onnx`, `tokenizer.json`,
  `tokenizer_config.json`), but M3.1a found transformers.js fatally
  requires `config.json` to build a pipeline, which is why the curated
  catalog entries carry it. The native runtime constructs its tokenizer
  directly and does its own pooling, so it may not need the file at all —
  making the required set platform-dependent, which the custom-import
  spec doesn't model. Resolve when M7.1 plans the import flow; verify the
  native requirement rather than assuming symmetry. Surfaced by M3.1a
  device review (2026-07-21).
- **M7.1 — A local model whose files are gone still resolves as healthy.**
  `resolveEmbedderConfig` validates a local backend by looking the model id
  up in the bundled catalog (`localModelDim`); it never checks that the
  model's directory exists. So a model removed from disk resolves `ok`, is
  offered as a swap candidate, and produces no reason line — the Memory
  panel's `modelMissing` reason only fires for an id absent from the
  _catalog_, which is the one shape a real removal never produces.
  [`model-management.md → Removal`](../memory/model-management.md#removal)
  expects the panel to explain "model missing"; today the failure surfaces
  only per-embed, as a generic `That didn't work` toast with the cause in
  a `logger.error` the user cannot see. Wants a files-exist check in the
  resolution path (or an `installed`-set intersection at the panel), which
  also gates the swap picker from offering an uninstallable target. Owner
  is plausibly the M7.1 removal flow, but the gap is live now, since the
  directory can vanish without going through any app flow. Surfaced by
  M3.1b manual smoke (2026-07-25).
- **M7.1 — The swap resume dialog can trap the user when the target cannot
  embed.** A staging failure leaves the marker set — `runStagingSwap`
  reaches `refreshStores` only on success — so the story-open resume
  prompt fires correctly. But the dialog is non-dismissible and its
  primary action re-runs the identical embed, so when the target model is
  the reason staging failed (files removed, provider unreachable), Resume
  can never succeed and each attempt reports only the generic
  `actionFailed` toast. The escape exists and is correct — `Cancel switch`
  never embeds, so it clears the marker and re-flags rows — but nothing in
  the copy distinguishes "retry a transient failure" from "this target is
  unusable, abandon it", and the failure reason is never surfaced.
  Confirmed by hand on desktop (2026-07-25): resume → generic toast →
  dialog persists. Wants the dialog to carry the last failure reason, or
  Resume to pre-flight the target's resolvability and steer to Cancel when
  it can't be met. Pairs with the files-exist gap above — a resolvability
  pre-flight fixes both surfaces at once. Surfaced by M3.1b manual smoke
  (2026-07-25).
- **M7.1 — Native-dim-dependent M7 validation remains.** M3.1b now persists a
  provider model's successful native probe as `embeddingDim` and threads
  it through production config resolution. The wizard still does not bound
  Custom by that value; an over-declared dim can therefore make its storage
  preview overpromise even though the service clamps to native. The local
  side also still needs a dim source for future custom imports:
  `InstalledModelInfo` carries only `id` and `sizeBytes`, so a non-catalog
  model cannot be tested. M7 owns both UI-facing gaps. The original provider
  persistence defect was surfaced by M3.1b manual smoke (2026-07-25) and
  resolved by the 2026-07-28 review followup.
- **M7.1 — Matryoshka support is not detectable, so M7 should let the user
  assert it.** No OpenAI-compatible endpoint advertises MRL training, and
  the obvious probe is a false-positive machine: sending `dimensions: N`
  and getting N floats back proves only that the _server_ honoured the
  parameter, which a naive slice of a non-MRL model satisfies identically
  while returning quality-destroyed vectors. The property that actually
  distinguishes MRL is rank preservation under truncation, which is
  measurable — embed a fixed probe set at native and at candidate dims,
  then rank-correlate the pairwise-similarity matrices — but it yields a
  statistical result against a judgment threshold, not a boolean, and a
  wrong answer degrades retrieval silently. So the contract stays capability
  flag plus user assertion (matching the relabel disclaimer this slice
  already ships), with **manual override as the primary path**: an advanced
  user who knows a model is Matryoshka-trained enables the flag and fills in
  the dims directly. A rank-preservation sweep, if built, belongs beside that
  control as evidence shown to the user rather than a gate that decides for
  them — and the sweep is also how the curated ladder's rungs would be found
  rather than assumed. Deferred to **M7** (developer decision 2026-07-25):
  the override needs the model-capability editing surface to host it, and
  most users will never touch the feature. Note for whoever builds it:
  `dimLadder`'s hardcoded `[512, 1024, 2048]` fallback becomes wrong under
  a user-assertion model, since enabling the flag would always come with
  user-supplied dims — the fallback currently fabricates rungs nobody
  asserted, and can offer dims above the model's native size. Surfaced by
  M3.1b manual smoke (2026-07-25).
- **M7.1 — Tighten the unprobed-dim escape hatches once M7 makes probing
  mandatory.** `validateCustomDim` skips its `above-native` check and
  `clampEffectiveDim` returns the value untouched whenever the model's
  native dim is unknown (`components/wizard/memory-cost-logic.ts`),
  both deliberately — rejecting on a ceiling nobody has measured would
  block valid picks. The cost is one representable cell: an unprobed
  provider with `effectiveDim` above native. There the pass reads the
  dim family named by `effectiveDim` while the embed service clamps
  the vectors it writes to the native dim, so the sync commits one
  family and clears the flags before the query embed refuses on the
  mismatch. The story has no in-app recovery — no post-creation
  `effectiveDim` editor exists, and a swap reuses the locked dim. M7
  is slated to force a probe before a model is selectable, which
  removes the cell; when it lands, both permissive branches should go
  with it rather than being left as a latent re-opening. Surfaced by
  the M3.4 review (2026-08-07).
- **M7.5 — `RankAllInput` carries no `capturedTokens`, so a whole-bundle probe
  replay is impossible.** `rankPerType` takes it; `rankAll` does not,
  and object-literal excess-property checking rejects passing it
  through. Slice 3.5's parity test replays per type, so nothing is
  blocked today — but this is deliberate-by-omission rather than
  designed, and an M7.5 simulator that wants to re-run a whole captured
  pass at once will need `RankAllInput` widened. Surfaced by the Slice
  3.5 Task 2 review (2026-08-08).
- **M7.3 — A non-embedder retrieval fault writes no capture, which is the
  case the probe most wants.** `runRetrieval` converts only
  `VectorInvariantError` into a captured failure and rethrows
  everything else — correctly, since routing a SQL fault to the
  "Switch embedder" surface would offer a re-index as the fix for a
  locked database. But the rethrow escapes `retrievalPhase` before the
  capture site, so a vec0/SQLite error, a dead IPC bridge or a ranker
  bug produces no capture at all. `failure_reason` is an
  `EmbedderErrorKind`, and `lib/embedder/types.ts` deliberately ties
  that union to the IPC envelope's own tag, so a third tier cannot be
  added to one side only — closing this needs a **capture-failure
  taxonomy separate from the embedder's**, threaded through
  `RetrievalPartial`, plus a capture-then-rethrow in the phase.
  `probe.md` was narrowed to state the gap rather than promise the
  behavior. Surfaced by the Slice 3.5 review (2026-08-09).
- **M7.5 — The classifier's tuning signal is `unresolvedRefs`, not
  `window_head_fallback`.**
  [Slice 3.3](./milestones/03-memory-floor/slices/03-classifier.md) called
  head-fallback warnings dominating the log the trigger for the M7.5 prompt
  tuning pass. The first real-provider run says otherwise: against a local
  4B-class Q4 model the pass logged 7 and 19 `classifier.unresolved_refs`
  against a single `classifier.window_head_fallback`. The model invents its
  own handles rather than reusing the `[c1]` placeholders the prompt hands
  it, so the refs it emits point at nothing. These are refs to entities that
  already exist, so the reserved `new:` namespace does not cover them.
  Consequence: the graph gains happenings with sound titles, descriptions
  and resolved `occurredAtTurn` anchors, but almost no edges — involvements
  and awareness are what get dropped. **Caveat: two runs, one model.** Enough
  to redirect what M7.5 measures, not to set a threshold — and small-model
  placeholder compliance may not generalise to the frontier models the
  tuning pass will target. Route into the M7.5 slice's Open questions once
  that milestone is authored; it has no owner today. Surfaced by the Slice
  3.3 real-provider smoke (2026-07-31), reproducible via
  `e2e/tests/classifier-real-provider.smoke.spec.ts`.
- **M7.1 — A profile's `structuredOutput: 'force-on'` never reaches the
  provider.** Routed from the Slice 3.12 split (2026-08-19). The flag
  round-trips through the DB but has no UI, and `createProviderModel`
  (`lib/ai/providers.ts`) takes no profile at all, so
  `supportsStructuredOutputs` is never set — while the generate path
  skips prompt-schema injection under force-on, so a forced structured
  call sends a bare `json_object` response format with no schema
  anywhere. Today reachable only by hand-editing SQLite; it becomes a
  footgun labelled "force on" the moment M7.1's profile editor ships,
  which is why it lands with that editor. Wiring: thread the resolved
  profile into provider creation, capability-gate on `json_schema`
  support, and convert the structured schemas' optional fields to
  nullable (the classifier's `currentLocation?` / `summary?` at
  minimum — that conversion also changes what the auto path accepts,
  so it needs its own care). `e2e/tests/structured-force-on.spec.ts`
  pins current behavior and flags the change. Surfaced by the M3 E2E
  harness work (2026-07-24); verified 2026-08-19.
- **M7.1 — The blocking embed path has no per-request token budget.**
  Routed from the Slice 3.12 split (2026-08-19), which keeps the cheap
  halves (a `maxParallelCalls` cap, chunking the local backend) in
  Slice 3.12a. What remains: provider chunks split at 2048 rows with
  no token bound, so a batch of long rows can 413 — and because the
  sync stage is blocking by design, that fails the turn outright. A
  real budget needs a per-provider token limit no settings surface
  carries, which makes M7.1's providers tab the owner; the estimator
  is free (`countTokens` exists) but sits across a lint-enforced
  module boundary from `lib/embedder`, so it needs relocating or
  re-exporting. Surfaced by M3.4 Task 12 review (2026-08-02);
  narrowed 2026-08-19.
- **M7.2 — `validateRegistry` cannot catch a template using an
  undeclared variable.** Routed from the Slice 3.12 split
  (2026-08-19). It validates template ids and display groups but
  never reads template Liquid source, so the direction that matters
  for prompt correctness is unchecked: an undeclared variable renders
  blank at runtime and passes every test
  (`templateContextMap.test.ts` documents the gap). M7.2's pack tab
  gates on this validator, which makes it the owner. Closing it needs
  scope tracking (`for` / `assign` / `capture` bind loop-locals a
  naive root-identifier check would flag), include-graph resolution
  (`lib/prompts/validate-includes.ts` already parses the include
  graph, so the substrate exists), and a filter allow-list. Surfaced
  by the Slice 3.6a Task 9b review (2026-08-10); sized 2026-08-19.
- **M7.2 — Nothing implements the window-level accounting canon
  describes.** Routed from the Slice 3.12 split (2026-08-19).
  [`retrieval.md → Structural floor takes budget first`](../memory/retrieval.md#structural-floor-takes-budget-first)
  wants floor-then-reservation-then-budgets over a tracked context
  window; verified absent on all three counts — no window figure
  exists anywhere (model profiles carry no input-window field), no
  prompt-overhead reservation exists (`promptBufferTokens` is
  computed only for probe captures), and the budget sliders the
  original entry described do not ship at all (the Memory tab's
  retrieval-budgets section is unbuilt). Everyone runs on the
  conservative 5,500-token defaults, so the failure mode — budgets
  with no relationship to the model's window overflowing the prompt —
  arrives with the budget editor, which is why this lands with
  M7.2's Memory tab rather than sooner. It is also an ordering
  problem, not just arithmetic: retrieval runs before the prompt is
  assembled, so overhead has to be estimated ahead of assembly or a
  pre-pass has to render the scaffolding; and changing what budgets
  mean moves Slice 3.5's parity test, since captures echo the
  pre-derivation values. Surfaced by M3.4 Task 17 review
  (2026-08-02); verified 2026-08-19.

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

Carried deferrals, routed out of [`triage.md`](./triage.md)
2026-08-18, verified against the code first. Resolve with the slice
each names.

- **M8.1 — `abortRun` reverse-replays every delta under a run's `actionId`,
  which would reverse a `suggestion-refresh` run's already-committed
  stage-1 emission.**
  [`reader-composer.md → Next-turn suggestions`](../ui/screens/reader-composer/reader-composer.md#next-turn-suggestions)'s
  "Re-roll cancel during translation stage" edge case states that on a
  translation-stage cancel "the stage-1 emission has already
  committed" — but `abortRun` (`lib/pipeline/runtime/orchestrator.ts`)
  doesn't distinguish committed-and-chained-forward deltas from
  in-flight ones; it reverses everything tagged with the run's
  `actionId`. Unobservable today because `suggestionTranslationPhase`
  (`lib/pipeline/definitions/suggestion-refresh.ts`) is a synchronous
  no-op — there's no window between stage 1 committing and stage 2
  finishing for a cancel to land in. Becomes real once the M8.1
  translation call replaces that no-op. Surfaced by M3.7a Task 7
  (2026-07-25).
- **M8.3 — `getCalendar` consults only code builtins, never the
  `vault_calendars` table.** The seeded story sets `calendarSystemId:
'cal_default'` and a matching `vault_calendars` row exists, but the
  registry holds only `earth-gregorian`, so every story falls through
  to the default and renders Gregorian dates regardless of the
  calendar it was configured with. Slice 3.8 relies on that fallback
  being load-bearing and correct, so nothing is broken today — but it
  means the registry-hit path is unexercised by seed data and a
  user-authored calendar would be silently ignored once the vault can
  hold one. Decide whether resolution is meant to be registry-only,
  DB-backed, or registry-with-DB-overlay. Raised 2026-08-15 by the
  Slice 3.8 Task 6 implementation. Extended by the Slice 3.12 split
  (2026-08-19): the fallback now backs a **write path**, not just
  rendering — the world-time edit form's tiers and inverse conversion
  come from the fallback calendar, so on a non-builtin id a user
  edits Minute/Second fields the story's calendar does not have and
  Gregorian-rollover seconds are written into `metadata.worldTime`,
  silently re-meaning if the real calendar ever resolves. Two facts
  for whoever picks it up: only seeded data can produce a non-builtin
  id today (the wizard offers builtins only), and DB-backing is not a
  lookup change — the seeded `cal_default` definition does not match
  `calendarSystemSchema`, so the persisted shape has to be designed
  first, and every registry consumer is synchronous (two `useMemo`s
  and the wizard), so an async or store-backed registry ripples. The
  reader-versus-prompt disagreement half was fixed in
  [Slice 3.12a](./milestones/03-memory-floor/slices/12a-runtime-integrity.md):
  the context builder now resolves through `resolveCalendar`, so a
  non-builtin id describes the same fallback calendar to the model
  that the reader already shows. That makes this item's stakes
  concrete rather than hypothetical — the seeded story's prompt now
  carries a Gregorian calendar section for a 360-day calendar, and
  it starts describing the real one the moment the registry consults
  `vault_calendars`.

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
  Slice-authoring note: when refcount-driven trashing lands (here
  or an M4 precursor), it must hook the **story-delete cascade
  path** — M2.4's `deleteStory` bulk-removes `entry_assets`
  junction rows without trashing the now-orphaned `assets`, and
  `stories.cover_asset_id` needs clearing on story delete — not
  just the standalone entry/branch delete arms, or deleting a
  story with attached assets or a cover leaks blobs (surfaced by
  Slice 2.4; no live impact before stories carry assets).
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

Carried deferrals, routed out of [`triage.md`](./triage.md)
2026-08-18, verified against the code first. Two are a11y-contract
rather than visual, so M9.2's audit has to widen past glyphs and
spacing to own them — or they need a slice of their own.

- **M9.2 — `disabledReason` never reaches the accessibility tree on web.**
  `Button`, `SwitchRow`, `swap-dialog`'s `CandidateRow` and
  `ColorPicker` all pass the reason to `accessibilityHint`, which RN
  Web drops outright — probed in Chromium, a disabled `Button` carries
  no `title`, `aria-describedby` or `aria-label` of its own. The web
  tooltip works (the `ReasonTooltip` ancestor is reachable by
  hit-test from every point on the control, verified), but an ancestor
  `title` is not a dependable accessible-description source, so screen
  reader users get "dimmed and unavailable" with no reason. Button's
  own prop doc claims both channels; on web only the tooltip half is
  true. RN Web does forward `aria-describedby` (verified), so the fix
  is a visually-hidden reason node plus `useId` in the shared wrapper —
  modest, but it needs a hidden-text primitive the repo lacks and it
  changes a shared UI contract, so it wants a design pass rather than a
  drive-by. Cross-cutting: every `disabledReason` consumer, present and
  future. Predates M3.7b; surfaced by the M3.7b review (2026-08-01).
- **M9.2 — Emoji stand in for icons across the app; sweep and replace.**
  User-facing chrome carries literal emoji and glyphs where the
  design system has an icon primitive — `✨` prefixes every AI-assist
  heading and several trigger labels, `⭐ Set as lead` and the
  `▼ More options` / `▼ Visual` disclosures are specced as glyphs in
  `wizard.md`, and arrows like `→` are baked into locale strings
  (`common:calendarPicker.manageInVault`, and entries across
  `settings`, `embedder`, `landing`, `reader`). Emoji render
  inconsistently across platforms and font stacks, cannot be themed
  or sized with the rest of the chrome, and land inside translatable
  strings where they are not translatable content. Sweep `components/`,
  `app/`, and `locales/` together: replace with `Icon`/`IconAction`
  where the glyph is decoration or an affordance, keep it only where
  it is genuinely textual. Canon in `wizard.md` specifies some of
  these as glyphs, so amending the doc is part of the work rather
  than a follow-on. Raised 2026-08-11.
- **M9.2 — `Select`'s dropdown trigger drops the current value from its
  accessible name once `label` is set.** `@rn-primitives/select`
  forces `role="button"` on the web trigger, overriding Radix's
  `combobox`, so the element carries no value semantic at all — the
  selected option reaches assistive tech only as the trigger's text
  content. Adding `aria-label` (the fix for triggers that renamed
  themselves on every pick) then suppresses that content: the month
  picker in `tier-tuple-input.tsx` announces "Month, button,
  collapsed" and never "January". Neither state is complete —
  before the label there was a value and no field identity, after it
  there is identity and no value. Reviewed and deliberately kept as
  identity-only: the value is one open away (Radix renders options
  with `role="option"` / `aria-selected` and focuses the selected one),
  while identity is unrecoverable because `FormRow` renders its label
  as plain `Text` with no `htmlFor` / `aria-labelledby`. The real fix
  is a `combobox` role on the trigger, where content is read as the
  value beside the label. Plausible-but-unverified path: the web build
  destructures `role: _role` out of the trigger's props and hardcodes
  `role='button'`, so a `patches/` one-liner deleting that destructure
  would let a caller-supplied `role="combobox"` through — nobody has
  applied or tested it. Applies to every `dropdown`-mode `Select` that
  carries a `label`. Raised 2026-08-13.
- **M9.5 — The retrieval pass has never been measured on mobile.** Every
  figure in
  [`retrieval.md → Per-turn cost budget`](../memory/retrieval.md#per-turn-cost-budget)
  is desktop. The only mobile evidence is the PoC's per-query KNN
  numbers, which predate the shipped pass — that PoC issued three KNN
  queries against one family, where the pass issues fifteen across five
  plus a by-id vector fetch. The ranker has never run on-device at all,
  and `retrieval.md`'s own PoC section puts a 384-dim Hermes dot at
  ~24-30 µs, which would make MMR's 19,900 dots ~500 ms per type if it
  holds. That is not turn-dominating against a narrative call measured
  in tens of seconds, but it is unknown rather than small, and it
  cannot be settled from a desktop runner. `bench/retrieval-cost.test.ts`
  is the harness to port. Owner is whoever does Android bring-up;
  desktop is v1 prod alongside it. Re-derived from the M3.4 MMR entry
  (2026-08-08), whose desktop half is now canon.

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
  - **M3** — Regenerate affordance on entries (M3.10; the earlier
    "refine on entries" phrase was dropped at promotion — canon
    defines refine only on the wizard opening); next-turn
    suggestions panel between AI replies and the composer (M3.7);
    per-entry worldTime click-to-edit + monotonicity flag (M3.8);
    CTRL-Z action-batched extension across classifier writes
    (M3.9).
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
  - **M3.2** — the per-turn piggyback / fallback-classifier layer
    writes `metadata.worldTime` on each new entry (entry metadata
    is per-turn-owned per the cadence write-set table; an earlier
    M3.3 attribution was corrected at M3 promotion); first
    non-zero worldTime values flow through the renderer.
  - **M2.3** — Wizard's calendar-summary preview samples the
    renderer to show how dates will format (`computeSampleRender`);
    M3.6a confirmed it needed no further work.
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

- **M3 + M4 did not merge** — M3 was authored standalone
  (2026-07-20). The mid-correctness-check inspection need is served
  by M3.5's developer probe and by building M4 read surfaces early
  against seeded rows per the look-ahead rule; M4 remains a
  separate roadmap entry.
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
