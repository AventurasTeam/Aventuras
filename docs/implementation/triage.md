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

- **Name-collision detection misses partial-name duplicates.** Layer B
  reconciliation (`lib/classifier/reconcile.ts`) gates on an exact
  `normalizeTerm` name match against existing characters, so "Kael" and
  "Kael Stormborn" never reach the embedding comparison: the classifier
  creates a second row with no flag, and no surface offers a merge.
  Keywords and aliases are not consulted either. Only characters are
  reconciled at all, though canon gives the flag to all four kinds.
  Scene presence is unused too: the classifier's window carries each
  turn's prose but not the `sceneEntities` saved in its metadata, and
  Layer B compares names and descriptions only, so a "new" character in
  a turn whose scene already names the existing row (strong evidence of
  a classifier miss) still lands as a flagged duplicate. Revisit
  together, developer-requested: feed each window turn its saved
  metadata state, resolve or promote such a character to the existing
  row, and consider correcting past entries' scene presence once a
  duplicate is resolved — a merge rewrites only the tail scene, so
  earlier entries keep naming the deleted loser and render it as
  "Entity no longer exists". Found during 4.2c planning (2026-10-06);
  the classifier is M3.3's substrate, outside 4.2c's scope.
- **The classifier drops why it flagged a row.** `reconcileNewCharacter`
  returns a `FlagReason` (`distinct`, `ambiguous`, `no-signal`), the
  similarity and the best-matching namesake, and its type comment says
  the reason is "carried explicitly for the collision-review surface",
  but `lib/classifier/plan.ts` persists only the 0/1 flag. The resolve
  dialog could say "descriptions differ" or "couldn't compare", and a
  stored partner id would let World pair the flagged row with the
  namesake the classifier actually compared rather than guessing by
  name. Both need a schema column. Found during 4.2c planning
  (2026-10-06).
- **`lastSeenAt.locationId` can name a removed location.** Characters
  and items carry `lastSeenAt { entryId, locationId, worldTime }`
  (`lib/db/entities/entity-state-schema.ts`), but `locationId` isn't
  one of the six ref fields the entity delete arm clears
  (`lib/world/entity-delete.ts`), nor one the 4.2c merge rewrites. So
  after a location is deleted (true since 4.2b) or merged away, a
  "last seen" can name a row that no longer exists. Canon is silent:
  `data-model.md → Authorship contract` makes `lastSeenAt` a
  classifier-only snapshot, and `world.md → Delete` lists the six
  fields. Decide whether the snapshot is history (leave it, render the
  dangling id as "Entity no longer exists") or a ref (clear or rewrite
  it like the others). Found during 4.2c planning (2026-10-06).
- **SQLite never gathers table statistics.** Nothing runs `ANALYZE` or
  `PRAGMA optimize` (`lib/db`, `electron/`), so the planner picks
  indexes without statistics. Measured while planning 4.2c's History
  link-row union: on a 30k-delta branch (node:sqlite, desktop) a
  History chunk takes about 9 ms because the union's OR keeps SQLite off
  `deltas_chain_idx`, and about 2 ms after `ANALYZE`. That's accepted
  for 4.2c. Running `PRAGMA optimize` at boot or on close is
  cross-cutting (desktop main process and the mobile expo-sqlite
  connection), so it's routed here rather than into the slice. Revisit
  if History or another log-shaped query feels slow on a long story,
  Android first. Found during 4.2c planning (2026-10-06).
- **The entity update arm accepts a present-but-`undefined` column.**
  `updateHandler` (`lib/actions/entities/register.ts`) treats a key as
  written whenever `col in patch`, so `{ name: undefined, priority: 7 }`
  returns `ok`: the DB keeps the old name, the store row's `name` becomes
  `undefined`, and the undo payload records `name`, so History shows
  "Modified Name" for a change that never landed and user precedence
  treats `name` as user-written. 4.2c closed the hole for
  `nameCollisionFlag` only (its own refusal). A general rule — refuse or
  skip any updatable key whose value is `undefined` — would cover every
  column. Found in 4.2c's Task 1 review (2026-10-06).
- **The entity operational seam's flag arm can bypass the delta log.**
  `lib/actions/entities/operational.ts` still calls itself the non-delta
  seam for the compute-lifecycle columns, flag included, but 4.2c made
  the flag clear a delta-logged user write. Its flag arm is unused; a
  future classifier path calling it would write a column the user path
  delta-logs, and a rollback couldn't revert it. Either drop the arm or
  narrow the header. Found in 4.2c's Task 1 review (2026-10-06).
- **Plot's awareness upsert type duplicates the arm's payload.**
  `lib/plot/happening-draft.ts` declares a local `AwarenessUpsert` type
  instead of deriving it from the `upsertHappeningAwareness` payload in
  `PipelineActionMap`. It is compatible today and can drift silently
  (4.2c added `retrievalCount` to the arm). Found in 4.2c's Task 3
  review (2026-10-06).
- **Undo and redo of a story entry's metadata skip its metadata lock.**
  `withEntryMetadataLock` has four callers (scene fields, world time,
  entity delete, 4.2c's merge); the undo and redo paths for an
  `updateStoryEntryMetadata` delta (`lib/actions/story-entries/undo.ts`,
  `lib/actions/delta/redo.ts`) take no lock. A CTRL-Z landing while a
  scene edit, delete or merge sits between its tail read and its commit
  could have its restore overwritten. Unverified: it needs two user
  actions at once. Found in 4.2c's Task 8 review (2026-10-06).
- **The entity update arm's missing-row refusal carries no code.**
  `updateHandler` (`lib/actions/entities/register.ts`) refuses "update
  target … not found" without `TARGET_NOT_FOUND`, which the delete arm
  sets. Callers that map refusal codes (`resolveCollision`,
  `commitRowSave`) therefore report a vanished row as `failed` instead
  of `not-found`. Found in 4.2c's PR 1 final review (2026-10-06).
- **The group runner commits an update and a delete of one row.**
  `groupConflict` (`lib/actions/delta/apply-delta-action.ts`) refuses a
  write to a row a delete in the same group cascades, but not an update
  of the deleted row itself. Such a group commits, and its undo then
  throws `ReversalIntegrityError` (`held-in-redo`), so the action can't
  be reversed. No shipped planner emits it (4.2c's merge leaves the
  loser out of its scene effects for this reason); any future planner
  that does would commit an irreversible action. Found while fixing
  4.2c's merge scene effects (2026-10-06).
- **The group conflict check can't see refs inside entity `state`.**
  `rowRefs` (`lib/actions/delta/live-refs.ts`) covers link-row columns
  but not the ref fields inside an entity's `state` (`current_location_id`
  and the rest), so `groupConflict` can't refuse a state write that names
  a row the same group deletes. Planners avoid it by discipline (4.2c's
  merge rewrites every ref to the loser before deleting it); nothing
  checks it. Found in 4.2c's PR 1 review (2026-10-06).
- **A tail scene edit re-anchors characters who left at the tail.** The
  scene editor (`lib/actions/story-entries/scene-fields.ts`) runs
  `sceneTrackingActions` over the previous, original and edited scenes
  on every tail edit, so a character the tail's scene dropped is moved
  back to the previous entry's location, overwriting a manual location
  edit made since. Plausibly intended (the edit re-states the scene) but
  undocumented as a consequence. Its live filter on the previous scene's
  ids has no effect, since tracking iterates live entities only. Found
  in 4.2c's PR 1 review (2026-10-06).
- **Location tracking accepts an item target.**
  `updateEntityLocationTracking`
  (`lib/actions/entities/state-patch-actions.ts`) has no kind check, so
  it writes `current_location_id` into an item's state, which the item
  state schema doesn't refuse; `updateItemPosition` checks its kind.
  4.2c's merge guards its own call; the arm doesn't. Found in 4.2c's
  PR 1 review (2026-10-06).
- **Segment Select clips a label that wraps past two lines.**
  `SegmentBranch` (`components/ui/select.tsx`) gives each option a fixed
  `h-control-md` height with `overflow-hidden` and no line limit, so a
  segment whose labels carry user data clips once a label wraps. 4.2c's
  collision dialog moved its phone picker to radio rows to avoid it; the
  component itself still needs a line limit or a growing row. Found in
  4.2c's PR 2 review (2026-10-06).
- **`Dialog` doesn't register as a blocking overlay.**
  `components/ui/dialog.tsx` never calls `useRegisteredOverlay`, while
  `alert-dialog.tsx`, `sheet.tsx` and `select.tsx` do, and
  `lib/stores/ui/blocking-overlays.ts` says modal dialogs should. So
  every `Dialog`-based modal (collision resolve, import, embedder) leaves
  the actions menu and its shortcuts armed underneath it. Found in 4.2c's
  PR 2 review (2026-10-06).
- **The collision dialog's tag partition compares raw strings.**
  `components/compounds/collision-resolve-diff.ts` partitions tags
  exactly, while the merge planner cleans them (trim, drop blanks, drop
  duplicates). So `'hero'` and `'hero '` render as two chips, a blank tag
  renders as an empty chip, and a side's internal duplicates give
  duplicate chip keys and a duplicated tag in the submitted list; the
  merge writes the cleaned list. The plan kept tags exact for case only.
  Found in 4.2c's PR 2 review (2026-10-06).
- **The collision dialog's merge error can scroll out of view.** The
  inline error line sits at the end of the merge body's scroll content,
  so with many tags a refusal can land below the fold. Found in 4.2c's
  PR 2 review (2026-10-06).
- **An E2E failure with a dirty pane hangs teardown.** When a test fails
  while a pane is dirty, the main process's armed close guard blocks
  `app.close()` (`e2e/harness/launch.ts`), so each spec's `afterAll`
  waits out the 90 s hook timeout per attempt and leaks its temporary
  `userData` directory. The harness needs a fallback that exits the app
  from main or kills it after a timeout. Found in 4.2c's PR 2 review
  (2026-10-06).
- **Link update arms log unchanged values.** The involvement update arm
  (`lib/actions/happenings/register-involvements.ts`) and the awareness
  upsert (`register-awareness.ts`) write a delta even when the value
  doesn't change, where the relationship arm refuses it as a `noop`. A
  caller sending the same role writes a "Modified Role" History row
  with no change. The Plot draft compares before writing, so no shipped
  path does this today. Found in 4.2c's PR 3 review (2026-10-07).
- **The History tab reads its own row without a branch check.**
  `components/history/use-history-target.ts` looks the tab's row up in
  the stores by id alone; ids repeat across branches (composite primary
  key), and 4.2c added branch guards to the other-end name lookups and
  the link version beside it. Unreachable while panes render only
  branch-filtered rows. Found in 4.2c's PR 3 review (2026-10-07).
- **The authorship contract table doesn't list the collision flag.**
  `docs/data-model.md → Authorship contract` has no row for
  `name_collision_flag`, though the World screen's authorship section
  (3+ collisions) cites the contract for who sets and clears it: the
  classifier at create, user paths only clearing it since 4.2c. Found
  in 4.2c's PR 2 review (2026-10-06).
