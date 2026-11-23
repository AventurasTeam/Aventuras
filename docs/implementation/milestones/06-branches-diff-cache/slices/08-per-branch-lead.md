# Slice 6.8 — The per-branch lead

## Metadata

- **Milestone:** [Milestone 6 — Branches + diff cache](../milestone.md)
- **Depends on:** none. Day-one startable.
- **Blocks:** [Slice 6.9](./09-lead-in-prompts.md), which reads the flag,
  the stamps and the DB lead read this slice ships.
- **Meets, with no edge:** [Slice 6.1](./01-copy-substrate.md) (the
  migration chain, C4; `submitTurn`'s lines, C10),
  [Slice 6.2](./02-scoped-reads-redo.md) (the store accessor, C5; the
  redo clear, C6), [Slice 6.10](./10-register-branch-pairs.md) (the
  register pairs, C5),
  [Slice 6.3](./03-fork-core.md) (the harness's lead switch, C10; the
  seed's fork, C7) and [Slice 6.7](./07-diff-cache.md) (the flag's
  prose, C9).
- **Contracts:** provides
  [C10](../milestone.md#c10--the-leads-surface); consumes
  [C5](../milestone.md#c5--branch-scoped-store-reads) and
  [C6](../milestone.md#c6--one-redo-stack-per-branch); follows
  [C4](../milestone.md#c4--migrations), C7's seed rule
  ([C7](../milestone.md#c7--fork)),
  [C11](../milestone.md#c11--shared-files) and
  [C12](../milestone.md#c12--canon-and-flips).
- **Gated tasks (C12):** the merge dialog, its fixed surviving row and
  its copy, and the refusal's reach to a row a stamp names, start after
  the design pass that lands R4's canon. The refusal of a merge whose
  losing row is the flagged lead isn't gated: it is today's behavior,
  which R4 keeps, and it lands with the delete handler's change (see
  [The merge keeps a stamped or flagged row](#the-merge-keeps-a-stamped-or-flagged-row-r4-c10)).
  Everything else starts on day one.
- **Size:** 17 tasks at layout; R4's merge work (the stamp read, the
  widened refusal, the dialog's fixed and blocked sides) and the
  order-free criteria put it nearer 19. M5's plans held 3 to 7 more
  than their estimates, so check it against 20 at the plan skeleton.

## Goal

The lead becomes a logged flag on a branch's character row, every new
entry records the lead it was written under, and a branch that needs a
lead and has none refuses a turn and says why. This delivers
`entities.is_lead` with its `CHECK` and the migration that moves the
stored lead onto it; `storyDefinitionSchema` without `leadEntityId`;
`resolveLead` by the flag, a DB read of a branch's lead and a `lib`
needs-a-lead rule; set and unset as logged groups on a branch the
caller names; the lead's delete allowed, and a collision merge that
always keeps the row of the lead and of any character an entry is
stamped with; `metadata.leadId` on every `user_action`,
`ai_reply` and `opening`, existing ones included; the refused turn in
the actions and in the reader; the undo target's lead row and the
History label. Slice 6.9 puts it into prompts; Story Settings (M7.2)
edits it.

## Background

Today the lead is `stories.definition.leadEntityId`: story-level,
written unlogged by `setStoryLead`, and resolved against the loaded
branch's entity map, where it can dangle, so delete and merge refuse the
lead outright. Canon moves it onto the branch's character row, a flag
that set, unset and a delete keep at one per branch, which a fork copies
with the row and which rollback, regenerate and CTRL-Z treat like any
World edit. A collision merge never removes the lead's row, nor the row
of any character an entry on the branch is stamped with (R4, in
[C10](../milestone.md#c10--the-leads-surface)), so a stamp names a
missing row only after a delete. Whether a branch needs a lead follows
from the story's mode and narration, and is checked where a branch
acts: the wizard's Finish, a turn, and in M7.2 a Story Settings save. Each new entry stamps the lead
it was written under, which 6.9's prompts read to mark where the lead
changes. Canon is the authority; this is orientation.

## Required reading

- [`data-model.md → The lead`](../../../../data-model.md#the-lead), all
  of it, as R4's design pass amends it: three writers, not four, no
  merge passes the flag, and no merge removes a stamped character's
  row. Until that pass lands, C10 holds R4.
- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback):
  groups, CTRL-Z, the redo stack, and redo reapplying a group newest
  first, which the two-flags rule below rests on.
- [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape):
  the definition loses the lead; story open parses it strictly.
- [`data-model.md → Entry metadata shape`](../../../../data-model.md#entry-metadata-shape):
  `leadId`.
- [`data-model.md → Survival anchor`](../../../../data-model.md#survival-anchor):
  why a lead change, which has no entry, is swept by rollback and
  regenerate.
- [`principles.md → Mode, lead, and narration`](../../../../ui/principles.md#mode-lead-and-narration--three-orthogonal-concepts),
  with
  [`2. Lead`](../../../../ui/principles.md#2-lead--which-character-the-story-is-about).
- [`principles.md → Composer mode`](../../../../ui/principles.md#composer-mode--send-time-transform-narration-aware):
  the refused turn, its reason line and the mode reset.
- [`world.md → Detail head structure`](../../../../ui/screens/world/world.md#detail-head-structure)
  (`Set as lead`), [`→ Delete`](../../../../ui/screens/world/world.md#delete)
  (the lead's confirm line) and
  [`→ Merge`](../../../../ui/screens/world/world.md#merge), as R4's
  design pass amends it: the surviving row is fixed to the one the lead
  flag or a stamp names. Its current line that the flag passes to the
  survivor is what R4 reverses.
- [`wizard.md → Lead-required gating`](../../../../ui/screens/wizard/wizard.md#lead-required-gating):
  the Finish gate this slice keeps while it moves the needs-a-lead rule
  into `lib`.
- [`reader-composer.md → Undo and redo`](../../../../ui/screens/reader-composer/reader-composer.md#undo-and-redo)
  (the describe table's lead row) and
  [`→ Peek drawer — lead affordance for characters`](../../../../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters).
- [`generation-pipeline.md → Action rejection — defense in depth`](../../../../generation-pipeline.md#action-rejection--defense-in-depth):
  the gate check a user write makes before it registers.
- [`testing.md → Fixture + seed contract`](../../../../testing.md#fixture--seed-contract),
  [`→ The dataset seed`](../../../../testing.md#the-dataset-seed) and
  [`→ Selector strategy`](../../../../testing.md#selector-strategy).
- Milestone contracts:
  [C4](../milestone.md#c4--migrations),
  [C5](../milestone.md#c5--branch-scoped-store-reads),
  [C6](../milestone.md#c6--one-redo-stack-per-branch),
  [C7](../milestone.md#c7--fork) (the seed rule),
  [C9](../milestone.md#c9--the-diff-caches-seams) (the flag's prose),
  [C10](../milestone.md#c10--the-leads-surface) (R4 included),
  [C11](../milestone.md#c11--shared-files),
  [C12](../milestone.md#c12--canon-and-flips) (the merge's gate).
- Lessons:
  [Drizzle drops keys the table has no column for](../../../lessons-learned/drizzle-drops-unknown-keys.md#drizzle-drops-keys-the-table-has-no-column-for-silently)
  (the register's `fullRow`),
  [The seeded branch tip moves at the first Send](../../../lessons-learned/seed-tip-position-shifts-at-first-send.md#the-seeded-branch-tip-moves-at-the-first-send-so-a-pre-launch-position-is-not-the-apps)
  (the E2E's refused Send keeps the seeded system tail).

## Scope: in

### The migration (C4)

Three steps from separate drizzle-kit runs, in this order, since a
column and its `CHECK` generated together make the rebuild's
`INSERT … SELECT` name a column the old table lacks:

1. **Generated:** `entities.is_lead`, integer, not null, default 0, on
   `lib/db/entities/entities.table.ts:16-55`, typed `0 | 1` in Drizzle
   as `embeddingStale` is.
2. **Hand-written data step.** Each JSON read is guarded as `0011` and
   `0013` guard theirs, `json_valid` first, then `json_type`, since one
   bad blob aborts `migrate()` at boot.
   - On every branch of a story, flag the row whose id is the story's
     stored `definition.leadEntityId` when that row is a `character`,
     whatever its status: a staged or retired lead stays the lead. A
     branch where the id names no character gets no flag.
   - Stamp `metadata.leadId` with that row's id on every `user_action`,
     `ai_reply` and `opening` of a branch that has a flagged row (C10:
     every entry is stamped). Pre-M6 switches weren't logged, so an old
     entry's true lead is unrecoverable; the branch's current lead is
     the one the data holds. 6.9's marks read a missing stamp under a
     flagged lead as "no lead", so one unstamped entry would mark every
     history holding it. A branch with no flagged row has no lead to
     stamp, and its entries stay as they are (open question 1).
   - Remove `$.leadEntityId` from every `definition`, drafts included,
     unless planning decides otherwise (open question 1).
3. **Generated:** the `entities` `CHECK` rebuild allowing `is_lead = 1`
   only on a `character` row, shaped like
   `lib/db/migrations/0016_entity_collision_pair_check.sql`, re-creating
   `entities_stale_idx`. The data step flags only `character` rows, so
   the rebuild meets no violating row.

The bundle entries go in `lib/db/migrations/migrations.js`. No number is
pinned: the second of 6.1 and 6.8 to land regenerates its generated
steps from main's snapshot, renumbers its hand-written step and adds its
bundle entries. No table references `entities` by foreign key (checked
by grep of the schema and every migration), so the rebuild runs under
Android's single wrapping transaction, where `PRAGMA foreign_keys=OFF`
is inert.

### The definition (C10)

- `storyDefinitionSchema` loses `leadEntityId` and the `superRefine`
  that requires it (`lib/db/stories/story-config-schema.ts:41-61`), in
  the same change as the migration. Story open's parse
  (`lib/actions/stories/operational.ts:121-123`) then neither requires
  the field nor keeps a stored one, since the object schema strips
  unknown keys. Removing the field while the refine stayed would fail
  every adventure, first-person and second-person story as
  `definition-corrupt`.
- The definition's writers follow: the wizard draft's `saveStoryDraft`
  (`lib/actions/wizard/session.ts:64-73`), the wizard's Finish
  (`components/wizard/finish.ts:259-268`), `createStoryWithBranch`
  (`lib/actions/stories/create-story.ts:82-93`) and the seeds.
- The wizard's own working-state `leadEntityId`
  (`lib/db/wizard-sessions/working-state.ts:133`), its store and the
  `wizard` template group are the draft's and stay.

### The register (C10)

In `lib/actions/entities/register.ts`:

- `isLead` joins `UPDATABLE` (`:104-117`) and `EntityColumnPatch`
  (`:53-63`), which the `PatchMatchesColumns` check at `:118` ties
  together, and `fullRow` (`:122-146`), whose explicit column list
  otherwise gives the store a row the database doesn't hold.
- **Creates and machine writers can't set it.** `createEntity` refuses a
  row whose `isLead` isn't 0. `updateEntity` refuses an `isLead` key from
  a source `isUserOriginatedSource` doesn't count as the user's. Whether
  `entityWriteSchema` (`lib/db/entities/entity-schema.ts:7-20`) omits the
  column and checks it as it checks the collision-flag columns is
  planning's call (open question 3).
- An `isLead` write dirties no vector and doesn't mark
  `embeddingStale`: only `KIND_FIELDS` do (`:322-330`).
- The delete handler loses `isStoryLead` and its refusal (`:351-384`).
  That refusal is also the merge's today, since a merge's group deletes
  its loser through this handler; the merge's own check below replaces
  it, in the same change, so no commit lets a merge remove the lead.
- Whole-row restores bypass the handlers and carry the flag as a
  column: `undoDelete`, redo's snapshots and the journal write-back.
  CTRL-Z of a delete restores the lead with no code of its own, since a
  delete's undo payload is the whole row
  (`lib/actions/delta/delete-cascade.ts:141`).

### Set and unset (C6, C10)

They replace `setStoryLead` (`lib/actions/stories/set-lead.ts`). Names
are this slice's; 6.9 and M7.2 use whatever ships.

- **Set** takes the branch and the target. It refuses before any write:
  the user-edit gate (`generationStore.isUserEditBlocked()`), checked
  with no await before the group as `commitRowDelete` checks it, since
  `applyDeltaActionGroup` refuses user writes only while a reversal is
  in progress (`lib/actions/delta/apply-delta-action.ts:329-334`); a
  draft story; a target absent on the named branch; a target that
  isn't a character; a target that isn't active. It commits one
  `applyDeltaActionGroup` group of `updateEntity` writes, source
  `user_edit`: `isLead: 0` on every other flagged row of the branch,
  then `isLead: 1` on the target unless it is flagged already. The
  target stays out of the clear list, since a group may not write one
  row's column twice (`apply-delta-action.ts:345-353`). A target that is
  already the branch's only lead writes nothing.
- **Unset** takes the branch and clears every flagged row in one group.
  It ships with no caller, as the M7 placeholders do: its only surface
  is Story Settings, in M7.2.
- Both act on the branch the caller names, never
  `stories.current_branch_id` (`set-lead.ts:35-52`).
- Gone from the action: the whole-definition write, `rehydrateStories`
  with its ignored result, the open story's definition patch, the
  `invalid-definition` refusal, and the direct redo clear at `:69`. The
  group clears its branch's redo through `applyDeltaActionGroup`
  (`apply-delta-action.ts:390`), whether 6.2 has landed or not (C6).
- **Callers pass their branch.** World's `onSetLead`
  (`app/world/[branchId].tsx:494-510`); the peek's `useSetLead`
  (`components/reader/peek/use-set-lead.ts:23-61`) and its two hosts,
  `peek-drawer.tsx:47` and `rail-sheet-peek.tsx:33`. The refusal copy
  map (`components/world/world-copy.ts:198-210`) follows the new codes.
  World keeps its success toast; the peek keeps none.

### Delete

- **The action.** The lead can be deleted.
  `ROW_DELETE_REJECTION.leadEntity` goes
  (`lib/actions/row-delete/delete-row.ts:15-20`), with its UI twins:
  `deleteDisabledReason`'s lead arm and the refusal maps
  (`components/world/delete-copy.ts:44,55-65`,
  `components/plot/use-plot-delete.ts:79`).
- **The confirm's lead line.** `entityDeleteCopy`
  (`components/world/delete-copy.ts:10`) adds canon's line when the row
  is flagged: "Aria is this branch's lead. The story can't continue here
  until you set another." when the story needs a lead, "This branch will
  have no lead." when it doesn't. The confirm builds from the row re-read
  by id, which carries the flag. Through `t()`.

### The merge keeps a stamped or flagged row (R4, C10)

A row is _held_ when it carries the lead flag or an entry on the branch
is stamped with its id. A merge never removes a held row, so no merge
passes the flag, and every stamp still names a live row: a former lead
merged away would strand the turns written under it as surely as the
current one. Two pieces wait on the design pass that lands R4's canon
(C12): the dialog's fixed side with its copy, and the refusal's reach
to a row a stamp names. The refusal for the flagged lead doesn't wait:
it keeps today's behavior, and it has to land with the delete handler's
change, or a merge could remove the lead.

- **The stamp read.** One existence query over the branch's entries
  says whether a stamp names a given row,
  `json_extract(metadata, '$.leadId')` against its id. It lives beside
  the DB lead read, in `lib/db` or `lib/world`, so the action and the
  dialog's hook share it. It scans the branch's entries with no index;
  it runs once when the dialog opens a pair and once per merge.
- **The backstop refusal stays, re-homed, and widens.**
  `COLLISION_REJECTION.leadEntity` keeps its code and its UI mapping
  (`lib/actions/world/resolve-collision.ts:43-47`,
  `components/world/collision-copy.ts:8`,
  `components/world/use-collision-resolve.ts:51`). It fires today from
  the delete handler inside the merge's group, for the story-level lead
  only. Once that handler allows the lead, the merge refuses itself:
  - a flagged loser, from the pair's rows in `buildResolution`, which
    builds and dispatches in one tick (day one);
  - a loser a stamp names, from the stamp read, awaited before that
    tick (after the pass). Between the two, a new entry is stamped with
    the lead flagged at its creation, which the in-tick check sees; a
    redo that restores a stamped entry in that gap is the one path it
    misses.

  Whether the group also checks the loser in the database is
  planning's. The code's value no longer comes from
  `ENTITY_DELETE_REJECTION`, which goes with the delete's refusal. The
  refusal's two strings (`world.json:102,112`) say why for either reach.

- **The dialog fixes the surviving row.** When one row of the pair is
  held, `CollisionResolveDialog`'s merge body
  (`components/compounds/collision-resolve-dialog.tsx:440-512`) defaults
  its surviving row to that row rather than the older one, the
  surviving-row picker can't change it, and a line through `t()` says
  why. When both rows are held, the pair can't merge: Merge is
  unavailable with a line saying so, and Rename and Keep as distinct
  stay. A double, both rows flagged, is the same case until a set
  repairs it. `useCollisionResolve` reads the flag off the pair's own
  rows and runs the stamp read when it opens the pair. A pair with
  neither row held keeps today's picker. The wording follows the design
  pass's `world.md → Merge` where it gives one.
- **The merge writes no flag.** `entityMergeActions`
  (`lib/world/entity-merge.ts:263-338`) is unchanged: `MERGE_SCALARS` is
  a fixed list without `isLead`, so a lead kept as the canonical keeps
  its flag, and a canonical that isn't the lead stays unflagged.

### Reads

- **`resolveLead`** (`lib/world/lead.ts:21-29`) returns the branch's
  flagged character from the rows the caller holds, in place of
  resolving a story-level id. Two flagged rows read as no lead
  everywhere.
- **Where the two-flags error is logged (C10).** Only readers outside
  the render path log it: the actions and the pipelines, including the
  DB lead read. A render-path read returns no lead silently, since a
  redo reapplies a set newest first, one store patch at a time
  (`lib/actions/delta/row-closure.ts:341`, `redo.ts:366-388`,
  `lib/stores/factory/working-set-store.ts:24-36`), so a selector sees
  both flags on between two patches of a correct redo. The render-path
  callers are the selectors at `components/reader/rail/use-rail-data.ts:93`,
  `app/reader-composer/[branchId].tsx:356-358` and
  `app/world/[branchId].tsx:166`. How the two kinds of caller say which
  they are, an option or two functions, is planning's.
- **Store reads after 6.2 (C5).** 6.2 removes the stores' unscoped row
  reads, so a read that names no branch stops compiling, and it swaps
  only the map argument on the three lead lines that hand `resolveLead`
  a raw entity map: `generation-context.ts:496`,
  `periodic-classifier.ts:204-205` and
  `app/reader-composer/[branchId].tsx:356-358`. If 6.2 lands first, this
  slice's rewrite of those lines rebases over that swap and keeps its
  branch read. Every store read this slice adds goes through 6.2's
  accessor if 6.2 has landed, and none adds a `branchId` filter over
  store rows; landing first, the inline form stays and 6.2's final sweep
  meets it.
- **Its callers:** `lib/pipeline/definitions/generation-context.ts:496`,
  `lib/pipeline/definitions/per-turn-retrieval.ts:52-56`,
  `lib/pipeline/definitions/periodic-classifier.ts:204-205`,
  `components/reader/rail/use-rail-data.ts:86-95`,
  `app/world/[branchId].tsx:165-168`,
  `app/reader-composer/[branchId].tsx:355-358` and
  `scripts/classifier-parse-probe.ts:101-139,410`. The generation
  context's `lead` keeps its `{ id, name }` shape; 6.9 owns every
  projection change. `classifier-context.ts`'s `leadOf` takes a resolved
  id and stays.
- **A DB read of a branch's lead,** for a caller with no store: this
  slice's turn actions, and the close in 6.9. It lives in `lib/db` or
  `lib/world` (C10), not `lib/actions`, whose barrel `lib/pipeline` may
  not value-import (`eslint.config.js:190`). It applies the same
  two-flags rule.
- **The needs-a-lead rule moves into `lib`,** a predicate over mode and
  narration. `needsLead` (`components/wizard/step-frame-logic.ts:6`)
  uses it or goes, so the rule has one home.

### The stamp (C10)

Every path that creates a `user_action`, `ai_reply` or `opening` writes
the stamp, and the migration stamps the ones that exist. The app's
creators are the three below (a grep of the three kinds in non-test
code); the seeds and harness helpers that insert entries are under
Seeds.

- `entryMetadataSchema` (`lib/db/story-entries/entry-metadata.ts`)
  gains `leadId: z.string().optional()`. `inheritedEntryMetadata`
  carries only the scene triple, so a stamp is never inherited, and
  `updateStoryEntryMetadata`'s merge
  (`lib/actions/story-entries/register.ts:124-128`) keeps it on an edit.
- **`user_action`.** `submitTurn` stamps the branch's lead, from the DB
  read, where it builds the metadata (`lib/actions/turns/submit-turn.ts:157`).
  That runs under the pending-turn mark, which holds the user-edit gate,
  so no set lands between the stamp and the run.
- **`ai_reply`.** The per-turn reply stamps the lead its run read
  (`lib/pipeline/definitions/per-turn.ts:518-534`), after the
  `...(fold?.metadata ?? inherited)` spread, which replaces `inherited`
  wholesale when the fallback classifier folds. A regenerate, a Retry
  and a Save & regenerate stamp their new reply this way, with the lead
  as their run starts; the `user_action` keeps its own stamp.
- **`opening`.** The wizard's Finish hands its lead to
  `createStoryWithBranch`, which inserts that cast row with `isLead: 1`,
  unlogged as story creation writes the rest of the floor, and stamps
  the opening (`components/wizard/finish.ts:282-291`). The guard that the
  lead is a cast character (`create-story.ts:86-93`) stays, on the new
  input.
- Absent when the branch has no lead.

### The refused turn

- **A `blockedBy` code** for a missing lead, a constant in `lib`.
  `submitTurn` returns it as a `rejected` outcome, with `converged`
  true, before any write: before the owed pass or close runs and before
  the `user_action`. `regenerateTurn` refuses with it as
  its `code` before its sweep (`lib/actions/turns/regenerate-turn.ts:72-95`
  holds its refusals). Retry reaches `submitTurn`, Save & regenerate
  `regenerateTurn`. A creative third-person branch with no lead runs.
- **The reader gates before dispatch.** `runSubmit` drops the system
  tail before `submitTurn` (`app/reader-composer/[branchId].tsx:888-898`)
  and `runRegenerate` clears it through `runBehindTailDrop`, so an
  action-level refusal alone would cost the tail and its Retry. With
  the lead missing, Send, the reply's `↻` and its confirm, a failed
  turn's Retry and Save & regenerate don't dispatch, and the draft
  stays. A pass's or a close's Retry still runs: canon runs a pass or a
  close regardless.
- **The reason line.** `reader:composerLeadMissing` takes canon's copy
  and shows whenever the branch needs a lead and has none, in every mode
  and narration. Today only adventure with a third-person wrap shows it
  (`[branchId].tsx:359-364`). Send is blocked. A whole-composer disable
  reason wins the line; while a turn is generating, the lead line stays.
- **The mode picker.** In adventure it disables, shows `Free`, and the
  mode resets to `Free` while the lead is missing, whatever the wrap
  person (`components/reader/composer.tsx:107,151-157,193-194`). Today a
  first-person wrap keeps it live.

### Undo and History

- **The undo target's lead row.** `describeUndoGroup`
  (`lib/undo/describe.ts:87-115`) gains canon's row ahead of the
  one-row and several-row arms: a user group writing `isLead`, with no
  delete in it, is "making `<name>` the lead", the row whose update sets
  the flag (undo payload `isLead: 0`), or "removing `<name>` as lead",
  the row it clears, when it sets none. Unseen. Redo describes its
  snapshot the same way. The copy goes in
  `components/reader/undo-copy.ts` and its locale strings, a whole
  sentence per place: the menu label, the confirm title, the notice.
- **The History label.** `isLead` gets its label in
  `lib/history/field-labels.ts`'s `ENTITY` map (C11). If 6.7 has landed,
  this slice also gives the flag its prose; otherwise 6.7 does (C9).

### Seeds (C7's seed rule, C11)

- **The dev seed** (`lib/db/devtools/seed-dataset.ts`): `definition()`
  loses `leadEntityId` (`:133-150`); Kael on `br_hero_main` and
  `char_sable` on its story's branch carry `isLead: 1`
  (`:1423-1501`, `:2219-2226`); every `user_action`, `ai_reply` and
  `opening` on those branches carries `leadId`. `br_hero_fork` holds no
  entity, so it has no lead until 6.3 rebuilds it at seed time; its rows
  aren't this slice's, with one exception C10 pins: if this slice lands
  after 6.3, it stamps the turns the seed appends to that fork.
- **The dataset seed**
  (`scripts/dataset-chapter/treasure-island.seed.json`): the flag on its
  lead's character row, `leadId` on its entries, the key gone from its
  definition. A plain load and export at this slice's schema flags
  nothing, since the migration never sees rows inserted after it ran.
  Load it under the chain before 6.8's steps, migrate, then
  `pnpm dataset:export-seed`; or edit the file by hand. Neither of the
  seed's tests reads `is_lead` or `metadata.leadId` today, and story
  open strips the old key, so an unedited file passes them; a new case
  reads both. An unstamped seed would also skew 6.9's `pnpm probe:close`
  runs on that story (`scripts/close-probe.ts:114,917`), every turn
  opening with a "no lead" mark.
- **`scripts/seed/long-branch.ts:192`** loses its `leadEntityId: null`;
  its story is creative third person with no lead, so its entries take
  no stamp.
- **The E2E harness** (`e2e/harness/seed.ts`): an entry a helper inserts
  on a branch with a lead carries its stamp. `seedClassifierBacklog`
  (`:347-366`) writes `ai_reply` filler with `'{}'` metadata, on
  `br_hero_main` in its specs; the opening-only story borrows the
  creative story's leadless definition and needs none.
- **The classifier eval fixture** (`scripts/classifier-eval/fixture.ts`)
  builds `Entity` and entry rows in memory. This slice owns stamping
  them; 6.9's renderer doesn't stamp. `entries()` (`:196-215`) takes no
  lead today, so it gains the window's `lead` and stamps each
  `user_action` and `ai_reply` with it, in the id scheme the window's
  entity rows use, so `render.ts`'s remap treats both alike; the lead's
  row carries the flag. `render.ts:80` passes the lead's id itself and
  stays. 6.9's new switch window sets its own per-entry stamps.

### The width

- `Entity` is `$inferSelect` (`lib/db/types.ts:55`), so `isLead` becomes
  required on every `Entity` literal: about 107 in 50 files by a grep of
  `nameCollisionFlag: 0`, mostly fixtures and stories.
- `leadEntityId` leaves every file that reads the story definition's.
  87 files hold the name, 28 of them non-test; the wizard's
  working-state files among them stay.
- Test fixtures that take a turn on a story that needs a lead seed a
  flagged character, since that turn now refuses.
- **E2E.** The specs reading `json_extract(definition, '$.leadEntityId')`
  read `entities.is_lead` instead: `e2e/tests/peek-drawer.spec.ts:46-105`,
  `e2e/tests/world.spec.ts:36-39,473-488`,
  `e2e/tests/wizard-cast.spec.ts:106-117`. The test "the lead's Delete
  entity is disabled" (`e2e/tests/world-delete-undo.spec.ts:119-129`)
  flips: the lead's `Delete entity` is enabled.
- **Storybook.** `LeadCannotBeDeleted`
  (`components/world/detail/entity-detail-pane.stories.tsx:924-941`)
  asserts a disabled `Delete entity` named with the lead reason. It
  flips: the lead's `Delete entity` is enabled and calls `onDelete`.

### Meeting other slices

- **6.1 (C10).** 6.1 anchors the `user_action` create's delta on its
  entry (`submit-turn.ts:179`); this slice owns that function's
  metadata line (`:157`) and its refusal.
- **6.2 and 6.10 (C5, C10).** The `isLead` update's two-branch pair
  goes in `lib/actions/entities/register.test.ts`, in the shape of
  `lib/actions/story-entries/register.test.ts:224-300`, shown red by
  removing the handler's branch condition.
  [Slice 6.10](./10-register-branch-pairs.md) took the register pairs
  from 6.2; if it landed first, its pairs for `createEntity` and
  `deleteEntity`, whose bodies this slice changes, are run again with
  their mutation check.
- **6.3 (C10).** The flag and the stamps copy as columns and JSON
  ([C3](../milestone.md#c3--the-manifest-and-the-copier)). The second of
  6.3 and 6.8 to land adds a lead switch after the fork entry to the
  equivalence harness, and stamps the turns the seed appends to
  `br_hero_fork` (C7).
- **"If the other has landed."** Each job above that falls to the
  second of a pair to land is also an acceptance criterion here, under
  Order-free meets, written as "if the other has landed": with 6.1, the
  regenerated migrations; with 6.2, the three lead lines; with 6.3, the
  harness's lead switch and the fork's stamps; with 6.7, the flag's
  prose; with 6.10, the register pairs for `createEntity` and
  `deleteEntity`.
- **6.7 (C9).** The second of 6.7 and 6.8 to land gives `isLead` its
  prose.
- **6.9 (C10).** 6.9's projections carry the computed mark, never the
  raw stamp; nothing here hands a stamp to a prompt.
- **C7's seed rule.** E2E here runs on `br_hero_main`, reads
  `br_hero_fork`'s identity and entries from the DB if it reads them at
  all, and takes no turn on it.
- **Shared files (C11).** Besides those named above: the reader route
  (the lead selector, the composer's reason line, the gate before
  dispatch); `app/world/[branchId].tsx` (the lead lines and
  `Set as lead`'s branch); `resolve-collision.ts` and
  `use-collision-resolve.ts` (the lead refusal's lines);
  `generation-context.ts` and `periodic-classifier.ts` (the lead lines,
  beside 6.2's map argument and 6.9's projections) and
  `chapter-close-metadata-call.ts`, whose only lead line here is its
  test's definition fixture; `use-rail-data.ts` (the lead lines);
  `lib/db/devtools/seed-dataset.ts` with its test, `scripts/seed/` and
  `e2e/harness/seed.ts` (the flag and the stamps, beside 6.3's fork);
  `field-labels.ts` (the flag's label); `register.ts` and its test (the
  flag and its pair, beside 6.10's `branch scope` block).

### Forward pointers and copy (C12)

Comments stating the story-level or dangling lead as fact go:
`lib/world/lead.ts:17-20`, `lib/actions/entities/register.ts:378`,
`components/reader/rail/use-rail-data.ts:92`,
`lib/actions/stories/create-story.ts:86`,
`scripts/classifier-parse-probe.ts:101`,
`components/reader/composer.stories.tsx:110`. Copy:
`locales/en/reader.json:26` takes canon's wording;
`locales/en/world.json:185` (the delete's lead refusal) goes with its
code. The merge refusal's two strings stay with their code
(`world.json:102,112`), reworded from "the story's lead" to the
branch's.

### Canon and inventory edits its PR makes

- R4's canon is the batched design pass's, not this PR's:
  `data-model.md → The lead` (three writers), `world.md → Merge` (the
  fixed surviving row, the flag line) and `principles.md` if it names
  the merge.
- `world.md → Merge`: the fixed surviving row's wording, only if the
  design pass leaves it to the slice.
- `docs/ui/component-inventory.md`: the `EntityDetailPane` row, whose
  `Delete entity` is "disabled for the resolved lead", and the
  `CollisionResolveDialog` row, whose merge body owns the surviving-row
  pick: fixed when one row of the pair is held, and no Merge when both
  are.
- Its answers to open question 2 where they decide what the user sees
  (how `↻`, Retry and Save & regenerate show the refusal), on
  [`principles.md → Composer mode`](../../../../ui/principles.md#composer-mode--send-time-transform-narration-aware).
- Open question 1's answers go to Implementation notes: canon describes
  only the end state.

## Scope: out

- **Every prompt change** (Slice 6.9): lead marks, the projections
  carrying the computed mark (C10), the chapter context's `lead` and
  `narration`, the close's DB lead in its tasks, the third-person rule, and the registry
  descriptions that still say the lead "dangles on this branch"
  (`lib/prompts/templateContextMap.ts:215-222,471-478`).
- **Story Settings** (M7.2): the lead field, `No lead`, the save check
  of the current branch, the confirm's other-branches line and its read
  of which branches have no flagged character. Unset's caller.
- **The Actions menu's `Set lead character…`** (M7.2, per the roadmap):
  today it renders only in `app/dev/actions-menu.tsx` and the
  Actions-menu story.
- **The fork's copy of the flag and the stamps** (Slice 6.3, through the
  copier's column list, C3) and the seed's real fork (Slice 6.3, C7).
- **The redo map and the store accessor** (Slice 6.2). The story-wide
  redo clear, which has no writer in M6 once this lands (M7.2).
- **Story export and import of the flag**, and import's refusal of a
  branch with two leads (M9.4). The per-row `.avts` export already
  leaves the flag out (`lib/avts/entity.ts:29-38`).
- **The diff prose for the flag** unless 6.7 has landed first (C9).
- **R4's canon edits** (the batched design pass, C12), and 6.9's "gone"
  mark, which after R4 follows a delete only.
- **A merge that passes the flag, and re-stamping a merged-away lead's
  entries:** both rejected by R4.

## Acceptance criteria

Unit paths run with `pnpm vitest run --project unit <path>`, stories
with `pnpm vitest run --project storybook <path>`. E2E runs after
`pnpm build:web` with `pnpm test:e2e -- <spec>`.

**The migration.**

1. `lib/db/__tests__/migrate-m6-lead.test.ts` (new): the three steps are
   in the journal and keyed in `migrations.js`, as
   `migrate-m3-classifier-context.test.ts` checks its own.
2. The same file, on a database migrated to the step before 6.8's and
   populated with: an adventure story whose stored lead is a character
   on main and absent from a second branch; a creative first-person
   story with a lead; a creative third-person story with a null lead; a
   story whose stored id names a location; a story whose `definition` is
   not valid JSON; a draft; entries of every kind, one with null
   metadata. After 6.8's steps, run both ways, each statement on its own
   (desktop) and every pending statement inside one `BEGIN … COMMIT`
   (Android): exactly the stored character row is flagged on each branch
   holding it, and no row elsewhere or for the location id; every
   `user_action`, `ai_reply` and `opening` on a flagged branch has
   `leadId` equal to that row's id; `system` entries and every entry on
   an unflagged branch have none; the invalid row is untouched and the
   migration doesn't throw.
3. The same file: every story's stored definition passes
   `storyDefinitionSchema.parse`, as story open runs it
   (`operational.ts:123`), the adventure story with an unflagged branch
   and the draft included; no definition holds `leadEntityId` (the
   default of open question 1; the criterion moves with its answer).
4. The same file: inserting a `location` row with `is_lead = 1` fails
   the `CHECK`, and `entities_stale_idx` exists after the rebuild.

**The definition and the register.**

5. `lib/actions/stories/operational.test.ts`: an adventure story whose
   branch has no flagged character opens; one whose stored definition
   still holds `leadEntityId` opens, with no such key in the open story's
   definition.
6. `lib/actions/entities/register.test.ts`: `updateEntity` with
   `isLead: 1` from `user_edit` writes the column with undo payload
   `{ isLead: 0 }` and leaves `embedding_stale` as it was; the same patch
   from `periodic_classifier` refuses and writes nothing; `createEntity`
   with `isLead: 1` refuses; deleting a flagged row commits, and its
   undo payload holds `isLead: 1`.
7. The same file's two-branch block: the `isLead` update on branch A
   leaves the row with the same id on branch B as it was, and fails when
   the handler's branch condition is removed (the mutation check goes in
   the PR description).
8. `lib/history/field-labels.test.ts` ("labels every updatable column of
   every history table") passes with `isLead` in `UPDATABLE`.

**Set and unset.**

9. `lib/actions/stories/set-lead.test.ts`, or the test beside the
   renamed action: on a branch with Kael flagged, setting Mira commits
   one group (one `action_id`) of two `entities` update deltas, source
   `user_edit`, `entry_id` null; Kael reads 0 and Mira 1; the shipped
   undo of the latest action restores both together; redo applies both
   again; another branch holding the same ids is untouched; the story's
   `definition` is not written; the redo stack is cleared through the
   group, with no direct `undoRedoStore.clear()` in the action.
10. The same file: a set on a branch with two flagged rows leaves only
    the target; each refusal (gate closed, draft story, target absent on
    the named branch, not a character, not active) writes nothing; a set
    on a branch other than `stories.current_branch_id` acts on the named
    branch.
11. The same file: a rollback whose target precedes a set restores the
    previous lead.
12. The same file: unset clears every flagged row in one group, and the
    undo restores them.
13. The same file: with a listener on the entities store that runs the
    render-path read on every notification, a redo of a lead switch
    calls `logger.error` nowhere, though the listener sees both flags on
    between the redo's two patches.
14. `components/reader/peek/use-set-lead.test.tsx`: the peek's set
    passes the branch its host gives it, and a refusal still toasts its
    copy.

**Delete.**

15. `lib/actions/row-delete/delete-entity.test.ts`: deleting the lead
    commits, and the undo restores the row with `is_lead = 1`.
16. `components/world/delete-copy.test.ts`: `entityDeleteCopy` for a
    flagged row carries the needs-a-lead line when the story needs one
    and the no-lead line when it doesn't, and an unflagged row carries
    neither; `deleteDisabledReason` returns `undefined` for the lead
    while the gate is open.
17. `components/world/detail/entity-detail-pane.stories.tsx`:
    `LeadCannotBeDeleted` is replaced by a story whose lead's
    `Delete entity` is enabled and calls `onDelete`.

**The merge.** The refusal of a flagged loser and the group free of the
flag are day one; the stamp's reach and the dialog wait on R4's design
pass.

18. `lib/actions/world/resolve-collision.test.ts`: with the delete
    handler no longer refusing the lead, a merge whose losing row is
    flagged refuses with `lead-entity` and writes nothing, no delta and
    no row change; a merge whose surviving row is the lead commits, and
    the lead's row is still the branch's only flagged row.
19. The same file: a merge whose losing row is unflagged but named by a
    stamp on one entry of the branch, a former lead, refuses with
    `lead-entity` and writes nothing; the same row named only by a stamp
    on another branch doesn't refuse. The stamp read's own test, beside
    it, finds a stamp on its branch and none on another.
20. `lib/world/entity-merge.test.ts`: with the canonical flagged, and
    with neither row flagged, the group writes no `isLead`.
21. `components/world/use-collision-resolve.test.tsx`: a pair with one
    held row, flagged or stamp-named, opens with that row as the fixed
    surviving row, whichever is older; a pair with both rows held opens
    with Merge unavailable and Rename and Keep as distinct offered; a
    pair with neither opens on the older row, changeable; the
    `leadEntity` refusal still maps to its reworded copy.
22. `components/compounds/collision-resolve-dialog.stories.tsx`: a story
    with one held row, the newer, shows it as the surviving row, the
    picker unable to change it and the line saying why, and Merge
    resolves with it as canonical; a story with both rows held shows
    Merge unavailable with its line; the existing stories keep the free
    picker.

**Reads.**

23. `lib/world/lead.test.ts`: `resolveLead` returns the flagged
    character, `null` with none and `null` with two; the render-path read
    of a double calls `logger.error` nowhere, and the logging read calls
    it once per read.
24. The DB read's test, beside it: it returns the named branch's flagged
    character, `null` with none, and `null` with two, logging an error;
    it never returns another branch's row with the same id.
25. The needs-a-lead predicate's test: adventure in any narration and
    creative in first or second person need a lead; creative third
    doesn't.

**The stamp.**

26. `lib/actions/turns/submit-turn.test.ts`: the `user_action`'s
    `metadata.leadId` is the branch's flagged id, and absent on a creative
    third-person branch with none.
27. `lib/pipeline/definitions/per-turn.test.ts`: the reply carries
    `leadId`, also when the fallback classifier folds.
28. `lib/actions/turns/regenerate-turn.test.ts`: the regenerated reply
    carries `leadId`, the branch's lead after the sweep, and the
    `user_action` keeps its stamp.
29. `lib/actions/stories/create-story.test.ts`: the lead's cast row is
    inserted with `is_lead = 1` and every other cast row with 0, and the
    opening's `leadId` names it; with no lead, no row is flagged and the
    opening has no stamp; a lead that isn't a cast character throws
    before any write. `components/wizard/finish.test.ts`: Finish passes
    its active lead.

**The refused turn.**

30. `lib/actions/turns/submit-turn.test.ts`: on an adventure branch with
    no flagged character, `submitTurn` returns `outcome: 'rejected'` with
    the lead code and `converged: true`, and writes no `story_entries`
    row, delta or `pipeline_runs` row; with a pass owed, the pass doesn't
    start.
31. `lib/actions/turns/regenerate-turn.test.ts`: on such a branch,
    `regenerateTurn` refuses with the lead code, and the reply, its
    deltas and the redo stack are as before.
32. `components/reader/composer.stories.tsx`: with the lead missing and
    modes hidden, the reason line shows and a Send press leaves the draft
    in place; in adventure the picker is disabled on `Free`; while a turn
    generates, the line stays; a whole-composer disable reason wins.

**Undo and History.**

33. `lib/undo/describe.test.ts`: a user group setting Mira and clearing
    Kael describes as the lead set naming Mira; a group clearing only
    describes as the unset naming the cleared row; a merge group and a
    delete group keep their existing rows; a redo snapshot of a set
    describes as the set.
34. `components/reader/undo-copy.test.ts`: both lead kinds render the
    menu label, the confirm title and the notice through `t()`.

**Seeds.**

35. `lib/db/devtools/seed-dataset.test.ts`, read from a seeded database
    (the test database the file seeds at `:237`), not from the static
    steps: `br_hero_main` has exactly one flagged row,
    Kael, and the filler story's branch one, Sable; every
    `user_action`, `ai_reply` and `opening` on both carries its lead's
    id; no seeded definition holds `leadEntityId`.
36. `scripts/dataset-chapter/treasure-island.seed.test.ts`, a new case
    on the loaded story: the dataset branch has exactly one row with
    `is_lead = 1`, the one the file's old `leadEntityId` named
    (`char_25b8a728-…`); every `user_action`, `ai_reply` and `opening` on
    it has `metadata.leadId` equal to that row's id; the stored
    definition holds no `leadEntityId`. `scripts/seed/dataset-story.test.ts`
    passes.
37. `scripts/classifier-eval/windows.test.ts`: in every window that
    names a lead, that lead's row has `isLead` 1 and every `user_action`
    and `ai_reply` carries `metadata.leadId` naming it; a window with no
    lead has no flag and no stamp.
38. `e2e/tests/periodic-classifier.spec.ts`, after its
    `seedClassifierBacklog` setup: a read of the seeded database finds
    every filler reply on `br_hero_main` stamped with Kael's id.

**Order-free meets.** Each holds only if the other slice has landed;
whichever of the pair lands second meets it.

39. If 6.1 has landed: this slice's generated steps are regenerated
    from main's snapshot and follow 6.1's in
    `lib/db/migrations/meta/_journal.json`, its hand-written step is
    renumbered to sit between its two generated ones, `migrations.js`
    keys all three,
    `pnpm db:check` passes and `pnpm db:generate` writes nothing new;
    the migration criteria above pass from the step before 6.8's first.
40. If 6.2 has landed: the three lead lines 6.2 swapped
    (`generation-context.ts:496`, `periodic-classifier.ts:204-205`,
    `app/reader-composer/[branchId].tsx:356-358`) read the branch's rows
    through 6.2's read under this slice's rewrite, and `pnpm typecheck`
    passes with 6.2's branch-taking reads on every file this slice
    touches.
41. If 6.3 has landed: `lib/actions/stories/fork-equivalence.test.ts`
    holds a fixture with a lead switch after the fork entry, made by
    this slice's set, in which the child's lead is the parent's as of
    the fork entry and the child equals the reference; it is shown red
    by a mutation restored by `cp`. On a database `pnpm db:seed`
    writes, `br_hero_fork`'s only flagged row is Kael's, and every
    `user_action`, `ai_reply` and `opening` on it, the turns the seed
    appends included, carries Kael's id.
42. If 6.7 has landed: `lib/history/diff-prose.test.ts` has an `isLead`
    case, setting and clearing, through this slice's label.
43. If 6.10 has landed: `lib/actions/entities/register.test.ts` holds
    6.10's `createEntity` and `deleteEntity` pairs, run again over the
    bodies this slice changed, each still red when any one branch
    condition 6.10's table lists for its handler is removed alone (a
    mutation restored by `cp`), with this
    slice's `isLead` pair beside them in the same `branch scope` block,
    red the same way.

**End to end** (`e2e/tests/per-branch-lead.spec.ts`, new, on the seeded
hero story's main branch with the mock LLM; DB assertions first, then
role and name through the app's i18n keys):

44. World's `Set as lead` on Mira: in the DB, Mira's `is_lead` is 1,
    Kael's 0, and both deltas share one `action_id`. The reader's Undo
    opens the confirm titled by the lead row's string; after Undo, Kael
    is flagged and Mira not.
45. Deleting Kael from World: the confirm shows the needs-a-lead line;
    after it, the branch has no flagged row.
46. In the reader, a typed draft and Send: no `user_action` row is
    added, the seeded `system` tail row is still there, the composer
    still holds the draft, and the reason line shows. The last reply's
    regenerate, pressed or disabled per open question 2, leaves that
    reply's row and the `system` row in place.
47. `Set as lead` on Mira again, then Send: the new `user_action` and its
    `ai_reply` both carry `metadata.leadId` equal to Mira's id.
48. In a launch of its own, after R4's design pass: with the newer (by
    `created_at`) Brannoc row of the seeded collision pair flagged as the
    lead before launch, and Kael unflagged, resolving the pair by Merge
    without touching the picker leaves the newer row, still flagged, and
    removes the older. The stamped and both-held cases are proven in
    unit tests and stories above.
49. `e2e/tests/world.spec.ts`, `e2e/tests/peek-drawer.spec.ts`,
    `e2e/tests/wizard-cast.spec.ts` (the committed lead's cast row has
    `is_lead = 1`, the staged character 0) and
    `e2e/tests/world-delete-undo.spec.ts` (the lead's `Delete entity` is
    enabled) pass; `grep -rn '\$.leadEntityId' e2e` finds nothing.

**Hygiene.**

50. `pnpm lint`, `pnpm format:check`, `pnpm compiler:check`,
    `pnpm typecheck`, `pnpm lint:docs` and `pnpm test:run` (the unit and
    storybook projects) pass. Every new chrome string routes through
    `t()`. The forward pointers listed above are gone.

## Tests

- **Unit (vitest, `--project unit`).** The migration on a populated
  database both ways; the register's handlers and the `isLead` pair; set
  and unset with undo, redo and a rollback, and a redo that logs
  nothing; the lead's delete; the merge's refusal for a flagged and a
  stamped loser, its group free of the flag, and the stamp read; the
  dialog hook's fixed and blocked sides; `resolveLead` and where it
  logs, the DB read and the predicate; the stamp on every entry kind,
  the fold included; both refusals with nothing written; the describe
  step and its copy; the seeds, the dataset seed and the eval fixture;
  the order-free meets, each once its pair has landed. Each new
  assertion is mutation-checked: green is not covered in this repo, and
  an expectation is never derived from the constant under test.
- **Component (Storybook).** The composer's lead-missing states, updated
  in `components/reader/composer.stories.tsx`; the resolve dialog's
  fixed surviving row and its blocked Merge, new stories in
  `components/compounds/collision-resolve-dialog.stories.tsx`; and
  `LeadCannotBeDeleted` flipped in
  `components/world/detail/entity-detail-pane.stories.tsx`. No new
  compound; two inventory rows change.
- **E2E (desktop).** One new spec for the milestone's lead line: set and
  its undo, deleting the lead with its line, the refused Send with the
  draft and the tail kept, the stamps on the next turn, and a merge that
  keeps the lead's row. Four existing specs updated, and the backlog
  spec's seeded fillers checked for their stamp.
- **Device (optional, never blocking).** On a slot AVD, a dev build with
  a pre-6.8 database updated to this slice's build: the migration runs
  inside the native wrapper and the hero story opens.

## Open questions

1. **What the migration leaves open.** C10 pins the stamp.
   Confirm these defaults at planning, and record the answers in
   Implementation notes:
   - A branch where the stored id names no character gets no flag, and
     its entries no stamp, since it has no lead to stamp. If the story
     needs a lead, that branch refuses turns until the user sets one,
     which is canon's behavior, though a pre-M6 turn there ran.
   - The step removes `$.leadEntityId` from every definition, drafts
     included. Story open would strip it anyway; removing it keeps
     dumps and exports free of a field canon no longer has. A draft's
     lead lives in its wizard working state.
2. **The refused turn's details.**
   - The order: the defaults refuse before the owed pass or close and
     before the regenerate's sweep, so nothing runs and nothing is
     destroyed.
   - How `↻`, a failed turn's Retry and Save & regenerate show the
     refusal: disabled with the lead reason, like the edit gate's
     controls, or a toast on press. Canon names only the composer's
     reason line.
   - What the reader does when the action-level backstop fires after
     its own gate passed (a race): put the draft back and write no
     failure entry, or a toast.
   - A regenerate's sweep can change the lead: a lead change made after
     the reply is a World edit the sweep reverses. A branch with no lead
     before the sweep may have one after, and the reverse. The default
     checks before the sweep, and the run takes whatever lead the sweep
     leaves, which can be none on a branch that needs one. Canon doesn't
     say which side of the sweep "has none" is judged on.
3. **Where "no machine writer" is enforced.** The handler
   checks above are the floor. Whether `entityWriteSchema` also omits
   `isLead`, so a create's parse can't carry it, is planning's.
4. **The width.** About 107 `Entity` literals: edit each, or
   give the test fixtures a shared row factory first.
5. **Smaller points.**
   - The History label's wording for `isLead`: canon gives none.
   - How a lead read says whether it is on the render path: an option
     or two functions.
   - Whether unset refuses when the story needs a lead. Canon says only
     that it is offered then; its one caller is M7.2's.
   - Which of `lib/db` and `lib/world` holds the DB read and the
     predicate (C10 allows either).
   - The fixed surviving row's and the blocked Merge's wording, if R4's
     design pass leaves them.
   - The stamp read scans a branch's entries with no index, once when
     the dialog opens a pair and once per merge. Unmeasured on a long
     story; an expression index is the remedy if it shows.
6. **Two sets at once.** A set reads the branch's flagged rows before
   its group commits. Two sets committing between each other's read and
   commit leave two flagged rows, which canon reads as no lead and the
   next set repairs. The peek guards a second press; World's menu closes
   on press. Check at planning whether any path reaches it.
7. **Pre-M6 payloads.** An undo payload or a journal before-image
   written before the migration holds an entity row with no `isLead` or
   an entry with no `leadId`, and restores it so. C10 makes an
   unstamped entry costly: 6.9 would mark every history holding it.
   - Entities: pre-M6 code refused deleting or merging the lead, and
     machine writers never delete a character, so no payload holds the
     lead's row to re-insert. A journal write-back's upsert keeps the
     database flag, since its SET names no `is_lead`
     (`lib/actions/delta/rerun-journal.ts:230-237`), but the same
     restore emits a `create` store patch whose row is the pre-M6
     before-image (`:271-273`), with no `isLead`, and the store replaces
     its row whole (`lib/stores/factory/working-set-store.ts:31`). If
     that journal's plan touched the lead's row, the store then reads
     the lead missing and the reader blocks Send until a reload, though
     the database holds the lead. Either the data step also flags the
     lead's entity rows that journals hold, as it would stamp their
     entry rows below, or this stays a dev-database caveat.
   - Entries: no production code issues a logged `deleteStoryEntry`
     (grep), so no undo payload re-inserts an entry. A re-run journal
     holds every row its reversal plan writes, whole, and its write-back
     upserts it (`rerun-journal.ts:33-47`, `:253-275`). Unverified:
     whether a close's group writes a story entry that a re-run
     reverses. If one does, a journal written before the migration and
     written back after it overwrites that entry's stamp, and the data
     step also stamps the entry rows journals hold. Dev databases only:
     no users until MVP.
8. **Unaudited contract text.** This slice builds on wording the
   milestone lists as unaudited
   ([Open questions](../milestone.md#open-questions)): C10's rule that
   every entry is stamped, R4 and its extension to every stamped
   character, and C10's rule for where the two-flags error is logged.
   Read them against the code at slice planning.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
