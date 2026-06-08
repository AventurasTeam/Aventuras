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

- **`turnCaptureSink` code lags the revised turn-grouping contract**
  (sooner rather than later). The capture contract was revised to group
  captures into turns —
  [`observability.md → turnCaptureSink`](../observability.md#turncapturesink):
  `TurnCapture` gains `kind` + `anchorEntryId`, `beginTurn` takes
  `{ actionId; kind; branchId; anchorEntryId? }`, a `recordTargetEntry`
  setter lands the (currently never-set) `targetEntryId` + the per-turn
  anchor, and `recordClassifierOutput` / `classifierOutputRaw` are
  dropped (the classifier's output is read from its LLM call's response
  body in the inspector's Calls section). The shipped M1 code
  (`lib/diagnostics/sinks/turn-capture-sink.ts`) and its only consumer
  (the `__DEV__` smoke producer) still implement the pre-revision
  shape, and the M1 slice doc
  [`05a-pipeline-core.md`](./milestones/01-spine/slices/05a-pipeline-core.md)
  restates it. Align the sink shape (+ its smoke consumer + the 05a
  restatement) to the revised contract now; orchestrator-side stamping
  of `kind` / `anchorEntryId` lands with the real capture producers in
  M2 / M3 per [`roadmap.md`](./roadmap.md).
- **M1.5-gate config defaults vs data-model prose.** Two `app_settings`
  defaults the gate shipped diverge from the data-model's prose and
  need reconciling (a prose fix, or a seeded value): (a)
  `default_calendar_id` is nullable — no calendar exists at first init
  (`vault_calendars` is unseeded) — but `data-model.md`'s App-settings
  storage types it `string`; (b) `ui_language` defaults to `'en'` in the
  config schema, but the data-model says "defaults to OS locale on first
  launch" — the OS-locale seed belongs in the boot / onboarding path,
  not a static schema default. Routes to the calendar domain (M8.3) and
  an onboarding / boot slice respectively.
- **Stale third `DeltaSource` union.**
  `components/compounds/delta-log-row.tsx` redeclares a local
  `DeltaSource` that still carries the dropped `memory_compaction` and
  lacks `periodic_classifier`. The canonical union is `lib/actions`'
  `DeltaSource`. Fold the UI to import it (or align the local copy).
  Out of the M1.5 data-layer slice's scope (UI).
- **Boot registration-ordering is test-unguarded.** `runBootstrap` calls
  `registerAllDomains()` before `recoverInFlightRuns` (load-bearing:
  recovery drives reverse-replay, which resolves descriptors by
  `target_table`). The vitest `setupFiles` pre-registration trips the
  `done` guard, so `runBootstrap`'s own call is a no-op in every test —
  a future reorder of those two lines fails no test, yet at real runtime
  (empty registry) recovery throws `unknown target_table`, swallowed by
  `runBootstrap`'s try/catch (crash recovery silently disabled). Lock
  the ordering with a test seam (reset the `done` guard) or a
  non-empty-registry assertion at the recovery call.
- **Branch-mismatch rejection is test-unguarded across the arm pattern.**
  Every delta-arm handler guards `payload.branchId !== branchId` and
  returns `{ status: 'rejected' }` (the guard that stops reverse-replay
  from reversing the wrong branch's row), but no test exercises that
  rejection in any of them — `story-entries`, the `fixture-domain` test,
  or now `entities`. A refactor dropping the guard fails no test. Add one
  negative case against the shared pattern asserting a branch-mismatch
  payload rejects without writing a row or a delta. Pattern-wide (the
  shared `lib/actions` arm idiom); not the M1.5 entities slice's to own
  alone.
- **Pre-existing storybook flake** (observed during M1.5-gate full-suite
  runs, ~20% of runs). `components/compounds/app-actions-menu-pure.stories.tsx`
  "Diagnostics On" intermittently fails a `findByRole` with a
  `TestingLibraryElementError`; the console shows a load-bearing DOM bug
  — a `<button>` nested inside a `<button>` — the likely cause of the
  unstable query. Predates this branch (last touched in `ee5efe2a`, on
  `main`). Fix the nested-button markup.
- **Happening delete orphans its link rows** (M3/M4). `deleteHappening`
  (slice M01b/04) removes only the `happenings` row — `happening_involvements`
  and `happening_awareness` are FK-less link tables, so their rows are left
  orphaned. Cascade/reconcile is a Tier-2 composition deferred to its
  consumers: the M3 classifier reconcile and the M4 Plot delete-flow. Route to
  whichever of those slices is authored first.
- **Era-flip worldtime reorders vs the non-deferrable unique index**
  (M5/M7). `branch_era_flips` carries `uniqueIndex(branch_id, at_worldtime)`
  (migration `0003`, slice M01b/05). Each `applyDeltaAction` writes one
  delta, so single-action reverse-replay is collision-free. But if a future
  orchestrator batches multiple `at_worldtime` updates into **one** action,
  the batched undo statements run in a single transaction against a
  non-`DEFERRABLE` index — an intermediate undo state could transiently
  violate uniqueness and throw even when the final state is valid. Needs
  deferred-constraint handling or per-row sequencing in the batching layer.
  Zero callers today (the slice ships primitives only). Route to whichever
  of M5 (chapter-close) / M7.2 (era-flip UX) first batches era-flip writes.
- **Empty-patch update throws across the arm pattern.** Every delta update
  handler builds `set` by looping `UPDATABLE`; a patch that parses but
  touches no updatable column leaves `set` empty, and Drizzle's `.set({})`
  throws "No values to set" — the action crashes instead of being rejected.
  Fixed in `chapters` / `branch_era_flips` (slice M01b/05) with an
  empty-set guard returning `rejected`, but the merged sibling arms
  (`lore`, `threads`, `entities`, `happenings` + its link tables,
  `character_relationships`, `story_entries`) still carry the latent bug.
  No current trigger (no UI/orchestrator callers yet). Pattern-wide
  hardening — add the same guard to each, ideally with one shared helper;
  pairs naturally with the existing "branch-mismatch rejection is
  test-unguarded across the arm pattern" item. Route to a delta-arm
  hardening pass (M2/M3, whoever first wires a real update caller).
