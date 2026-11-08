# Milestone 5: Chapters + chapter-close

## Goal

A story closes chapters for real. When the open region crosses its
token threshold, or the user picks an end, one LLM-powered close runs:
catch-up passes, boundary selection on an auto close, chapter metadata,
and the lore-management agent's tasks, landing as one reversible group
the user can review afterwards. The reader navigates by chapter, the
Chapter Timeline ships as the management surface, retrieval's decay
starts measuring chapter distance, and rollback, regenerate and chapter
delete tell the truth about what a close did.

## Why now

M3 and M4 fill the world and let the user see and correct it, and
nothing consolidates it: lore has no AI writer, identity fields stay as
first written, threads and happenings only grow, and a long story's
open region grows without limit. Chapter close is the second-largest
piece of the memory pipeline after the per-turn classifier, and it
needs the World and Plot surfaces first, because a compaction nobody
can see is untestable. It also unlocks M6, whose fork has to respect
close writes, and it turns on what earlier milestones left waiting:
the chapter-summaries pool has no rows, Plot's chapter buckets are
seed-only, `chapterAutoClose` has no reader, and `chaptersOld` is a
hardcoded 0, so a pin moves no score.

## Narrative / overview

**A chapter is only ever created by a close.** There are two closes and
they are the same pass: an auto close fires on the token threshold and
starts with boundary selection, and a manual close runs at an entry the
user picks. The roadmap's "insert break" and "manual-boundary
primitive" are gone. A chapter always ends on an `ai_reply` (C10).

Four tracks compose the milestone. The first three start at once, and
the reversal track follows them.

**The chapter track** makes a real chapter without an agent.
[Slice 5.1](./slices/01-token-measure.md) lands the stored token
measure, so the trigger, the strip, Phase 1 and the modal read one
number from the DB (C5).
[Slice 5.2](./slices/02-first-chapter.md) builds the `chapter-close`
pipeline with metadata, the chapter row, stamps and an agent slot,
started from a dev route: a close with no tasks is a whole close,
because run order puts metadata and stamps before any task and a task
with nothing to do doesn't fail. Reversal then runs on real deltas
instead of synthetic ones. The same slice corrects the seed, whose
close deltas anchor null and whose test pins the opposite of canon, and
builds the real chapter the agent is measured on, from a story dataset
run through the classifiers.
[Slice 5.6](./slices/06-close-owed.md) makes a close owed: the chain,
phase 0, Send's owed work, the interrupt, CTRL-Z of a running close,
the banner and the failure surfaces.

**The agent track** comes early because the tools rest on it. The
close's design measured a chapter of about 100 words with five tools;
a real close has 24k tokens, seven tasks and fourteen write tools.
[Slice 5.4](./slices/04-tool-step.md) gives `lib/ai` a tool step and
both mocks a way to script one.
[Slice 5.5a](./slices/05a-task-runner.md) builds the runner and its
verdict seam. [Slice 5.5b](./slices/05b-identity-threads.md) proves them
with the Identity and Threads tasks, which carry the hardest write
shapes, and measures them on the real chapter through
`pnpm probe:close`. Nothing else builds on the tool contract until that
has run. [Slice 5.8](./slices/08-prose-tasks.md) and
[Slice 5.9](./slices/09-chapter-wide-tasks.md) finish the job: Lore,
Upkeep, Lifecycle and parts, then Happenings, Awareness, stackable
normalization and the decay that gives pin tuning its effect.

**The surface track.** [Slice 5.3](./slices/03-reader-chapters.md)
gives the reader its chapter chip, popover, inline breaks and jump to
entry. The chips were never built and are new here, and jump moves in
from M7.3, since three M5 surfaces consume it.
[Slice 5.7](./slices/07-chapter-timeline.md) ships the Timeline on
seeded chapters. [Slice 5.11](./slices/11-review-window.md) shows what a
close changed. [Slice 5.10](./slices/10-two-starts.md) comes after
everything it wires: it makes both closes reachable, with the modal, `STORY TOOLS`,
`Close chapter here`, Phase 1's model call and the `toolCalling` gate,
and it proves the whole close end to end.

**The reversal track** is one slice.
[Slice 5.12](./slices/12-chapter-delete-rollback.md) is not the new
surface the roadmap expected: the rollback modal, its counts and the
cascade warning shipped in M2.5, and reversal needs no code in
`lib/actions/delta/` for a rollback. It lands chapter delete, the
regenerate arm and honest copy. Chapter delete is **not** a rollback,
which is a canon correction from the developer: deleting a chapter
undoes what the close did and leaves every entry in place, for the
latest chapter only, as CTRL-Z of the close still available after later
turns (C13).

What changes from "before" to "after": the app goes from "an open
region that only grows" to "a story in chapters, whose memory is
consolidated at each boundary, reviewable, and reversible". M6 then
forks over all of it.

Six deliberate M5 limits. A close runs only the default
`closeConversation: split` and `closeTools: separate`; `single`, `shared`
and both profile fields move to M7.1, since nothing can set them before
its profile editor. `toolCalling` ships settable only by DB or catalog,
and `Fix profile` lands on the Providers tab until M7.1. `Regenerate
summary` renders disabled until M7.2, since canon doesn't specify its
run. A close's display translation has no slot until M8.1. A close's
turn capture carries no anchor and the `ch. 3` run summary doesn't
exist, both M7.3's, whose inspector is their first reader. Tuning stays
in [`followups.md → Tuning and play testing`](../../../followups.md#tuning-and-play-testing):
Slice 5.5b answers whether the agent holds, not whether it is good.

## Slices

- [Slice 5.1](./slices/01-token-measure.md) — token measure:
  `content_tokens`, `openRegionTokens`, the per-entry series, the strip
  from the DB (C5)
- [Slice 5.2](./slices/02-first-chapter.md) — first chapter: the
  `chapter-close` pipeline with metadata, stamps, `close_report` and an
  agent slot, the seed's close shape, reversal on real deltas, the
  dataset chapter (C1, C2, C3, C4, C8, C10, C14)
- [Slice 5.3](./slices/03-reader-chapters.md) — reader chapters: jump
  to entry, chapter and time chips, popover, inline breaks, strip tone,
  story card label (C15)
- [Slice 5.4](./slices/04-tool-step.md) — tool step: the `lib/ai` step
  call, retry shape, window count, tool steps in both mocks and the stub
- [Slice 5.5a](./slices/05a-task-runner.md) — task runner: verdict seam,
  driver, ledger, reads, ids, later-turn reader, `pnpm probe:close` (C1,
  C9, C11, C12)
- [Slice 5.5b](./slices/05b-identity-threads.md) — Identity and Threads
  at size: their tools and tasks, measured on the real chapter
- [Slice 5.6](./slices/06-close-owed.md) — a close owed: chain, phase 0,
  Send, interrupt, banner, failure surfaces (C6, C14)
- [Slice 5.7](./slices/07-chapter-timeline.md) — Chapter Timeline: the
  route, cards, per-card session, in-progress card
- [Slice 5.8](./slices/08-prose-tasks.md) — prose tasks and parts: Lore,
  Upkeep, Lifecycle, metadata per part
- [Slice 5.9](./slices/09-chapter-wide-tasks.md) — chapter-wide tasks
  and decay: Happenings, Awareness, `read_turns`, stackables, the reset,
  `chaptersOld`
- [Slice 5.10](./slices/10-two-starts.md) — the two starts and the whole
  close: close modal, `STORY TOOLS`, `Close chapter here`, Phase 1,
  `toolCalling`, the end-to-end close (C7, C10)
- [Slice 5.11](./slices/11-review-window.md) — review window: by-action
  read, grouped rows, Not applied, press routing, commit toasts (C4, C7)
- [Slice 5.12](./slices/12-chapter-delete-rollback.md) — chapter delete
  and rollback: delete, divider-only removal, the regenerate arm, copy,
  the preview under a running close (C13)

## Dependency graph

```
day-one: 5.1   5.2   5.3   5.4          (5.2 lands after 5.1)

5.2, 5.4 ───────────→ 5.5a ───→ 5.5b ───→ 5.8
                                     └───→ 5.9
5.1, 5.2 ───────────→ 5.6
5.1, 5.3 ───────────→ 5.7
5.2, 5.3, 5.5b, 5.7 ─→ 5.11
5.2, 5.5a, 5.6, 5.7 ─→ 5.12
5.1, 5.3, 5.6, 5.7, 5.8, 5.9, 5.11 ──→ 5.10

5.1 ┄→ 5.3            (partial: count labels; percent until then)
```

- **Day-one startable:** 5.1, 5.2, 5.3 and 5.4. 5.3 runs on seeded
  chapters, which Plot's E2E has used since M4. 5.2 may start at once
  but lands after 5.1, for its `token_count` source and the migration
  order (C5).
- **5.2 gates 5.5a:** the runner needs the `chapter` group, the report
  type, the range intermediate and a real close around it.
- **The agent track gates tool work, the review and 5.12's suite.** Send
  and the Timeline never wait for it. 5.11 waits for 5.5b, since a real
  report needs real tools, and 5.12 waits for 5.5a, since its delete
  modes join the round-trip suite (C9).
- **5.1 and 5.2 gate 5.6,** since `closeOwed` needs the token read and a
  close to chain to.
- **5.3 gates 5.7** for `Jump to chapter →` and the time-range read
  (C15).
- **5.10 comes after everything it wires.** It puts `Close chapter…` on
  the popover and the card, builds its modal host on 5.11's store, and
  owns the full close, so it needs 5.3, 5.6, 5.7, 5.8, 5.9 and 5.11. The
  dev route starts closes until then. Hosts ship its entry points
  disabled, and with no partial edge into it, no flip can go missing.
- **5.8 and 5.9 run at once** and share the driver by C2's slots, and
  5.11 should run beside them, so the report meets its reader while the
  tools can still adjust.
- **The roadmap's parallel-paths sketch is superseded.** Its gate-then-
  four-parallel shape rested on a primitive canon doesn't have. M5.1
  dissolves into 5.1, 5.2 and 5.6. M5.2 becomes 5.2, 5.4, 5.5a, 5.5b,
  5.6, 5.8, 5.9 and part of 5.10. M5.3 becomes 5.7, 5.10 and 5.11. M5.4
  becomes 5.3 and part of 5.10. M5.5 becomes 5.12.

## Slice contracts

### C1 — A close's delta shape

Provider: [Slice 5.2](./slices/02-first-chapter.md), and
[Slice 5.5a](./slices/05a-task-runner.md) for the move to one group.
Writers: 5.5b, 5.8, 5.9. Consumers: 5.11, 5.12, and the seed.

Every delta of a close carries the run's `actionId`,
`source = 'chapter_close'` (a member of `DeltaSource` at
`lib/actions/types.ts:12-19`, which nothing writes yet) and
`entry_id = E`, the chapter's end entry
([`chapter-close.md → Logs and anchors`](../../../memory/chapter-close.md#logs-and-anchors)).
This is load-bearing: `resolveRollbackWindow` sweeps by anchor position,
so a stamp anchored on its own entry would be spared by a rollback into
the chapter and leave `chapter_id` naming a deleted row, and a null
anchor reverses positionally, which is the seed's bug.

- The `chapters` create comes first, then the stamps, then agent writes,
  then the `close_report` update.
- A stamp is a new action kind, `stampEntryChapter`, registered beside
  `updateStoryEntryMetadata` (`lib/actions/story-entries/register.ts:234-241`)
  with a `LOCK_KEY` entry (`lib/actions/delta/apply-delta-action.ts:51`).
  One delta per entry, payload `{ chapterId: <prior> }`, since a delta
  reverses one row (`reverse-replay.ts`, `undoTargetOf`).
- No stamp carries a `content` key: `isContentEditDelta` keys on it
  (`lib/actions/story-entries/classifier-facts.ts:56-65`).
- `story_entries.chapter_id` stays FK-less
  (`lib/db/story-entries/story-entries.table.ts:20`), because redo runs
  newest-first and stamps land before their chapter row.
- Slice 5.2 sends the stamps through the shipped `delta_emitted` path, a
  burst under one `actionId`, and its metadata phase checks
  `abortSignal` between stamps, since the orchestrator reads an abort
  only between phases and each stamp is its own transaction and store
  patch. The move to one group is decided (developer, 2026-11-05) and
  lands in [Slice 5.5a](./slices/05a-task-runner.md) once
  `delta_group_emitted` does: the create and every stamp as one group,
  each stamp still its own delta anchored on the end entry, and the
  `close_report` update a write of its own after it.

### C2 — Pipeline shape

Provider: [Slice 5.2](./slices/02-first-chapter.md). Consumers: 5.5a,
5.5b, 5.6, 5.8, 5.9, 5.10.

`lib/pipeline/definitions/chapter-close.ts` declares the kind per
[`generation-pipeline.md → V1 declarations`](../../../generation-pipeline.md#v1-declarations):
`hard-gate`, `interruptible: 'close'`, `pill-and-banner`, no `chainsTo`,
`blockedBy` per-turn, pass, itself and translation-retry. A
`CHAPTER_CLOSE_KIND` constant in `lib/chapters`, re-exported by
`lib/pipeline`, replaces the bare string at
`per-turn.ts:580`, `periodic-classifier.ts:471`,
`components/reader/generation-phase.ts:18`,
`components/story-settings/generation-run.ts:84,129` and
`lib/recovery/copy.ts:19`, and boot registers it
(`lib/boot/bootstrap.ts:112-113`), since a chain to an unregistered kind
chains nothing (`getPipelineSafe` in `commitRun`, `orchestrator.ts`).

Phases are static (`Pipeline.phases` in `lib/pipeline/types.ts`), so the list is pinned,
in order: `boundary`, `metadata`, `agent`, `report`, each in its own
file beside the declaration (`chapter-close-boundary.ts` and so on), as
per-turn's are, since 5.5a, 5.5b, 5.6, 5.8, 5.9 and 5.10 all touch them
and some run at once. `boundary`, `metadata` and `agent` declare
`resolves: [{ target: 'lore-mgmt' }]`, so an unassigned model fails at
pre-flight, not in a phase.

- **`boundary`** resolves the end entry into the intermediate below. In
  5.2 it reads `pendingClose` only. 5.6 adds the no-model fallback: the
  latest `ai_reply` in the open region before the head, else the head if
  it's an `ai_reply`, read from `openRegionSeries` and shared with Phase
  1's fallback. With C10's rule that a region needs a reply it can't miss,
  and reading the region it can't land on an earlier chapter. 5.10 adds
  the model call.
- **`metadata`** writes the chapter row and stamps.
- **`agent`** exports `closeAgentPhase(ctx)`, a no-op until 5.5a fills
  it. 5.5a ships the driver as three slots in run order: `before`,
  `perPart` and `after`. 5.5b adds Identity and Threads to `perPart`.
  5.8 owns `perPart`'s other tasks and the part intermediate. 5.9 owns
  `before` (stackables, Happenings) and `after` (Awareness, the reset).
  A chapter-wide task can't land inside the part loop.
- **`report`** writes `close_report` last, from the ledger.
- The close's run-scoped state sits behind typed accessors in
  `lib/pipeline/definitions/close-intermediates.ts`, whose keys stay
  private: the range, `{ chapterId, startEntryId, endEntryId }`, the
  ledger and, from 5.5a, the close-wide id map. Phases read the range
  from SQL by these ids. 5.8 adds its parts and 5.9 its clusters there,
  each as an accessor.
- A failed phase returns `{ status: 'failed', error }`
  (`lib/pipeline/types.ts:53`). The orchestrator's abort reverses the
  group.
- One per-call bound keyed by agent id, `callTimeoutMs` and
  `CALL_TIMEOUT_DEFAULT_MS` in `lib/ai`, serves metadata, boundary and
  tool steps, in whichever of 5.2 and 5.4 lands first:
  `passTimeoutMs` hard-coded `resolveModel('classifier', …)`; it now
  calls `callTimeoutMs('classifier', …)` (`periodic-classifier.ts`).

The HTTP capture cap stays as it is (`http-call-sink.ts:9`); it moves to
M7.3.

### C3 — The `chapter` context group

Provider: [Slice 5.2](./slices/02-first-chapter.md). Consumers: 5.5a,
5.5b, 5.8, 5.9, 5.10.

A new `chapter` group in `CONTEXT_GROUPS` (`lib/prompts/types.ts:4-10`)
serves every close template, replacing canon's unbuilt `lore` group and
its listing of chapter templates under `generationContext`, whose
budget-governed `entries` can't hold a whole chapter.
`templateContextMap.ts` types `VARIABLES` and `TEMPLATE_GROUPS`
exhaustively, so the first close template needs the group.

Prose tasks hold the chapter or part in the system half; the design
measured 6,088 of 6,181 tokens reused across different tool lists that
way, and 0 of 6,176 with it in the user turn. Their system half is
stable across a part's tasks, not across the story.
`lib/prompts/bundled/system-half-stability.test.ts:346` gets a named
exemption for the close's task templates only, added by 5.5a, and it
grows with each task template in 5.5b and 5.8. Happenings and Awareness
don't read the prose. Boundary and metadata follow the normal rule, with
everything in the user half.

### C4 — `close_report` v1

Provider: [Slice 5.2](./slices/02-first-chapter.md) (column, schema,
writer, store projection). Writers: 5.5a's ledger, used by 5.5b, 5.8 and
5.9. Consumers: 5.7, 5.11.

A nullable JSON column on `chapters`
(`lib/db/story-entries/story-entries.table.ts:32-58`), added to
`fullRow` and `UPDATABLE` (`lib/actions/chapters/register.ts:15,47`),
with its Zod schema in `lib/db/story-entries/close-report.ts`. It may
grow; a field's meaning doesn't change.

```ts
type CloseTask =
  | 'happenings'
  | 'lore'
  | 'identity'
  | 'threads'
  | 'upkeep'
  | 'lifecycle'
  | 'awareness'

type CloseReport = {
  version: 1
  actionId: string
  calls: CloseReportCall[] // every tool call, in run order
  stopped: { task: CloseTask; part: number; reason: 'budget' | 'window' | 'cut-off' }[]
  noToolCalls: boolean // no task called a tool
}

type CloseReportCall = {
  task: CloseTask
  part: number // from 1; 0 for the chapter-wide Happenings and Awareness
  tool: string
  rows: { table: string; id: string; name: string }[] // a refused create keeps its minted id
  why: string
  turns: string[] // entry ids
  result: 'ok' | 'rejected' | 'skipped'
  reason?: string // why it didn't land, whole
  values?: Record<string, string> // delta path to new or proposed value, cut to the bound
  skippedFields?: { field: string; reason: string }[] // a partly landed call (C11)
  survivor?: { table: string; id: string } // a landed merge's kept row
}
```

- **New values live here.** Deltas hold only the prior value, so canon's
  "old and new values come from the deltas" can't work, and the diff
  cache is M6.4. Old values come from the deltas; new values from
  `values`, cut to one `CLOSE_REPORT_VALUE_BOUND`, the same bound a Not
  applied value uses.
- **`values` holds only landed or proposed fields.** Its keys and a
  `skippedFields` entry's `field` are delta paths, as `changedPaths` reads
  them (`description`, `state.voice`). A list joins with `, `, and a ref's
  value is the row's name, not its id. A restated field is absent (C11),
  and the review omits an `ok` call with no field and no `survivor`. A
  tool writing a single field, such as `retire_entity`, records it here.
- **A `reason` is a stable key** for the three shared classes,
  `USER_EDITED_SINCE_PROSE`, `later-turn` and `row-gone`, and the
  handler's own string for a rule refusal.
- **The ledger**, behind an accessor in `close-intermediates.ts`, is
  `Pick<CloseReport, 'calls' | 'stopped' | 'noToolCalls'>`. A close with
  no ledger reads as none, with `noToolCalls: true`. The driver clears the
  flag on any tool call, an invalid one included, which records no row.
- **The cited entry comes from `turns`,** since every delta anchors on E.
- **A landed merge names its survivor,** threads included. A refused merge
  carries none, and is one Not applied row by tool and rows.
- **Not applied is derived on read,** by canon's rule: a refused or
  skipped write the same task didn't later land with the same tool on
  the same row and field. A refused create mints an id no retry shares,
  so it matches a later landed create by that task with the same title,
  trimmed and case-folded.
- **Stamps, `retrieval_count` resets and stackable normalization stay
  out of the review.** Normalization is code with no `why` or `turns`,
  and its keys are a spelling cleanup.
- **The report stays out of `chaptersStore`.** Story open hydrates chapter
  rows whole (`lib/actions/stories/operational.ts:168`), and the create
  handler, the update handler and redo all patch the row
  (`lib/actions/chapters/register.ts:71,132`,
  `lib/actions/delta/redo.ts:329`), while the store casts past its
  row type (`lib/stores/factory/working-set-store.ts:31,36`). So one
  projection sits at the `patcher` (`register.ts:168`), which all three
  share. On create it drops `closeReport` and derives `hasCloseReport`.
  On update it does so only when `closeReport` is a key of `columns`,
  since an update patch carries only what was written: a title save must
  leave the flag alone. The hydrate select matches, with `.mapWith(Boolean)`
  so the flag isn't 0 or 1. The store's row is
  `Omit<Chapter, 'closeReport'> & { hasCloseReport: boolean }`. A store
  test walks commit, a title save and its undo, CTRL-Z and redo. The
  review window reads the report by chapter id when it opens.

### C5 — Token reads and the progress hook

Provider: [Slice 5.1](./slices/01-token-measure.md). Consumers: 5.2, 5.3,
5.6, 5.7, 5.10.

- **`story_entries.content_tokens`,** a nullable integer. It counts
  stored `content`, which is the source language, so a translated story
  needs no separate rule. Written at the create handler
  (`lib/actions/story-entries/register.ts:65-92`), at `create-story`
  (`lib/actions/stories/create-story.ts:154-168`), and on a content edit
  (`updateStoryEntryContent` in `lib/actions/story-entries/operational.ts`), with the old
  value in the edit's undo payload. No backfill: dev DBs reseed, and a
  null reads as 0. 5.1 fills the column in the seed, so seeded stories
  read real numbers.
- **`countTokens` moves to a leaf `lib/tokens` module,** importing only
  `js-tiktoken`, with `TOKENIZER_IDENTITY`, and `lib/retrieval` re-exports
  both. The seed can't import `@/lib/retrieval`: on native, `lib/db/index.ts:125`
  reaches `reseed.native.ts` and so the dataset, which would close a value
  cycle through `lib/retrieval`'s imports of `@/lib/db`, against a
  half-initialised module, failing only on Android at boot. `lib/actions`
  imports the leaf too, which spares it an edge to `lib/retrieval`.
- **Migration order.** 5.1's migration lands first, and 5.2 lands after
  it. A second lander takes main's `_journal.json` and `migrations.js`,
  deletes its own `.sql` and snapshot, and re-runs `pnpm db:generate` on
  the rebased tree. It never renames one: the migrator runs a migration
  only when its `when` is newer than the last applied
  (`drizzle-orm/sqlite-proxy/migrator.js:20`), so a renamed file keeping
  an older `when` silently skips on a migrated DB and stays green on a
  fresh one.
- **One open-region predicate:** `kind != 'system' AND chapter_id IS NULL`,
  held as `openRegionWhere(branchId)` in
  `lib/db/story-entries/open-region.ts`, exported from `@/lib/db`.
- **`openRegionSeries(branchId, ctx)`,** in the same file, returning
  `{ id, kind, position, tokens }[]` in position order, is the one read.
  `closeOwed` and the hook take the sum, canon's `openRegionTokens`, and
  `.some(canEndChapter)` from it. Phase 1's candidates and the modal's
  range count need the series itself, which a whole-region sum can't
  answer. 5.2 sums the same column over the closed range for
  `token_count`.
- **`useChapterProgress(storyId)`** returns
  `{ tokens, threshold, percent, tone, canClose }`, and replaces
  `useOpenRegionTokens`.
  `canClose` says the region holds an entry that can end a chapter, and
  `Ready to close` and `Close chapter…`'s availability both read it. It
  refetches on `settleCount` and the tail, as `useEntryIndex` does
  (`hooks/use-entry-index.ts`); a content edit runs in the reversal
  bracket, so it ticks `settleCount`.
- **`ScreenShell.chapterProgress`** (`components/shells/screen-shell.tsx:52`)
  takes the hook's return, plus `onChapterProgressPress` from the
  route. Tone comes from `chapterProgressTone` in `lib/chapters`,
  returning `'success'`, `'warning'` or `'danger'` at canon's 80 and 90.
- **`lib/chapters` takes no value import of `@/lib/db`.** The seed sits
  below `lib/db/index.ts:125`, and `'use dom'` reader code can't reach the
  DB. It holds pure rules and constants, and 5.1's boundaries rule holds
  it there beside `lib/tokens`, so no later slice can reopen this past a
  one-time check. Stores, actions, retrieval and the hooks bring `lib/db`
  in at runtime, so the rule bars value imports of every lib module and
  of app code. Bare lib files such as `lib/keyword-terms` stay open.

### C6 — What the banner's `N of M` counts

Provider of the event: [Slice 5.5a](./slices/05a-task-runner.md).
Provider of the store field and the label:
[Slice 5.6](./slices/06-close-owed.md). They run at once. Consumers: 5.8,
5.9.

A `close_task_start { task, part, index, total }` event joins
`PhaseEmittedEvent` (`lib/pipeline/types.ts`) in whichever lands
first, and `handleEvent`
forwards it unchanged. It fires as each task
starts, since a completion event leaves the banner blank through
Happenings and names a finished task where the label names a running
one. `N of M` counts agent tasks only. `total` is `2 + 5 × parts`:
Happenings, five prose tasks per part, and Awareness, so a one-part
chapter is `of 7`. It's fixed when the agent phase starts, and a task
with nothing to start from still counts. A bus event isn't replayed, so
the latest progress lives on `RunState.closeProgress`
(`lib/stores/generation/generation.ts`), where a banner mounted
mid-close reads it. Emitted events carry no `runId`, and the store holds
a copy of the run, so `handleEvent` calls a new `generationStore`
mutator by `run.runId`, `setCloseProgress`, added to the restricted
list in `eslint.config.js`. 5.6 owns the mutator and the call.

Labels: `Closing chapter: 3 of 7 — Identity…`. Boundary and metadata each
have their own label and no count, as does the `agent` phase until its
first task starts and `report`, and the last task's label stands until
`report`, since a start-only event can't show the reset.
Before a turn each leads with `Before your turn:` in its place
(`Before your turn: 3 of 7 — Identity…`), and a close not yet in a phase
reads `Closing chapter before your turn…` (developer, 2026-11-08: the
banner is the only place phone names the wait). Phase 0's passes keep
the pass's labels: `Updating memory before your turn…` under Send, whose
`beforeTurn` each successor inherits from the chain's start, and
`Updating memory…` outside one. Until 5.5a lands, a close shows only the
phase labels.

### C7 — Chapter overlays

Providers: [Slice 5.11](./slices/11-review-window.md) (store, review
host), then [Slice 5.10](./slices/10-two-starts.md) (modal host), which
builds on it. Consumers: 5.3, 5.7.

`lib/stores/ui/chapter-overlays.ts` exposes
`openCloseModal({ branchId, endEntryId? })` and
`openReviewWindow({ chapterId })`, and one host for both,
`ChapterOverlaysHost` in `components/chapters/chapter-overlays-host.tsx`,
mounts at the app root beside `MemoryRunToasts` (`app/_layout.tsx:115`).
The toast's `Review` fires from there, and the modal has four triggers
on five routes, so a per-route mount would touch every in-story route.

- If the close reverses while the review window is open, it closes
  itself. A stale toast's `Review` does nothing.
- A row press goes through the current surface's guard. A root host
  doesn't hold one, and `useSurfaceNavigate` reuses a mounted screen
  with `setParams`, so a press over a dirty World pane could swap the
  row under its draft. The host has no navigator either, so its own
  navigate would push a second screen. Routes register both with
  `registerSurface({ guard, navigate })`, through `useOverlaySurface` on
  focus, in 5.11, with a surface that has nothing to guard defaulting to
  `(proceed) => proceed()`. `openCloseModal` runs that guard, so no
  trigger can skip it. Inferred from the code, not run.

### C8 — Seed stability

Provider: [Slice 5.2](./slices/02-first-chapter.md). Consumers: 5.1, 5.3,
5.7, 5.11, and every story or E2E reading seeded chapters.

5.2 gives the seed a real close shape: end-entry anchors, stamp deltas,
and chapters ending on a reply. `CHAP1_END` and `CHAP2_END`
(`lib/db/devtools/seed-dataset.ts:209-210`) are even positions, which are
`user_action` rows, so they become 29 and 57. Chapter 2 starts at
`CHAP1_END + 1`, replacing the literal at `:342`, and entry 59 stays
open: it's Plot's only live open-region anchor (`:885`), and two
E2Es need it there. `delta_hero_3` and `delta_hero_9` (`:1232`, `:1241`)
gain `entryId`, and `seed-dataset.test.ts:449-474` flips to canon.
Seeded chapter ids and titles don't change. Consumers assert by chapter
title or number, never by entry position.

### C9 — The round-trip rule

Provider: [Slice 5.5a](./slices/05a-task-runner.md). Consumers: 5.5b, 5.8,
5.9, 5.12.

Reversal shapes are where "refused for good" hides. Each tool's landed
group joins one suite that runs it through CTRL-Z, redo, abort and a
rollback on each side of the end entry. A tool isn't done until it's in
the suite. `merge_happenings` and `merge_threads` also assert that a
close's CTRL-Z never reaches `held-in-redo`
(`snapshotForRedo` in `lib/actions/delta/redo.ts`: a held row written,
or one a ref-clear would restore), and the check counts link rows and
creates, not only the merged row.

Both chapter delete modes join the suite with 5.12: it adds their arms
for tools already on main, and a tool landing later adds its own.

### C10 — What a chapter may end on

Providers: [Slice 5.1](./slices/01-token-measure.md) creates the predicate,
which C5's hook needs and which lands first, and
[Slice 5.2](./slices/02-first-chapter.md) enforces it at the start.
Consumers: 5.6, 5.10, 5.12.

A chapter ends only on an `ai_reply`, on an auto close and a manual one
alike, the newest reply included on a manual close. A single predicate,
`canEndChapter` in a new `lib/chapters` module, holds this, and
`startManualClose`, `closeOwed`, `useChapterProgress`, Phase 1's
candidates and fallback, the modal's picker and `Close chapter here` all
use it, so the rule has one copy. The other kinds
break something: a `system` entry hard-deletes with no delta, so its
anchor reads as spared for good; the `opening` is the rollback floor; a
`user_action` splits a turn, and a regenerate's follow-up sweep can then
take the close with no consent.

Chapter 1 keeps the opening, as canon says.

**A region with no reply owes no close.** `closeOwed`'s threshold arm
also needs an entry in the open region that passes the predicate. Without
that, a new story whose opening alone passes a low threshold owes a close
with no valid end, which fails every Send, and no turn can land to supply
a reply. The threshold accepts values as low as 1
(`components/story-settings/memory-knobs.ts:112`).

### C11 — Tool results

Provider: [Slice 5.5a](./slices/05a-task-runner.md). Consumers: 5.5b, 5.8,
5.9, 5.11.

The tool result is the action layer's verdict. Canon's three results
hold, with these cases settled:

| Case                                                                     | Result                                                              |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| A value already stored                                                   | `ok`, nothing written                                               |
| A row that moved or went                                                 | `rejected`, saying where it went                                    |
| A call with some fields protected                                        | Free fields land, and the result is `ok` naming the skipped fields  |
| A merge with a row a later turn touched                                  | `skipped`, whole                                                    |
| One protected row in a merge                                             | `skipped`, whole                                                    |
| A field refused beside one that lands, such as a soft cap or a placement | `ok`, naming the refused fields and their reason; alone, `rejected` |

A merge is protected by a user edit of an absorbed row or its link rows
(`userTouched`), or of a field the merge writes on the kept row
(`userWrote`). A kept row's other fields lose nothing to a merge, so they
don't stop one.

**A start row counts as read only when the start showed the fields the
tool writes.** Lore's title list seeds nothing, so `update_lore` needs a
`read_row` first, and canon's "rows a task starts with count as read"
narrows to that in 5.8's PR.

"Lands whole" means all-or-nothing on failure, not on precedence. A
partly protected call appears in the review twice: its landed fields
under Changes and its skipped fields under Not applied.

Shipped shape this replaces: `applyDeltaActionGroup` returns only
`ok` or `rejected`, and a noop vanishes inside a group
(`lib/actions/delta/apply-delta-action.ts:225-227,300,334-348`).
`consumePhase` calls `gen.next()` with no argument
(`consumePhase` in `orchestrator.ts`) and a rejection throws (`:219`), so
`delta_group_emitted` and a per-action outcome back through the `yield`
are 5.5a's. One `code: 'noop'` covers four things: a restated value, a
user-won write, a gone row and a broken rule such as `not-active` or a
place refusal. So each action's outcome carries the handler's `reason`,
indexed by action and assigned after the group's rerun, and a mapping
matches `USER_EDITED_SINCE_PROSE` to `skipped` and restated values to
`ok`, an already retired row included. Everything else defaults to `rejected` with its reason, so a write
that didn't land can never read as `ok`. Restated values go by more than
a dozen spellings, some restated only by row state, and gone rows
interpolate ids, so both carry a stable marker,
`noopRefusal(reason, 'restated' | 'gone')`
(`lib/actions/delta/registry.ts:74`), and rule refusals stay unmarked.
`updateEntity`, `updateLore`, `updateThread` and `updateHappening` return
a hard `not-found` that aborts a group
(`lib/actions/lore/register.ts:108-112`), which gives the whole call
`rejected` with nothing written, and an all-noop group still returns its
outcomes. The exact types are settled by 5.5a's implementation and
sequenced to the tool slices. Its
starting design: a tool's reads and refusals run ahead of one group,
since a merge's precedence can't live inside a group that drops noops.

### C12 — What "a later turn wrote" means

Provider: [Slice 5.5a](./slices/05a-task-runner.md). Consumers: 5.5b, 5.8,
5.9.

[`chapter-close.md → Tools and writes`](../../../memory/chapter-close.md#tools-and-writes)
has a close leave alone what later turns wrote. No selector exists, and
neither column alone gives one: a turn's fold writes carry a null anchor,
and phase 0's passes land after later turns but anchor inside the
chapter. A delta counts as later when it anchors past E, or when it's
null-anchored in the action of a turn past E. A `retrieval_count`-only
update never counts, and neither does a `chapter_close` delta, so work
kept by a divider-only removal doesn't read as a later turn's when the
chapter closes again. This rule looks forward from a running close only;
chapter delete has its own (C13).

### C13 — Chapter delete

Provider: [Slice 5.12](./slices/12-chapter-delete-rollback.md). Consumer:
5.7.

`Delete…` on the latest chapter's card, and only there. It is not a
rollback: no entry goes. Two modes, one action in
`lib/actions/chapters/`:

- **Delete the chapter.** The close's `action_id` group reverses, with
  stamps cleared, merged rows back, lore it created gone. The group is
  found by the `action_id` of the chapter's `create` delta, and the
  action refuses when there is none. A close-created row the user edited
  later still goes, as any machine create does.
- **Remove the divider only.** The chapter row, its report and its stamps
  reverse. The group's other deltas stay in the log, still anchored on E,
  as an ordinary undo target: with no later turn, the next CTRL-Z reverses
  the kept work, and redo restores it. The review window goes with the
  row; History keeps the writes.

**Later writes win.** For a delete, a field keeps its value when a delta
on that row, outside the set, with a higher log position, wrote it, from
any source, unless the delta only moved `retrieval_count`
(`lib/row-signals/link-owners.ts:71-77` holds that test). The shipped
reversal yields only to `user_edit`
(`lib/actions/delta/user-precedence.ts:103-127`,
`reverse-replay.ts:664`), and canon's reversal rules assume only
periodic-classifier groups sit above a reversed group, so this is new.
The yield mode goes on `ReversalSeed` and the nominal `ReversalSet`,
since `refClearsOf` reads later edits itself at selection
(`lib/actions/delta/row-closure.ts:185-202,358-359`): a yield in the
planner alone would still clear a later place move. A normalized
stackable record a later write touched stays normalized, since undoing
it can double-count; that's settled by the later of 5.9 and 5.12 to land.

Both modes refuse on `generationStore.isUserEditBlocked()`, then run
inside `bracketProseReversal`, as `rollbackToEntry` does, because
`settleCount` ticks only on a run's or a bracket's end, and C5's hook
and `useEntryIndex` refetch on it. Inside the bracket they re-read the
branch's highest `sequence_number` and refuse when the chapter isn't it,
since a close can commit under an open confirm, and reversing an earlier
chapter would strand its entries before a closed one. They use
`selectReversalSet` and `reverseAndPruneDeltaRows`
(`lib/actions/delta/row-closure.ts:398`, `reverse-replay.ts:714`) with
`keepRedoExact: false`, through `commitNewAction`
(`lib/actions/story-entries/operational.ts:46-58`), exported, which clears
redo even when the store sync fails after the commit. Neither is undoable. `deleteChapter`
(`lib/actions/chapters/register.ts:136`) has no production caller and
dangles stamps; 5.12 removes it.

**A later undo can bring a deleted value back.** A later write's own
undo payload holds the value it replaced, which may be the close's, so
rolling that turn back after a delete writes it again, and the value
before it isn't in the log. This is accepted: the order is rare, the
state stays valid, and the next pass or close corrects it. The confirm
and canon say so.

**After a delete.** The region grows by the chapter's tokens. The
confirm reads the result and says which applies: with a manual close
pending, the next Send runs it; with auto-close on and the region at the
threshold, the next Send closes again, which also restores the chapter's
memory; with auto-close on and
under it, a close waits for the region to grow, as after a short manual
chapter; with auto-close off, the chapter stays open and `Ready to close`
shows once the threshold is met. A threshold changed first simply
applies. The confirm also says the turns since stay as written and can
still reflect what the close added. Full coherence is a rollback to the
chapter's last entry, then a delete.

### C14 — The manual start and `pendingClose`

Provider: [Slice 5.2](./slices/02-first-chapter.md). Consumers: 5.6, 5.10.

`TxState` gains `pendingClose` as
[`generation-pipeline.md → Multi-run txState`](../../../generation-pipeline.md#multi-run-txstate)
specs it, and `startManualClose(branchId, endEntryId)` in
`lib/actions/chapters/` writes it and starts the run. The record holds a
pick only, `{ endEntryId: string }`: a close the threshold owes keeps
none, since `closeOwed` derives it each time, and no record means
boundary selection. Until 5.6 it refuses
unprocessed entries, a held branch, a pending swap and a busy story, so
it starts a close only where a close can run at once. 5.6 replaces the
unprocessed refusal with phase 0 and settles the record's lifecycle, and
the action resolves with the chain's end, not the first pass's: `TxResult`,
`RejectedStart`, or from 5.10 `{ outcome: 'preflight-failed', error }`. A
successor takes no inputs (`commitRun` in `orchestrator.ts`), so the end entry
reaches a chained close only through this record.

### C15 — Entry jump and chapter time ranges

Provider: [Slice 5.3](./slices/03-reader-chapters.md). Consumers: 5.7,
5.11.

An `entry=<entryId>` param on the reader route, mirroring M4's C6, and a
`jumpToEntry` beside `jumpToBottom`
(`components/reader/reader-document-types.ts:16`). Load older until the
entry is present: the reader holds no disconnected window, as
`holdsLiveEdge` states (`app/reader-composer/[branchId].tsx:355`).
`History`'s entry link is its first consumer, moved in from M7.3, whose
entry keeps wiring the Diagnostics delta log.

One read, `readChapterTimeRanges` in `lib/db/story-entries/` beside
`open-region.ts`, gives each chapter's `{ first, last }` world time, by
`min` and `max`, for the popover and the Timeline. A 0 counts: it is the
story's origin, not a flashback
([data-model.md → In-world time tracking](../../../data-model.md#in-world-time-tracking)).
It covers the open region as a null chapter for their `since <time>`.
The app's query client never goes stale (`lib/cache/query-client.ts`),
and a world-time edit moves neither `settleCount` nor the tail, so a
surface calls `refetch()` when it opens.

### C16 — Flip rule

A provider flips any consumer already on main, and a consumer landing
later binds directly. A consumer waiting on a provider renders disabled
with a reason, per canon's "unbuilt disables, not hides", as in M4. Each
flip is a line or two. `Review changes` is the exception: canon hides it
on a chapter no close wrote, so it ships hidden.

| Flip                          | Provider | Host |
| ----------------------------- | -------- | ---- |
| `Manage chapters →`           | 5.7      | 5.3  |
| `Close chapter manually`      | 5.10     | 5.3  |
| `Close chapter…`              | 5.10     | 5.7  |
| `Delete…`                     | 5.12     | 5.7  |
| `Review changes`, from hidden | 5.11     | 5.7  |

## Definition of done

- **Token measure.** With more than 50 open entries the strip equals a
  SQL sum, holds across a reload and a failed turn, and moves both ways
  with an edit and its undo (vitest; E2E).
- **Auto close.** A turn crossing the threshold chains catch-up passes,
  then a close that picks a boundary, writes the row and stamps, runs
  every task in canon's order, and writes the report; each delta has
  `source = chapter_close` and the end entry as its anchor (Slice 5.10's
  E2E with scripted tool steps, asserting the DB).
- **Manual close.** A close starts from the menu on World, Plot, Story
  Settings and the reader, from the Timeline, from the popover and from
  an entry, at a picked `ai_reply`. A dirty pane raises its own guard
  first (E2E).
- **Failure and interrupt.** A failed call reverses the whole close,
  fails the Send with the text kept, and the next Send retries. Cancel
  and a head reversal interrupt, reverse and defer it with the toast.
  CTRL-Z of the turn interrupts a running close (vitest; E2E).
- **Reversal.** One CTRL-Z reverses a committed close and redo restores
  it; a rollback past the end entry spares it and one into the chapter
  takes it all, stamps included; no close group is refused for good
  (the round-trip suite).
- **Chapter delete.** Delete and divider-only removal leave every entry
  in place, on the latest chapter only, a later turn's write survives a
  delete, and no earlier chapter offers either (vitest; E2E).
- **The agent at size.** `pnpm probe:close` runs Identity and Threads on
  a real 24k chapter on the dev model, with every step's messages saved
  and the bar set in Slice 5.5b's planning met. Slice 5.10 runs the whole
  close the same way.
- **Retrieval.** Canon's `exp(-0.07 × 57 × 0.7)` example reproduces
  through the ranker, and a `set_pin` moves a happening's score (vitest).
  The chapter pool, boost, Plot's buckets and the prompt buffer behave on
  a real close (vitest; E2E).
- **Surfaces.** The Timeline, popover, chips, inline breaks, review
  window and modal work on desktop and at phone width, with Storybook
  stories for every new compound. A jump to chapter 1 on a long story
  is measured on Android, and the number is in the slice's notes.
- **Honest copy.** Regenerate of a reply a close ends on or wrote under,
  rollback across chapters and chapter delete say what will happen
  (Storybook; E2E).
- **Hygiene.** Every new chrome string routes through `t()`; `pnpm lint`,
  `pnpm typecheck`, `pnpm lint:docs` and the full vitest suite pass on
  every slice's PR; the deferral comments and canon lines the promises
  sweep named flip with their work.

## Open questions

- **Canon batch.** Resolved 2026-11-01: the rulings made at promotion
  landed in canon at `0f28204f0`, through `aventuras-design`'s second half.
  Each slice's PR still makes the canon edits its doc lists.
- **`chaptersOld` needs a developer's eye at planning.** It sits in one
  slice, 5.9, but has real options: canon says `learned_at_entry_id` and
  `updated_at`, M3.4 "decided" `occurred_at_entry_id` and a new column,
  `updated_at` is never advanced by any handler, and the rule for a
  happening several in-scene characters know is unstated. Landing it runs
  decay for the first time, so every chaptered story's ranking shifts on
  untuned defaults. Slice 5.9's planning offers the design route. A new
  column there follows C5's migration rule.
- **The chapter behind `pnpm probe:close`.** No realistic 24k chapter
  exists. Slice 5.2 builds it from a narration or story dataset, shaped
  into turns and run through both the per-turn classifier and the
  periodic pass, since Identity starts from the entities a chapter
  touches and those need scene data. Which dataset, and whether it can
  sit in the repo, is 5.2's planning question. Answered: _Treasure
  Island_, its text committed and the built database kept outside git
  ([5.2's Implementation notes](./slices/02-first-chapter.md#implementation-notes)).
- **Unmeasured costs.** A close's forward stamp burst and its reversal
  over about 132 stamps (Slice 5.2), a full group (5.10), whole-prompt counting per step
  (5.5b), and load-until-present on Android (5.3). Each is measured where
  named. A bad number reopens that slice's approach, not the layout.
  5.2's are measured
  ([5.2's Close measure](./slices/02-first-chapter.md#close-measure)):
  the Android burst stalls the JS thread about 1.1 s, a miss 5.5a's move
  to one group carries as a hard bar.
- **Report size.** A guess until a real close runs. 5.5b's run gives the
  first number, which sets `CLOSE_REPORT_VALUE_BOUND`.
- **Unaudited.** The contract audit ran two rechecks and stopped, as
  planned. The last round's fixes weren't rechecked: C2's fallback, C5's
  single series read and `canClose`, C6's labels, C10's one copy, C11's
  markers and its landed-and-refused row, and 5.12's count filter and
  immediate regenerate. The final audit's fixes had no audit of their
  own either: C4's `survivor` and refused rows, C5's boundaries rule, C7's
  default guard, C11's merge protection and start-row rule, C14's result
  and C15's `refetch()`. Read them all at slice planning.
- **Sizes.** 5.5a, 5.8 and 5.10 sit close to the ceiling, at 16 to 20
  tasks, on estimates that grew by about a tenth through the audit. Check
  each at its plan skeleton.
