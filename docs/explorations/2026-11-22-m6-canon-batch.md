# M6 canon batch: R1–R4

Four rulings made at M6's promotion (2026-11-22) are approved and not
yet in canon. This pass writes them in, per the canon lists in
[the milestone's Open questions](../implementation/milestones/06-branches-diff-cache/milestone.md#open-questions).
Nothing here reopens a ruling; what's open is the wording, and the few
points where a ruling leaves canon a choice. Each section lists where
the text lands and what it says.

## R1 — Unrecovered runs against copies and deletes

**The rule.** `pipeline_runs` gains `branch_id`, written at `beginRun`.
Boot recovery reads an orphan's group, journal and chapter on its
branch, and by the id alone for a marker with none. Story duplicate
refuses a branch with an unfinished run. Fork refuses only when a
delta of an unfinished run would survive into the copy, or its journal
would, judged against the plan's prune set; this replaces the blanket
`classifier_status.state !== 'running'` refusal and keeps the
recovery-failure policy's escape (a branch from an entry before the
orphan). Branch delete removes the branch's run rows, finished ones
too, and its hold.

**Choices this pass makes.**

- _Which rows a delete removes._ "Every run row that names the
  branch." Rows written before the column existed name none and stay
  until their story's delete. Nothing reads a finished row, and boot
  settles an unfinished one before any delete can run
  ([6.6's open question](../implementation/milestones/06-branches-diff-cache/slices/06-delete-duplicate.md#open-questions)).
- _Duplicate keeps both conditions._ A copied branch with an unfinished
  run, or with `classifier_status.state` `'running'`, refuses. 6.6
  builds both (`unfinished-run`, `branch-held`) behind one line of copy.
- _The invariant._ With both copies refusing to carry an unfinished
  run, a live or orphaned run's deltas and journal sit on its own branch
  only. Recovery scopes by branch anyway: a re-run's chapter id repeats
  on every copy of its branch, so the chapter read needs the branch even
  when the deltas don't.
- _The fork refusal moves into the plan step._ It reads the plan, so it
  can't sit among the pre-conditions "refused before any write". It
  joins step 1 beside the `ReversalIntegrityError` abort, and the
  pre-conditions lose the `'running'` bullet.
- _What "carry" means, on the child's final state._ For each
  `pipeline_runs` row on the parent with `finished_at` NULL, the fork
  refuses when any of three holds:
  1. a delta survives into the copy under the run's `action_id` (every
     one does when `B` doesn't exist). A re-owned create doesn't count:
     it changes hands on the child exactly as recovery would leave it on
     the parent;
  2. the run's journal survives;
  3. the run is a close's re-run whose reversal committed
     (`rerun_chapter_id` set) and the plan keeps its chapter. With no
     delta of its own and its journal dropped (case 4), conditions 1
     and 2 both pass, yet the child would hold the chapter with its
     earlier close half undone and nothing to restore it. This tightens
     R1's wording; the developer approved it on 2026-11-22, and the
     exception for re-owned creates in condition 1 too.
- _The reason, restated for every kind._ `pipeline_runs` doesn't copy,
  so carried writes would have no marker on the child. The blanket rule
  caught only a pass, the one kind that leaves `'running'`. Per-turn,
  close, re-run, refresh and unwound orphans passed it unchecked, so R1
  is wider in kinds as well as narrower in fork points.
- _The escape, per kind._ "An entry before the orphan" means before the
  earliest entry its writes anchor on: the user's action for a turn,
  the window's first entry for a pass, the chapter's end entry for a
  close or its re-run, the refreshed entry for a suggestion refresh. An
  orphan anchored on the opening has no escape, since every fork keeps
  the opening: a branch's first pass, or a refresh of the opening's
  chips.
- _A held branch._ A re-run's failed abort always leaves an open
  marker, so `heldBranches` needs no rule of its own: the same test
  applies. Fork writes nothing to the parent, so the hold's reason
  doesn't reach it.

**Where it lands.**

- `generation-pipeline.md → Invariants`, the `actionId` bullet: the
  orphan's id names one branch because the copies refuse to carry it;
  reverse-replay of a run reads on the run's branch, by the id alone
  only for a marker with none.
- `→ Crash recovery via pipeline_runs`: `branch_id` in the DDL and in
  `beginRun`'s bullet; kept rows go with their branch's or story's
  delete.
- `→ Startup recovery pass`: the contract passes `orphan.branch_id`.
- `→ Reverse-replay`, the `reverseRunGroup` paragraph: it reads the
  group, the journal and the chapter on the branch it's given.
- `→ Recovery-failure policy`: the escape names fork's refusal.
- `→ Multi-run txState`: a story or a branch delete drops all four of a
  branch's records; `heldBranches` is cleared by those deletes and a
  restart.
- `data-model.md → Branch model`: the pre-condition; the manifest's
  `pipeline_runs` row (Not copied ×2) and the `probe_captures` row's
  "only" claim; Deleting a branch (run rows in the set, a refusal under
  the gate, four records, both kinds of held branch deletable).
- `data-model.md → Story deletion`: `pipeline_runs` joins the
  per-branch list; rows with no branch go by story.
- `data-model.md → Story duplicate`: the refusal names an unfinished
  run beside the `'running'` status.
- `memory/probe.md → Schema`: "the only branch-scoped table a fork
  skips" becomes one of two.
- `memory/chapter-close.md → Re-running a close`: fork's pre-conditions
  in the re-run-on-new-branch path.
- `story-list.md → Duplicate a story`: the Refused line names an
  interrupted update the app hasn't recovered.
- `code-conventions.md → Syncing a store after a write`: `delete-branch.ts`
  joins `dropBranchRecords`' owners, and the paragraph says what it drops.
- `parked.md → A delta whose target table left the registry…`: "fork
  refuses a held branch" becomes "no fork leaves it behind". A fork
  that would carry the orphan refuses. A fork from before it has to
  reverse the orphan's deltas on the copy, and the planner resolves
  each delta's table the same way (`reverse-replay.ts:483-485`), so it
  throws too.

## R2 — How a branch switch works

**The rule.** A switch is one action: the navigator pauses its rows
while the gate is closed (any run, a suggestion refresh included, a
pending turn, a reversal), and the action refuses then as the backstop.
It writes `stories.current_branch_id`, loads the branch, and replaces
the whole in-story stack with a fresh reader on it, so Back lands on the
Story List and the composer's draft doesn't carry. A switch and a fork
hold the reader's gated controls and its ways out from their start to
the navigation. A load that fails, or a switch whose reader lost focus
or unmounted before it published, puts the pointer back. A switch isn't
a story open. A branch held until a restart pauses nothing. Fork writes
the pointer in its own transaction.

**Choices this pass makes.**

- Pending, refused and failed states of a switch, and their toasts,
  stay with 6.4, which owns those surfaces. This pass writes only the
  semantics they rest on.
- `During generation` keeps its heading (data-model links its anchor)
  and its banner copy for every gate, 6.4's default.
- The line that generation depends on `stories.current_branch_id` goes.
  Runs keep the branch they started on. What the pause protects is the
  reader a run streams into and is cancelled from, and a turn starting
  on the old branch while the new one publishes.
- `principles.md → What's gated` already lists the switch. It gains
  branch delete, which R1's refusal under the gate makes a gated
  operation.

**Where it lands.**

- `branch-navigator.md → Per-row anatomy`: the row press.
- `→ During generation`: the trigger, the held-branch line, the
  rationale.
- `→ After confirm`: one transaction with the pointer, then the fresh
  reader and the hold.
- `reader-composer.md → Loaded-set model`, Branch switch: a fresh
  reader, Back to the list, the draft dropped.
- `→ Edge cases`, Branch switch with chips in flight: a switch waits for
  the refresh; the unmount abort stays as a backstop.
- `→ Custody of the turn's text`: "one composer serves every branch"
  goes; the draft-limit line adds a branch switch.
- `memory/chapter-close.md → Re-running a close`: the pointer moves in
  the fork's transaction.
- `principles.md → What's gated`: branch delete.

## R3 — Diff-cache eviction

**The rule.** A reversal, a redo and a journal write-back each evict
every cache entry of their branch, not only the rows they touched,
through a post-commit hook `lib/actions` owns and the cache registers
with; the delta layer never imports the cache. The hook fires after the
commit and before the store sync, so a transaction that rolls back
evicts nothing. A fork, a duplicate and a branch delete evict nothing.

**Choices this pass makes.** The in-flight walk an eviction overtakes,
the module path, the remembered failure and the gone outcome are 6.7's
own canon edits; this pass leaves them.

**Where it lands.** `architecture.md → Cache shape and lifecycle` (what
clears the cache) and `→ Concurrency, rollback, error path` (the three
invalidating writes, the hook, what evicts nothing).

## R4 — The lead survives a merge it is in

**The rule.** A row is _held_ when it carries the lead flag or an entry
on the branch is stamped with its id. A merge never removes a held row.
The collision dialog fixes the surviving row to it; the action refuses a
held losing row as the backstop (`lead-entity`); a pair of two held rows
can't merge, and the user renames one or keeps them distinct. No merge
moves the flag, so three logged writes touch it. A stamp names a missing
row only after a delete.

**Copy.** One line under a fixed picker:
`<name> is or was this branch's lead, so this row stays.` With both rows
held, `Merge into one` is unavailable and the merge body reads:
`Both have been this branch's lead, so they can't merge. Rename one or
keep them distinct.`

**Where it lands.**

- `data-model.md → The lead`: three writers; the merge bullet becomes
  the held-row rule; the stamp paragraph's missing row follows a delete
  only.
- `world.md → Merge`: the fixed picker and its line, the two-held case,
  the flag line, and `lead-entity` among the refusals.
- `world.html`: a `held` review control (neither / one / both) on the
  resolve dialog's merge body.
- `principles.md → Mode, lead, and narration` doesn't name the merge;
  no change.

## Adversarial pass

**R2.**

- _The pause's trigger._ The navigator pauses on the gate
  `isUserEditBlocked(txState)` reads with no branch: a hard-gate run, a
  pending turn, a reversal. Every pipeline that runs declares
  `hard-gate`, suggestion refresh included
  (`lib/pipeline/definitions/suggestion-refresh.ts:250`), so "any run"
  is accurate today. Verified in code.
- _Dropped draft._ R2 accepts losing unsent composer text with no
  prompt. The inline-edit draft stays guarded; only the composer's goes.
  Canon now says so in two places, so it can't read as a bug later.
- _The custody line._ "One composer serves every branch" was the reason
  a left branch drops a handed-back text. The drop stays, and the code
  logs it (`reader.handback_skipped_left_branch`,
  `components/reader/system-entry-actions.tsx:90`); only the reason
  changes. Verified.
- _The close banner._ Principles already ends the done state on
  "another branch opening", so R2's drop of the held close result needs
  no canon line. Verified.
- _A switch isn't an open._ The upgrade prompt is "one app-level mount
  keyed on the open story" (`memory/retrieval.md`), so a switch inside
  the story doesn't refire it. The row-press text says so.
- _Assumed, not verified:_ that `replace` to the same route pattern
  mounts a fresh reader on both platforms. Canon says "a fresh reader";
  6.4's first task checks the mechanism, and the keyed body covers
  either answer.

**R3.**

- _Fork's rewind rewrites prior values on the child._ The child's
  branch id is new, so no entry exists to go stale. Holds.
- _A redo's effect._ Redo restores the survivors' original prior
  values (6.7's walk test pins it), so it invalidates as a reversal
  does. Holds.
- _Store sync throws after the commit._ The hook fires first, so the
  cache is already clean; a rolled-back transaction evicts nothing.
- _A merge or any forward write._ A merge's delete payload equals the
  row the walk would have seeded from, so cached entries on it stay
  correct. "A forward write never changes an earlier delta's old and
  new" holds.
- _Left to 6.7:_ a walk in flight when an eviction lands. R3 names it
  as 6.7's question, and 6.7's doc pins an in-flight guard with its own
  canon edit.

**R4.**

- _Rollback frees a row._ Rolling back the entries that stamped a row
  removes the stamps, so the row is no longer held. Intended.
- _Redo after a merge._ A merge is a user group, which clears the redo
  stack, so a redo can't restore a stamp naming a merged-away row. The
  one gap is 6.8's: a redo landing between the dialog's stamp read and
  the merge's dispatch.
- _The refusal's current copy._ `world.json`'s `leadEntity` string
  suggests "use Set as lead on another character first", which no
  longer frees a stamped row. It's 6.8's to reword, but the canon line
  must not repeat that advice. It doesn't.
- _Across branches._ Entities and stamps are both per branch, so a
  stamp on a sibling never holds a row here. A fork copies stamps with
  their entries, so a copy's rows are held on the copy too. Intended.

**R1.** A background check read the rule against `lib/actions/delta`,
`lib/pipeline/runtime` and canon at `726f09de0`.

- _The planner can plan over an orphan._ Nothing in `resolveSweep`,
  `selectReversalSet` or `buildReverseAndPrunePlan` reads
  `pipeline_runs` or `classifier_status`, and no integrity refusal is
  orphan-specific. A crash leaves a prefix of whole deltas, since each
  delta or close group commits in its own transaction, which is the
  same input recovery already reverses. Verified.
- _Carry is decidable._ The plan exposes `prunedDeltas`,
  `reownedDeltas` and `droppedJournals` (`reverse-replay.ts:99-108`).
  Verified.
- _The re-run hole_ (condition 3 above). It needs a manual close that
  ended before open-region turns, an in-place re-run that crashed after
  its reversal committed, a boot recovery that then failed, and a fork
  between the chapter's end and the open tail. Rare, but the child it
  leaves can't be repaired. Verified in code; not run.
- _Re-owned creates_ (condition 1's exception). `undoCreate` keeps a
  row a later user write kept, whatever the redo mode, and the closure
  doesn't pull that write in, so recovery on the parent re-owns the
  same create. Verified.
- _No escape from an opening-anchored orphan._ A first pass's window
  starts at position 1, and an unattributed fact falls back to the
  window's head; a refresh anchors on the last reply or the opening.
  Verified. Canon has always promised that escape; it now says where it
  ends.
- _A write-back refusal in the fork's plan._ When a user write anchored
  at or below `N` survives, the fork's own plan can refuse as boot
  recovery does. Canon already aborts the fork on
  `ReversalIntegrityError`, so nothing new is needed. Assumed, not
  traced.
- _An orphan's rows inside a finished re-run's journal_ (`recovery.ts:57-58`).
  These can't be found by `action_id`. For an orphan close, its dividers
  stay in the log under its id, so the rule still refuses. An orphan
  pass moved wholly into such a journal escapes recovery on the parent
  as well, so the gap predates M6. Assumed, not traced. Already parked
  as the second shape of
  [Recovery order after an orphan's failure on a re-run's branch](../parked.md#recovery-order-after-an-orphans-failure-on-a-re-runs-branch).
- _Duplicate keeps `'running'`._ A duplicate copies `classifier_status`
  verbatim, so a `'running'` source would hand the copy a hold even with
  no open marker (a status restore that failed after a committed
  reversal). Fork resets the child to idle, so it doesn't need the
  check.

## Integration plan

**Canonical files.**

| File                                                              | Section                                                                           | Ruling |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| `generation-pipeline.md`                                          | Multi-run txState (deferred, heldBranches paragraphs)                             | R1     |
|                                                                   | Crash recovery via `pipeline_runs` (DDL, `beginRun`, kept rows)                   | R1     |
|                                                                   | Startup recovery pass (contract code)                                             | R1     |
|                                                                   | Recovery-failure policy (the escape)                                              | R1     |
|                                                                   | Reverse-replay (`reverseRunGroup` paragraph)                                      | R1     |
|                                                                   | Invariants (`actionId` bullet)                                                    | R1     |
| `data-model.md`                                                   | Branch model (pre-conditions, step 1, manifest rows, Deleting a branch)           | R1     |
|                                                                   | The lead                                                                          | R4     |
|                                                                   | Story deletion                                                                    | R1     |
|                                                                   | Story duplicate (refusals)                                                        | R1     |
| `memory/probe.md`                                                 | Schema (the `probe_captures` note)                                                | R1     |
| `memory/chapter-close.md`                                         | Re-running a close (fork's pre-conditions, the pointer in the fork's transaction) | R1, R2 |
| `code-conventions.md`                                             | Syncing a store after a write                                                     | R1     |
| `parked.md`                                                       | A delta whose target table left the registry…                                     | R1     |
| `architecture.md`                                                 | Cache shape and lifecycle; Concurrency, rollback, error path                      | R3     |
| `ui/principles.md`                                                | Edit restrictions → What's gated                                                  | R2     |
| `ui/screens/story-list/story-list.md`                             | Duplicate a story (Refused)                                                       | R1     |
| `ui/screens/reader-composer/branch-navigator/branch-navigator.md` | Per-row anatomy; During generation; After confirm                                 | R2     |
| `ui/screens/reader-composer/reader-composer.md`                   | Custody of the turn's text; Edge cases; Loaded-set model                          | R2     |
| `ui/screens/world/world.md`                                       | Merge                                                                             | R4     |

**Wireframes.** `world.html`: a `held` review control on the resolve
dialog. With one held row, the picker locks to the newer row with its
line; with both held, `Merge into one` is disabled with its line and the
dialog lands on `Rename one`. `branch-navigator.html` keeps its banner
copy for every gate, so it doesn't change.

**Planning docs.**

- `milestone.md → Open questions`, Canon batch: marked landed, with the
  date and the third re-run condition.
- `03-fork-core.md`: the refusal bullet and criterion 4 gain the
  re-run condition, and the open question on re-owned creates points at
  canon's answer. Only if the developer approves condition 3.

**Renames.** None. Every heading keeps its text, `During generation`'s
included, since `data-model.md` links its anchor.

**Patterns adopted.** None.

**Followups.** None resolved; `followups.md` holds no M6 item. None
introduced: the journal-embedded orphan is already parked.

**Added by the drift pass** (approved 2026-11-22). Old rules the plan
missed:

- `patterns/collision-resolve.md`: the default canonical and Merge's
  submit rule follow R4.
- `reader-composer.md`'s undo-target row: a merge no longer writes the
  lead flag.
- `principles.md`: switching away from a held branch stays open.
- `reader-composer.md`: the held re-run's error toast reads "this branch
  can't be changed". The code string changes with 6.4.
- The two "only a reversal rewrites a prior value" lines, in
  `generation-pipeline.md` and `data-model.md`, say that a redo puts it
  back.
- `data-model.md`: `pipeline_runs` comes off the "above branch scope"
  list.
- `parked.md`: the restore-draft entry names a branch switch.

**Intentional repeated prose.** Three places in the R1 text state that
`pipeline_runs` doesn't copy: the manifest row, Story duplicate's "Not
copied" bullet, and the fork refusal's reason. Each is local context.
The fresh-reader rule also appears twice, on the navigator's row press
and in the reader's Loaded-set model, one from each screen's side.
