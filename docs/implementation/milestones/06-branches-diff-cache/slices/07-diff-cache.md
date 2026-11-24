# Slice 6.7 — Diff cache

## Metadata

- **Milestone:** [Milestone 6 — Branches + diff cache](../milestone.md)
- **Depends on:** none. Two things wait inside it. Its eviction tasks
  start after R3's canon pass lands
  ([C12](../milestone.md#c12--canon-and-flips)). Its database-seeded
  two-branch key test needs [Slice 6.1](./01-copy-substrate.md)'s
  composite `deltas` key, with no edge: it is a criterion here if 6.1
  has landed, and in 6.1 if this slice has
  ([C9](../milestone.md#c9--the-diff-caches-seams)).
- **Blocks:** none. It meets [Slice 6.8](./08-per-branch-lead.md) only at
  `isLead`'s prose: a criterion here if 6.8 has landed, and in 6.8 if
  this slice has.

## Goal

World and Plot History say what an update changed, before and after,
for the seven tables they list. This slice delivers the consistent read
the walk needs, the walk itself, an in-memory cache of its results keyed
by branch and delta id, a renderer that turns an entry into prose, and a
History host that shows the field-name summary until the prose resolves
and keeps it when the walk fails. A reversal, a redo and a journal
write-back evict their branch's entries through a post-commit hook that
`lib/actions` owns, so no entry outlives a rewrite of the log.

## Background

An update's `undo_payload` holds the value it replaced. Nothing stores
the value it wrote: the row as it stands is that value only for the
newest delta on it. The walk recovers the rest by reading the row's
later deltas and stepping back through them, newest first, applying each
payload column by column as rollback does. Canon assumes a WAL read
transaction for that read; neither platform has one, so the slice builds
the read. Since M4, History renders `Modified <fields>` from the
payload's keys (`lib/history/humanize.ts:71-78`); that summary stays as
the miss path, for search, and for the reader's undo confirm. The design
is
[`architecture.md → Delta history diff resolution`](../../../../architecture.md#delta-history-diff-resolution);
R3 (evict by branch, through a hook) lands in it before the eviction
tasks start.

## Required reading

- [`architecture.md → Delta history diff resolution`](../../../../architecture.md#delta-history-diff-resolution)
  whole:
  [Walk algorithm](../../../../architecture.md#walk-algorithm),
  [Cache shape and lifecycle](../../../../architecture.md#cache-shape-and-lifecycle),
  [Consumer flow](../../../../architecture.md#consumer-flow),
  [Concurrency, rollback, error path](../../../../architecture.md#concurrency-rollback-error-path)
  and
  [Search is orthogonal](../../../../architecture.md#search-is-orthogonal),
  as R3's design pass leaves them.
- [`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay),
  from "A delta's result is the prior value of the next delta" through
  "Only a reversal rewrites a prior value": what a reversal does to the
  payloads the walk reads, and the column groups.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  (the `op=update` encoding, the meta keys, and the paragraph on a redo's
  re-insert and the journal write-back), the `deltas` entity and
  `deltas_chain_idx` in the [ER diagram](../../../../data-model.md#diagram),
  and [`Branch model`](../../../../data-model.md#branch-model) for why a
  delta id repeats across branches.
- [`world.md → History tab`](../../../../ui/screens/world/world.md#history-tab)
  whole (Search, Link rows, Link-row wording, Refresh),
  [`History tab — lore`](../../../../ui/screens/world/world.md#history-tab--lore),
  and the History bullet of
  [`plot.md → Threads side`](../../../../ui/screens/plot/plot.md#threads-side).
- [`delta-log-row.md → Summary`](../../../../ui/patterns/delta-log-row.md#summary)
  and [`lists.md → Search bar scope`](../../../../ui/patterns/lists.md#search-bar-scope).
- [`tech-stack.md → TanStack Query`](../../../../tech-stack.md#12-tanstack-query-react-query).
- [`observability.md → Logger contract`](../../../../observability.md#logger-contract)
  and
  [`Subsystem emission inventory`](../../../../observability.md#subsystem-emission-inventory).
- [`code-conventions.md → Module structure`](../../../../code-conventions.md#module-structure),
  [`State placement`](../../../../code-conventions.md#state-placement),
  [`i18n discipline`](../../../../code-conventions.md#i18n-discipline)
  and
  [`Testing discipline`](../../../../code-conventions.md#testing-discipline).
- [`testing.md → E2E target: desktop only`](../../../../testing.md#e2e-target-desktop-only),
  [`Fixture + seed contract`](../../../../testing.md#fixture--seed-contract),
  [`Mock LLM`](../../../../testing.md#mock-llm) and
  [`Selector strategy`](../../../../testing.md#selector-strategy).
- Milestone contracts: [C9](../milestone.md#c9--the-diff-caches-seams),
  which this slice provides;
  [C1](../milestone.md#c1--delta-rows-on-two-branches), which it
  consumes; [C11](../milestone.md#c11--shared-files) and
  [C12](../milestone.md#c12--canon-and-flips), which it follows; the
  [Definition of done](../milestone.md#definition-of-done)'s Diff prose
  line; and the prose's wording,
  [`world.md → Change prose`](../../../../ui/screens/world/world.md#change-prose).
- Lessons:
  [known-answer vectors share blind spots](../../../lessons-learned/known-answer-vectors-share-blind-spots.md#how-to-apply)
  (walk tests take expectations from what the test wrote, never from the
  walk),
  [the unit project can't render RN-Web chrome](../../../lessons-learned/unit-project-no-rn-web-chrome.md#how-to-apply),
  [one `exhaustive-deps` suppression disables the compiler](../../../lessons-learned/exhaustive-deps-suppression-disables-the-compiler.md#how-to-apply),
  and, if the read is one statement,
  [a JSON value crossing a scalar subquery needs `json()`](../../../lessons-learned/sqlite-json-subtype-lost-across-subquery.md#how-to-apply).

## Scope: in

The proposed home for the walk, the cache and the renderer is
`lib/history` (`diff-walk.ts`, `diff-cache.ts`, `diff-prose.ts`), which
already imports the `lib/actions` barrel and which `lib/actions` never
imports. Canon leaves the path to implementation; planning may pick a new
`lib/` module instead, under the same import rule. Test files named below
follow the default.

**The consistent read.**

- One read gives the walk a target's chain and its seed together: every
  delta on `(branch_id, target_id)` with `log_position` at or above the
  oldest requested delta, `target_table` as a post-filter, every op,
  retrieval bumps included, ordered by `log_position`; and the target
  row by branch and id. No forward write may commit between the two
  halves.
- Rows come back as drizzle maps them: field names, not columns
  (`inverseKind`, not `inverse_kind`), JSON columns parsed, integer
  booleans as the schema types them. Payload keys are field names
  (`lib/history/link-ends.ts:45`), so a raw read that skips the mapping
  misses every key, and a `0` against a `false` breaks the "old equals
  new renders nothing" rule.
- Planning picks the mechanism; see
  [Open questions](#open-questions). Whichever it is, `DbCtx`
  (`lib/db/types.ts:41-44`) gains no required member (C9): the read is a
  function beside it, or an optional member. The test database
  (`lib/db/__tests__/test-db.ts`) gets the same read, so the walk's tests
  run through it.
- If the read crosses the desktop bridge, the slice may touch: the
  handler's body in `electron/db/service.ts`, beside `transaction`; its
  IPC channel in `electron/main.ts` and `electron/preload.ts`; the two
  bridge type copies, kept in step (`types/db-bridge.d.ts`,
  `electron/db/types.ts`); and the drizzle client in
  `lib/db/runtime/client.ts`, which gains the batch callback. A native
  half goes beside it in `lib/db/runtime/` as a `.native.ts` file.
- The chain read uses `deltas_chain_idx`
  (`lib/db/system/system.table.ts:89`). Without table statistics an
  `ORDER BY log_position` can steer SQLite onto another index
  (`lib/history/link-ends.ts:274-275`), and `deltas_log_position_uniq`
  (`:90`) also serves that order.

**The column-level apply (C9).**

- `undoneValue` and `undoneColumn` stay where they sit
  (`lib/actions/delta/reverse-replay.ts:291-309`), since 6.1 and 6.3 edit
  that file. The least-touching route: an `export` keyword on
  `undoneColumn`, and the wrapper in a new file under
  `lib/actions/delta/`.
- One wrapper keyed by table name, exported through
  `lib/actions/index.ts` (a suggested shape:
  `undoneColumnOf(table, column, partial, current)`). It takes its
  `TableEntry` from `resolveByTable`, which stays private, and throws on
  an unregistered table. A place's parent and `unplaced` mark restore as
  one field through it, as they do in a reversal.

**The walk** (`lib/history/diff-walk.ts`).

- For an update on one of the seven tables History lists (`entities`,
  `lore`, `threads`, `happenings`, `character_relationships`,
  `happening_involvements`, `happening_awareness`), seeded from the first
  that exists:
  1. the live row;
  2. the payload of a delete at the head of the chain;
  3. the copy another row's delete holds, for a link row removed with its
     other end: a delete on the branch in `entities` or `happenings`
     whose payload holds the row under its cascade key (the shapes
     `HELD_KEY` and `HOLDING_TABLES` already name,
     `lib/history/link-ends.ts:101-107`).
- **A requested delta that is gone** resolves as gone, before any seed
  is looked for: absent from its chain, it was pruned after its History
  row loaded. A reversal's hook evicts before History's list refreshes (the
  list waits on `settleCount`, `history-tab.tsx:91`), so the rows of
  deltas it just pruned are still mounted and re-read once. Gone is not
  a failure: no entry, no `warn`, nothing remembered, and the row keeps
  its field-name summary until the list drops it. A failed or cancelled
  pass that touched an open History row is the common case.
- **With none of the three seeds,** the target is corrupt: the walk
  rejects with a reason naming it.
- Newest to oldest over the chain's updates. For each: `new` is the
  state picked by the payload's column keys, `old` the payload; then the
  state steps back through the wrapper, column by column. `$`-prefixed
  keys (`isPayloadMetaKey`) are skipped on both sides and never reach the
  wrapper as columns.
- Each update on the path that History lists gets an entry, so one walk
  serves every requested delta on its target. An awareness update whose
  payload holds only `retrievalCount`, the shape History leaves out
  (a retrieval bump, or a close's reset; `lib/history/query.ts:131-137`),
  is stepped back through but gets no entry: a retrieval can bump each
  aware in-scene row once a turn, so one long awareness chain would
  otherwise fill the 2000-entry cache. The walk and the list's query
  build that shape from the same two constants, `RETRIEVAL_COUNT` and
  `RETRIEVAL_BUMP_TABLE` (`lib/history/link-rows.ts`), and a test pins
  that the two leave out the same deltas.
- Every read is scoped by `branch_id`.

**The cache** (`lib/history/diff-cache.ts`).

- A process-wide singleton holding its state in-module
  ([State placement](../../../../code-conventions.md#state-placement)):
  `peek(branchId, deltaId)`, synchronous; `populate(delta)`, keyed on
  `delta.branchId`; `populateBatch(deltas)`, grouped by branch and
  target, one walk per target. Keyed on branch and delta id from its
  first commit (C9).
- An LRU with a hard cap of 2000 entries; a `peek` hit and a `populate`
  both refresh recency.
- In-flight coalescing per branch and delta id, as canon has it.
- Eviction by branch: every entry, every in-flight walk and every
  remembered failure of that branch goes. A walk that started before an
  eviction never writes an entry after it, and a `populate` called after
  it starts a new walk rather than joining the old one. The guard
  discards such a walk's rejection as it discards its entry: no `warn`,
  nothing remembered, since a read across the eviction can see a
  half-reversed row. The guard's mechanism is planning's (see
  [Open questions](#open-questions)); the behavior is the scope.
- A gone delta (see The walk) settles its `populate` without an entry
  and without rejecting as a failure; whether as a typed result or a
  typed rejection the host tells apart is planning's. Canon's proposed
  signature, `populate(delta): Promise<DiffCacheEntry>`, changes with
  it.
- A failed walk: `populate` rejects, the cache remembers the failure by
  branch and delta id, and one `warn` names the delta id and the reason.
  A later `populate` for it rejects at once, with no walk and no second
  `warn`, whether or not TanStack has dropped its query. The memory goes
  with its branch's next eviction: under a consistent read, only a
  rewrite of the log can change a chain the walk found corrupt. A plain
  DB error is remembered as long, so a one-off failure keeps its rows
  on the summary until that eviction.
- The cache registers its eviction with the hook when its module loads,
  so no entry can exist before its listener does.

**The eviction hook (C9, R3).**

- A registration that `lib/actions` owns and exports through its barrel:
  a listener hears the branch whose log a commit rewrote. The delta
  layer never imports the cache. Any boundary rule this needs goes in
  `eslint.config.js` (C11).
- Fired after the commit and before the store sync, which can throw:
  - in `reverseAndPruneDeltaRows`, between its transaction
    (`reverse-replay.ts:914-920`) and `emitCommittedPatches` (`:930`),
    with `set.branchId`. A journal write-back commits here, as
    `extraOps` (`lib/actions/delta/rerun-journal.ts:529`,
    `lib/actions/story-entries/undo.ts:229`);
  - in `reverseReplayGroup`, between its transaction (`:987`) and
    `emitCommittedPatches` (`:993`), with `set.branchId`;
  - in `applyRedoLocked`, after its transaction
    (`lib/actions/delta/redo.ts:364`) and before its patch block
    (`:367`), with the branch the redo wrote: its snapshots' and ref
    restores', which are one branch, or the group's branch once
    [Slice 6.2](./02-scoped-reads-redo.md) gives it one.
- Only after a commit. A transaction that throws, a refusal, and the
  early returns on an empty set (`:896-902`, `:984`) fire nothing.
- A listener that throws doesn't stop the store sync, the other
  listeners or the caller's result; its error is logged.
- 6.1 and 6.3 leave these commit tails in place; a fork's commit is its
  own batch and fires nothing (C9). A duplicate and a branch delete evict
  nothing (R3).

**The renderer** (`lib/history/diff-prose.ts`).

- From a cache entry, the row's table and, for a relationship, the tab's
  side, to a summary string. It iterates the keys of `old` per column,
  descending a nested column as `changedPaths` does (`state`, and
  `state.visual` within it), and looks each path up in `new`. A path
  whose old and new are equal, as
  [Change prose](../../../../ui/screens/world/world.md#change-prose)
  defines it, renders nothing.
- Wording per field kind through `t()` in the `history` namespace, as
  [`world.md → Change prose`](../../../../ui/screens/world/world.md#change-prose)
  sets it out. The kinds across the seven tables: free text, enums,
  term lists, row refs, entry refs, the `stackables` record,
  `state.visual`'s sub-fields, numbers and counters, flags, the two
  column groups (a place's parent and `unplaced`, the collision
  triple), and a relationship's two views by side.
- `humanizeDelta` and `changedPaths` keep their signatures and output:
  the fallback, search, the reader's undo confirm
  (`components/reader/undo-copy.ts:300,333`) and the close review
  (`lib/history/close-review-changes.ts:229`) read them.

**The History host** (`components/history/history-tab.tsx`).

- An `update` row reads its entry through a TanStack query under
  `['diff', branchId, delta.id]`, seeded from `peek`. A hit shows the
  prose at once. A miss shows the field-name summary at once and
  upgrades to the prose when the walk resolves. A rejected read keeps
  the summary, and so does a gone one. Create, delete and removal rows
  never touch the cache.
- The row takes its entry from the query, not from a bare `peek` in
  render: React Compiler memoizes a render-time call by its arguments,
  so the row could stay on the summary after the entry lands (inferred;
  see [Open questions](#open-questions)).
- The misses of a loaded chunk go through `populateBatch`, so N update
  rows over M targets run M walks.
- On an eviction of branch `b`, the host's `['diff', b]` queries are
  invalidated or reset, not only removed: `removeQueries` notifies no
  mounted observer (TanStack's `Query.#dispatch` runs on a reset, not on
  a remove), so a mounted row would keep the stale prose until something
  else re-rendered it (C9). The host hears the eviction from the cache,
  not from a hook of its own. Every query key in the app so far carries
  `settleCount` instead (`hooks/use-entry-index.ts:108`); this is the
  first invalidation by key.
- A loader seam beside `HistoryLoaderProvider`
  (`components/history/history-loader.tsx`), defaulting to the cache, so
  stories and tests inject entries with no database.
- `HistoryTabView` stays a pure view: summaries reach it as strings, and
  `DeltaLogRow`'s `summary: string` contract doesn't change.
- The host's new store reads, if any (names for ref values), use 6.2's
  accessor if it has landed and the inline form if not
  ([C5](../milestone.md#c5--branch-scoped-store-reads)).

**Order-free meetings (C9).** Each is an acceptance criterion in both
slices of its pair, written as "if the other has landed"
([Dependency graph](../milestone.md#dependency-graph)).

- If 6.1 has landed, this slice writes the database-seeded test that two
  branches holding one delta id get distinct entries. The in-memory
  half, two `Delta` objects with one id on two branches through an
  injected walk, needs no composite key and ships here either way.
- If 6.8 has landed, `isLead` gets its prose here, with 6.8's label.

**Stories.** In `components/history/history-tab.stories.tsx`, through
the loader seam: one story per field kind above, a relationship row from
each side, the pending miss (summary showing), and the failed walk
(summary kept).

**Canon and inventory edits** (C12). The PR makes:

- `architecture.md → Walk algorithm`: the seed from a copy another row's
  delete holds; the read as built, in place of the WAL read
  transaction; the column-level apply through the wrapper, in place of
  a row-level `applyUndoPayload`.
- `architecture.md → Concurrency, rollback, error path`: the snapshot
  sentence as built; "falls back permanently" as the cache's remembered
  failure, cleared by its branch's eviction; the in-flight guard, which
  discards a stale walk's rejection too; a gone delta, which is no
  failure; and whatever of redo and the write-back R3's design pass
  didn't write.
- `architecture.md → Cache shape and lifecycle`: the module path chosen,
  `populate`'s gone outcome, and the walk's skip of the retrieval-count
  shape.
- `observability.md → Subsystem emission inventory`: the walk-failure
  `warn`.
- `tech-stack.md → TanStack Query`: "and later the diff cache" becomes
  present.
- [`component-inventory.md → Compounds — shipped`](../../../../ui/component-inventory.md#compounds--shipped):
  the `HistoryTab` row names its diff reads and their loader seam.

## Scope: out

- **The five tables only Diagnostics lists** (`story_entries`,
  `chapters`, `translations`, `branch_era_flips`, `entry_assets`): their
  prose and the
  [Diagnostics delta log](../../../../ui/screens/diagnostics/diagnostics.md#tab-5--delta-log)'s
  adoption of the cache are M7.3's.
- **Search.** It stays SQL over the log. The free-text arm matching only
  a pre-change value is not lifted by the cache; canon's
  [Search is orthogonal](../../../../architecture.md#search-is-orthogonal)
  stands, and M4's note that it would lift "until M6.4" is stale.
- **The reader's undo confirm** keeps the field-name summary.
- **The close review's formatter** (`close-review-changes.ts`) keeps its
  `old → new` wording. The renderer agrees with it on format, not
  code: it keeps its own value functions.
- **The composite `deltas` key and the branch-scoped delta writes**
  (6.1, C1). This slice reads by branch from its first commit and
  relies on C1 for the rest.
- **The redo map and a redo group's branch** (6.2). The hook takes what
  redo holds when it lands.
- **History's own branch scoping:** `use-history-target.ts`'s lookup by
  id and the inline filters in `useStoreNames`
  (`history-tab.tsx:44-50`) are 6.2's sweep (C5).
- **The fork, a duplicate and a branch delete** (6.3, 6.6): they evict
  nothing.
- **`isLead`'s column and its History label** (6.8).

## Acceptance criteria

1. **The wrapper.** A test in `lib/actions/delta/` (proposed
   `column-undo.test.ts`) gives a scalar column, an entity `state`
   partial, a `null` partial on `state`, and a parent-only partial on an
   unplaced place, and asserts the wrapper returns what a reversal of
   the same payload writes to the row. An unregistered table throws.
   `git diff` on `reverse-replay.ts:291-309` shows at most an `export`
   keyword. `pnpm lint` passes with the walk importing only
   `@/lib/actions`.
2. **The read.** A test in `lib/history/diff-walk.test.ts` lands a
   forward write on the walked target while a walk is pending, at each
   point the chosen mechanism leaves open, and gets the entry a walk
   gives with that write wholly before or wholly after it. For a read
   that is one call, the test instead shows the walk makes one read call
   per target. A second case does the same with a forward delete of a
   live link row, and gets no rejection. A third runs
   `EXPLAIN QUERY PLAN` on the chain read against the test database and
   finds `deltas_chain_idx`. `git diff lib/db/types.ts` adds no required
   member to `DbCtx`.
3. **The read on each platform.** The test database's read is a third
   implementation beside the platforms', so criterion 2 can't show a
   platform's read is atomic. If the read crosses the desktop bridge, a
   case in `electron/db/service.test.ts` shows the handler serves the
   chain and the row from one synchronous call on one connection: no
   `await` and no second round trip inside it, and the renderer's half
   in `lib/db/runtime/client.ts` sends one IPC message per read.
   `pnpm exec tsc -p electron/tsconfig.json` passes. If the read has a
   native half, planning confirms that expo-sqlite's synchronous reads
   can't interleave with `withTransactionSync`, by reading expo-sqlite's
   source or by a probe on the slot AVD, and records which in
   Implementation notes.
4. **The walk.** `lib/history/diff-walk.test.ts`, on the test database
   with every domain registered, writing through `applyDeltaAction` and
   the shipped reversals, with every expectation a literal the test
   wrote:
   - three updates to one character's `state` (traits, drives, traits
     again) give each delta `old` equal to its payload and `new` equal to
     the value just after it;
   - a lore row updated then deleted seeds from the delete's payload;
   - a relationship whose character was deleted seeds from the copy in
     the character's delete, rejects nothing and logs no `warn`;
   - a target with no row, no head delete and no held copy rejects;
   - an entity edit carrying `$resolvedPair` puts no `$` key in `old` or
     `new`;
   - stepping back through a parent-only payload on a place that a
     reversal's ref clear left unplaced restores the parent and
     `unplaced` as one field;
   - an awareness row with retrieval bumps between two listed updates
     gives the listed updates their true `old` and `new`, and the bumps
     get no entry;
   - a delta read for its row and then pruned by a reversal (a pass's
     update, reversed as an abort reverses it) resolves as gone, with no
     `warn`;
   - after CTRL-Z of a user edit that a later pass's write on the same
     field survives, the survivor's entry shows its rewritten `old`, and
     after the redo, its original `old`.
5. **The cache.** `lib/history/diff-cache.test.ts`, with an injected
   walk:
   - a miss, then a `populate`, then a `peek` hit;
   - two `Delta` objects sharing an id on two branches get distinct
     entries;
   - the 2001st entry evicts the least recent, and a `peek` hit refreshes
     recency;
   - two concurrent `populate` calls for one key run one walk;
     `populateBatch` over N deltas on M targets runs M walks;
   - evicting branch `b` leaves branch `c`'s entries; a walk started
     before the eviction and resolved after leaves `peek` empty; a
     `populate` after it runs a second walk;
   - a walk started before an eviction that rejects after it logs no
     `warn` and leaves nothing remembered: the next `populate` walks;
   - a gone outcome logs no `warn`, writes no entry and is not
     remembered: the next `populate` walks;
   - a failed walk rejects and logs one `warn` naming the delta id; a
     second `populate` rejects with no walk and no `warn`; an eviction of
     its branch lets a third walk run.

   Removing the in-flight guard turns the stale-walk case red; keying on
   the delta id alone turns the two-branch case red.

6. **The hook.** A test in `lib/actions/delta/` (proposed
   `post-commit-hook.test.ts`) registers a listener and finds it called
   once with the branch after each of: a CTRL-Z (`reverseAndPruneDeltaRows`),
   a reversal by `reverseReplayDeltas` (`reverseReplayGroup`), a redo
   (`applyRedo`), and a re-run's undo that writes its journal back.
   Called too when a patcher throws and the reversal rejects at stage
   `store-sync`. Not called when the transaction throws, on a refusal or
   on an empty set. A listener that throws leaves the patches emitted,
   the caller's result unchanged and the error logged. Deleting any one
   of the three calls turns its case red.
   `grep -rnE "diff-cache|@/lib/history" lib/actions --include=*.ts`
   finds nothing outside tests.
7. **The cache as the app registers it.** The Definition of done's
   eviction test. In `lib/history/diff-cache-eviction.test.ts` (proposed),
   on the test database with every domain registered: the test imports
   the cache only through the module History's host imports (the
   `@/lib/history` barrel, or the chosen home's) and makes no
   registration call of its own. It writes a user edit and a later
   pass's write on the same field, populates the survivor's entry
   through the real walk, then runs the shipped `undoLastAction` on the
   edit. `peek(branch, survivor)` is empty, and the next `populate`
   returns the rewritten `old`, a literal the test wrote. Removing the
   cache's registration, or moving it into a module that barrel doesn't
   import, turns it red.
8. **The renderer.** `lib/history/diff-prose.test.ts`:
   - canon's example: an entry with `old.state = { traits: ['brave'] }`
     against a `new.state` holding traits, drives and voice names the
     added trait and nothing of drives or voice. Iterating `new`'s keys
     instead turns it red;
   - a path whose old and new are equal renders nothing;
   - a relationship's `kind` reads by the tab's side;
   - one case per field kind, in the wording of
     [`world.md → Change prose`](../../../../ui/screens/world/world.md#change-prose).

   `lib/history/humanize.test.ts`, `lib/history/close-review-changes.test.ts`
   and the reader's undo-copy tests pass with no expectation changed.

9. **The host.** `components/history/history-tab.test.tsx`:
   - an update row shows `Modified <labels>` first, then the prose when
     its read resolves;
   - a rejected read keeps the summary, and so does a gone one;
   - create, delete and removal rows never call the loader;
   - a chunk of N update rows on M targets runs M walks;
   - an eviction of the tab's branch, fired through the cache's own
     eviction (the path the hook drives), re-reads a mounted row and
     shows the new prose with no other trigger; an eviction of another
     branch re-reads nothing. Replacing the invalidation with
     `removeQueries` turns it red.
10. **Stories.** The stories named under Scope pass
    `pnpm vitest run --project storybook components/history/history-tab.stories.tsx`.
11. **E2E** (desktop, new spec, proposed
    `e2e/tests/history-diff-prose.spec.ts`). A World edit of a
    character's field shows its before-and-after prose in History; CTRL-Z
    of the edit from the reader (`undoFromReader`,
    `e2e/flows/navigation.ts`) and then Redo leave History showing the
    right values. A thread edit in Plot shows its prose. Each step
    asserts its write in the database first, then the row's text through
    the same i18n keys the app renders. That flow passes with no
    eviction at all, which criterion 7 covers. If planning finds a UI
    path that leaves a later write surviving the undo (see
    [Open questions](#open-questions)), the spec adds it: the undo shows
    the survivor's rewritten prose, the redo its original, and removing
    the cache's registration turns the undo step red.
    `pnpm build:web && pnpm test:e2e -- history-diff-prose`, with
    `pnpm electron:compile` first if the bridge changed.
12. **If 6.1 has landed:** `lib/history/diff-walk.test.ts` holds the
    database-seeded test that two branches holding one delta id, with
    different payloads, get distinct entries (C9), seeded with 6.1's
    `cloneBranch`. It fails with `branch_id` dropped from the walk's
    chain read.
13. **If 6.8 has landed:** `lib/history/diff-prose.test.ts` holds a case
    for the `isLead` flag's prose, set and cleared, under 6.8's label.
14. **Canon.** Each edit under Scope is in the PR, and
    `pnpm lint:docs` passes.
15. **Gates.** `pnpm lint`, `pnpm format:check`, `pnpm typecheck`,
    `pnpm exec tsc -p electron/tsconfig.json`, `pnpm compiler:check`,
    `pnpm lint:docs` and `pnpm test:run` pass. Every new user-facing
    string routes through `t()`.

## Tests

| Level                  | Tool                                                                          | What                                                                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit, `lib/actions`    | Vitest, `--project unit`, test database                                       | The wrapper against the reversal's own restore; the hook at its three call sites, after a store-sync failure, and with a throwing listener.                                                                                       |
| Unit, `lib/history`    | Vitest, `--project unit`, test database                                       | The read's consistency and its index; the walk's seeds, meta keys, column group, bumps with no entry, a gone delta, and survivor rewrites across an undo and a redo; the renderer per field kind; the fallback's tests unchanged. |
| Unit, cache            | Vitest, `--project unit`, injected walk                                       | Keying, LRU, coalescing, batching, eviction, the in-flight guard on entries and rejections, gone outcomes, remembered failures.                                                                                                   |
| Unit, registered cache | Vitest, `--project unit`, test database, the real cache as History imports it | A shipped `undoLastAction` evicts the survivor's entry and the next read gives its rewritten `old`.                                                                                                                               |
| Unit, desktop read     | Vitest, `--project unit`, `electron/db/service.test.ts`                       | If the read crosses the bridge: one synchronous handler call serves the chain and the row.                                                                                                                                        |
| Component              | Vitest jsdom, `--project unit`, mocked view as `history-tab.test.tsx` does    | Summary first then prose, rejection, gone, eviction refresh through the cache, M walks for M targets.                                                                                                                             |
| Stories                | Storybook, `--project storybook`                                              | Each field kind, both relationship sides, pending, failed.                                                                                                                                                                        |
| E2E                    | Playwright, desktop                                                           | Edit, prose, undo, redo, Plot; a survivor only if a UI path reaches one.                                                                                                                                                          |
| Device                 | Android slot AVD, manual, non-blocking                                        | If the read is platform-split: History on Android shows prose after an edit, and after an undo and a redo.                                                                                                                        |

Mutation checks named under the criteria are run and recorded in the PR
body: the iteration rule, the in-flight guard, the branch key, each
hook call site, the cache's registration (criterion 7), the host's
invalidation, and, if the E2E has a survivor, its registration check.

## Open questions

- **The fork's no-eviction check, if Slice 6.3 lands first.**
  [Slice 6.3's Acceptance criteria](./03-fork-core.md#acceptance-criteria)
  9 asserts that a fork leaves the loaded parent's stores, patchers and
  redo stack alone "and, once 6.7's post-commit hook is on main, no
  eviction fired" (C9: a fork's commit is its own batch). The milestone's
  dependency graph lists no 6.3 ┄ 6.7 pair, so whichever of the two
  lands second adds that clause to `lib/actions/stories/fork-branch.test.ts`'s
  AC 9 test. Found by Slice 6.3's slice review (2026-11-24).
- **The read's mechanism.** Neither platform sets WAL or has a read
  transaction; the desktop bridge has `query`, `exec` and a write-only
  `transaction(ops)` (`electron/preload.ts:34-38`). Options:
  - A read batch. On desktop, drizzle's sqlite-proxy takes a second,
    batch callback behind `db.batch([...])` and maps its rows (drizzle
    docs, verified), so one new IPC channel runs the reads in
    Electron main in one synchronous handler. On native, expo-sqlite's
    synchronous reads with no `await` between them can't interleave
    with `withTransactionSync`. That is inferred, and drizzle's batch
    docs don't list the expo driver, so planning confirms it
    (criterion 3).
  - One statement returning the chain and the row, whose mapping back to
    field names is then hand-written.
  - Reading under the row's key lock, as every delta-logged write and
    reversal takes it (`lib/actions/delta/key-lock.ts`); a held-copy
    seed would need its holder's key too, and a populate waits behind a
    long reversal.
  - A checked read: chain, then row, then the chain's head again,
    retrying on a change.

  One finding narrows the choice. A reversal, a redo or a write-back
  that commits mid-walk evicts its branch after its commit: the eviction
  clears what the walk already wrote, or the in-flight guard keeps it
  from writing or rejecting, so the read only has to guard forward
  writes. Those still matter twice: a new update between the halves
  shifts the newest delta's `new`, and a link row's own delete between
  them makes a live target read as missing with no delete in its chain,
  which rejects and is then remembered as a failure.

- **Ref names outside the working set.**
  [`world.md → Change prose`](../../../../ui/screens/world/world.md#change-prose)
  names a ref as a link row's other end is named, and marks one the
  working set doesn't hold `(deleted)`, checked at render; a merge
  deletes its loser, so those names are routine, not rare. Ids the
  working set lacks cost a read 6.7 hasn't sized. Options: (a) the walk
  records them: after its read, `populate` reads
  the names of the ref ids in its entries (stored row, then latest
  delete payload, through `link-ends.ts`'s `namesOf` and
  `latestDeletedValues`, made public) into a `names` map on the entry,
  and the renderer takes the working set first; one-phase loading and
  the host unchanged, but the entry shape grows, and a row renamed after
  the walk and then deleted shows its walk-time name. (b) A names query
  in the host keyed on the ids the working set lacks: the entry shape
  holds, loading goes two-phase. The design leans (a).
- **Entry-ref rows wait for the entry index.** Until its first read the
  index reads `ready: false`, and prose would flash "Unknown entry"; a
  row whose prose names an entry keeps the field-name summary until the
  index has read, and after a failed read. Rows with no entry ref don't
  wait.
- **The renderer's seams.** `termChanges`
  (`lib/actions/delta/term-list.ts`) isn't on the `lib/actions` barrel,
  and each list's match lives in its table's registration; the renderer
  needs both. A status reads the select's word (`world:tiers.*`,
  `plot:tiers.*`), not the close review's status maps, which use the
  tags' `status.*` words.
- **Writes with no delta.** A reversal's ref clear (a place's parent, a
  character's faction: `reverse-replay.ts:756-768`), the views a
  reversal nulls on a kept relationship (`:580-590`), and redo's ref
  restore (`redo.ts:347-363`) change a row and log nothing. Eviction
  keeps entries from going stale across them, but a walk seeded from
  such a row shows the newest delta on that path as having written the
  cleared value. Default: accept, and say so in canon's Walk algorithm;
  planning may instead stop the walk at the path.
- **Does a UI path leave a survivor?** CTRL-Z reaches a World save only
  when nothing but passes sits above it, and a rollback or CTRL-Z of a
  turn keeps a pass's facts
  ([Reverse-replay](../../../../generation-pipeline.md#reverse-replay)),
  so the write that survives the edit's undo has to be a pass's. Which
  classifier writes the chosen field from a mock reply (the periodic
  classifier's reply in `e2e/tests/periodic-classifier.spec.ts` writes
  happenings and new characters, not a character's `state`), and
  whether the turn that triggers it is undone first, decides whether
  criterion 11 gains its survivor step.
- **The in-flight guard's mechanism** (left open by R3): a per-branch
  generation counter checked when a walk settles, or tracked in-flight
  walks dropped on eviction. Either meets criterion 5.
- **The warn's kind.** `LogSubsystem` has no `history` member
  (`lib/diagnostics/kinds.ts:1-13`). Planning picks an existing one or
  adds one, with its inventory line.
- **React Compiler and `peek`.** That a bare `peek` in render stays
  memoized after the entry lands is inferred, not tested; reading
  through the query sidesteps it either way.
- **A reversal outside the bracket.** Admission refusal
  (`lib/actions/turns/submit-turn.ts:200`) and boot recovery reverse
  outside `bracketProseReversal`, which bumps `settleCount`. Eviction
  refreshes a mounted row's prose either way; whether History's row list
  refreshes after an admission refusal was not traced and is M4's
  behavior.

## Implementation notes

- **The read.** `readChainSnapshot`, a function beside `DbCtx` in
  `lib/db`, reads the chain and the row in one call: a `db:batch` IPC
  channel whose Electron main handler runs every query in one
  synchronous call on its one connection, two synchronous drizzle reads
  on native, and a batch callback on the test database (developer
  decision). Criterion 3's native half was confirmed by reading the
  source, not by a probe: drizzle-orm 0.45.2's expo-sqlite session is
  synchronous, native `runInTransaction` is expo-sqlite 55's
  `withTransactionSync`, and no app code calls an async expo-sqlite API.
  ESLint now holds that (developer decision): it bans `*Async` members of
  `expoDb` and value imports of `expo-sqlite` outside the native client.
  Two dev-only paths are the exceptions: the Drizzle Studio dev plugin
  calls the async API on the app's connection, and is a no-op when
  `NODE_ENV` is `production`; the on-device reseed
  (`lib/db/devtools/reseed.native.ts`), which throws outside `__DEV__`,
  holds a `BEGIN` open across `await`s between its synchronous inserts,
  so a walk run in one of those gaps reads rows the reseed hasn't
  committed.
- **The read's tests.** The native read also has a unit test,
  `lib/db/runtime/chain-snapshot.native.test.ts`, running drizzle's
  expo-sqlite driver over a small `node:sqlite` sync adapter: it covers
  mapping and order, not atomicity. The chain query's
  `EXPLAIN QUERY PLAN` names `deltas_chain_idx`, so the fallback of
  sorting in JS didn't fire; the chain read test turns on
  `PRAGMA reverse_unordered_selects`, so a dropped `ORDER BY` fails.
- **The vocabulary** was designed in canon before planning resumed
  (developer decision):
  [`world.md → Change prose`](../../../../ui/screens/world/world.md#change-prose).
- **Ref names** (developer decision). The walk reads the names of its
  entries' refs, stored row then latest delete payload, and records them
  on the entry; the `(deleted)` mark is computed when the row renders.
- **The collision group** (developer decision). The walk fills it: when a
  delta's undo payload holds any of `nameCollisionFlag`,
  `nameCollisionPartnerId` or `nameCollisionReason`, the entry's `new`
  holds all three, picked from the walk's state at that step, as `new`
  already holds the whole column for the placement group. The renderer
  stays as planned, and `world.md`'s column-group rule holds literally.
  Pinned in
  `lib/history/diff-walk.test.ts` (a merge re-point, a clear by merge
  and a raise, through the real walk) and in
  `lib/history/diff-prose-walk.test.ts` (the walk's output rendering
  `Collision flag: Kael (deleted) → Kael`).
- **The survivor E2E** (developer decision, built differently). The
  planned flow, one turn whose pass writes the edited field, leaves no
  survivor: the pass reads only that turn, so its write is anchored on
  it, and the turn's CTRL-Z sweeps it. The spec instead parks the
  classifier watermark so the pass's window opens on the reply before
  the last turn. After the World edit it rewords that reply from the
  reader: an edit below the head turn, which records no invalidation
  scope but moves the reply's prose position past the World edit. It
  then takes one turn whose pass writes The City Watch's standing with
  that reply as its source. CTRL-Z of the turn, of the rewording and of
  the World edit leaves the pass's write standing with its prior
  rewritten, and Redo puts it back. The spec re-selects World's row
  after each return from the reader: GO TO Reader dismisses World
  (`hooks/use-surface-navigate.ts`), so World comes back with nothing
  selected.
- **Criterion 12's** two-branch database test, and criterion 4's last
  two cases (the abort's gone and the survivor across CTRL-Z and redo),
  live in `lib/history/diff-walk-reversals.test.ts`, not
  `diff-walk.test.ts`, and criterion 2's `EXPLAIN QUERY PLAN` case lives in
  `lib/db/runtime/chain-snapshot.test.ts`, beside the read it plans.
- **Deviations from the brief.**
  - `populate` resolves a typed `DiffOutcome`, whose `gone` is no
    failure, in place of canon's `Promise<DiffCacheEntry>`.
  - A walk its branch's eviction overtook rejects its callers with
    `DiffEvictedError`. TanStack joins an invalidation's refetch onto a
    first fetch that has no data yet instead of cancelling it, so the
    History host's query function populates again on that error.
  - History's diff queries set `gcTime: 0`, so the diff cache alone
    retains entries and a tab remounted after an eviction it didn't hear
    reads again.
  - Batching N rows into M walks lives inside `populate`, a batch per
    tick, so each row's query calls `populate` alone.
  - The warn's subsystem is a new `history` member of `LogSubsystem`.
  - Writes with no delta are accepted, and canon's Walk algorithm says
    so.
  - The post-commit hook fires only on a commit that rewrites the log
    (a review ruling): `reverseAndPruneDeltaRows` when its set holds
    rows or its commit writes a journal back (the caller passes the
    write-back's patches as `patchesAfter`), `reverseReplayGroup`
    when its set holds rows, a redo when its commit is non-empty. A
    forward write routed through the reversal path with an empty set
    evicts nothing. This replaces the plan's op-count guard.
- **C5.** 6.2 had landed; the host's ref names go through
  `useStoreNames`, which reads its branch accessor. It was merged in,
  not rebased onto, and the redo hook's branch reads the redo group's
  (`group.branchId`).
- **Criterion 13.** Did not apply: 6.8 had not landed when this PR
  opened.
- **Device smoke** (slot AVD, non-blocking): ran on `Aventuras_Slot_2`
  with a debug x86_64 build, whose bundle carried the native read. A World
  edit of Mira's description read as before-and-after prose in History;
  after Undo from the reader the update row was gone, and after Redo the
  same prose came back. Undo and Redo each evicted the branch from the
  diff cache, checked in the running app.
- **The term-list prose** (developer decision). It ships as
  [`world.md → Change prose`](../../../../ui/screens/world/world.md#change-prose)
  reads, with no renderer change and no canon edit in this slice. Two
  gaps stay open and go to
  [triage](../../../triage.md): a term list can show two sides that read
  identically once the 40-character head cut or the whitespace collapse
  hides the difference, and the exact-match text lists (traits, drives,
  agenda) store terms with no whitespace or Unicode normalization, so
  terms differing only by spacing or NFD versus NFC are distinct values
  and read `added X, removed X`.
- **The entry-index gate** (developer decision, slice review R1: b,
  2026-11-24). After a failed re-read, `useEntryIndex` kept its last
  good list and read `ready: true, failed: false`, so the host's
  `ready && !failed` stayed open and a row naming an entry newer than
  that list read "Unknown entry". The hook
  (`hooks/use-entry-index.ts`, outside this slice's files) gained
  `stale`: true until a read lands, while one runs and after one fails;
  `ready`, `failed` and `updating` keep their meaning for their other
  readers. The host gates per row: a row naming an entry the index
  doesn't hold (`entryIdsOf`, which replaced `namesAnEntry`) keeps the
  field-name summary while the index is stale, a row whose entries it
  holds keeps its prose, and a missing entry reads "Unknown entry" once
  the index is fresh. The index re-reads on every turn, so a row naming
  a deleted entry shows the summary while each re-read runs.
- **A wrong-typed value** (developer decision, slice review R2: b,
  2026-11-24). `diffProse` tells a value that isn't its field's type
  from a path with no wording, and hands the first such path to its
  context's required `onMistyped`; it still returns null, so the row
  keeps the field-name summary. The History tab logs
  `history.diff_prose_mistyped` with the branch, delta id and path,
  once per walk result (a `WeakSet` of the cache's entries): a
  re-render or a remount doesn't repeat it, a re-walk after an eviction
  can. A path with no wording logs nothing.
