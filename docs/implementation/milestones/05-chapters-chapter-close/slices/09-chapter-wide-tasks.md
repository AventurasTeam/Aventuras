# Slice 5.9 — Chapter-wide tasks and decay

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.5b](./05b-identity-threads.md)
- **Blocks:** [Slice 5.10](./10-two-starts.md)
- **Runs beside:** [Slice 5.8](./08-prose-tasks.md), sharing the driver
  by C2's slots, and [Slice 5.11](./11-review-window.md), so the report
  meets its reader. C13's stackable rule goes to the later of this slice
  and [Slice 5.12](./12-chapter-delete-rollback.md).

## Goal

The two close tasks that don't read the prose, Happenings and Awareness,
with `read_turns`, their only way to it; the code steps on either side
of them, stackable normalization and the `retrieval_count` reset; and a
real `chaptersOld`. That last one gives Awareness its point: a
happening's pin reaches its score only through the decay exponent, so
until `chaptersOld` has a source, `set_pin` writes a value nothing reads.

## Background

Canon's run order puts normalization and Happenings ahead of the part
loop and Awareness and the reset after it, which are C2's `before` and
`after` slots, so every later task reads merged rows. Happenings starts
from clusters code finds over vectors it embeds first. A merge is one
group, and its refusals run ahead of that group, because a group drops
noops. Awareness reviews the chapter's rows and a top-N set whose counts
it never sees. `chaptersOld` is a hardcoded 0 (`lib/retrieval/run.ts:772`),
so landing it runs decay on chapter distance for the first time, on
defaults canon calls guesses.

## Required reading

- [`memory/chapter-close.md → Run order`](../../../../memory/chapter-close.md#run-order),
  [Tools and writes](../../../../memory/chapter-close.md#tools-and-writes)
  and [When a task stops](../../../../memory/chapter-close.md#when-a-task-stops).
- [`memory/chapter-close.md → 3c`](../../../../memory/chapter-close.md#3c--stackable-normalization),
  [3d](../../../../memory/chapter-close.md#3d--awareness-pin-tuning) and
  [3e](../../../../memory/chapter-close.md#3e--happenings-consolidation):
  the sub-jobs this slice builds, read whole.
- [`memory/chapter-close.md → Review`](../../../../memory/chapter-close.md#review):
  what stays out of the report.
- [`memory/cadence.md → User edits and classifier writes`](../../../../memory/cadence.md#user-edits-and-classifier-writes):
  precedence, link rows included.
- [`data-model.md → Authorship contract`](../../../../data-model.md#authorship-contract):
  the Stackables, Happenings, Involvements and Awareness rows.
- [`generation-pipeline.md → Writes`](../../../../generation-pipeline.md#writes),
  for the carve-out the range embed uses, and
  [Reverse-replay](../../../../generation-pipeline.md#reverse-replay), from
  "A reversed machine write keeps a later user write" through the four
  refused states.
- [`memory/retrieval.md → Compute lifecycle`](../../../../memory/retrieval.md#compute-lifecycle),
  [Scoring function](../../../../memory/retrieval.md#scoring-function),
  [Per-type decay rates](../../../../memory/retrieval.md#per-type-decay-rates)
  and [Pin contradiction reconciliation](../../../../memory/retrieval.md#pin-contradiction-reconciliation).
- Milestone contracts
  [C1](../milestone.md#c1--a-closes-delta-shape),
  [C2](../milestone.md#c2--pipeline-shape),
  [C3](../milestone.md#c3--the-chapter-context-group),
  [C4](../milestone.md#c4--close_report-v1),
  [C6](../milestone.md#c6--what-the-banners-n-of-m-counts),
  [C9](../milestone.md#c9--the-round-trip-rule),
  [C11](../milestone.md#c11--tool-results) and
  [C12](../milestone.md#c12--what-a-later-turn-wrote-means);
  [C13](../milestone.md#c13--chapter-delete) for its stackable rule, and
  [C5](../milestone.md#c5--token-reads-and-the-progress-hook) for its
  migration rule if `chaptersOld` adds a column.
- [Drizzle drops keys the table has no column for](../../../lessons-learned/drizzle-drops-unknown-keys.md#drizzle-drops-keys-the-table-has-no-column-for-silently):
  a `retrievalCount` gate has to be tested on the store patch.

## Scope: in

Tools and code steps are entries in [Slice 5.5a](./05a-task-runner.md)'s
slots, on its write path, read gate, ledger and ids, and new files sit
under `lib/pipeline/definitions/close-agent/`. `lib/pipeline` can't
import `@/lib/actions` as values
(`lib/pipeline/runtime/action-port.ts:29-32`), so delta-log reads go
through 5.5a's row guard: `laterTurnTouched` and `userTouched` for a row,
`laterTurnWrote` and `userWrote` for a field. E is the chapter's end
entry (C1).

**`read_turns`,** on the Happenings and Awareness tool lists only,
beside 5.5a's read tools. It reads `story_entries` through `ctx.db`,
since `entriesStore` holds a window
(`lib/pipeline/definitions/periodic-classifier.ts:80-82`), and returns
each turn's `promptProse` in position order, with no `system` row. A
call returns at most ten turns (`READ_TURNS_MAX`) and names the rest as
unread. An unknown handle, or one outside the range the open question
settles, is an answer saying so, as `read_row`'s missing row is. A read
writes nothing and can't fail a task.

**The range embed,** a code step in `before`, after normalization and
ahead of the Happenings task, in `close-happenings.ts`.

- `runSyncStage` (`lib/retrieval/sync.ts`) over deps from
  `resolveStorySwapConfig` and `composeRetrievalEmbedDeps`, as
  `lib/pipeline/definitions/per-turn-retrieval.ts:54-64,131` does, with
  `loadStaleRows` narrowed to the happenings whose `occurred_at_entry_id`
  lies in the closed range. Other kinds and other happenings stay stale
  for the next sync stage.
- `ctx.abortSignal` reaches the embed. `cancelled` returns
  `{ status: 'aborted' }`. Any other failure, an unconfigured embedder
  and an unknown dim included, returns `{ status: 'failed', error }` in
  the shape `embedderInitFailure` uses
  (`per-turn-retrieval.ts:36-38`), which fails the close.
- It writes through `ctx.runInTransaction` under the carve-out, and
  fewer than two rows in the range makes no embedder call.
- It needs no swap admission of its own: `runUserEmbedderAction` refuses
  a swap while the gate holds
  (`lib/embedder-swap/app-deps.ts:206-208`), and 5.6 keeps the swap
  refusal on a manual start.
- As a code step it shows the `agent` phase's label, with no count (C6).

**Clustering,** pure, in `close-clusters.ts`: vectors read back
with `vectorsByIdQuery` (`lib/db/embeddings/knn.ts`), compared with
`cosine`. All three of canon's criteria must hold, with cosine and
overlap thresholds as constants (`0.8`, `0.5`). Only rows with an
`occurred_at_entry_id` in the range cluster, which keeps
`happenings_mutual_excl` true through a merge. A cluster has at least two
rows. It runs in the embed's code step, and the task's start read takes
the clusters from a new key in `intermediates.ts`. The terms canon leaves
open are in Open questions.

**`merge_happenings`** takes `keep`, `absorb` (ids), an optional `title`
and `description`, `turns` and `why`, so a redundant row merges with the
kept text, as `merge_threads` does in
[Slice 5.5b](./05b-identity-threads.md). Its checks run ahead of one
group (C11), in `merge_threads`' order, with link rows added, and any
that stops the call writes nothing:

1. Slice 5.5a's gates on every row. `keep` inside `absorb`, a repeated
   id, an empty `absorb` or a row outside `keep`'s cluster is `rejected`.
2. A row that's gone is `rejected`, naming its survivor from the ledger.
3. A row this close already wrote can't be absorbed: any delta under the
   run's `actionId` on it, or on one of its involvement or awareness
   rows, creates included, is `rejected`, saying to keep that row
   instead. `snapshotForRedo` refuses any non-delete redo row a delete
   holds, and a delete holds its captured children
   (`lib/actions/delta/redo.ts:118-126`, `held-rows.ts:49-101`). It stays
   the kept row of a merge freely.
4. A later turn's write to any row of the merge, link rows included, is
   `skipped` whole, by `laterTurnTouched`. A retrieval bump alone doesn't
   count (C12).
5. A user edit after the latest cited turn is `skipped` whole when it
   touches an absorbed row or one of its involvement or awareness rows,
   by `userTouched`, since the cascade would take a user's `role` or pin,
   or a field the merge writes on `keep`, by `userWrote` (C11). A kept
   row's other fields lose nothing, so they don't stop a merge.

The group, anchored on E under the run's `actionId`:

- One `updateHappening` on the kept row, with its precedence from 5.5b:
  the composite text when given, under the bound the open question
  settles, and the earliest `occurred_at_entry_id` by entry position. A
  redundant-row merge can leave it a noop, and the deletes still land.
- One `createHappeningInvolvement` per character the kept row lacks,
  built ahead of the group, since `happening_involvements` has no unique
  index. The action takes an optional `proseEntryId`, as the awareness
  upsert does, and `userDeletedRowSince` widens to its table
  (`lib/actions/delta/user-precedence.ts:244-250`), so a carry doesn't
  bring back an involvement the user removed from the kept row after the
  cited prose.
- One `upsertHappeningAwareness` per character, folded ahead of the
  group, since `haw_natural_uniq` holds one row a pair: max
  `decay_resistance`, earliest `learned_at_entry_id` by entry position,
  summed `retrieval_count`, sources joined where they differ, with
  `proseEntryId` the latest cited turn.
- One `deleteHappening` per absorbed row, whose cascade takes its links.

Check 5 doesn't cover the kept row's own link rows. There the group's
per-field precedence keeps a value the user wrote, as 3e says, and the
merge lands. A call the group's precedence stops in part returns `ok`,
naming what didn't land (C11).

The ledger entry lists every row. A landed merge sets `survivor` to
`keep` and holds the landed text in `values`, which is what
[Slice 5.11](./11-review-window.md) renders. A refused or skipped merge
carries no `survivor`, and its `values` hold the proposed text (C4).

**The awareness merge arm,** in `register-awareness.ts`. The upsert
honours `learnedAtEntryId` and `retrievalCount` for a `chapter_close`
source as well as a user one, on both arms. The update arm gains a count
write, and a count-only pair stops being the plain rejection at `:103`,
which would refuse the group. `set_pin` passes neither field, and a
pipeline source other than `chapter_close` keeps today's behaviour.

**Where a merged row went.** Once this tool fills `survivor`, 5.5a's
read and write paths name it for an absorbed row. If 5.8 is on main, this
slice checks that for `mark_common_knowledge`, whose `updateHappening`
would otherwise end in a bare hard `not-found`. If not, 5.8 does.

**The Happenings task,** in `before`, `part` 0, with `read_row`,
`read_turns` and `merge_happenings`. Its starting rows are the clusters,
each row with its title, description, cast, the turn it occurred at and
`common_knowledge`, the fields `merge_happenings` writes, so they seed the
read gate (C11). `read_row`'s field set for a happening matches and
leaves out `retrieval_count`. No cluster means no call. Its template
joins the `chapter` group, holds no chapter text and takes no exemption
entry (C3). `templateGlobals` follows includes, so a macro reading the
turns counts as read even when it renders empty: this template includes
the shared instructions apart from the chapter's turns.

**Stackable normalization,** first in `before`, with no task and no
ledger entry.

- `normalizeStackables` beside `foldStackables` in `lib/keyword-terms.ts`
  folds each key, then applies the plural rule across every character's
  record on the branch, summing counts under one key.
- `close-stackables.ts` reads the characters from `ctx.db`, skips a
  record `userWrote` or `laterTurnWrote` reports at `state.stackables`,
  with E as the cited turn, and emits one `updateEntityStackables`
  through `delta_emitted` for each record that changes, anchored on E,
  polling `abortSignal` between characters, as C1's stamps do.

**The stackable guard,** at `restorablePayload`
(`lib/actions/delta/reverse-replay.ts:556`). Undoing a
`chapter_close` delta that carries `state.stackables` yields whole, on
any later write of `stackables` in the edits the walk holds, read with
`wrotePath(edits, 'state', ['stackables'])`. A close writes that path
only here, so the delta needs no marker. If 5.12 is on main, its yield
mode fills those edits and C13's rule is met by the same check. If 5.9
lands first, 5.12 adds that arm to the suite.

**The Awareness task,** in `after`, `part` 0, with `read_turns` and
`set_pin`, in `close-awareness.ts`.

- Its starting rows are the chapter's rows, awareness whose
  `learned_at_entry_id` is an entry of this chapter, and the
  high-frequency set, with the chapter's summary. Rows show the happening,
  the character, `decay_resistance` and the source, and never
  `retrieval_count`. `set_pin` writes only `decay_resistance`, so these
  rows seed the read gate (C11). A row in both sets lists as a chapter row.
- The top-N read is new SQL, after the merges, so summed counts count:
  `retrieval_count > 0`, highest first, ties broken by id, leaving out
  rows of a common-knowledge happening, where a pin reaches nothing.
- `set_pin` takes a listed row by its `aw1…` handle, which Slice 5.5a's
  id layer gives a `haw_` row, a value in `[0, 1]`, `turns` and `why`, and
  lands `upsertHappeningAwareness` as a group of one with `proseEntryId`
  the latest cited turn. It resolves the row by id first,
  since a stale pair would fall to the create arm. A lower value on a row
  only in the high-frequency set is `rejected`, by 3d's one-way rule. A
  field `laterTurnWrote` reports is `skipped`, and a restated value is
  `ok`.
- The template follows the Happenings template's C3 note. No row means
  no call.

**The reset,** last in `after`, whether or not the task stopped early. A
new `resetAwarenessRetrieval` action, registered beside
`bumpAwarenessRetrieval` with a `LOCK_KEY` entry
(`lib/actions/delta/apply-delta-action.ts:51`), takes the prior count on
its payload and logs `{ retrievalCount: <prior> }` as its only undo key,
which keeps it hidden from row signals and History
(`lib/row-signals/link-owners.ts:71-77`). One delta per row with a count
above 0, read from SQL, through `delta_emitted` anchored on E, polling
`abortSignal`. It writes nothing to the ledger, and C12 exempts it.

**`chaptersOld`,** in `lib/retrieval/chapters-old.ts`.

- `current - sequence`, with `current` the highest closed
  `sequence_number` plus 1, so a chapter-3 row reads 57 at chapter 60 and
  a row in the open region reads 0. A story with no chapter reads 0
  everywhere, as today.
- No new query: `SOURCE_COLUMNS.chapter` gains `sequence_number`, and
  `LoadedChapterRow` with it (`lib/retrieval/source-rows.ts:19-25,48-71`),
  and `loadChapterRanges`, which the pass already runs, inverts to an
  entry-to-sequence map. It holds no derived state, so a chapter reversed
  or deleted reads right on the next pass.
- A happening reads from its in-scene awareness rows'
  `learned_at_entry_id`, as canon says, under the rule the open question
  settles. Entities and threads read from the source planning settles,
  and lore and chapters stay 0.
- `assembleCandidates`' `shared()` loses its literal 0
  (`lib/retrieval/run.ts:764-772`), and `lib/retrieval/types.ts:48` and
  the comment at `run.ts:770-771` flip.
- `retrieval.md → Scoring function` states what planning settled, the
  multi-POV rule and the open-region reading included.

**The round-trip suite (C9).** Cases in
`lib/pipeline/__tests__/close-round-trip.test.ts`: `merge_happenings`
as a composite and as a redundant-row merge, both with its `merge` flag,
`set_pin`, and the normalizer and the reset, which are code steps but
land under the same `actionId`. A later turn's retrieval bump on an
absorbed row joins them: the merge lands, and CTRL-Z of the close, then
of the turn, both succeed. `mark_common_knowledge` on a merged row joins
if 5.8 landed first, and both chapter delete modes if 5.12 did.

**Canon's order.** One test over `closeAgentPhase` with scripted tool
steps pins normalization, Happenings, every `perPart` task on main,
Awareness and the reset, and that a two-part chapter runs neither
chapter-wide task twice if 5.8 is on main.

**Canon this work outdates.** `generation-pipeline.md → Writes` says the
retrieval phase's sync is the only carve-out writer. `→ Reverse-replay`
calls a close's merge "the one machine update of a happening", which
`mark_common_knowledge` isn't. `chapter-close.md → 3c` gives `gold pieces`
and `gp` to `gold` as examples the algorithm can't reach. Each flips with
the work, as does whatever the open questions settle.

## Scope: out

- **Tuning the defaults,** `λ_type`, thresholds and top-N once chosen:
  [`followups.md → Tuning and play testing`](../../../../followups.md#tuning-and-play-testing).
- **Growing 3d's scope,** unless the contradicted-pin question below
  says so.
- **The full seven-task close, its E2E and a full group's reversal cost:**
  [Slice 5.10](./10-two-starts.md).
- **The driver, `close_task_start`, citation checks, the read gate, the
  ledger, ids and the later-turn reader:**
  [Slice 5.5a](./05a-task-runner.md). The banner's task labels:
  [Slice 5.6](./06-close-owed.md).
- **`updateHappening`'s precedence and noop:**
  [Slice 5.5b](./05b-identity-threads.md).
- **The `mark_common_knowledge` tool:** [Slice 5.8](./08-prose-tasks.md).
- **How a merge or a pin renders, and press routing:**
  [Slice 5.11](./11-review-window.md).
- **C13's yield mode and chapter delete:**
  [Slice 5.12](./12-chapter-delete-rollback.md). Duplicates a redo leaves
  under a manual close at the head can't reach 3e, since it never revisits
  a closed range; that residue is 5.12's question too.
- **Semantic stackable merging,** `gold` against `coin`: parked by canon
  in 3c.
- **An embed timeout:** M7.1. Like the two embeds its entry names, this
  one ends on a cancel and has no bound of its own.
- **A close's display translation:** M8.1.

## Acceptance criteria

Each test file runs under `pnpm vitest run --project unit <file>`.

- **`read_turns`:** an entry older than the store's window comes back,
  a `system` row doesn't, a state block doesn't, an unknown handle gets
  an answer and no prose, and an eleventh turn is named as unread
  (`lib/pipeline/definitions/close-agent/read-turns.test.ts`).
- **Range embed:** with a stale lore row and a stale happening outside
  the range, `embedRows` gets only in-range happenings and the others
  stay `embedding_stale = 1`; an aborted signal returns `aborted`, a
  failed embed returns `failed`, and a range of one row calls no embedder
  (`close-agent/close-happenings.test.ts`).
- **Clustering:** a pair failing each criterion alone doesn't cluster, a
  `temporal` row never does, and two rows a redo re-derived at one
  entry do (`close-agent/close-clusters.test.ts`).
- **Merge refusals:** one test per check above, each asserting the
  result, that no delta landed and that the ledger entry has no
  `survivor`, including a kept row a prior merge created a link on,
  offered as an absorbed row, and a user's `role` on an absorbed row's
  involvement for a character the kept row also has, which returns
  `skipped`. A row with only a later retrieval bump still merges, a user
  edit of the kept row's `icon` doesn't stop a merge writing only
  `description`, and a user's value on the kept row's own awareness row
  stands while the merge lands (`close-agent/close-happenings.test.ts`).
- **Merge shape:** the survivor holds the composite and the earliest
  anchor; two absorbed rows naming one character give one upsert with max,
  earliest and sum; two naming one involvement give one create; a
  user-removed involvement stays removed; a composite past the bound
  lands bounded; the ledger entry of a landed merge lists every row and
  has `survivor` (`close-agent/close-happenings.test.ts`).
- **Awareness arm:** a `chapter_close` upsert moves `learned_at_entry_id`
  and `retrieval_count` on both arms, asserted on the store patch; a
  `periodic_classifier` upsert moves neither; a count-only pair doesn't
  refuse its group (`lib/actions/happenings/register-awareness.test.ts`).
- **Where it went:** with 5.8 on main, `mark_common_knowledge` on an
  absorbed row is `rejected`, naming the survivor, and the survivor takes
  the write (the round-trip suite).
- **Normalization:** `{ Gold: 5, gold: 3 }` becomes `{ gold: 8 }`, and a
  record with nothing to fold logs no delta; a record the user or a later
  turn wrote is left alone; no ledger entry appears
  (`lib/keyword-terms.test.ts`, `close-agent/close-stackables.test.ts`).
- **Guard:** after normalization, a later user removal of the whole
  `stackables` record, or an edit of one key, survives a reversal of the
  close whole, with no old spelling restored
  (`lib/actions/delta/reverse-replay-user-writes.test.ts`). With 5.12 on
  main, a later turn's write to the record survives a chapter delete
  normalized (the round-trip suite).
- **Awareness start:** with `retrieval_count` above 0 on rows from an
  earlier chapter, the top-N rows appear, no number from the column appears
  anywhere in the rendered prompt, and a count from an absorbed row lifts
  its kept row (`close-agent/close-awareness.test.ts`).
- **`set_pin`:** landed, restated, user-won, later-turn and one-way
  refused cases each return C11's result, and a citation outside the
  chapter is `rejected` on a high-frequency row
  (`close-agent/close-awareness.test.ts`).
- **Reset:** every count on the branch reads 0 after the phase, each row
  has one `chapter_close` delta anchored on E, no count-only delta reaches
  History, and a task stopped at its budget still resets
  (`close-agent/close-awareness.test.ts`).
- **Report:** `part` is 0 for both tasks' calls and `stopped` rows, and
  neither normalization nor the reset appears in `calls`
  (`lib/pipeline/definitions/chapter-close-agent.test.ts`).
- **Order:** as Canon's order states, and a chapter with no cluster or
  no awareness row makes no call for that task while its
  `close_task_start` still fires (`chapter-close-agent.test.ts`).
- **Decay:** with 59 closed chapters and an awareness row learned in
  chapter 3 at `decay_resistance` 0.3, the candidate's `chaptersOld` is 57
  and its captured `recency_factor` is within 0.001 of
  `exp(-0.07 × 57 × 0.7)`; a row in the open region reads 0, and one in the
  newest closed chapter reads 1 (`lib/retrieval/chapters-old.test.ts`).
- **A pin moves a score:** on that fixture, a `set_pin` to 0.9 through the
  real action raises the next pass's `recency_factor` to within 0.001 of
  `exp(-0.07 × 57 × 0.1)` (`close-agent/close-awareness.test.ts`).
- **No chapters, no change:** on a story with no closed chapter every
  candidate reads `chaptersOld` 0 (`lib/retrieval/run.test.ts`).
- **Entities and threads:** each reads the value planning settled, one
  case per type (`chapters-old.test.ts`).
- **Parity:** a capture from a pass with non-zero `chaptersOld` on real
  source rows replays equal (`lib/probe/parity.test.ts`).
- **Round trip:** every tool and step above is a case in
  `close-round-trip.test.ts`, with no close reaching `held-in-redo`.
- **Stability:** `lib/prompts/bundled/system-half-stability.test.ts`
  passes with both new templates and no new exemption.
- **Deferrals:** `grep -n "M5" lib/retrieval/run.ts lib/retrieval/types.ts`
  prints nothing.
- **Canon flips:** `grep -n "the only such" docs/generation-pipeline.md`,
  `grep -n "the one machine" docs/generation-pipeline.md` and
  `grep -n "gold pieces" docs/memory/chapter-close.md` each print nothing.
- **Measures:** Implementation notes hold the three numbers under Tests.
- **Gates:** `pnpm lint`, `pnpm format:check`, `pnpm compiler:check`,
  `pnpm typecheck`, `pnpm lint:docs` and `pnpm test:run` pass.

## Tests

- **Vitest, unit:** clustering, `normalizeStackables` and `chaptersOld`
  as pure functions, run on inputs that can fail, with expectations
  written out, never derived from the constant under test.
- **Vitest, phase level:** both tasks through the real orchestrator and
  the real action layer on a test DB, with tool steps scripted as Slice
  5.5a's suite scripts its fixture tool.
- **Round-trip suite:** Slice 5.5a's table, over a real close group.
- **Measures, recorded in Implementation notes with no bar:** on 5.2's
  dataset chapter with the dev embedder, how many clusters the chosen terms
  give, how many tokens the Awareness start list costs, and what the
  reset's burst costs at the row count it produces.
- **No E2E here.** 5.10's Auto close spec covers both tasks.

## Open questions

- **Where does `chaptersOld` read from?** This needs the developer at
  planning, with the `aventuras-design` route offered: landing it shifts
  every chaptered story's ranking, and canon and
  [M3.4's decision](../../03-memory-floor/slices/04-retrieval.md#open-questions)
  disagree.
  - _Happenings._ Canon says `learned_at_entry_id`, and M3.4 said
    `occurred_at_entry_id`. Recommendation: canon, as
    [M4.3's note](../../04-world-plot-read-surfaces/slices/03-plot-panel.md#implementation-notes)
    also took. A candidate stands for the in-scene union, and canon has no
    multi-POV rule. Recommendation: the smallest age among its rows, which
    pairs with `pinSignal`'s max. It can overstate a row whose pin and
    youngest anchor sit on different characters, which per-row scoring
    would fix at the cost of the probe's single pair. A null anchor falls
    back to the happening's `occurred_at_entry_id`, else 0, and a dangling
    one reads 0.
    A common-knowledge row's value reaches only the probe, since the ranker
    ignores it, so canon's `created_at` arm can go.
  - _Entities and threads._ Canon says `updated_at`, which no handler
    advances, and advancing it brings a write at every handler, no undo,
    and a close refreshing what it only compacted. A created-at anchor
    column, M3.4's shape, is safe under reversal but ages a protagonist who
    was on stage last chapter. With no schema, threads could read
    `resolved_at_entry_id` or `triggered_at_entry_id`, and characters
    `lastSeenAt` against chapter time ranges, leaving other kinds at 0.
    Or both stay 0, with canon narrowed and a tuning followup.
    Recommendation: stay at 0. Neither type has a pin, nothing in M5 reads
    their decay, and their `λ` is a guess, so real stories should say
    whether it earns a column. A new column follows C5's migration rule.
  - _Which chapter is "at chapter 60"?_ The open one, as written above,
    is the only reading that gives canon's 57.
- **How far does `read_turns` reach?** High-frequency rows come from any
  chapter, and a citation outside the chapter is refused. Recommendation:
  any non-system entry at or before E can be read, for a row's origin,
  and citations stay inside the chapter. 5.5a's handles cover the chapter
  only, so a row from elsewhere takes one through `registerHandle` when
  it's listed.
- **What of the fields 3e doesn't name?** `common_knowledge` when one row
  has it, `category`, `icon`, a null `learned_at_entry_id`, the source
  separator, and whether embedded-text bounds apply to a composite.
  Recommendation: `common_knowledge` survives, since dropping it hides a
  happening from everyone it reached; the kept row's `category` and `icon`
  stand; null loses to any anchor; sources join with `; `, deduped; and
  a composite is clamped as the classifier clamps, since canon says the
  app's own writers are bounded.
- **What are clustering's terms?** The denominator of "overlap ≥ 50%",
  pairwise or transitive membership, zero involvements, what "~3 entries"
  measures given gapped positions, and a size limit. Recommendation: the
  smaller cast as denominator, every pair meeting all three criteria so
  no chain can drift, a row with no involvements clustering with nothing,
  counting non-system entries between anchors, and no size limit yet.
- **What is N?** No value exists in canon or code. Recommendation: a
  constant of 20, with its value left to tuning.
- **What is 3c's rule, and which writes stop it?** A bare `-s` strip turns
  `glass` to `glas`. Recommendation: a plural folds only onto a singular
  that exists on the branch, so `arrows` joins `arrow`, and `glass`,
  alone, stays. 3c cites no turn, so E's prose is its anchor, and a user
  edit after it or a later turn's write skips the whole record. A
  by-key skip would let `Gold` return beside a user's `gold`, which is
  also why the guard above is by record.
- **Does lore-mgmt catch a contradicted pin?**
  [`retrieval.md → Pin contradiction reconciliation`](../../../../memory/retrieval.md#pin-contradiction-reconciliation)
  and [`edge-cases.md → v1 limitations`](../../../../memory/edge-cases.md#v1-limitations)
  promise it, and 3d reviews only the chapter's rows and frequency rows
  it can't demote, so a death pinned in chapter 3 and undone in chapter 25
  is neither. Recommendation: drop the sentence from both and keep 3d's
  scope.
- **What bounds the two start lists?** Neither task has parts, and canon
  projects 250 to 1000 awareness rows a chapter, so a long chapter's list
  can fill the window, and a first call that doesn't fit fails the close,
  every retry included. Recommendation: list rows under their happening,
  and past the prose tasks' read limit keep the highest `decay_resistance`
  and log how many were left out. The dataset chapter's measure tests this.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
