# Slice 5.8 — Prose tasks and parts

## Metadata

- **Milestone:** [Milestone 5 — Chapters + chapter-close](../milestone.md)
- **Depends on:** [Slice 5.5b](./05b-identity-threads.md), and through
  it [Slice 5.5a](./05a-task-runner.md), [Slice 5.4](./04-tool-step.md),
  [Slice 5.2](./02-first-chapter.md) and
  [Slice 5.1](./01-token-measure.md)
- **Blocks:** [Slice 5.10](./10-two-starts.md)

Runs at once with [Slice 5.9](./09-chapter-wide-tasks.md), which holds
the driver's other two slots (C2), and beside
[Slice 5.11](./11-review-window.md), so the report meets its reader
while these tools can still adjust.

## Goal

The prose tasks 5.5b left, on the tool contract it proved, and chapters
too big to send whole. The slice delivers the Lore, Upkeep and Lifecycle
tasks with their eight write tools, the `duplicate` collision reason
with its resolved-pair read, and parts: the cut, the `perPart` loop,
limits that hold across parts, and metadata as one call per part and a
merge. After it every prose task runs, and a chapter over half the
window closes instead of failing its metadata call.

## Background

After 5.5b the driver runs Identity and Threads on one implicit part,
and the other prose tasks take the same `perPart` slot, plans, row guard
and ledger. What they add is rules the code doesn't hold: `updateLore`
has no precedence, a place's rules live in `placeLocation`, which a call
writing `condition` beside a parent can't use, nothing can remove a
keyword or say who added one, and `raiseRefusal` refuses a pair that
isn't namesakes, which a `duplicate` usually isn't. Parts change the loop
around every prose task, and 5.2 accepted that a chapter over half the
window fails its metadata call until this slice. Below, E is the
chapter's end entry, and canon is the authority on every rule.

## Required reading

- [`chapter-close.md → Run order`](../../../../memory/chapter-close.md#run-order),
  [`Conversations`](../../../../memory/chapter-close.md#conversations),
  [`Parts`](../../../../memory/chapter-close.md#parts),
  [`Tools and writes`](../../../../memory/chapter-close.md#tools-and-writes)
  and
  [`When a task stops`](../../../../memory/chapter-close.md#when-a-task-stops)
- [`chapter-close.md → Phase 2`](../../../../memory/chapter-close.md#phase-2--chapter-metadata),
  [`3a`](../../../../memory/chapter-close.md#3a--lore-creation),
  [`3b`](../../../../memory/chapter-close.md#3b--identity-compaction)'s
  "Beyond the arrays" paragraph,
  [`3f`](../../../../memory/chapter-close.md#3f--world-upkeep) and
  [`Phase 4`](../../../../memory/chapter-close.md#phase-4--lifecycle-review)
- [`chapter-close.md → Review`](../../../../memory/chapter-close.md#review):
  what a call's `values` must feed
- [`data-model.md → Authorship contract`](../../../../data-model.md#authorship-contract):
  which fields a close may write, and that `priority`, `injection_mode`
  and `tags` aren't among them
- [`data-model.md → LocationState shape`](../../../../data-model.md#locationstate-shape)
  and [`Entry metadata shape`](../../../../data-model.md#entry-metadata-shape):
  scene fields are inherited, and factions are never scene-tagged
- [`cadence.md → User edits and classifier writes`](../../../../memory/cadence.md#user-edits-and-classifier-writes)
- [`world.md → Surfacing`](../../../../ui/screens/world/world.md#surfacing),
  [`Resolve dialog`](../../../../ui/screens/world/world.md#resolve-dialog),
  [`Rename`](../../../../ui/screens/world/world.md#rename),
  [`Keep as distinct`](../../../../ui/screens/world/world.md#keep-as-distinct),
  [`Authorship and 3+ collisions`](../../../../ui/screens/world/world.md#authorship-and-3-collisions)
  and
  [`Required body`](../../../../ui/screens/world/world.md#required-body--creation--edit-invariant)
- [`architecture.md → System and user halves`](../../../../architecture.md#system-and-user-halves),
  [`Context groups`](../../../../architecture.md#context-groups) and
  [`The window figure`](../../../../architecture.md#the-window-figure)
- [`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay)
  and [`Phase vs sub-work`](../../../../generation-pipeline.md#phase-vs-sub-work)
- [`retrieval.md → Keywords schema`](../../../../memory/retrieval.md#keywords-schema)
- [`parked.md → A keyword write's undo restores the whole prior list`](../../../../parked.md#a-keyword-writes-undo-restores-the-whole-prior-list):
  why a close skips a list a later turn wrote
- [Slice 5.5a → Scope: in](./05a-task-runner.md#scope-in) and
  [Slice 5.5b → Every write tool, in order](./05b-identity-threads.md#every-write-tool-in-order):
  the plan, row guard, `fieldVerdicts`, `entityWriteAction` and ledger
  these tools build on
- Milestone contracts
  [C1](../milestone.md#c1--a-closes-delta-shape),
  [C2](../milestone.md#c2--pipeline-shape),
  [C3](../milestone.md#c3--the-chapter-context-group),
  [C4](../milestone.md#c4--close_report-v1),
  [C5](../milestone.md#c5--token-reads-and-the-progress-hook),
  [C6](../milestone.md#c6--what-the-banners-n-of-m-counts),
  [C9](../milestone.md#c9--the-round-trip-rule),
  [C11](../milestone.md#c11--tool-results) and
  [C12](../milestone.md#c12--what-a-later-turn-wrote-means)

## Scope: in

Tools and tasks sit under `lib/pipeline/definitions/close-agent/`, with
5.5a's runner. Every write tool is a 5.5a plan and follows
[5.5b's order](./05b-identity-threads.md#every-write-tool-in-order):
common checks, fields as sent, restated fields, protection by the row
guard, landing as one `delta_group_emitted`. Text is bounded as a pass
bounds it there, `condition` by `boundStateText` and `description` by
`clampEmbeddedText`'s limits. Deltas take C1's shape and results C11's.

### Lore

- **`create_lore`.** Takes `title`, `body`, `category`, `keywords`,
  `turns` and `why`. Code sets `priority: 0`, `injectionMode: 'auto'`,
  empty `tags` and `embeddingStale: 1`, mints the id, and allocates it
  in the run's `IdBiMap`, so `ok` returns a short id later steps, tasks
  and parts resolve. Keywords pass `dedupeTerms`. A blank `title` or
  `body` is `rejected`, whitespace counting as blank, as in the lore
  pane: a row with no body exports a file its own import refuses
  (`lib/avts/lore.ts:23`). An update can't blank one either, since 5.5b's
  order reads a blank value as omitted.
- **The lore cap.** A create past the cap, 3 by default, is `rejected`,
  telling the task to extend a row instead. The count reads the ledger's
  landed `create_lore` calls, so it holds across parts and a refused
  create doesn't spend it. Where the number lives is an open question.
- **`update_lore`.** Writes `title`, `body`, `category` and `keywords` on
  any lore row, the user's included. It can send several columns, so the
  plan reads ahead through the row guard, as `update_thread` does.
  `updateLore`'s payload (`lib/actions/lore/register.ts:33-36`) gains an
  optional `proseEntryId`, as 5.5b gives `updateThread`: no user caller
  sends it, a column the user wrote after that prose drops from `set`,
  and a `set` left empty ends in `noopRefusal(USER_EDITED_SINCE_PROSE)`.
- **`update_lore`'s keywords** take `add` and `remove`, as `set_keywords`
  does, so a list the model shortened can't read as a removal. They land
  as a new `setLoreKeywords` action in the same group, `null` in
  `LOCK_KEY` as `updateLore` is. A refused removal is that action's
  alone, so the free fields land and the result is C11's `ok` naming it.
- **Lore's starting read,** by part, from SQL: every lore row's title and
  short id on the branch. It shows a title and no body, so through 5.5a's
  split between rows shown and rows seeded it seeds nothing (C11). A row
  takes a `read_row` before `update_lore`, or a user's body could be
  replaced by text written blind.

### Upkeep

- **`update_place`.** Writes `condition`, `description`, and placement: a
  parent, or the top-level mark for an unplaced place. A row that isn't a
  location is `rejected`. `condition` and placement are both `state`, and
  two `state` actions on one row refuse the group
  (`lib/actions/delta/apply-delta-action.ts:318-325`), so both go through
  5.5a's helper into one `updateEntity`, with `description` in that
  action's patch, as 5.5b's tools do. The sub-fields come from
  `withPlacement`, which clears `unplaced` in the same write, and the
  guard reads them as one field.
- **Placement's rules run in the plan.** `updateEntity` checks only the
  parent chain, as a plain refusal, and leaves a retired parent to its
  builders (`lib/actions/entities/register.ts:277-283`), so this path
  never reaches the checks in `placeLocation`
  (`lib/actions/entities/state-patch-actions.ts:480-506`). The plan runs
  them ahead, from `lib/world` and `ctx.db`: the target is a live place
  and isn't retired, `placementDrop` finds no loop and no move that hides
  the story, and `top` goes only on an unplaced row. The story comes from
  `readStoryPlace` (`lib/pipeline/definitions/entry-reads.ts:68`), so
  `storyInside` holds for a close, where today it's gated to a pass. A
  refused placement drops from the call: what can land does, and the
  result is `ok` naming it with its reason. Sent alone, it's `rejected`.
- **`update_item`.** Writes `condition` and `description` on an `item`
  row, the same way. Any other row is `rejected`.
- **`set_keywords`.** Takes `add` and `remove` on any entity kind.
  `laterTurnWrote` reads `keywords` whole, so a list a later turn wrote
  is `skipped`. It lands a new `setEntityKeywords` action, `entityRow` in
  `LOCK_KEY`, since no shipped action removes a term and add and remove
  on one row must be one `keywords` write. `add` works as
  `appendEntityKeywords` does (`state-patch-actions.ts:394-411`): only
  terms the list lacks, less any the user removed after the prose, while
  the same call's other terms land. A term in `remove` the list doesn't
  hold is ignored. A removal failing the rule below refuses the action
  with an unmarked noop naming the term, so the call is `rejected`.
  Nothing left to change is `noopRefusal(reason, 'restated')`.
- **Who added a term.** A new `lib/actions/delta/keyword-authors.ts`
  serves both keyword actions, in the action layer, which `lib/pipeline`
  can't import. It reads the row's deltas in log order. An update's
  pre-list is its undo payload's `keywords`, and its post-list is the
  next such delta's pre-list, else the live row's. A term's author is the
  source of the latest delta whose pre-list lacks it and whose post-list
  holds it, by `normalizeTerm`. A term no update added takes the source
  of the row's `create` delta. With no such delta (wizard, seed, import)
  it reads as the user's. Only a term whose author fails
  `isUserOriginatedSource` can go. A user merge's keyword union reads as
  the user's, the safe direction.
- **`mark_common_knowledge`.** Sets `commonKnowledge: 1` through
  `updateHappening`, with 5.5b's `proseEntryId` and its noop on an
  unchanged column, behind `laterTurnWrote`. It only ever sets 1. The
  plan reads the row first, since `updateHappening` ends a gone row in a
  bare hard `not-found`, and a row this close merged must name its
  survivor from the ledger.
- **Upkeep's starting read,** by part, from SQL. Each row shows the
  fields its tools write, so it seeds the read gate (C11). Three sets:
  - Off-scene rows the part mentions: rows that aren't retired whose name
    or keyword `matchTerms` finds in the part's `promptProse`, less any id
    in a part entry's `sceneEntities` or `currentLocationId`.
  - Places and items in the part's scene with no keywords. 3f wants their
    first ones, and the per-turn writer creates them in scene, so the
    off-scene set can never hold them.
  - Happenings of the part still at `commonKnowledge = 0`, by title and
    that flag. `search_world` reaches a happening only through words the
    model guesses, and the prose never gives it a title.

### Lifecycle

- **`retire_entity`.** Over `retireEntity`, with `why` as `retiredReason`,
  behind `laterTurnWrote`. An already retired row is restated, `ok` with
  nothing written, so `retireEntity` marks that arm of `not-active`. A
  staged row's `not-active` and `location` reach the model as `rejected`,
  C11's default for an unmarked noop.
- **The scene check.** On a character, the plan refuses with `rejected`
  when an `ai_reply` past E holds its id in `metadata.sceneEntities`
  (`lib/db/story-entries/entry-metadata.ts:69`). Only replies count. Scene
  fields are carried forward onto every entry, `user_action` rows
  included, so the action after E inherits E's scene, and reading it
  would refuse every retirement of a character who dies at the chapter's
  end. A reply whose writer reported no scene inherits too
  (`lib/piggyback/apply.ts:81`), which errs toward keeping the character,
  as canon's bias does.
- **The `duplicate` reason.** A value in `COLLISION_REASONS`
  (`lib/db/enums.ts:12-21`). `stillPaired`
  (`lib/world/collision-pair.ts:52-54`) returns true for it with no
  namesake test. That's the one gate: `flagStillHolds`, `brokenFlags`,
  `pairFlagsToClear`, `raiseRefusal` and the merge's re-point all read
  through it. No migration, since the column is a plain `text` and the
  table's CHECK covers the triple, not the values. The dialog's
  `REASON_TEXT` record
  (`components/compounds/collision-resolve-dialog.tsx:102-116`) takes a
  line, and `locales/en/common.json` takes
  `collisionDialog.reason.duplicate`, with canon's copy.
- **`flag_duplicate`.** Over `raiseCollisionFlag` with reason `duplicate`
  and the latest cited turn as `proseEntryId`, behind `laterTurnWrote`.
  The call names two rows, so both pass the read gate. A row with a live
  flag refuses it through `raiseRefusal` (`already-flagged`), and the
  agent never merges.
- **The resolved-pair read.** For `duplicate` only, and ahead of
  `raiseRefusal`, the handler reads both rows' whole user history,
  `userEditsSince(…, 0)`, since canon's refusal has no prose bound. Run
  after it, a clear past the cited turn would stop at
  `USER_EDITED_SINCE_PROSE` (`state-patch-actions.ts:554`), which reads as
  `skipped`. It refuses with an unmarked noop when a
  `user_edit` delta on either row has `nameCollisionFlag: 1` in its undo
  payload and the other row as `nameCollisionPartnerId`. That's a clear,
  by Keep, the dialog's Rename or a detail-pane rename's `brokenFlags`; a
  re-point carries no `nameCollisionFlag`. Either row can hold the clear,
  so reading one misses a flag raised from the other side. `name-taken`
  keeps its prose-bounded rule.
- **Lifecycle's starting read,** by part, from SQL. It can't leave out a
  character the chapter shows dying, it reaches factions, which have no
  `lastSeenAt` and no scene tag, it never lists a location, and it isn't
  the stale-active threshold. Each row shows `status`, `retiredReason` and
  its flag, the fields its tools write, so it seeds the read gate (C11).
  What it selects is an open question.

### Tasks and templates

- **Three task templates** in the `chapter` group (C3), each in
  `TEMPLATE_IDS` and `TEMPLATE_GROUPS`, on 5.5a's shared macro, with the
  task's instructions, starting rows and the writes so far in the user
  half. Each joins the named list at
  `lib/prompts/bundled/system-half-stability.test.ts:346`. Canon's bars
  go in the prompt: 3a's establishes-not-mentions test, 3b's bar on a
  place's or item's `description`, a material change and never detail the
  state slots already carry, explicit spread for `common_knowledge`, hard
  finality for a retirement.
- **`read_row`'s registry** gains, by task and row kind. Lore: a lore
  row's four fields. Upkeep: a place's or item's `condition`,
  `description` and `keywords`, a place's placement, any entity's
  `keywords`, and a happening's `title`, `description` and
  `commonKnowledge`. Lifecycle: an entity's `status`, `retiredReason`,
  `description`, `keywords` and flag.
- **Slot order.** `perPart` runs Lore, Identity, Threads, Upkeep,
  Lifecycle. A start read returning nothing makes no call and the task
  still counts (C6). Lore's never returns nothing: it starts from the
  prose as well as the titles, or a story with no lore could never get a
  row.
- **`values` for the report (C4).** Keys are the paths `changedPaths`
  reads off the landed delta, as 5.5b's are. `create_lore` carries
  `values.body`, which 5.11 shows as its summary. `flag_duplicate` names
  the flagged row in `rows[0]` and the partner in `rows[1]`, and its one
  key, `nameCollisionPartnerId`, holds the partner's name and belongs to
  `rows[0]`, so the review shows one row. A written parent's value is the
  parent's name. A `top` mark's only changed path is `state.unplaced`, so
  it holds `top level`, or the landed move would have no field and the
  review would omit it. `mark_common_knowledge` carries `commonKnowledge`
  holding `1`. `retire_entity` carries `status` alone; its reason is the
  call's `why`. A refused `create_lore` keeps its minted id and title in
  `rows` and its proposed fields in `values`.

### Parts

- **The cut.** `cutChapterParts(entries, windowTokens)` in `lib/chapters`,
  pure. The limit is half of `windowTokens`, floored, or 32,000 when it's
  null. It walks the entries in position order and closes a part before
  an entry that would pass the limit. An entry over the limit is a part
  alone. It never cuts inside an entry.
- **Where it runs.** First in the `metadata` phase, before any call. The
  window is `generationWindow` on `lore-mgmt`'s resolved model, so a
  story override's model counts. The entries are the series read 5.2
  already takes for `tokenCount` (C5), filtered to the closed range,
  while the range is unstamped: a stamped entry leaves the series.
- **The part intermediate.** An accessor in
  `lib/pipeline/definitions/close-intermediates.ts`, beside the range's
  and the ledger's, holds
  `{ part, startEntryId, endEntryId, tokens }[]`, `part` from 1 as C4
  numbers it, always set, one element for a chapter that fits. Later
  reads take a part's entries from SQL by these ids, as C2 has phases do.
- **The loop.** 5.5a's parts function reads the intermediate in place of
  its whole-chapter stand-in, and C6's `total` takes the count from there
  through 5.5a's pure function. The shared macro renders the part's
  entries under their chapter-wide handles. Identity's start narrows from
  the closed range to the part; Threads' stays branch-wide. The ledger
  takes `part` from the loop where 5.5b wrote 1.
- **Limits across parts.** The lore cap holds across them. Each part's
  writes-so-far list holds every earlier part's writes. A task's 24 steps
  and its read gate are per part, so a row read in part 1 is unread in
  part 2. `stopped` and each call carry their part.
- **Metadata per part.** A chapter of one part keeps 5.2's call unchanged.
  With more, one call per part returns `{ summary }`, reading as Phase
  2's call does with the part as its range, and a last call takes the
  part summaries in order with the previous chapter's summary and the
  open threads (pending or active), and returns `chapterMetadataSchema`.
  Both are new templates beside `lib/prompts/bundled/chapter-metadata.ts`,
  in the `chapter` group, following the normal rule with everything
  per-call in the user half, so neither takes an exemption. Each uses
  C2's bound. The phase polls `abortSignal` between calls, and a failed
  call fails the close, as Phase 2's does.
- **Mock shapes.** `chapter-metadata-part` and `chapter-metadata-merge` in
  `scripts/mock-llm/shapes.ts`, with `EXAMPLES` in
  `e2e/harness/mock-llm.ts` and a lane in `scripts/mock-llm/state.ts` for
  each. The merge shares `chapterMetadataSchema` with 5.2's
  `chapter-metadata`, so they share a block, and
  `scripts/mock-llm/routing.test.ts:274-286` requires shapes sharing a
  block to carry distinct, non-empty markers. `storyShape`
  (`scripts/mock-llm/shapes.ts:62`) takes no marker, so it gains one
  through `markerOf`, on 5.2's entry too, and both templates' user halves
  open with literal text for `markerOf` to slice. The loop at
  `routing.test.ts:94-105` routes every story shape from a prompt with no
  marker, so it passes `shape.marker` into that prompt, and the "carry no
  marker" comments there and at the head of `shapes.ts` flip.

### Round trip and canon

- **Each tool in the round-trip suite (C9):** the eight write tools join
  `lib/pipeline/__tests__/close-round-trip.test.ts` as cases. Named cases:
  `create_lore` in part 1 with `update_lore` of that row in part 2;
  `update_place` writing `condition` and a parent; `set_keywords` adding
  and removing; `update_lore`'s `setLoreKeywords` beside a text field; a
  `flag_duplicate` whose partner a later turn created, whose flag a
  rollback leaves dormant; `update_thread` in part 1 against
  `merge_threads` absorbing that row in part 2.
  `mark_common_knowledge` on a merged row if 5.9 landed first: the
  absorbed id is `rejected` naming the survivor, and the survivor takes
  the write. If 5.12 landed first, each tool adds its own delete arms.
- **Canon,** in this PR:
  - `chapter-close.md → Run order`'s Upkeep and Lifecycle "Starts with"
    cells say what the reads select.
  - `chapter-close.md → Tools and writes`' "Rows a task starts with count
    as read" narrows to rows shown with the fields the task writes.
  - `data-model.md → LocationState shape`'s `placeLocation` paragraph
    (`docs/data-model.md:822-826`) says a close places a row through its
    plan and `updateEntity`, and refuses a disabled place around the story
    as a pass does.

### The dataset seed

[Slice 5.2](./02-first-chapter.md#implementation-notes)'s dataset chapter
is checked in as [the dataset seed](../../../../testing.md#the-dataset-seed),
and each slice that adds to a close refreshes it (developer decision,
2026-11-05). Load it with `pnpm db:seed:dataset`, CTRL-Z its close, and
close the chapter again from the dev route with `pnpm mock` passing the
close's calls through to the dev model
([Passthrough and recording](../../../../../scripts/mock-llm/README.md#passthrough-and-recording)).
Re-export with `pnpm dataset:export-seed`, update the counts and title
`treasure-island.seed.test.ts` pins, and commit the diff. The re-close
reruns every close task, not this slice's alone, so rows the dev model
rewrites churn; that is expected. A story-level model override has to
name a provider the default seed defines, or the export refuses it. 5.8
and 5.9 run at once: whichever merges second rebases onto the other's
seed and refreshes again rather than merging the file by hand, which
would drop one slice's rows.

## Scope: out

- `placeLocation` and `updateEntityCondition` don't change. A close's
  place and item writes go through 5.5a's helper and never reach them, so
  the per-turn writer's comment at `state-patch-actions.ts:327-330` stays
  true.
- The driver, ledger, row guard and its widening to `lore`, the `state`
  helper, the id layer with `body` in `PROSE_FIELDS`, `search_world` and
  `read_row` itself ([Slice 5.5a](./05a-task-runner.md)).
- Identity and Threads, and `proseEntryId` on `updateHappening`
  ([Slice 5.5b](./05b-identity-threads.md)). Its order and bounds apply
  here unchanged.
- Happenings, Awareness, stackable normalization, the reset, `read_turns`
  and `merge_happenings`
  ([Slice 5.9](./09-chapter-wide-tasks.md)).
- `CLOSE_REPORT_VALUE_BOUND` ([Slice 5.5b](./05b-identity-threads.md)) and
  reading the report, including Not applied
  ([Slice 5.11](./11-review-window.md)).
- The seven-task `probe:close` run, the Auto close E2E and Phase 1
  ([Slice 5.10](./10-two-starts.md)).
- `closeConversation: single` and `closeTools: shared` (M7.1), and any
  surface for the lore cap.
- `Regenerate summary` over a chapter in parts (M7.2).
- World's "stale active" (followups). Phase 4's surfacing half doesn't
  land here.
- An undo that removes only its own terms
  ([`parked.md`](../../../../parked.md#a-keyword-writes-undo-restores-the-whole-prior-list)).
- Prompt tuning
  ([`followups.md → Tuning and play testing`](../../../../followups.md#tuning-and-play-testing)).

## Acceptance criteria

Run on the mock unless a line says otherwise. Each delta named below has
`source = chapter_close` and `entry_id = E`. Test paths run with
`pnpm vitest run --project unit <path>`.

**Lore**

- A landed `create_lore` leaves a row with `priority` 0, `injectionMode`
  `auto` and the model's body and keywords, and a later step resolves the
  short id it returned. A short id in its `body` lands as the name it
  stands for.
- An uncited create, one citing a turn outside the chapter, and one with
  a whitespace body each return `rejected` and write nothing.
- On a two-part chapter, three creates in part 1 land and one in part 2
  is `rejected` naming the cap. A refused create leaves the count where
  it was, and its call keeps a minted id in `rows`.
- `update_lore` with a user edit of `body` after the cited turn and a
  free `category` lands `category` and returns `ok` with a `skippedFields`
  entry for `body`. With only `body` sent it returns `skipped`. Restating
  stored values returns `ok` and adds no delta. A blank `body` beside a
  free field reads as omitted.
- `update_lore` on a row the title list showed, with no `read_row`, is
  `rejected` and writes nothing. After a `read_row` the same call lands.
- Removing a term the user added beside a free `body` lands the `body`
  and returns `ok` with a `skippedFields` entry for `keywords`.
- `lib/actions/delta/lock-keys.test.ts` asserts `lockKeysFor` returns `[]`
  for `setLoreKeywords` and `updateLore`.

**Upkeep**

- `update_place` with `condition`, a parent and `description` lands all
  three as one delta and one CTRL-Z reverses them. A parent clears
  `unplaced` in that write. On a place a user edited after the cited
  turn, `condition` is skipped and named. `update_item` lands `condition`
  and `description` the same way. A `location` id sent to `update_item`,
  or an `item` id to `update_place`, is `rejected`.
- Each refused placement returns its reason and lands the call's other
  fields: a parent that isn't a place, a retired parent, a loop, `top` on
  a row that isn't unplaced, and a move of a place holding the story
  under a disabled parent, with `PLACE_REFUSAL.storyInside`. The same
  parent for a place that doesn't hold the story lands. No refused
  placement reaches `updateEntity`'s plain refusal, which would fail the
  whole call.
- `set_keywords` adds and removes in one delta. A term the user added, a
  term on a wizard row with no `create` delta, and a term a user merge
  unioned in are each refused with the term named and nothing written. A
  term a pass added goes. A term the user removed after the prose stays
  removed while the same call's other terms land. A list a later turn
  wrote returns `skipped`.
- `mark_common_knowledge` sets 1, and a repeat returns `ok` with no delta.
- Upkeep's read over `createTestDb` holds an off-scene place named in the
  part, leaves out one in the part's scene, holds a bare item in scene,
  and holds a part's happening at `commonKnowledge = 0` and not one at 1.
  With all three sets empty the task makes no call and `close_task_start`
  still fires.

**Lifecycle**

- `retire_entity` retires a character, an item and a faction, with `why`
  as `retiredReason`, and returns `rejected` on a location and on a
  `staged` row. On a row already retired it returns `ok` with no delta,
  no `values`, and no Not applied row.
- A character in the scene of an `ai_reply` past E is `rejected`. A
  character only in the `user_action` right after E, by inheritance,
  retires.
- `flag_duplicate` lands on two rows with no namesake basis.
  `flagStillHolds` reads it live, so World lists it, and `brokenFlags`
  leaves it through a detail-pane rename of either row. The dialog's
  Rename, Keep and a merge resolve it as they do any flag. A live flag
  naming another row, or the same row for another reason, returns
  `rejected`; the same flag again returns `ok` with nothing written (C11).
- After Keep on a pair, in either direction, `flag_duplicate` on that pair
  returns `rejected`, whether the clear came before or after the cited
  turn, and from either row. A re-point doesn't count as resolved.
  Undoing the Keep lifts the refusal.
- Every other reason behaves as before: the existing suites under
  `lib/world` and `lib/classifier` pass, and `name-taken` still re-raises
  on newer prose.
- The resolve dialog shows `The chapter close judged these the same.` for
  a `duplicate` pair, routed through `t()`.
- Adding the reason takes no migration: `pnpm db:generate` reports no
  changes.
- Lifecycle's read over `createTestDb` holds a character dying in the
  part's scene and a faction the part names, and no location. With an
  empty read the task makes no call and still counts.

**Parts**

- `lib/chapters/cut-parts.test.ts`: half a known window, floored; 32,000
  on null; an entry exactly filling a part stays in it; an entry over the
  limit is a part alone with its neighbours kept apart; a chapter under
  the limit is one part; a null-count row reads as 0 through C5's series.
- The limit follows `lore-mgmt`'s resolved model, a story override
  included, and the part intermediate holds one element for a
  chapter that fits.
- A chapter of one part makes the same single metadata call as before,
  and no merge.
- A three-part chapter makes four metadata calls, and `chapters.summary`,
  `title`, `theme` and `keywords` are the merge's. A failed part call and
  a failed merge each reverse the group. An abort between part calls makes
  no further call.
- On a three-part chapter `close_task_start` reports `total` 17. Each
  `perPart` task's `index` follows Lore, Identity, Threads, Upkeep,
  Lifecycle in part order, and each `CloseReportCall.part` matches the
  part that made it, Identity's and Threads' included.
- Identity's starting rows in part 2 are those part 2 touches.
- Part 2's user half lists part 1's writes. Part 2's rendered entries
  carry the chapter-wide handles, so `t12` resolves to one entry in both
  parts. A row read in part 1 and written unread in part 2 is `rejected`.
- In a three-part chapter, one part's five tasks render a byte-identical
  system half, and two parts' differ.
- `update_thread` in part 1 then `merge_threads` absorbing that row in
  part 2 is `rejected`, and the group's CTRL-Z doesn't reach
  `held-in-redo`.

**Reversal, report and gates**

- All eight tools are in `close-round-trip.test.ts` with the named cases,
  and no case reaches `held-in-redo`.
- `create_lore`'s call holds `values.body`. `flag_duplicate`'s has the
  flagged row as `rows[0]`, the partner as `rows[1]` and one `values` key.
  A `top` mark's holds `state.unplaced` as `top level`, and
  `mark_common_knowledge`'s holds `commonKnowledge` as `1`, so neither
  landed write drops out of the review. Every other landed call's `values`
  keys are among the `changedPaths` of its delta.
- `read_row` returns each task's registry fields. A write to an Upkeep or
  Lifecycle starting row passes the read gate with no `read_row` call,
  since those starts show the fields the tools write. Lore's title list
  seeds nothing.
- `lib/prompts/bundled/system-half-stability.test.ts` passes with one
  named entry per new task template, and the two metadata templates pass
  the ordinary check.
- `scripts/mock-llm` passes with both new shapes, and each of the three
  metadata shapes routes to its own entry.
- `chapter-close.md`'s Upkeep and Lifecycle cells match the reads, its
  "count as read" sentence names rows shown with the fields the task
  writes, and `docs/data-model.md`'s `placeLocation` paragraph covers a
  close.
- `pnpm lint`, `pnpm format:check`, `pnpm compiler:check`,
  `pnpm typecheck`, `pnpm lint:docs` and `pnpm test:run` pass.

## Tests

- **`lib/chapters`.** The cut, as a pure function, with the boundaries
  above.
- **Actions, Vitest over `createTestDb`.** Extend
  `lib/actions/entities/state-patch-actions.test.ts` (`setEntityKeywords`,
  the resolved-pair read), `lib/actions/lore/register.test.ts` and
  `lib/actions/lore/update-noop.test.ts` (`proseEntryId`,
  `setLoreKeywords`), and `lib/actions/delta/lock-keys.test.ts`. New
  `lib/actions/delta/keyword-authors.test.ts`,
  walking a row through a create, a pass's append, a user's removal and
  re-add, and a row with no `create` delta.
- **`lib/world`.** `duplicate` through `stillPaired`, `flagStillHolds`,
  `brokenFlags` and `pairFlagsToClear` in `collision-pair.test.ts` and
  `collision-flags.test.ts`, and the re-point in `entity-merge.test.ts`.
- **Tools and tasks,** beside them under `close-agent/`. Each tool against
  every C11 row it can reach, on the fixtures 5.5b's tools use. Assert the
  result, the DB and the ledger call, since a green result over an
  unchanged row is this repo's usual vacuous test. Mutation-check the
  walk, the resolved-pair read and its place ahead of `raiseRefusal`, and
  the placement rules.
- **Pipeline.** The metadata phase's one-part and many-part paths, and the
  agent phase's loop on a stubbed window, with 5.4's scripted steps.
- **Reads.** All three starting reads and the scene check over
  `createTestDb`, with `sceneEntities` and `currentLocationId` set by hand,
  and what each seeds into the read gate.
- **Prompts.** `system-half-stability.test.ts`, and a render of the five
  tasks against one part for the byte comparison.
- **Mock.** `shapes.test.ts` and `routing.test.ts`.
- **Round trip.** The eight tools in `close-round-trip.test.ts`.
- **Storybook.** A `duplicate` story in
  `components/compounds/collision-resolve-dialog.stories.tsx`, on a pair
  with no namesake basis, asserting the reason line.
- **Manual.** One `pnpm probe:close` on 5.2's dataset chapter on the dev
  model, with a `contextWindowOverrides` value that cuts it in two. Read
  the saved messages for a part's repeated system half and for a row
  cited across parts. It's a smoke check, not a measure: 5.10 owns the
  full run.

No E2E: this slice's one surface is a dialog line, and the end-to-end close
is [Slice 5.10](./10-two-starts.md)'s.

## Open questions

- **Where does the lore cap live?** Canon calls it tunable in app
  settings, but `data-model.md → App settings storage` has no key,
  `lib/db/app-settings` has none, and no surface could set one before
  M7.1. The same reasoning moved `closeConversation` to M7.1. Suggested: a
  named constant of 3 here, with the key, its range and its surface
  decided at M7.1, and 3a's line saying so.
- **Does the keyword rule reach lore?** Canon's `rejected` bullet says a
  write can't remove "a keyword the user added", with no table named, but
  3f's rule is about entities and 3a only says the agent extends or
  corrects a row's keywords. Suggested: yes, by the same walk, which this
  doc assumes. "No `create` delta reads as the user's" then protects
  wizard lore.
- **What does "active entities not seen lately" select, and for which
  kinds?** It can't exclude canon's own auto-retire case, a character who
  dies in this chapter. It must reach factions, which have neither
  `lastSeenAt` nor a scene tag. It isn't the stale-active threshold, and a
  read that returns nothing means the task never runs and nothing says so.
  Since a retirement must cite a turn of the chapter, a row the part never
  mentions has nothing to cite. Suggested: `active` rows of the three
  non-location kinds that the part touches, by 5.5b's reading of "touches"
  for a faction, less characters an `ai_reply` past E has in scene, whose
  retirement would be refused anyway. Check the size against the dataset
  chapter. `lastSeenSpan` (`lib/world/overview.ts:88-95`) then has no role
  here.
- **Is a lore body bounded?** `retrieval.md` bounds the app's own writers
  and exempts the user's lore, where "a long body is the feature". 5.5b
  bounds a description by `clampEmbeddedText`'s 1,200 characters and 5.9
  suggests the same for a composite, but 1,200 is short for a definitional
  rule. Is a machine body bounded at all, and by what? And `update_lore`
  extending a user's body already past the bound can't be cut without
  losing the user's text. Suggested: a body limit of its own on a create,
  and on an update a `rejected` the model can act on, never a cut.
- **Should `flag_duplicate` refuse a pair flagged from the other side?**
  `raiseRefusal` reads only the row's own flag, so part 1 can flag A
  naming B and part 2 B naming A: two strips and a pill of 2 for one
  question, though one resolve clears both. Canon says "a row with a live
  flag". Suggested: refuse it as `already-flagged`, at the cost of one
  read.
- **Should a removal that breaks a live flag's pair be refused?** When a
  keyword is what makes two flagged rows namesakes, removing it turns the
  flag dormant, and a question the user hadn't answered disappears. Canon
  lets a reversal or a pass's rename do this, and World's own writes clear
  such a flag. Either `brokenFlags` refuses the removal or the dormancy is
  accepted.
- **Does the slice stay under the ceiling?** It's priced at about 19 tasks,
  and the placement rules and `setLoreKeywords` weren't in that estimate.
  If its plan passes 20, parts split cleanly from the tools: the cut,
  metadata per part, the loop and the across-parts cases touch neither the
  actions nor the task prompts. They free no edge, so keep them together
  unless the count demands it.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
