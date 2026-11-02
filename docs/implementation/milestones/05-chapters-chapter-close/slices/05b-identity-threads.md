# Slice 5.5b — Identity and Threads at size

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.5a](./05a-task-runner.md), and through it
  [Slice 5.2](./02-first-chapter.md)'s dataset chapter and
  [Slice 5.4](./04-tool-step.md)'s tool step
- **Blocks:** [Slice 5.8](./08-prose-tasks.md),
  [Slice 5.9](./09-chapter-wide-tasks.md),
  [Slice 5.11](./11-review-window.md)

## Goal

The first real tools on Slice 5.5a's runner: `update_character`,
`update_faction`, `update_thread` and `merge_threads`, with the
Identity and Threads tasks that call them. They carry the hardest write
shapes a close has: a whole list under a soft cap, a status anchored on
a cited turn, and a merge that lands whole. The slice then runs both
tasks through `pnpm probe:close` on a real 24k chapter on the dev model,
so the tool contract is proved at size before Slices 5.8 and 5.9 build
on it.

## Background

Slice 5.5a ships the runner, the verdict seam and the reads, proved on a
stand-in tool, so a real model first meets them here. The close's design
measured a chapter of about 100 words with five tools, and this is the
first run at 24k tokens. Every `updateEntity`, `updateThread` and
`deleteThread` call today is `user_edit`, so a close is their first
machine caller, and `updateThread` and `updateHappening` log columns they
didn't change, which the later-turn rule and History would read as
writes. The run answers whether the agent holds, not whether it is good:
tuning stays in
[`followups.md → Tuning and play testing`](../../../../followups.md#tuning-and-play-testing).

## Required reading

- [`chapter-close.md → Run order`](../../../../memory/chapter-close.md#run-order),
  [`Conversations`](../../../../memory/chapter-close.md#conversations),
  [`Tools and writes`](../../../../memory/chapter-close.md#tools-and-writes),
  [`When a task stops`](../../../../memory/chapter-close.md#when-a-task-stops)
  and [`Logs and anchors`](../../../../memory/chapter-close.md#logs-and-anchors)
  — the task table, the three results, the later-turn rule, the anchor.
- [`chapter-close.md → 3b — identity compaction`](../../../../memory/chapter-close.md#3b--identity-compaction)
  — the operations and the discipline Identity's template carries.
- [`chapter-close.md → 3f — world upkeep`](../../../../memory/chapter-close.md#3f--world-upkeep)
  (the Threads bullet) and
  [`3e — happenings consolidation`](../../../../memory/chapter-close.md#3e--happenings-consolidation)
  ("A merge lands whole, once per row"), whose rules `merge_threads`
  follows.
- [`chapter-close.md → Review`](../../../../memory/chapter-close.md#review)
  — what the report holds for a landed, partly landed and refused call.
- [`cadence.md → User edits and classifier writes`](../../../../memory/cadence.md#user-edits-and-classifier-writes)
  — user precedence, field by field and inside `state`.
- [`data-model.md → Soft caps`](../../../../data-model.md#soft-caps--compaction-discipline)
  and [`Authorship contract`](../../../../data-model.md#authorship-contract)
  — the chapter-close rows these tools are allowed to write.
- [`classifier.md → Threads`](../../../../memory/classifier.md#threads)
  — the entry refs and who may set them.
- [`generation-pipeline.md → Writes`](../../../../generation-pipeline.md#writes)
  and [`Reverse-replay`](../../../../generation-pipeline.md#reverse-replay)
  — `delta_group_emitted`, and why a delete holds a row from redo.
- [`architecture.md → System and user halves`](../../../../architecture.md#system-and-user-halves)
  — the rule C3 narrows.
- [`retrieval.md → What gets embedded per type`](../../../../memory/retrieval.md#what-gets-embedded-per-type)
  — the app's own writers stay under the embedder's ceiling.
- [`testing.md → Real-provider checks`](../../../../testing.md#real-provider-checks)
  — how the probe precedent runs against a real server.
- [Slice 5.5a → Scope: in](./05a-task-runner.md#scope-in) — the tool
  plan, the row guard, `fieldVerdicts`, `entityWriteAction`, the ledger,
  the suite and the probe this slice builds on.
- Milestone contracts
  [C1](../milestone.md#c1--a-closes-delta-shape),
  [C2](../milestone.md#c2--pipeline-shape),
  [C3](../milestone.md#c3--the-chapter-context-group),
  [C4](../milestone.md#c4--close_report-v1),
  [C6](../milestone.md#c6--what-the-banners-n-of-m-counts),
  [C9](../milestone.md#c9--the-round-trip-rule),
  [C11](../milestone.md#c11--tool-results) and
  [C12](../milestone.md#c12--what-a-later-turn-wrote-means).

## Scope: in

Tools and tasks sit under `lib/pipeline/definitions/close-agent/`, with
Slice 5.5a's runner.

### Handlers

- **Unchanged columns.** `updateThread`
  (`lib/actions/threads/register.ts:135-142`) and `updateHappening`
  (`lib/actions/happenings/register-happenings.ts:118-126`) drop a
  column whose value already stands, as `updateLore` does
  (`lib/actions/lore/register.ts:125-134`), compared after `nullifyRef`
  so `''` over a null is unchanged. A patch naming no updatable column
  stays a plain rejection. A `set` emptied this way ends in
  `noopRefusal(reason, 'restated')`, C11's marker, so a restated value
  neither reads as a later write nor aborts its group. `updateThread`'s
  ref arm (`register.ts:145-154`) stays: a real status change on a
  thread with refs still logs `resolvedAtEntryId` beside it.
- **`proseEntryId` on two handlers.** `updateThread` and
  `updateHappening` take an optional `proseEntryId: ProseEntryId`, which
  no user caller sends, so no shipped caller changes. With it, a column
  the user wrote after that prose is dropped from `set`, by
  `userEditsSinceProse` and `wroteField`, and a `set` left empty by that
  ends in `noopRefusal(USER_EDITED_SINCE_PROSE)`, which C11 maps to
  `skipped`. An `ok` outcome can't name a dropped column, so a caller
  sending two columns reads ahead through the row guard first, as both
  merges do. `updateHappening` has no caller here: 5.8's
  `mark_common_knowledge` and 5.9's merge are the first, so it is proved
  by handler tests alone.
- **`updateEntity`'s handler doesn't change,** per Slice 5.5a's planning.
  `fieldVerdicts` runs precedence ahead of the group through the row
  guard, so a handler check would re-read what the guard already dropped.
  `update_character` and `update_faction` get their precedence there.
- **`deleteThread` stays as it is.** A noop inside a group is dropped, so
  a merge's precedence is a read ahead of the group (C11), not a check
  in the delete.

### Every write tool, in order

Each tool is a Slice 5.5a plan, which reads ahead and returns a refusal
or actions tagged with the fields they write.

1. **Common checks.** Slice 5.5a's `turns`, `why` and read gate, over
   every row the call names, which give the plan its `proseEntryId`.
2. **The fields as sent.** A blank text value and an empty list read as
   omitted: a model fills optional fields, and a list replaces the
   stored one whole, so `drives: []` would wipe the row. Lists go
   through `dedupeTerms`, as a pass's do
   (`lib/classifier/plan-creates.ts:55-57`). Text is bounded as a pass
   bounds it, so `updateEntity`'s Zod parse can't refuse a call over it
   and the embedder's ceiling holds: `standing` by `boundStateText`,
   `voice` at 2,000 characters, `description` and a thread's `title` by
   `clampEmbeddedText`'s limits. A call with no field left is `rejected`.
3. **Restated fields** leave the call, when the value equals the stored
   one as sent or as bounded. Comparing only the bounded value would read
   a user's longer description as a change and land a cut copy, and this
   runs before the guard so a restated protected field isn't reported as
   skipped. A call with nothing else is `ok`, writes nothing and holds no
   `values`.
4. **Protection.** The row guard, field by field. For an entity, Slice
   5.5a's `fieldVerdicts` reads `laterTurnWrote` and `userWrote`
   for each field sent, `description` included. For a thread
   `laterTurnWrote` runs here, and user precedence stays on the actions'
   `proseEntryId`.
5. **Soft caps.** A list that would still land is checked against
   `CAST_SOFT_CAPS` (`lib/wizard/assist-schemas.ts:69-73`), by `traits`,
   `drives` and `agenda`. Over a cap that list is refused and what else
   the call holds lands, `ok` naming the list and its reason, per C11; a
   call with nothing else is `rejected`. The tool schema carries no
   `.max()`: a schema failure would reach the model as a malformed call,
   with no entry in the report.
6. **Landing.** For an entity, Slice 5.5a's `entityWriteAction`
   makes the one `updateEntity` from the fields still wanted, with `description` in its
   patch. What's left goes out as one `delta_group_emitted`, and Slice
   5.5a's mapping reads the outcomes into the result. With nothing left
   the plan emits no group, and its result follows that mapping's rule
   for a call where nothing landed: `rejected` if a cap refused a field,
   else `skipped`.

The ledger entry fills C4's fields with `part: 1`, keyed by delta path
(`state.traits`, `description`), and a field lost from a call that landed
goes in `skippedFields` with its own reason.

### Tools

| Tool               | Fields                                           | Lands as                                                                    |
| ------------------ | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `update_character` | `traits`, `drives`, `voice`, `description`       | One `updateEntity` from `entityWriteAction`                                 |
| `update_faction`   | `agenda`, `standing`, `description`              | The same, with `standing` in that one `state` write                         |
| `update_thread`    | `description`, `status` (`resolved` or `failed`) | `updateThread` for the text and `setThreadStatus` for the status, one group |
| `merge_threads`    | `keep`, `absorb` (ids), `title`, `description`   | `updateThread` on `keep` and `deleteThread` per absorbed row, one group     |

Each takes `turns` and `why`; the first three take `id`.

`update_character` and `update_faction` land as one `updateEntity` per
Slice 5.5a's planning, which weighs it against a narrow action taking a
sub-field map. As input to that decision, the whole-state parse looks
safe, read and not run: per-turn stackable keys are bounded at parse
(`lib/piggyback/parse.ts:37-41`) and visual text by `boundStateText`.

- **`update_character` and `update_faction`** refuse a row of the wrong
  kind as `rejected`. Neither reaches `setFactionStanding`: a second
  `state` write on one row refuses the group
  (`lib/actions/delta/apply-delta-action.ts:317-324`).
- **`update_thread`** sends a status only through `setThreadStatus`,
  with `proseEntryId` and `resolvedAtEntryId` both the latest cited turn,
  because `updateThread` keeps the old ref on a machine status change
  (`register.ts:152`). It takes no `title`: canon brings descriptions up
  to date, and a title changes only on a merge.
- **`merge_threads`** declares `keep` and `absorb` as ids, the second an
  array. `title` and `description` are optional, so a redundant row
  merges with the kept text. Its checks run ahead of the group, in this
  order, and any that stops the call writes nothing:
  1. The common checks on every row. `keep` inside `absorb`, a repeated
     id or an empty `absorb` is `rejected`.
  2. A row that's gone is `rejected`, naming its survivor from the
     ledger. The same goes for `update_thread` on a row this close
     absorbed.
  3. A row this close already wrote can't be absorbed: any delta on it
     under the run's `actionId` is `rejected`, saying to keep that row
     instead. `snapshotForRedo` would otherwise refuse CTRL-Z of the
     close for good (`lib/actions/delta/redo.ts:118-126`). Such a row may
     still be the kept one.
  4. `laterTurnTouched` on any row is `skipped` whole.
  5. A user edit after the latest cited turn is `skipped` whole:
     `userTouched` on an absorbed row, or `userWrote` on `keep` for a
     field the merge writes. A kept row's other fields lose nothing to a
     merge, so they don't stop one (C11).

  The ledger entry lists every row, and sets `survivor` to `keep` only on
  a landed merge (C4).

### Tasks and templates

- **Identity and Threads in `perPart`** (C2), under the `CloseTask`
  values `identity` and `threads`, with canon's tool lists:
  `search_world`, `read_row`, `update_character` and `update_faction`;
  `read_row`, `update_thread` and `merge_threads`. One part only, since
  parts are 5.8's.
- **Identity's start.** The slow fields of the characters in the closed
  range's `metadata.sceneEntities`, dropping ids with no live row, and of
  the factions the chapter touches (see Open questions). Scene data holds
  no factions
  ([`principles.md → Scene presence`](../../../../ui/principles.md#scene-presence-is-runtime-derived-not-status)),
  so a faction comes from those characters' `faction_id`, and from
  matching faction names and keywords over the range's prose with
  `matchTerms`.
- **Threads' start.** Every `pending` and `active` thread on the branch,
  the user's included, by `title`, `description` and `status`.
- **`read_row`'s field registry,** keyed by task and row kind:
  `description`, `traits`, `drives` and `voice` for a character;
  `description`, `standing` and `agenda` for a faction; `title`,
  `description` and `status` for a thread. Both starts show these fields,
  so their rows count as read (C11).
- **Templates.** Two `TEMPLATE_IDS` entries mapped to `chapter` in
  `TEMPLATE_GROUPS`, on Slice 5.5a's shared system half, each user half
  holding its task's instructions, starting rows and the writes so far.
  Identity's carries 3b's operations and "don't churn stable identity",
  and "replace, don't append" at a cap. Threads' carries 3f's bullet and
  what an active thread costs. Both ids join the named list at
  `lib/prompts/bundled/system-half-stability.test.ts:312`, which 5.5a
  ships empty (C3). Two checks come here from 5.5a, since the list first
  holds a template in this slice: a function over a list and a group map
  refuses a template outside the `chapter` group, and the shared half
  renders the same bytes across the two tasks of one part.

### Round-trip suite

Each of the four tools joins `lib/pipeline/__tests__/close-round-trip.test.ts`
as a case (C9). `merge_threads` sets the `merge` flag, so a close's CTRL-Z
is asserted never to reach `held-in-redo`. Two further cases put
`update_thread` before a merge:

- `update_thread(A)` then `merge_threads(keep: A, absorb: [B])` lands, on
  the kept-row path.
- `update_thread(B)` then `merge_threads(keep: A, absorb: [B])` is
  `rejected`, with no `held-in-redo` on all five arms. This is the case
  that reaches the already-wrote check: without the check the merge
  lands and CTRL-Z throws.

The check selects by `actionId`, so it holds across the parts 5.8 adds.

### The measure

- **`pnpm probe:close`** runs Identity and Threads on Slice 5.2's dataset
  chapter on the dev model, at `PROBE_RUNS=10`, with `PROBE_OUT` outside
  tracked files. Until 5.8 the chapter is one part, so read the served
  model's window first: the chapter has to fit half of it.
- **The bar** is set at slice planning, before the runs, by amending the
  open question below. A miss goes to the developer and holds 5.8 and
  5.9.
- **`CLOSE_REPORT_VALUE_BOUND`** takes its number from these runs: the
  largest `values` entry and the whole report's size go in Implementation
  notes (C4).
- **Whole-prompt counting per step.** Read `provider.prompt_estimate`'s
  `ms` (`lib/ai/context-window.ts:109-122`), on a close of the dataset
  chapter from the dev route, on the desktop renderer and on Android with
  diagnostics on. `probe:close` runs under Node, so it can't give either
  number. A bad number reopens this slice's approach, not the layout.

## Scope: out

- The runner's parts, Slice 5.5a's: the driver, ledger, common checks,
  row guard, `fieldVerdicts`, `entityWriteAction`, id layer,
  `search_world`, and the `probe:close` and suite harnesses. This slice
  only adds to `read_row`'s registry and the suite's table.
- Lore, Upkeep and Lifecycle ([Slice 5.8](./08-prose-tasks.md)),
  including `update_place`'s and `update_item`'s `description` and
  `mark_common_knowledge`.
- Parts and the `perPart` loop over them
  ([Slice 5.8](./08-prose-tasks.md)).
- Happenings, Awareness and `merge_happenings`
  ([Slice 5.9](./09-chapter-wide-tasks.md)), whose pre-checks add link
  rows to these. Placing every landed task first and last in canon's
  order is 5.9's too.
- A bound on lore bodies and happening composites, which this slice
  doesn't write (Slices [5.8](./08-prose-tasks.md) and
  [5.9](./09-chapter-wide-tasks.md)).
- The review's rendering and Not applied
  ([Slice 5.11](./11-review-window.md)). This slice fills the ledger, and
  nothing reads it yet.
- Chapter delete's later-write rule
  ([Slice 5.12](./12-chapter-delete-rollback.md)).
- The seven-task `probe:close` run and the first E2E through scripted
  steps ([Slice 5.10](./10-two-starts.md)).
- Tuning the prompts, the step budget and the caps' numbers
  ([`followups.md → Tuning and play testing`](../../../../followups.md#tuning-and-play-testing)).
- `closeConversation: single` and `closeTools: shared` (M7.1).

## Acceptance criteria

Test paths below run with `pnpm vitest run --project unit <path>`.
`identity.test.ts` and `threads.test.ts` are new, under
`lib/pipeline/definitions/close-agent/`.

1. **Unchanged columns.** In `lib/actions/threads/register.test.ts` and
   `lib/actions/happenings/register-happenings.test.ts`, a patch
   restating every named column returns a noop with the `restated` mark
   and logs no delta; a patch changing one of two columns logs an undo
   payload holding that key alone; `patch: {}` stays a rejection with no
   `code`; `''` over a null ref logs nothing; and a user's status change
   on a thread with refs still logs both columns. The
   `{ status: 'resolved' }` case at `threads/register.test.ts:414-426`
   flips to the noop.
2. **Handler precedence.** In those two files, with `proseEntryId` set: a
   column the user wrote after the prose keeps its value while a sibling
   lands, a user edit before the prose loses, and an all-protected write
   is a noop with `USER_EDITED_SINCE_PROSE`. With it omitted, behaviour
   is unchanged.
3. **Results.** In `identity.test.ts` and `threads.test.ts`, each line of
   C11's table these tools can reach returns its result: restated `ok`
   with no delta and no `values`; a partly protected call landing its
   free fields, `ok`, with `skippedFields` and both fields in `values`;
   an all-protected call `skipped`; one action landed and one refused,
   `ok` naming the refused field; a gone row `rejected`, naming the
   survivor.
4. **Protection inside `state`.** A user edit of `state.traits` after the
   cited turn doesn't shield `voice`, and a later turn's `standing` write
   leaves `state.standing` skipped while `agenda` lands. With `voice` the
   only `state` field sent and protected, `description` still lands and
   the result is `ok`. A `chapter_close` delta on the row doesn't count as
   a later write.
5. **Fields as sent.** `drives: []` and `voice: ''` beside a real
   `traits` write land `traits` alone and leave `drives` and `voice` as
   they were. A 3,000-character `voice` lands cut to 2,000, and a
   restated description over the embedded bound writes nothing.
6. **Soft caps.** With literal numbers, not `CAST_SOFT_CAPS`: 8 traits, 6
   drives and 4 agenda land. Sent alone, 9, 7 and 5 are `rejected` with no
   delta. Beside a sibling field, the sibling lands and the result is
   `ok`, with the list in `skippedFields` and its reason. A list the guard
   removes reaches no cap check.
7. **Delta shape.** Every delta these tools write has
   `source = 'chapter_close'`, the run's `action_id` and `entry_id = E`,
   asserted on the DB rows.
8. **Status.** `update_thread` with `turns` listed out of order writes
   `resolved_at_entry_id` as the latest by position; a status restated is
   `ok`; a user's thread keeps both refs null; and a status the user
   wrote after the cited turn returns `ok` with `status` in
   `skippedFields`, reason `USER_EDITED_SINCE_PROSE`, and its `description`
   lands.
9. **Merge.** `threads.test.ts` covers a clean merge landing one update
   and each delete; a redundant merge with no text; a later turn's write
   on either row skipping it whole with no delta; a user edit of any
   field of an absorbed row, or of a field the merge writes on `keep`,
   skipping it whole with no delta; a user edit of another field on
   `keep` not stopping it; absorbing a row the close wrote refused;
   keeping that row landing; `survivor` set on a landed merge and absent
   on a refused or skipped one; and `update_thread` on an absorbed row
   refused, naming the survivor.
10. **Round trip.** `lib/pipeline/__tests__/close-round-trip.test.ts` holds
    a case for each of the four tools and both cases of `update_thread`
    before a merge, through all five arms, and it fails if `merge_threads`'
    already-wrote check is removed.
11. **Tasks.** With scripted steps: each task sends canon's tool list; an
    empty start makes no step call and no failure; and
    `close_task_start` gives `3 of 7` for Identity and `4 of 7` for
    Threads on a one-part chapter. A scene id with no live row reaches no
    prompt, and a faction reaches Identity's start by membership and by
    name.
12. **Templates.** `lib/prompts/bundled/system-half-stability.test.ts`
    passes with its list naming exactly the two templates. The list's
    check, given a list and a group map, refuses a fixture id outside
    `chapter`, so it can't pass on the real list alone, and the shared
    half renders the same bytes across Identity and Threads in one part.
    `lib/prompts/templateContextMap.test.ts` and
    `lib/prompts/bundled/bundled-pack.test.ts` pass.
13. **The measure.** `PROBE_RUNS=10 pnpm probe:close`, with
    `SMOKE_LLM_URL`, `SMOKE_LLM_MODEL` and `PROBE_OUT` set, meets the bar
    in Open questions on Slice 5.2's dataset chapter on the dev model.
    Implementation notes hold the model id from `/v1/models`, each task's
    outcome per run and where the saved messages are. A miss has gone to
    the developer.
14. **Numbers.** `CLOSE_REPORT_VALUE_BOUND` is set from those runs, and
    Implementation notes hold the report sizes and the per-step counting
    time on desktop and Android.
15. **Gates.** `pnpm lint`, `pnpm format:check`, `pnpm compiler:check`,
    `pnpm typecheck`, `tsc -p electron/tsconfig.json`, `pnpm lint:docs`
    and `pnpm test:run` pass.

## Tests

- **Vitest on the handlers,** extending the two shipped `register` test
  files, on a real test DB.
- **Vitest on the tools and tasks,** in `identity.test.ts` and
  `threads.test.ts`, with the DB real and only the step scripted, so a
  write goes through the group and the mapping. The round-trip suite
  carries reversal.
- **Vitest on the templates,** through the shipped stability and pack
  tests.
- **`pnpm probe:close`** on the dev model, the slice's main evidence.
  Read the transcripts as well as the counts: an earlier classifier
  probe misled on counts alone.
- **No E2E and no stories.** The slice has no UI, and Slice 5.10's E2E
  proves the whole close.

Green proves little here without a mutation: for each new guard (soft
cap, already-wrote, kept-row field, restated compare, empty list, latest
by position) break it and confirm its test fails, and keep caps as
literals so a test can't derive its expectation from the constant.

## Open questions

- **Does the whole-prompt count hold for a story in Japanese or Chinese?**
  An English dataset chapter says little about those. On an x86_64
  emulator's debug build a count of 40,000 characters took 35 ms of
  English, 591 ms of Chinese and 2,088 ms of Japanese, on the JS thread
  ([Slice 5.1's closing review](../../../../followups.md#ux)), and this
  slice counts per tool step. Measure a CJK prompt beside the English one.
- **What bar does the measure have to clear?** Set it at slice planning
  and amend this question with it, since a bar written after the runs
  proves nothing. Suggested: both tasks finish in 8 of 10 runs, with no
  step reaching the 8k output bound, reading before writing. "Finishing"
  alone would pass a model that answers in plain text, so count a run
  with `noToolCalls` as a miss.
- **Which status and refs survive `merge_threads` when the rows differ?**
  Canon names neither, and a kept `pending` thread absorbing an `active`
  one would drop it from the narrator's prompt with no write saying so.
  Suggested: the kept row's status, refs, `category`, `icon` and
  `injection_mode` stand, and absorbing an `active` thread into a
  `pending` one is `rejected`, saying to keep the active one.
- **What does a soft cap do on a row already over it?** A user's or an
  import's 12 traits, and an agent sending 10, is over the cap and an
  improvement. Suggested: refused only when the list would grow past the
  cap, so a reduction lands.
- **What makes a faction "touched"?** Canon's start names entities the
  chapter touches, scene data never holds factions, and membership and
  name matching are this doc's reading. Confirm it, since Slice 5.8's
  starts read the same way, and check how many rows it brings on the
  dataset chapter.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
