# Slice 3.12a — M3 reconciliation: runtime and data integrity

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** none — every slice whose debt this reconciles is
  merged.
- **Blocks:** none —
  [Slice 3.12b](./12b-ui-tooling-contracts.md) is independent.

## Goal

Close the runtime, transactional and query-cost defects M3's own
slices left behind — the half of the former Slice 3.12 that lives in
`lib/`, `electron/` and the action layer. The sibling,
[Slice 3.12b](./12b-ui-tooling-contracts.md), holds the tooling,
test, patch and UI-contract half. This file inherits the unsplit
Slice 3.12's history.

## Background

The unsplit Slice 3.12 held 32 items in four sweeps. Planning
(2026-08-19) ran a per-item verification pass against the code and
found roughly a third of the premises stale or materially wrong —
one day after the triage drain that had claimed to re-verify them.
Outcomes: three items dissolved, eight re-routed to named owners
(both recorded under Implementation notes below), and the survivors
split into this slice and 3.12b. Every item below carries its
corrected premises as of that pass; file/line references are dated
2026-08-19 and must still be re-verified at pickup.

## Required reading

- [`code-conventions.md → Action layer`](../../../../code-conventions.md#action-layer)
- [`testing.md → Coverage: thorough, not exhaustive`](../../../../testing.md#coverage-thorough-not-exhaustive)
- [`retrieval.md → Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle)
- [`retrieval.md → Storage`](../../../../memory/retrieval.md#storage)

## Scope: in

### Transactional integrity and the action layer

- **Make a settings save atomic via `json_set`, not a bridge
  capability.** `updateStorySettings` reads `stories.settings` in a
  bare select (`lib/actions/stories/update-story-settings.ts:65-69`),
  merges, then writes the whole column in a separate
  `runInTransaction` (`:81-87`); `resetStorySettings` has the same
  shape. The original entry said this "needs a bridge capability";
  verification found the repo already ships the cheaper fix: the swap
  engine writes settings via
  `UPDATE stories SET settings = json_patch(settings, json(?))`
  (`lib/db/stories/settings-ops.ts:52-57`), chosen — per its own
  comment — precisely because the action's read-merge-write is a
  separate-transaction race. Two corrections to the recorded blast
  radius: the swap never loses to a settings save (its writes are
  key-scoped); it is the save that clobbers the swap's keys
  (`embedding_swap_target`, `embedding_model_id`, `effectiveDim`)
  when its snapshot predates the patch — and that save is **ungated**
  during a swap, because the swap registers no `RunState`, so
  `isUserEditBlocked` stays false and the race is reachable
  single-window. Phase 2's `assertStoryLive` preflight
  (`lib/actions/embedder-swap/engine.ts:241`) makes the loss loud but
  leaves the swap non-resumable. Decided fix: convert
  `updateStorySettings` to a key-scoped `json_set` op plus post-write
  rehydrate, matching the `settings-ops.ts` precedent; no bridge
  change. Corrected while planning (2026-08-19): the primitive is
  `json_set`, not `json_patch`. RFC-7386 merge-patch deletes a key
  whose value is null, which would drop `activePackId` (required,
  nullable, no default) and make every later read fail as corrupt,
  and it merges nested objects where the action's contract replaces
  them. The swap engine keeps `json_patch` because it wants
  delete-on-null for its optional marker keys. Settled while
  planning: `resetStorySettings` preserves the nine engine-owned
  keys structurally rather than refusing while a swap is admitted.
  Surfaced by M3.11 review (2026-07-22); re-scoped 2026-08-19.
- **Add a defense-in-depth `reversalInProgress` guard at
  `applyDeltaAction`.** Rewritten: the original entry claimed the
  reversal barrier was "specified but never invoked", which is stale —
  it shipped with Slice 3.3 (`lib/actions/story-entries/prose-reversal.ts:21`
  awaits `awaitRunTerminal(PERIODIC_CLASSIFIER_KIND, branchId, 'cancel')`;
  `lib/pipeline/runtime/concurrency.ts:19-21` refuses classifier
  starts during a reversal; the generation store forces
  `isUserEditBlocked`). What survives is narrower: the invariant is
  enforced at the view layer and in per-action guards, never at the
  write choke point — `applyDeltaAction` itself never consults
  `reversalInProgress`, so a future surface or a new action that
  forgets its own guard can silently write mid-reversal. Add the
  guard, a rejection reason, and a test. Surfaced by M3.7a Task 7
  (2026-07-25); premise corrected 2026-08-19.
- **Route the reader's failable dispatches through `runAction` and
  add a global unhandled-rejection handler.** Corrected counts: the
  reader route carries 16 bare `void` dispatches, of which four
  cannot reject (`awaitRunTerminal` returns a promise constructed
  with no reject path), two already carry `.catch()`, and two wrap an
  internally try/caught `runSubmit`. The genuinely-unhandled sites
  (line refs 2026-08-19, `app/reader-composer/[branchId].tsx`): the
  `db.select().then()` at 437, `redoLastAction` (999),
  `undoLastAction` (1000), `menuUndo` (1056), `menuRedo` (1067),
  `confirmRollback` (1257). **Six, not the eight recorded here
  before** — implementation found `refreshEmbeddingStatus` (450) and
  `rehydrateStories` (485) are internally try/caught and always
  resolve, already reporting under `embedder.status_refresh_failed`
  and `bootstrap.stories_hydrate_failed`. Wrapping them would have
  added two log kinds that can never fire, so they stay bare `void`
  with a comment pointing at the event each callee already emits. The global handler is the separable half and lands first
  (platform fork: `unhandledrejection` listener on web/desktop
  renderer, `HermesInternal.enablePromiseRejectionTracker` on
  native — corrected at implementation from `ErrorUtils`, which
  handles uncaught exceptions and only ever sees a rejection
  downstream of a tracker), routed through `logger.error`.
  Each site conversion is a small toast-versus-log call with copy,
  decided per site at implementation — a failed background
  `refreshEmbeddingStatus` is not the same event as a failed undo.
  Note `components/reader/world-time-editing.ts:56-59` documents a
  reliance on the absence of a global handler; re-check it when the
  handler lands. Split out of the post-3.8 tidy 2026-08-18; counts
  corrected 2026-08-19.
- **Align the prompt with the reader on the calendar fallback.** The
  narrowed remainder of the calendar-registry item:
  `lib/pipeline/definitions/generation-context.ts:163` calls
  `getCalendar` with no fallback and sends
  `calendarVocabulary: null`, while the reader renders through
  `resolveCalendar`'s `earth-gregorian` fallback — so on a
  non-builtin `calendarSystemId` the reader shows Gregorian dates
  while the model is told there is no calendar. Pick one direction;
  default: the context builder adopts `resolveCalendar` so both
  surfaces agree. Only seeded data can produce a non-builtin id
  today (the wizard offers builtins only), and the
  registry-consults-`vault_calendars` half is routed to M8.3 — the
  persisted calendar shape is undefined, and the seeded
  `cal_default` row does not even match `calendarSystemSchema`.
  Raised 2026-08-16 by the Slice 3.8 review; split 2026-08-19.
- **Salvage healthy rows when a wizard draft row is malformed.**
  `parsePersistedState` (`lib/actions/wizard/session.ts:110`) runs
  one `safeParse` over the whole working state and returns
  `emptyWorkingState()` on any failure, discarding the title,
  description, genre, tone, setting, calendar, opening prose, and
  every healthy sibling row. Parse the scalar shell, then map each
  `cast` / `lore` row through its own `safeParse`, dropping failures
  with a count in the toast — the pattern is shipped at
  `decodeCaptures` (`lib/probe/read.ts:90-109`). Not reachable
  through the app today (writers are typed, schema strips unknown
  keys); the realistic triggers are a schema tightening or a
  hand-edited database. Raised 2026-08-14.
- **Make Cancel reach a local embed.** Two platforms, two shapes.
  Android (`lib/embedder/local/runtime.native.ts:131-154`) already
  loops per text in-process: accept the signal and check it between
  iterations. Desktop is one IPC call
  (`lib/embedder/local/runtime.ts:29-33`) into a single
  transformers.js `pipe(args.texts, …)` run
  (`electron/embedder/service.ts:95-113`) that is not interruptible
  mid-inference — so the work is a cancellation channel through the
  bridge (the `cancelDownload` precedent already spans
  `electron/embedder/types.ts` → `preload.ts` → `main.ts` with a
  per-call abort registry) **plus chunking inside the Electron-main
  service**, because cancel-between-chunks is what makes the channel
  useful. Chunking must be reconciled with
  `lib/retrieval/sync.ts:39-42`'s no-partial-success contract:
  chunking is not partial success — every chunk must succeed or the
  stage fails; cancel stops between chunks. Share one chunk constant
  with the drain's `BATCH_SIZE = 16` unless measurement argues
  otherwise. Surfaced by the M3.4 review (2026-08-06); platform
  split verified 2026-08-19.
- **Invert the `embedding_stale` create default, derive the update
  flip, and revalidate before re-embedding — in both the drain and
  the sync stage.** Design settled 2026-08-07 and re-verified: all
  five register files default `embeddingStale` to `0` on create
  (entities, lore, threads, happenings, and chapters too); flip the
  default to `1` — a new row has no vector by definition. On update,
  flip only when an embedded column actually changed:
  `KIND_FIELDS[kind].includes(col) && set[col] !== current[col]`,
  with both values already in the update loop's hands. Comment the
  narrow flip set at the site — for entities only `name` and
  `description` flip, which is correct (nothing else is embedded)
  but reads as a bug. Wire `recomputeStaleOps` (already used by the
  cross-model cancel) into the stale-row load — and note the load is
  shared: `lib/embedder/drain.ts` **and** `lib/retrieval/sync.ts`
  both consume the same `loadStaleRows` path, so revalidating only
  the drain would leave the blocking pre-retrieval stage re-embedding
  rollback-restored content. Also in scope: sweep
  `lib/db/devtools/seed-dataset.ts`'s ~15 `embeddingStale: 0` rows
  (they carry no vectors, so the inversion fixes them), and
  re-verify — not blindly flip — `create-story.test.ts`'s post-splice
  `embedding_stale == 0` assertions. The import-path audit dissolves:
  no import module exists. The raw `ctx.db.run` writers in
  `lib/actions/classifier/deps.ts` touch only
  `branches.classifier_status` — no embedded column, so no trigger
  is needed today. Live exposure note: no current caller flips an
  embedded column on update, so the drift is entirely prospective —
  which is exactly why this must precede M4's edit surfaces, since
  [`retrieval.md → Storage`](../../../../memory/retrieval.md#storage)
  has already traded away the retrieval-time hash check on the
  premise that the flag cannot be forgotten. Create half surfaced by
  the M3.4 review (2026-08-07); drain half by M3.1b manual smoke
  (2026-07-27); scope verified 2026-08-19.
- **Curate the embedder-swap barrel.** The correctness payload
  extracted from the deferred `lib/actions` extraction pass:
  `lib/actions/embedder-swap/index.ts` re-exports the raw engine
  primitives (`startSwap`, `resumeSwap`, `cancelSwap`,
  `reindexStory`, `relabelModel`) alongside the safe `app-deps`
  wrappers, with zero comments — the lock contract ("caller must
  hold the per-story admission lock") is documented only inside
  `app-deps.ts`. A future caller reaching for `startSwap` instead of
  `startStorySwap` skips the admission lock and the
  `isUserEditBlocked` check, which is a real corruption path. Stop
  exporting the primitives from the barrel; tests deep-import.
  Surfaced 2026-08-01; narrowed 2026-08-19. (The extraction pass
  completed 2026-08-26 — see Slice 1.5a's Post-M1 reconciliation for
  the `defineAction` half.)

### Query and render cost

- **Split `loadHappeningRows`' OR into two indexed queries and add
  the `(branch_id, occurred_at_entry_id)` index.** Both halves
  verified necessary by `EXPLAIN QUERY PLAN` against the real table
  shape: even with the index added, the OR-ed form still plans as a
  branch scan — only the split form seeks. Two queries, in-memory
  dedupe on the union; migration precedent is `0006` (the partial
  stale index). Note for the next item: `buildHappeningsPool`
  (`lib/retrieval/run.ts:576-579`) feeds `boostedEntryIds` — every
  entry id in every seated chapter, chapter-scaled and unbounded —
  into this same bind list. `pnpm bench:retrieval` picks the
  migration up automatically; run before/after on the committed rig.
  Surfaced by the M3.4 cost re-derivation (2026-08-08); plan-shape
  verified 2026-08-19.
- **One pass over SQL bind-list chunking — after the index split.**
  Both runtimes verified at a 32766 floor (desktop probed directly on
  `node:sqlite` / SQLite 3.51.2; `expo-sqlite` 55.0.16 vendors the
  same default with no override). Premise correction: the claim that
  `ADMIT_ID_CHUNK`'s input "is capped at three times `KNN_K`" is
  wrong — `admitted` is the chapter-range set _minus_ KNN hits, which
  scales with chapter length. Establish the chunk policy once (one
  constant, one rationale comment naming the real floor), and record
  boundedness per site across the unchunked builders —
  `awareness.ts`, `engine.ts`'s branch-id lists, `field-rows.ts`,
  `vec-tables.ts`, plus the unlisted `knn.ts` and `source-rows.ts` —
  so the next reader does not re-derive them. Lands after the index
  split, which changes both the bind arithmetic and `admitted`'s
  derivation. Surfaced by CodeRabbit review of the M3.4 triage PR
  (2026-08-08); floor re-probed and premise corrected 2026-08-19.
- **Cache `formatWorldTime`'s parsed template — after re-measuring.**
  `lib/calendar/render.ts` still parses `displayFormat` per call, but
  the recorded comparison (2.1 ms of parse against 13.0 ms of
  `worldTimeToTuple`) is dead: the tuple conversion gained caches on
  2026-08-18, taking the 50-row walk from 24.0 ms to 3.4 ms.
  Re-measure first; if the parse still earns it, cache parsed
  templates by `displayFormat` string. Extend
  `bench/calendar-cost.test.ts` with a decoration-walk row (~20
  lines) so the before/after is committed. Raised 2026-08-15 by the
  Slice 3.8 Task 2 review.
- **Bound the blocking sync stage's provider fan-out and split the
  local call.** The surviving parts of the sync-stage item: pass
  `maxParallelCalls` to the SDK's `embedMany`
  (`lib/ai/embedding.ts:68-79` omits it and the default is
  `Infinity` — capping the fan-out is an SDK option, not custom
  scheduling), and chunk the local backend (shared with the
  local-embed-cancel item's desktop chunking above). The per-request
  **token** budget is routed to M7.1 — it needs a per-provider limit
  no settings surface carries. Canon check recorded:
  [`retrieval.md → Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle)'s
  "one batch" collapses repeated writes; it does not mandate one
  HTTP request, so chunking does not violate it. Test shape is
  failure-injection, not timing (see Tests). Surfaced by M3.4
  Task 12 review (2026-08-02); narrowed 2026-08-19.

## Scope: out

- Everything in [Slice 3.12b](./12b-ui-tooling-contracts.md).
- The eight re-routed items — see Implementation notes → Planning
  resolutions for the routing record.
- Items routed to a later milestone's slice-authoring notes in
  [`roadmap.md`](../../../roadmap.md) during the 2026-08-18 triage
  drain, and items parked under
  [`parked.md → Parked until signal`](../../../../parked.md#parked-until-signal).
- Root-causing the Storybook file-load flake and the NativeWind
  gaps, both since closed — see
  [`lessons-learned → Failed Storybook files with zero failed tests`](../../../lessons-learned/storybook-load-flake-zero-failed-tests.md).

## Acceptance criteria

- Every Scope: in item is closed with a test that fails when the fix
  is reverted, mutation-checked rather than assumed — except the
  template-cache item, which may instead close as "not worth it"
  with the committed re-measurement as evidence.
- The settings-save fix carries an interleave test: a save landing
  during a simulated swap phase-1 window leaves the swap's keys
  intact.
- The index and bind-chunk items carry before/after evidence
  (`EXPLAIN QUERY PLAN` or the committed bench) on the same rig.
- No item is closed on a premise that was not re-verified against
  the code at pickup — this doc's line references are dated
  2026-08-19 and drift.

## Tests

Unit tests at the action layer for the transactional items;
interleave tests where a race is the defect; failure-injection unit
tests for the embedder work (oversized set → chunked requests, N
chunks → at most the cap in flight, cancel between chunks) — the
former sweep's uniform before/after-measurement criterion mis-fits
robustness fixes and is deliberately not applied to them. Committed
benches for the query/render items (`pnpm bench:retrieval`, the
`bench/calendar-cost.test.ts` extension). One new E2E, for the local
embed's cancel alone: the abort check only means anything behind the
real renderer→main IPC hop and the real message pump, which no unit
test crosses, so `e2e/tests/embedder-cancel.spec.ts` drives a turn's
sync stage into a chunked embed and cancels it. The rest of the new
IPC surface changes no user-facing flow shape and stays covered at
the Electron service seam by unit tests. The Android half of the
cancel was verified on a device rather than by manual smoke — see
Implementation notes.

## Open questions

- Chunking defaults for the local embed path: the shared chunk
  constant (default: reuse the drain's 16) and the
  `maxParallelCalls` cap value (default: 2).
- Bind-chunk policy below the verified 32766 floor: keep a smaller
  chunk for transaction-size / IPC-payload reasons, or chunk only
  near the floor and drop the constants where input is bounded by
  construction.
- Per-site toast-versus-log calls for the eight reader dispatches
  (implementation-time, with copy).

## Implementation notes

**Planning resolutions (2026-08-19).** The unsplit Slice 3.12 was
verified item-by-item against the code and split into 3.12a / 3.12b;
this file inherits the original's history. **Dissolved:** the
reversal-barrier item as written (the barrier shipped with
Slice 3.3; rewritten above as the `applyDeltaAction` guard); the
`useTier`-per-`EntryCard` item (tier is width-derived and the soft
keyboard changes height, so the feared storm is N identical-output
re-renders of a conditional footer — not worth a WebView profiling
rig); the suggestions-invisible-to-old-stories item (3.7b shipped
the toggle; an E2E proves the persisted round-trip). **Re-routed
with owners:** the `buildGenerationContext` data-source refactor and
the `lib/actions` extraction pass → `followups.md`'s Code-structure
section (near-future refactors, per the developer); both landed and
the section is gone with them, the refactor on 2026-08-28. The
`updateEntryWorldTime` metadata race → the world-state-block pass
([`followups.md → UX`](../../../../followups.md#ux)), whose
scene-field editor is the concrete second writer that would arm it;
the `vault_calendars` registry → M8.3; the per-request embed token
budget and `structuredOutput: force-on` wiring → M7.1; the
`validateRegistry` undeclared-variable direction → M7.2 (its pack
tab gates on this validator); window-level accounting → M7.2 (the
retrieval-budget editor it protects lives in the Memory tab).

**Consequences of the key-scoped settings write (Task 1).** Three
follow-on facts surfaced during implementation and review, none of
them blocking:

- **Zod defaults no longer self-heal.** The old whole-blob write
  incidentally materialised every `.default()` value into the stored
  blob on each save; a key-scoped write only touches the patched
  keys. This is the same property that closes the race, so it cannot
  be avoided. Today nothing breaks — every write path
  (`buildStorySettings`, `create-story.ts`, `resetStorySettings`,
  the seed dataset) produces a complete parsed blob, and the one
  unparsed consumer (`lib/actions/embedder-swap/app-deps.ts:265`)
  reads only `embedding_*` keys, which carry no defaults. The
  forward hazard is real though: **adding a `.default()` key to
  `storySettingsSchema` now needs a backfill migration**, where it
  used to heal itself on the next save.
- **A save that fails corrupt still lands its write.** Detection
  moved to a read-back after the write, so a save whose keys do not
  repair a corrupt blob persists its values and bumps `updated_at`
  before throwing, and the caller reports a failed save. Accepted
  rather than given the `StorySettingsStaleStoreError` treatment:
  the state is only reachable through external DB corruption, and
  its real repair path is `resetStorySettings`. Recorded here so it
  is a decision rather than an oversight.
- **Malformed-JSON blobs bypass the repair affordance, as before.**
  A syntactically invalid column makes `json_set` raise inside the
  transaction, so `setOpenFailure` never runs — but the old path
  dead-ended identically (drizzle's json-mode select threw on the
  same input). Parity, not a regression.

**The reset item landed on the other branch than planned (Task 2).**
Planning settled that `resetStorySettings` preserves the nine
engine-owned keys, and froze the corrupt-blob repair branch verbatim.
Execution found that split backwards. `resetStorySettings` has exactly
one production caller — the recovery dialog (`app/index.tsx`), whose
reset button is gated on `kind === 'settings-corrupt'`
(`components/story/story-config-recovery-dialog.tsx`) — and that kind
is only ever set after a schema parse has already failed. The dialog's
reset is therefore **always** the parse-failure branch, so:

- **The parse-success branch is effectively unreachable today.** Its
  key-scoped write is forward-safety for any future "Reset to
  defaults" surface in story settings, not a live fix. Keep that in
  mind before citing it as one.
- **The incoherent-trio hole was never on the branch the plan
  changed**, so the claim in commit `77a2c291` that preserving
  `embeddingBackend` closes it is false on every reachable path. Two
  independent passes reproduced the real bug: a corrupt blob carrying
  a provider backend, a provider model id, and a provider id comes out
  of reset as local-backend with the provider model id still attached,
  resolving as `unknown-local-model`. Commit `66f2689e` is what
  actually closes it, by **reopening the frozen branch** — a
  deliberate deviation from the planned scope.
- **The repair rule.** `lockedEmbedding` carries `embeddingBackend`
  when it validates against the schema's own enum, and the repair
  drops `embedding_provider_id` and `effectiveDim` whenever the
  resolved backend is local, mirroring what `setEmbeddingTargetOp`
  already does for a local target. A rejected alternative is pinned by
  a test: inferring `provider` from a surviving `embedding_provider_id`
  is wrong, because `buildStorySettings` writes that key regardless of
  backend and the dev seed ships a local backend beside a real
  provider id — the inference would flip correct local stories and let
  `resolveEmbedderConfig` pass a provider config naming a local model.
  Accepted residual: backend unreadable plus an app default of local
  plus a carried provider model id still resolves
  `unknown-local-model`. That corner fails gated and recoverable,
  which is the right failure mode for a repair path.
- **Six of the nine engine-owned keys are structurally inert.**
  `buildStorySettings` never emits the five `embedding_swap_*` keys
  and omits `effectiveDim` when called without locked overrides, so
  what actually spares the swap markers is the write being key-scoped,
  not set membership. The six are kept as belt-and-braces should
  `buildStorySettings` ever grow one.
- **Unknown keys now survive a reset** on the parse-success branch,
  where the whole-blob write used to strip them. Inert — settings are
  a `$type` cast that zod re-parses on read.

Related: `assertStoryLive` narrows the reset-versus-swap race to
phase 2's flip window; it holds no lock and does not close it. Comments
that claimed otherwise were corrected in this slice.

**Unhandled rejections record past the diagnostics gate (Task 4).**
Implementation found the handler would have been inert where it
mattered most: `logger` drops everything when diagnostics are off, and
that setting defaults off outside dev, so the backstop recorded
nothing in a production build. Developer decision (2026-08-19):
unhandled rejections are recorded **regardless** of the setting, via a
named `ALWAYS_RECORDED` set in `lib/diagnostics/core/logger.ts` rather
than a per-call flag, so the list of kinds that override a user's
choice stays auditable in one place. The bar for adding another, and
the privacy consequences, are canon in
[`observability.md`](../../../../observability.md). Three constraints
fell out of review and are worth not relearning:

- **The bypass covers both surfaces.** Reversed during PR review:
  the original split (store write bypasses, console mirror does not)
  was argued from distribution surface — logcat and devtools reach
  wider than a capped in-memory buffer read on demand. What that
  misses is that the bypassing entry is already captured locally and
  already exportable from the Logs tab, so the console adds no secret
  the device did not hold; it only makes the same record legible
  without opening the tab. Against that, a split gate means the Logs
  tab and devtools disagree about what happened, which costs an
  engineer more than the surface delta buys. Canon in
  [`observability.md`](../../../../observability.md).
- **A retraction must travel with its accusation.** The tracker
  reports any promise unsettled after roughly two seconds, so
  ordinary deferred-await code produces false positives, and
  `onHandled` is what withdraws them. An accusation that records
  while its retraction is gated out is worse than neither.
- **Native registers only in production.** React Native's and Expo's
  own trackers are dev-gated and give a symbolicated LogBox stack that
  routing through `logger` can only flatten, so registering ours in
  dev traded a tappable stack for an escaped string.

Still uncovered, filed in
[`triage.md`](../../../triage.md): the Electron main process, which
hosts SQLite and the embedder and needs an IPC path to report at all.

**The happenings split is seek support, not a measured win (Task 12).**
`bench:retrieval` cannot resolve this change at the fixture's documented
ceiling: `knnMs` ranged 74.9-79.3 ms across six runs with and without
it, so run-to-run noise exceeds the effect. A micro-benchmark at ten
times that scale showed 20-30%, and **only with both the index and the
split** — either alone showed no consistent gain, which is what makes
neither half dead weight. The acceptance evidence is therefore
`EXPLAIN QUERY PLAN`, not the bench: the OR form walks every
`branch_id = ?` row, while the split's two statements seek on the
primary key and on `happenings_occurred_idx`. A future scale-planning
pass should not expect `knnMs` to move until happenings counts grow
well past the projections in
[`retrieval.md`](../../../../memory/retrieval.md).

One precondition is worth not rediscovering: the OR form's inability to
seek is a property of **this app's configuration**, not of SQLite.
Given `ANALYZE` statistics the planner will choose `MULTI-INDEX OR` for
small bind lists — it still degrades to a scan as they grow — and
nothing in this repo runs `ANALYZE` or `PRAGMA optimize`. The split is
still the right call because it seeks unconditionally, but anyone
re-verifying the plan output should know what would change it.

**The 999-variable floor both chunk constants were sized against
does not exist on either runtime (Task 13).** `STALE_ID_CHUNK = 400`
and `ADMIT_ID_CHUNK = 990` each carried a comment citing "the
999-variable floor of older SQLite builds". Probed directly, desktop
`node:sqlite` (SQLite 3.51.2) binds 32766 parameters and throws
`too many SQL variables` only at 32767; `expo-sqlite` 55.0.16 vendors
`SQLITE_MAX_VARIABLE_NUMBER 32766` in both its `sqlite3` and
`sqlcipher` trees and never overrides it in its Gradle build flags.
999 is a pre-3.32 SQLite default. Both constants collapse into one
`BIND_CHUNK = 8192`, which keeps 4× headroom for statements binding a
second list alongside while folding every realistic id set into a
single statement.

Two premises in the plan's own audit were wrong and are worth not
re-deriving. `knn.ts`'s id list is **not** bounded by `KNN_K`
multiples — `vectorsByIdQuery`'s only caller passes the chapter-range
admission set _minus_ the KNN hits, which is chapter-scaled; it is
safe because that caller chunks, not because anything bounds it. And
the `=> '?'` grep the audit list was built from misses drizzle's
`inArray`, which hid two further sites
([`delete-story.ts`](../../../../../lib/actions/stories/delete-story.ts),
[`story-names.ts`](../../../../../lib/recovery/story-names.ts)).

The `branchIds` sites are deliberately commented rather than chunked,
and the distinction is a **scale argument, not a bound**: nothing
caps `branches` — no CHECK, no UNIQUE, no constant — but the set is
story-scoped (`loadSwapContext` selects `WHERE story_id = ?`) and
grows only by an explicit user fork, so reaching the ceiling needs
32,766 forks of one story. Today it is exactly one, since
`create-story.ts` is the sole inserter and fork-from-entry is not
built. The slice that builds forking should re-read this: the nine
branch sites chunk trivially except `field-rows.ts`, which needs
`RowQuery → RowQuery[]` across four callers.

**The shared chunk constant the brief asked for is not achievable
(Tasks 16-17).** Scope: in says to "share one chunk constant with the
drain's `BATCH_SIZE = 16`". `electron/tsconfig.json` sets
`rootDir: "."` scoped to `electron/` with no path aliases, so main
cannot import from `lib/` at all. `EMBED_CHUNK` is therefore
duplicated with a cross-reference comment, matching the deliberate
duplication that already exists between
[`types/embedder-bridge.d.ts`](../../../../../types/embedder-bridge.d.ts)
and `electron/embedder/types.ts` — those two are now byte-identical
again, with `cancelEmbed` **required** rather than optional, because
`preload.ts` sets it unconditionally and an optional member would let
a preload that forgot to expose it typecheck clean.

Three things about the cancel path are worth knowing before touching
it. A signal already aborted when `embed` is called costs zero ONNX
runs, because the abort check sits _before_ each chunk's `await`; a
cancel **delivered while a chunk is running** costs exactly that one
chunk, and only because the loop yields to the macrotask queue ahead
of the check. Without that yield it costs two — onnxruntime-node
resolves a run from inside a `setImmediate`, so a chunk's promise
settles in a microtask while the IPC carrying the cancel is still
queued, and the next check reads a pre-cancel signal. Only a test
that enqueues the abort as a macrotask can tell the two apart. The web
runtime's `cancelEmbed` call carries a `.catch`: it is fire-and-forget
from an abort listener, and Task 4's renderer rejection handler would
otherwise surface a failing cancel as an unattributed
`app.unhandled_rejection` during a user cancel. And the native runtime
still builds its ORT bundle before honouring an already-aborted
signal, which is deferred work rather than wasted — the bundle is
memoized per model and the next embed needs it — but it is an
asymmetry with web's pre-check, not an oversight.

Chunking also made two states representable that a single call could
not. `dim` is now fixed by the first chunk and a later chunk that
disagrees fails the embed with a `kind: 'call'` error rather than
silently keeping either value — impossible with a real ONNX model,
but cheap to close once the loop exists. And the no-partial-success
contract `lib/retrieval/sync.ts` documents is now pinned by a test
rather than resting on `vectors` happening to be block-scoped inside
the `try`: the tempting refactor is to salvage completed chunks when
a later one throws, and that is exactly what the contract forbids.

One consequence went to [triage](../../../triage.md) rather than
being fixed here: because main returns a cancelled embed as an
ordinary `kind: 'call'` envelope, a deliberate user cancel now writes
an error-level diagnostics entry indistinguishable from a real
embedder fault. Distinguishing them needs a third envelope kind
across the IPC boundary, which is a contract change rather than a
fix.

**The Android cancel is measured, not inferred (2026-08-20).** The
claim that the native runtime needs no equivalent of the desktop
macrotask yield — because ORT-RN resolves from a genuine async native
call, leaving the JS thread free for a queued `abort()` — was reasoned
from the runtime's shape and could not be checked by any unit test. It
now has a number. Driving a real turn on an x86_64 emulator against
the `Xenova/all-MiniLM-L6-v2` model, with the same mutation the unit
tests use (delete the loop-top `signal?.aborted` check, served over
Metro so no rebuild is needed), time from tapping Cancel to the turn
ending was **3.4 s with the check and 7 min 28 s without it** — the
mutant cannot end the turn until all ~3000 stale rows finish
embedding. The abort genuinely reaches the per-text loop on device.

Three things about that setup are worth not rediscovering. The
background drain clears the whole stale set in two to three minutes,
faster than a `uiautomator`-driven flow can send a turn, so the
fixture needs thousands of rows rather than the E2E's 320 — otherwise
the turn's sync stage finds nothing to embed and there is no cancel
window at all. `uiautomator` reports an element's layout bounds even
when the IME window covers it, so Send reads as present and enabled
while taps land on the keyboard; `KEYCODE_ESCAPE` (111) dismisses the
IME, while `KEYCODE_BACK` navigates out of the reader. And the device
fixture has to be installed before launch — the app's SQLite file and
the model directory are pushed into the sandbox through `run-as`,
because Android ships no `sqlite3` binary, which is what makes the
post-launch external write the desktop spec relies on unavailable.

**The swap-barrel item was smaller than recorded (Task 11).** The
entry above framed this as closing an exposure. It wasn't one. The
top-level `lib/actions/index.ts` already excluded the five engine
primitives with a comment saying exactly why, so app, components, and
hooks were never able to reach them — and the intra-`lib/actions`
route turned out to be closed in practice too: both barrel consumers
(`classifier/deps.ts`, `stories/operational.ts`) import safe wrappers,
and the two turn tests already mock `./engine` directly rather than
the barrel. Nothing needed re-pointing. What landed is a defensive
tightening of an export list nothing was exploiting, which is worth
having — the unsafe pair should never be the more obvious import —
but it closed no live path, and the slice should not claim otherwise.

**Scope added during execution: reverse-replay must flip the flag
(2026-08-19).** Review of the staleness work found a third writer the
plan never accounted for, and it fails in the unsafe direction.
`lib/actions/delta/reverse-replay.ts` restores prior column values
from `undoPayload` but never touches `embedding_stale`. So an edit
sets the flag, a retrieval embeds the row and clears it, and a
subsequent undo, rollback, regenerate, or crash-recovery restores the
old text against a vector for text that no longer exists — with the
flag reading clean. Nothing re-derives it short of a full embedder
swap, and canon deliberately has no retrieval-time hash comparison to
catch it. Canon already specifies the fix ("they write rows, flip
`embedding_stale` by the same per-row checksum"), so this is
code-versus-canon drift rather than a new decision. Folded into this
slice on the developer's call, because the premise justifying the
whole no-tripwire design is that the flag cannot be forgotten, and
that premise is false while this path is open. Sequenced **after the
revalidation task**, so the restored row can simply err dirty and let
revalidation clear it back to zero without paying for a re-embed when
the restored content already matches its stored vector.

**Redo had to follow, and it was the worse half (2026-08-20).**
Fixing the undo direction alone would have shipped one half of one
feature. `snapshotForRedo` captures the whole row _before_ the undo
runs, `embedding_stale` included, and `applyRedo` writes it back
wholesale — so redo does not merely fail to dirty a row, it
overwrites a legitimately-dirty flag with a stale `0`, undoing the
undo-side fix on the very next CTRL-Y. Folded in on the developer's
call for the same reason the undo half was. The gate is table
membership only: redo writes every column and carries no diff, so
there is no field-membership signal to gate on, and buying one would
cost a read of the current row per delta to save a hash compare
revalidation already does for free. The inverse table→embedded-fields
map moved to [`lib/db/embeddings/stale.ts`](../../../../../lib/db/embeddings/stale.ts)
in the same pass, beside the two constants it derives from, once both
delta directions needed it.

One trap is worth not rediscovering, because it made a test vacuous
before it was caught: Drizzle builds its column list from the table
schema, so a flag leaked onto a non-embeddable table is dropped from
the generated SQL **silently**. A gate test asserting "the write
fails" therefore asserts nothing — the write succeeds either way.
Both directions' gates are now pinned through the working-set store,
whose patch is an unfiltered spread and does observe the extra key.
Written up in
[`lessons-learned/drizzle-drops-unknown-keys.md`](../../../lessons-learned/drizzle-drops-unknown-keys.md).

**The calendar fallback has a live consequence, not a hypothetical
one (Task 6).** The prompt builder now resolves through
`resolveCalendar`, so an unresolvable `calendarSystemId` describes
the same fallback the reader already renders. The premise recorded
above — that only seeded data can produce such an id — held, and it
matters more than "only seeded" suggests: the seeded story's
`cal_default` is a `vault_calendars` row absent from the registry, so
**that story's prompts now carry a Gregorian calendar section
describing year/month/day/hour for a 360-day year/season/day
calendar**. Previously the section was omitted entirely, which was
not better — the reader was already showing Gregorian dates, so the
model was the only party left uninformed. Both surfaces now agree,
and both become correct together when M8.3 teaches the registry to
consult `vault_calendars`. `resolveCalendar`'s totality also gained
its first test: it rests on a hand-maintained string match between
`DEFAULT_CALENDAR_ID` and a builtin's `id`, which the type system
cannot enforce, and the new call site turns a typo there from silent
degradation into a throw on every generation.
