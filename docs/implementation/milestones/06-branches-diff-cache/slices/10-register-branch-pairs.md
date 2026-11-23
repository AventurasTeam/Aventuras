# Slice 6.10 — Register two-branch pairs

## Metadata

- **Milestone:** [Milestone 6 — Branches + diff cache](../milestone.md)
- **Depends on:** [Slice 6.2](./02-scoped-reads-redo.md). The pairs go
  in the register suites whose store reads 6.2 migrates to the branch
  reads, so this slice starts once 6.2 has landed.
- **Blocks:** none. Nothing waits on it, which is why it split from
  6.2 at that slice's planning: 6.4's landing waits on 6.2.
- **Order-free meets:** with [Slice 6.8](./08-per-branch-lead.md) (its
  `isLead` pair, C10). If 6.8 lands first, this slice keeps the pair;
  if this slice lands first, 6.8 re-runs the `createEntity` and
  `deleteEntity` pairs, whose bodies it changes. The criterion here is
  written as "if the other has landed".
- **Contracts:** provides the register half of
  [C5](../milestone.md#c5--branch-scoped-store-reads); follows
  [C10](../milestone.md#c10--the-leads-surface) for the `isLead` pair
  and [C11](../milestone.md#c11--shared-files).

## Goal

Every registered action handler proves its branch condition against a
second branch holding the same ids. This delivers a two-branch pair for
each of the 55 registered handlers, a further case for each branch
condition a pair can't reach, the chapter delete's branch reads against
a sibling, and a table in the PR body that names, for each handler and
branch condition, the test that fails without it.

## Background

Once a fork or a duplicate copies rows, one id names a row on each
branch, and every handler that reads or writes a branch-scoped row has
to say which one it means
([`data-model.md → Branch model`](../../../../data-model.md#branch-model),
the composite-key paragraph). Each handler is hand-written, with its
own payload check and branch conditions, and the registry descriptor's
`branchCol` scopes the reversal's, liveness's and the journal's reads.
A missing condition fails nothing until a second branch holds the same
id. `lib/actions/story-entries/register.test.ts` already holds the
shape every suite follows: a `branch scope` block over a second branch.

## Required reading

- [`data-model.md → Branch model`](../../../../data-model.md#branch-model),
  the paragraph on composite primary keys
- [`generation-pipeline.md → Reverse-replay`](../../../../generation-pipeline.md#reverse-replay),
  the reversal each pair's second half runs
- [`testing.md → Coverage: thorough, not exhaustive`](../../../../testing.md#coverage-thorough-not-exhaustive)
- [`milestone.md → C5`](../milestone.md#c5--branch-scoped-store-reads),
  whose register half this slice provides;
  [`C10`](../milestone.md#c10--the-leads-surface) for the `isLead`
  pair; [`C11`](../milestone.md#c11--shared-files); and the
  [dependency graph](../milestone.md#dependency-graph)
- [Slice 6.2](./02-scoped-reads-redo.md)'s Implementation notes: the
  store reads these suites now use
- `lib/actions/story-entries/register.test.ts:224-300`, the shape;
  `lib/db/__tests__/two-branch.ts` (6.1), the copy fixture

## Scope: in

**Register two-branch tests (C5).** All 55 registered handlers: the 39
the 12 register files define, and the 16 the entities register takes
from `lib/actions/entities/state-patch-actions.ts:273-852`
(`lib/actions/entities/register.ts:409-429`). Thirteen suites carry
them:

- the nine `lib/actions/<domain>/register.test.ts` suites, for
  `chapters`, `entities` (its own three handlers), `entry-assets`,
  `era-flips`, `lore`, `relationships`, `story-entries`, `threads` and
  `translations`;
- `register-happenings`, `register-involvements` and
  `register-awareness`, under `lib/actions/happenings/`;
- `lib/actions/entities/state-patch-actions.test.ts`, for the 16
  state-patch handlers: `updateEntityVisualState`,
  `updateEntityInventory`, `updateEntityStackables`,
  `updateItemPosition`, `updateEntityCondition`,
  `updateEntityLocationTracking`, `promoteStagedEntity`,
  `appendEntityKeywords`, `setEntityKeywords`, `retireEntity`,
  `setCharacterFaction`, `placeLocation`, `renameEntity`,
  `raiseCollisionFlag`, `setFactionStanding` and
  `returnFromRetirement`. Their fixtures already live there.

Each suite gains or extends a `branch scope` block in the shape of
`lib/actions/story-entries/register.test.ts:224-300`. The entry-assets
suite asserts the database alone: 6.2 removed its store mirror.

- **The fixture.** A hand-seeded second `branches` row, with rows under
  the same ids as the first branch's. The two rows of an id differ in
  every column the handler reads or writes, so a read from the wrong
  row shows in the result, not only a write to it. No deltas are
  seeded on it: until 6.1's composite key lands, a delta id can't
  repeat. 6.1 has landed since this was written, which reopens the
  choice ([Open questions](#open-questions)).
- **The pair.** Per handler: its write on one branch lands on that
  branch's row as computed from that row, and leaves the other
  branch's same-id row unchanged; and that write's reversal
  (`reverseReplayDeltas`, as the story-entries block does) restores its
  own branch's row and leaves the other's. A delete with a cascade
  (`entityCascade`, `happeningCascade`) has a captured child on both
  branches, and only its own branch's child goes and comes back.
- **The proof.** Each branch condition the handler holds, removed
  alone, turns a test red: the payload's branch check, each read's and
  each write's `eq(<table>.branchId, …)`, the reads it makes through a
  helper, the registry descriptor's `branchCol` and the cascade's
  branch. `placeLocationHandler` alone reads by branch in its payload
  check, `loadCurrent` twice, `branchPlaces`, `loadStoryPlace` and
  `userWroteSinceProse` (`state-patch-actions.ts:583-624`), so one pair
  won't reach them all. Where the pair can't reach one (a create's
  payload check), a further case does, new or already in the suite. A
  pair that is red against shipped code is a handler bug, fixed in this
  slice and noted in Implementation notes.
- **Existing coverage counts where it already fails.**
  `register-awareness.test.ts:613-639` covers the bump's write; the
  mutation check says what else it covers.
- **The chapter delete's reads.** `resolveChapterDeleteSet`'s chapter
  read and latest read (`lib/actions/chapters/chapter-delete-set.ts:62-75`),
  `ownEntryTokens`' sum (`chapter-delete-preview.ts:57-73`) and the
  preview's `pendingClose.has(branchId)` (`:50`), each with a same-id
  sibling or a sibling's pending close, beside the one lore case
  `chapter-delete-preview.test.ts:246-270` already has.
- At the final rebase, a handler another slice changed since the base
  gets its pair re-checked. If [Slice 6.8](./08-per-branch-lead.md)
  landed first, its `isLead` pair (C10) stays in the entities block.

## Scope: out

- The store accessor, the sweep, the signature guard and the move of
  these suites' store reads onto the branch reads:
  [Slice 6.2](./02-scoped-reads-redo.md).
- The `isLead` flag, its handler and its pair:
  [Slice 6.8](./08-per-branch-lead.md). This slice keeps the pair at
  its final rebase if 6.8 has landed.
- The composite `deltas` key, the scoped delta writes and the copy
  fixture: [Slice 6.1](./01-copy-substrate.md), landed.

## Acceptance criteria

- Every one of the 55 registered handlers has its pair, against a
  second branch holding the same ids: the 39 in the 12 register suites,
  and the 16 state-patch handlers in
  `lib/actions/entities/state-patch-actions.test.ts`, each in a
  `branch scope` block.
- The PR body carries a table with one row per handler and branch
  condition: the handler, the condition removed alone, and the test
  that turned red. Every row names a red test, and every one of the 55
  handlers has at least one row.
- `lib/actions/chapters/chapter-delete-preview.test.ts`: on branch A,
  with branch B holding a chapter under the same id, a later chapter
  and the same entries under their ids, the preview's
  `chapterNumber`, its latest check and its `after` read A's rows; a
  pending close on B alone leaves A's `after` reading as no manual
  close. Removing each of the four branch conditions turns a case red.
- If [Slice 6.8](./08-per-branch-lead.md) has landed: the entities
  `branch scope` block keeps 6.8's `isLead` pair, red with its branch
  condition removed.
- `pnpm lint`, `pnpm typecheck`, `pnpm lint:docs`, `pnpm format:check`
  and `pnpm test:run` pass.

## Tests

- **Unit, `--project unit`.** The 13 suites that carry the pairs, and
  `chapter-delete-preview.test.ts`. No store, Storybook or E2E change.
- **Mutation check.** The pairs are this slice's main risk of passing
  vacuously, since one handler can hold several branch conditions and
  a pair can catch only some. Remove each condition alone, as the PR
  body's table records. Copy a file aside and restore it with `cp`;
  never `git stash`. Never derive an expectation from the code under
  test.

## Open questions

- **Register coverage.** 55 handlers in 13 suites. The 16 state-patch
  handlers carry the most branch conditions, several through helpers,
  and a pair per handler won't reach them all; the table in the PR
  body is the measure, not the pair count.
- **The fixture now that 6.1 has landed.** "No deltas on the second
  branch" rested on delta ids that couldn't repeat; 6.1's composite
  key lets them, and it shipped `lib/db/__tests__/two-branch.ts`
  (`cloneBranch`, `seedCopyFixture`). Open: whether the fixture builds
  on `cloneBranch`, and whether it seeds same-id deltas on the second
  branch. `reverseReplayDeltas(actionId)` reads by action id alone, so
  a pair whose action id repeats on the second branch would trip
  `selectReversalSet`'s refusal of a set that spans branches. Default:
  hand-seeded rows and no deltas on the second branch, as the
  story-entries block has.
- **Size.** Not estimated on its own. Planning sizes it against the
  conventions' line: above about 20 plan tasks, it splits by suite
  group or records why it can't.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
