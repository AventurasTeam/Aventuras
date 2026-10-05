# Implementation triage

Inbox for cross-cutting deferrals surfaced during implementation that
have **no single downstream slice to own them** — the items that would
otherwise be dropped straight into [`followups.md`](../followups.md) or
[`parked.md`](../parked.md) and lost.

Drop them here first. This file is a **queue, not a ledger**: an item
living here means "not yet triaged," not "deferred forever." Triage
happens as a separate pass — each item is read, then routed to its real
home (a specific slice's Open questions, the active
[`followups.md`](../followups.md) ledger, [`parked.md`](../parked.md), a
canonical spec change) or deleted if it dissolves on inspection. Keep
the queue short; a growing inbox is the signal to triage.

A deferral that a **specific downstream slice** will own does not belong
here — it goes straight into that slice's Open questions, where the
slice-planning gate forces its resolution before that slice is planned.

## Inbox

- **Story isolation leaks across files under
  `--fileParallelism=false`.** Serializing puts every story file in one
  page, and some app-level DOM state survives the file that set it.
  Latent rather than active — nothing runs the suite serially — but it
  means "run the browser project sequentially" is not available as a
  debugging move, which is exactly the move a browser-project
  regression calls for. See
  [failed Storybook files with zero failed tests](lessons-learned/storybook-load-flake-zero-failed-tests.md)
  for the parallel-run flake this sits next to; the two may share a
  cause. **Anchor item — accumulating evidence, not yet actionable.**
  Append observations rather than rewriting.

  Evidence so far:
  - 2026-08-24, raised at `384823d6`: the `Diagnostics On` story in
    `app-actions-menu-pure.stories.tsx` failed 2/2, body carrying a
    `data-density` attribute. Attributed to that story; both the
    attribution and the mechanism are unconfirmed.
  - 2026-08-25 at `edce17b8`, three full serial runs (96 files, 803
    tests): green, then a failure in `Trigger Opens Overlay`
    (`preset-browser.stories.tsx`), then green. `Diagnostics On` passed
    all three; `components/compounds` alone is green 26/26. So it is
    intermittent (~1 in 3), the failing story varies across
    directories, and it is not one story's dependency. Root cause
    unidentified — an overlay that fails to open suggests residual
    pointer-events or portal state rather than `data-density`, which
    every file sets for itself through the global decorator in
    `.storybook/preview.tsx`.

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **The fallback classifier can re-apply stackable transfers the
  narrative fold already wrote.** The fold applies whatever the tagged
  block parsed even when another field failed
  (`lib/pipeline/definitions/per-turn.ts`), and any parse failure fires
  the fallback, whose schema asks for transfers again. Item moves and
  visual changes overwrite, so a repeat is harmless; stackable amounts
  add, so a transfer both layers report lands twice. Read, not
  reproduced (2026-10-04, raised by the post-4.2b triage pass).
- **`createTranslation`'s live-target check holds no key lock between
  its read and its commit.** The link writers take their family's
  per-branch key, which an entity or happening delete also holds, so a
  concurrent delete of an end serialises with the write (canon:
  [`generation-pipeline.md`](../generation-pipeline.md#atomicity-per-action),
  [`cadence.md`](../memory/cadence.md#concurrency)); `missingRef` in
  `lib/actions/translations/register.ts` reads the target and the
  write commits later, so a concurrent `deleteEntity` could land
  between them. Latent: nothing writes translations. A fix needs a key
  per target table, and lore, thread and chapter deletes take no key
  today (`lib/actions/happenings/register-happenings.ts` already notes
  translations aren't locked). Raised in the reversal-integrity PR's
  review (2026-10-05).

- **Deleting a relationship pair directly leaves its translations
  dangling.** `deleteHandler` and the upsert-to-null delete branch in
  `lib/actions/relationships/register.ts` delete the pair without
  cascading its `character_relationship` translations; only the entity
  cascade cleans them up. A reversal that deletes a pair the closure
  did not remove strands them too. The closure's `userKeptRows` in
  `lib/actions/delta/row-closure.ts` drops the planner's "still
  non-null" half (a plan decision), so a create whose user-written
  view was later cleared counts as kept; an update's undo that leaves
  no view deletes a pair the closure never reached; and the same undo
  on a pair a delete holds strips it from that delete's payload. The
  planner (`lib/actions/delta/reverse-replay.ts`) prunes the pair's
  own logged writes in all three cases, but translations naming it are
  not closed over and stay. Latent: nothing writes translations.
  Revisit both when translations get a writer. Raised in the
  reversal-integrity PR's review (2026-10-05).

- **The reversal closure doesn't follow id references inside
  `entities.state`.** `REF_COLUMNS` in
  `lib/actions/delta/live-refs.ts` registers only link-table columns,
  so `selectReversalSet` in `lib/actions/delta/row-closure.ts` never
  reaches the ids [`data-model.md`](../data-model.md#branch-model)
  says `state` holds: `current_location_id`, `faction_id`,
  `parent_location_id` and `at_location_id`, and the id arrays
  `equipped_items` and `inventory` (all in
  `lib/db/entities/entity-state-schema.ts`). A reversal removing an
  entity could leave another entity's `state` naming it if a user
  write outside the set put the reference there; an item the user
  equips or stows is likely the commonest such write. Unverified
  whether reachable: the argument canon gives for its write-back
  refusal, that an entity's create is never reversed while a delete
  holds it
  ([`generation-pipeline.md`](../generation-pipeline.md#reverse-replay)),
  may extend to this. Separately, `data-model.md` contradicts itself:
  its branch model lists `equipped_by` as a `state` reference, but its
  own [`ItemState` shape](../data-model.md#itemstate-shape) has no such
  field and rules out a back-pointer on the item, and the schema has
  none either. Drift to resolve in the doc. Raised in the
  reversal-integrity PR's review (2026-10-05).

- **Rollback and edit rejection copy always says "Please try again."**
  `reader:rollbackFailed` and `reader:editFailed`
  (`locales/en/reader.json`) cover every rejection code, including the
  persistent ones (`delta-failed` from an integrity refusal,
  `not-found`, `rollback-floor`), which a retry cannot clear. Regenerate
  avoids the loop only for its dispatch result, through
  `REGENERATE_REJECTION_COPY` in `app/reader-composer/[branchId].tsx`;
  its preview rejection in `handleRequestRegenerate` still toasts
  `reader:regenerateFailed` ("…Please try again."). Raised in the
  reversal-integrity PR's review (2026-10-05).

- **Every seeded hero rollback reverses chapter 1's create.**
  `delta_hero_3` in `lib/db/devtools/seed-dataset.ts` (the
  `chap_hero_1` create) has a null `entryId` and is logged after every
  entry create, so it falls inside every hero rollback window; a probe
  showed `chapters: 1` even for a rollback to position 70. Raised in
  the reversal-integrity PR's review (2026-10-05).

- **Redo re-inserts newest-first, so a link lands before its parent.**
  `applyRedoLocked` in `lib/actions/delta/redo.ts` walks the snapshots
  newest-first and a link's create precedes its parent entity's. It is
  safe only because link ends (`entity_id`, `character_id`, and the
  like) carry no foreign key; adding one breaks redo of a closed
  group. Record the constraint where link tables are declared. Raised
  in the reversal-integrity PR's review (2026-10-05).

- **A kept (re-owned) create in `redoRows` fails redo with a raw
  SQLite error.** It is unreachable today only because no non-periodic
  machine source creates relationships and CTRL-Z skips periodic
  groups. If one is reached, the plain INSERT `applyRedoLocked`
  (`lib/actions/delta/redo.ts`) runs from the row `snapshotForRedo`
  captured hits a primary-key error rather than a refusal, since the
  kept row never left, and the redo stays pending. Add a guard
  or refusal before any non-periodic machine source creates
  relationships. Raised in the reversal-integrity PR's review
  (2026-10-05).

- **`loadHeldRows` scans the branch's whole delta log on every
  reversal-set selection.** `lib/actions/delta/held-rows.ts` filters
  on `op = 'delete'` and JSON-decodes every delete payload each time a
  reversal set is selected: every CTRL-Z, prose edit, abort and
  rollback-preview tap. The only `deltas` indexes are
  `(branch_id, log_position)` and
  `(branch_id, target_id, log_position)`, so the filter scans the log,
  which grows every turn (awareness bumps add update deltas). Latent:
  fine today. Revisit with a partial index on deletes (or an
  op-leading index) when long stories show selection latency. Raised
  in the reversal-integrity PR's review (2026-10-05).

- **`buildUndoOps` is one ~265-line loop carrying every reversal rule.**
  `lib/actions/delta/reverse-replay.ts` holds the live and held arms,
  re-own, tombstones, stranded writes and two refusals in a single
  loop, with four hand-synced per-row presence structures. Extract the
  create and update arms (and their held variants) into named helpers,
  and consider one per-row state, before the next rule lands. Raised in
  the reversal-integrity PR's review (2026-10-05).

- **`RedoSnapshot` can be built by hand.** `RedoSnapshot` in
  `lib/actions/delta/redo.ts` is a plain exported object type,
  re-exported from `lib/actions` and held by
  `lib/stores/ui/undo-redo.ts`, and `applyRedo` trusts whatever
  snapshots it is given. The `held-in-redo` refusal and the snapshot's
  "taken before the reversal" timing hold only because
  `snapshotForRedo` is its one producer; a hand-built snapshot skips
  both. Latent: no production code builds one, though
  `redo.test.ts` and `undo-redo.test.ts` do, so a brand needs a
  test-side constructor. The type predates this PR, and
  [Type design](../code-conventions.md#type-design) files looseness in
  older code as a deferral. Brand it, or make it opaque, when redo is
  next touched, so it is minted only by its producer, as `ReversalSet`
  is by `selectReversalSet`. Raised in the reversal-integrity PR's
  slice review (2026-10-05).

- **The seed logs a classifier happening as its own CTRL-Z group.**
  The hero branch's `act_class_1` group in
  `lib/db/devtools/seed-dataset.ts` (`delta_hero_2`, the `hap_fire`
  create, with `delta_hero_5`, `delta_hero_6` and `delta_hero_7`, its
  link creates) is logged as `ai_classifier` in an action of its own
  with no story-entry create, a group no production writer leaves. The
  periodic classifier logs happenings and links as
  `periodic_classifier` (`lib/classifier/plan.ts`), which CTRL-Z steps
  over (`lib/undo/index.ts`), and the Plot draft
  (`lib/plot/happening-draft.ts`) logs them as `user_edit`. A CTRL-Z
  that reaches the group on the seeded hero branch so undoes it as a
  standalone group. Pre-existing for `delta_hero_2` (the merge base
  logs it the same way); this PR added the link creates to the group,
  and its sibling `delta_hero_8` already logs as a periodic pass. The
  test "logs the hero happening fire as one contiguous action" in
  `seed-dataset.test.ts` treats it as a CTRL-Z-able group, and the E2E
  harness seeds from this dataset (`e2e/harness/seed.ts`), so changing
  its source needs a check of what those specs CTRL-Z. Raised in the
  reversal-integrity PR's slice review (2026-10-05).

- **IN-list chunking against the bind cap is hand-rolled in nine
  places.** `lib/actions/delta/row-closure.ts` (`chunked`) and
  `lib/db/embeddings/stale.ts` (`chunk`) each keep a private helper,
  and `user-precedence.ts`, `reverse-replay.ts` and
  `live-link-filter.ts` under `lib/actions/delta/`, plus
  `lib/retrieval/run.ts`, `lib/retrieval/source-rows.ts`,
  `lib/entry-refs/read.ts` and `lib/db/embeddings/ops.ts`, inline the
  `i += BIND_CHUNK` loop. One exported helper beside `BIND_CHUNK` in
  `lib/db/bind-limit.ts` would replace them; the reversal-integrity
  PR's simplifier pass skipped it because that home sits outside the
  PR. Raised in the reversal-integrity PR's slice review (2026-10-05).
