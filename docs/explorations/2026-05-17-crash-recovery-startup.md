# Crash recovery — startup-side consumer wiring

Resolves the `Crash recovery for in-flight transactions` followup
previously tracked in `followups.md`, removed by the commit that
lands this exploration. The substrate side (marker table schema,
lifecycle hooks
at `beginRun` / `commitRun` / `abortRun`, the `reverseReplayDeltas`
primitive, atomicity-window honesty about the final-delta-to-commit
gap) was already pinned in
[`generation-pipeline.md → Crash recovery via pipeline_runs marker table`](../generation-pipeline.md#crash-recovery-via-pipeline_runs-marker-table).
What was open: where the consumer hook lives in the boot sequence,
what the user sees when recovery fires, what happens if recovery
itself fails, and one small spec defect in the `reverseReplayDeltas`
code block (it currently throws `PipelineError`, which is the wrong
abstraction for the startup-recovery caller).

## What this design closes vs. defers

Closes:

- Boot ordering for the recovery pass and the invocation contract
  (`recoverInFlightRuns`).
- Modal UX (trigger conditions, kind-aware copy with story name,
  ack-required shape).
- Recovery-failure policy when `reverseReplayDeltas` throws at
  startup.
- An invariant that lets the post-Zustand-construct ordering be
  safe: data-model Zustand slices must not auto-rehydrate at
  construct time.
- A code-block correction in `generation-pipeline.md → Reverse-replay`:
  the primitive throws a substrate-level `DeltaReplayError` (not
  `PipelineError`) and returns the delta count so callers can
  distinguish pre-first-delta orphans from real recoveries.

Defers:

- Multi-version `undo_payload` apply-dispatcher. The
  `encoding_version` stamp itself ships at v1; the dispatcher that
  would route a stamped delta through legacy-compatible apply rules
  is parked at
  [`parked.md → Multi-version undo_payload apply-dispatcher`](../parked.md#multi-version-undo_payload-apply-dispatcher)
  (added by this commit). Stuck orphans whose `undo_payload`
  references a post-migration schema sit in the Logs tab until the
  dispatcher lands.
- Final-delta-to-commit window tightening — already a future-work
  item in `generation-pipeline.md`.
- Pruning policy for finished `pipeline_runs` rows — already noted
  as "future concern" in the existing crash-recovery section.

## Boot ordering

Recovery runs in this slot during app boot:

1. Native shell ready (Expo / Electron main process up).
2. SQLite handle opened, **migrations applied** — `deltas` and
   `pipeline_runs` tables guaranteed at current schema.
3. Zustand stores constructed at empty default state.
4. **Crash recovery pass runs here.**
5. Theme / settings hydration, provider and embedder readiness
   checks, first user-facing surface renders (Story List in v1).
6. Story-load and background-task startup are gated until recovery
   has resolved.

Migrations-first is load-bearing. If a migration mutated a column
an orphan's `undo_payload` references, `applyUndo` will fail —
that is exactly the cross-version case the
[`encoding_version`](../data-model.md#diagram) stamp + the parked
multi-version apply-dispatcher will eventually handle together.
Running recovery after migrations guarantees stale-encoding orphans
fail-into that dispatcher when it lands rather than fail in
mysterious ways before it.

### Zustand-rehydrate invariant — withdrawn

An earlier draft proposed an invariant that data-model Zustand
slices (entries, entities, lore, deltas, etc.) must not rehydrate
from SQLite at construct time, to avoid picking up pre-recovery
state. Withdrawn on review: the architecture makes the race
unreachable. Data-model slices are **story-scoped** — they
construct when the user opens a story, which happens long after
boot (after migrations, after `recoverInFlightRuns`, after the
story list renders). The boot-time stale-state window the
invariant guarded against does not exist because the stores in
question do not exist at boot.

UI-pref slices (theme id, last-opened-story id, etc.) construct at
boot but don't depend on deltas; reverse-replay leaves them
untouched.

## Invocation contract

The canonical `recoverInFlightRuns` code lives in
[`generation-pipeline.md → Startup recovery pass`](../generation-pipeline.md#startup-recovery-pass).
The session shape:

- Query orphans with `started_at ASC` for diagnostic legibility —
  runs don't share state, so order isn't load-bearing, but ASC
  matches the order they originally fired in logs.
- For each orphan, call `reverseReplayDeltas(action_id)` and branch
  on the returned delta count:
  - `deltaCount === 0` (pre-first-delta orphan, nothing to reverse):
    `DELETE` the row. No diagnostic value in retaining it; aligns
    with the existing atomicity-window enumeration ("just delete the
    row").
  - `deltaCount > 0`: `UPDATE` the row to `finished_at = now()`,
    `outcome = 'recovered'`. Push a `RecoveredRun` entry into the
    report and emit `pipeline.recovered` via observability.
- On `DeltaReplayError` thrown by `reverseReplayDeltas`: per-orphan
  catch, emit `pipeline.recovery_failed` at `error` severity, leave
  the row with `finished_at = NULL` so the next boot retries
  automatically. Boot is not blocked.

The returned `RecoveryReport` (split into `reversed` / `failures`)
drives modal-or-silent at the UI layer.

### `pipeline_runs.story_id`

The orphan rows need `story_id` so the recovery modal can name the
story. Resolving it by joining one of the orphan's deltas to its
target row's `story_id` fails when the target row was created and
then deleted within the same orphaned run (no FK target left to join
through). Cleaner: store `story_id` on `pipeline_runs` directly,
populated at `beginRun` from the run's calling context. The column
lands in the table's initial definition (the existing `CREATE TABLE`
block in `generation-pipeline.md → Crash recovery`); no migration
concern — the table isn't implemented yet.

The column is nullable because pipelines aren't strictly required
to be story-scoped (a hypothetical future global maintenance task
would have NULL `story_id`). In v1, all three kinds (`per-turn`,
`chapter-close`, `periodic-classifier`) are story-scoped, so v1
rows are always populated.

## Reverse-replay primitive — substrate-level error

Current spec showed `reverseReplayDeltas` throwing
`new PipelineError('Reverse-replay failed', e)`. That bleeds the
pipeline abstraction into a deltas-substrate primitive that has
**two** callers — runtime `abortRun` (a pipeline-context caller)
and `recoverInFlightRuns` (a startup caller with no pipeline
running). Throwing pipeline-typed errors from the substrate forces
the startup caller to either pretend a pipeline is running or
unwrap the cause and re-throw differently.

Correction (lands in
[`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)):

1. Return type becomes `Promise<number>` (the delta count), so
   callers distinguish the pre-first-delta zero-delta case from a
   real recovery. Zero-delta early-returns before the `BEGIN`.
2. Thrown error becomes a substrate-level `DeltaReplayError`
   carrying the underlying cause and the `actionId` for diagnostic
   context. `abortRun` catches and re-wraps as `PipelineError`
   for orchestrator surfacing (the existing `kind: 'orchestrator'`
   category); `recoverInFlightRuns` catches directly and routes to
   the failure policy below.

`DeltaReplayError` lives in the deltas-substrate module alongside
the delta types. Exact module path is an implementation detail
settled when the substrate ships; this design pins only the
abstraction boundary.

## Recovery modal UX

### Trigger

The modal fires when `recoverInFlightRuns` returns with
`reversed.length > 0` — i.e., at least one orphan had real deltas
to undo. The path is:

- `reversed.length > 0` → modal fires on the first user-facing
  surface that renders after boot.
- `reversed.length === 0` and no failures → silent, normal boot.
- `failures.length > 0` (regardless of `reversed.length`) → silent
  at the modal layer; failures go to observability only (see
  _Recovery-failure policy_ below).

### Host

The modal fires on the **first user-facing surface that renders
after boot completes.** In v1 that surface is Story List; if a
future preference (e.g., "resume last story on launch") changes
which surface boots first, the modal moves with it. Mechanism: the
recovery pass writes the `RecoveryReport` into a `pendingRecoveryReport`
slot in a UI-state Zustand slice; the first rendered surface drains
the slot via `useEffect` and mounts the modal.

### Shape

[AlertDialog](../ui/patterns/alert-dialog.md) primitive — modal
on every tier (phone, tablet, desktop). Single primary action;
no destructive variant (the destructive thing already happened).

### Copy

Title is uniform (`Last action reverted after interrupted shutdown`);
body is kind-aware and names the affected story via `{storyName}`
substitution from the orphan's `story_id`. Per-kind templates and
NULL-storyId fallback wording live in the canonical doc:
[`generation-pipeline.md → Recovery modal`](../generation-pipeline.md#recovery-modal).

### Multi-orphan case

Concurrent same-kind runs can't happen (concurrency policy); chained
runs (`per-turn → chapter-close`) don't run simultaneously either.
So multiple orphans only arise from independent crashes across
separate sessions without successful intervening boots — vanishingly
rare.

The modal copy concatenates orphans into one paragraph rather than
chaining N modals:

> _"An interrupted shutdown was detected in `The Long Pier` and
> `The Bone Forge`. Your last AI response and a background memory
> update were reverted to keep your stories consistent."_

N=2-3 reads fine; N>3 reads ugly but is accepted as-is. Pretty UI
for pathological cases is wasted work; if a user ever sees N>3 they
have a bigger problem than modal aesthetics.

### What the modal does NOT do

- No "view details" expansion showing the deltas reversed. A
  delta-summary primitive doesn't exist (separate followup tied to
  history surfaces); building one for this rare-event modal is
  over-engineering. Curious users can inspect Diagnostics Hub Logs
  — the `pipeline.recovered` event carries run details.
- No "undo this revert / restore my work" affordance. The whole
  point of recovery is to reach a consistent state; offering to
  re-apply orphaned deltas defeats it.
- No fire on zero-reverse success or on recovery failure (those
  surface via Logs only).

## Recovery-failure policy

Policy shape (canonical detail in
[`generation-pipeline.md → Recovery-failure policy`](../generation-pipeline.md#recovery-failure-policy)):

- Boot is not blocked — per-orphan catch, accumulate, continue.
- Orphan row stays with `finished_at = NULL`; next boot retries.
  The failure was non-destructive because SQLite ROLLBACK in
  `reverseReplayDeltas` undid any partial replay.
- Failure event surfaces in Diagnostics Hub Logs only; the modal
  layer stays silent. Almost all real failures will be cross-
  version-related (the deferred multi-version apply-dispatcher
  case parked under
  [`parked.md → Multi-version undo_payload apply-dispatcher`](../parked.md#multi-version-undo_payload-apply-dispatcher)).

No max-retry counter and no admin "drop orphan" affordance for v1
— stuck orphans surface in Logs across boots until the dispatcher
work lands.

## Realistic failure modes for `DeltaReplayError`

For honesty about how reachable this error actually is in v1:

- **SQLite I/O error** (disk full, corruption, DB locked) — vanishingly
  rare in single-process local SQLite.
- **Schema mismatch** between `undo_payload` shape and current
  schema after a migration — the cross-version case. The
  `encoding_version` stamp lands at v1; the apply-dispatcher that
  routes stamped deltas through version-appropriate apply rules is
  the parked work that eventually resolves it.
- **Foreign-key constraint failure on undo** — possible if an
  orphan's reverse-replay tries to resurrect a row whose FK
  reference no longer exists. Within a single orphan, `ORDER BY seq DESC`
  reverses creates last (the natural order), so intra-orphan FK
  graphs are consistent. Cross-version cases where the schema
  changed FK definitions fall under the schema mismatch above.

In v1 the throw path is essentially inert outside the deferred
cross-version case.

## Atomicity windows still accepted

The existing `generation-pipeline.md → Crash recovery` section
enumerates atomicity windows honestly. Restating for completeness;
this design does not change them:

- Pre-first-delta orphan — handled (the `deltaCount === 0` branch
  DELETEs the row).
- Between consecutive deltas — handled (standard reverse-replay).
- Final-delta-to-commit-marker window — accepted as the v1
  data-loss window. The user effectively "succeeded" but the
  marker still says in-flight, so recovery reverses just-finished
  work. v2 tightens by coupling the final action's SQLite txn
  with the marker UPDATE; tracked in
  `generation-pipeline.md → Future-work`.

## Integration plan

### Canonical-doc edits

- **`docs/generation-pipeline.md`**
  - `Crash recovery via pipeline_runs marker table` — extend with
    the consumer side: the boot-ordering slot, the
    `recoverInFlightRuns` invocation contract, the modal-UX
    summary, the failure-policy summary. Add `story_id TEXT NULL`
    to the existing `CREATE TABLE pipeline_runs` block; note that
    `beginRun` populates it from the run's calling context.
  - `Reverse-replay` — replace the existing code block with the
    corrected version: `Promise<number>` return type, zero-delta
    early-return, `DeltaReplayError` instead of `PipelineError`,
    diagnostic-context cause.

- **`docs/architecture.md`**
  - `What this doc does not yet cover → Startup + migration flow`
    bullet — narrow the scope. Crash recovery is no longer entirely
    "the startup wiring lands with the broader startup design";
    boot ordering + modal UX + failure policy are now pinned.
    Hook _placement in a specific module_ still lands with broader
    startup-flow design; rephrase the bullet accordingly.
  - **Zustand-rehydrate invariant** — pinned inline within
    `generation-pipeline.md → Crash recovery → Startup recovery pass`
    rather than a separate architecture section, since that's where
    the invariant is load-bearing. (The dedicated data-flow section
    in architecture.md doesn't exist yet — listed as not-yet-covered.)

- **`docs/followups.md`**
  - Remove `Crash recovery for in-flight transactions` (resolved by
    this exploration).

### No UI wireframe

The recovery modal uses the existing
[`AlertDialog`](../ui/patterns/alert-dialog.md) primitive at its
standard shape; no new wireframe surface, no new pattern. Copy
templates live alongside other modal copy when that infra ships
(no commitment in this design to a specific copy-library shape).

### Renames

None. No heading or schema-field rename in this design.

### Patterns adopted on a new surface

None. The recovery modal cites the AlertDialog pattern, but
AlertDialog has no `Used by` list to update (the doc is
contract-shaped, not adoption-tracking).

### Followups resolved

- `followups.md → Crash recovery for in-flight transactions` —
  removed.

### Followups introduced

None.

### Intentional repeated prose

`generation-pipeline.md → Crash recovery` will contain a short
restatement of the atomicity-window enumeration via cross-reference.
The exploration doc above also restates the windows for completeness.
This duplication is intentional context — the exploration is a
session record; the canonical doc is the spec.
