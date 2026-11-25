# Slice 6.5 — Fork from the reader

## Metadata

- **Milestone:** [Milestone 6 — Branches + diff cache](../milestone.md)
- **Depends on:** [Slice 6.3](./03-fork-core.md) (`forkBranch`, its typed
  refusals and its current-branch write,
  [C7](../milestone.md#c7--fork)) and
  [Slice 6.4](./04-switching-navigator.md) (the branch read and its store,
  the show-branch tail, the stack-replace helper, the reader keyed on its
  branch, the navigator,
  [C8](../milestone.md#c8--the-branch-list-the-switch-and-the-navigators-row)).
  Through them, [Slice 6.1](./01-copy-substrate.md) and
  [Slice 6.2](./02-scoped-reads-redo.md).
- **Blocks:** none.
- **Contracts:** consumes C7 and C8, and through them
  [C2](../milestone.md#c2--run-records-and-the-copy-refusal),
  [C5](../milestone.md#c5--branch-scoped-store-reads) and
  [C6](../milestone.md#c6--one-redo-stack-per-branch); follows
  [C11](../milestone.md#c11--shared-files) and
  [C12](../milestone.md#c12--canon-and-flips).
- **Gated by C12:** the After-confirm work and the re-run route start
  once the canon pass has landed R2 (fork writes the current branch in
  its own batch) and R1's edit of the re-run path's fork pre-conditions
  in `memory/chapter-close.md`. The rest starts without it.
- **Size:** 13 tasks at planning; the plan held 12. M5's plans held 3 to 7 tasks more than
  their planning estimates.

## Goal

A user forks at an entry and lands on the new branch, and a chapter's
close re-runs on a new branch instead of rolling its later turns back.
This slice delivers the reader's `⎇` wiring on web and across the native
document bridge, the creation modal with its pending, refused and failed
states, and `Re-run on new branch` as a check on the parent, a fork, a
switch and a start on the new branch, with the M5 button flipped on.

## Background

A fork is a copy of the parent rolled back to the fork entry, which
Slice 6.3 builds as `forkBranch`; a switch shows a branch through a fresh
reader, which Slice 6.4 builds. Canon gives two places to create a
branch: the per-entry `⎇` on a reply or the opening, which opens a small
naming modal, and `Re-run on new branch` on the re-run confirm, which
forks where the chapter's later turns begin and re-runs the close there.
`EntryCard` already renders and gates `⎇` once a host passes `onBranch`
(`components/compounds/entry-card.tsx:1133,1398-1406`); the reader passes
none. The re-run path is not M5's button flip: `startCloseRerun` refuses
unless its branch is the open one and compares the confirm's counts with
a fresh read (`lib/actions/chapters/close-rerun.ts:394-408,427-429`), so
its refusals split between the parent before the fork and the new branch
after it, and the confirm unmounts as soon as the switch publishes
(`components/chapters/chapter-overlays-host.tsx:177-182`), so the sequence
runs outside it, as `runCloseRerun` already does for the in-place path.

## Required reading

- [milestone.md → Narrative / overview](../milestone.md#narrative--overview)
- [milestone.md → C7 — Fork](../milestone.md#c7--fork)
- [milestone.md → C8 — The branch list, the switch and the navigator's row](../milestone.md#c8--the-branch-list-the-switch-and-the-navigators-row)
- [milestone.md → C2 — Run records and the copy refusal](../milestone.md#c2--run-records-and-the-copy-refusal)
- [milestone.md → C12 — Canon and flips](../milestone.md#c12--canon-and-flips)
- [data-model.md → Branch model](../../../../data-model.md#branch-model)
- [branch-navigator.md → Branch creation — modal](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#branch-creation--modal),
  including After confirm and Name uniqueness
- [branch-navigator.md → During generation](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#during-generation--switch--delete--create-blocked)
- [reader-composer.md → Per-entry actions](../../../../ui/screens/reader-composer/reader-composer.md#per-entry-actions)
- [entry-card.md → Action cluster](../../../../ui/patterns/entry-card.md#action-cluster)
  and [Divergence notices](../../../../ui/patterns/entry-card.md#divergence-notices)
- [chapter-timeline.md → Re-run a close](../../../../ui/screens/chapter-timeline/chapter-timeline.md#re-run-a-close)
- [chapter-close.md → Re-running a close](../../../../memory/chapter-close.md#re-running-a-close)
- [rollback-confirm.md → Counts](../../../../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md#counts)
  (the counts the check on the parent compares, returning `counts-changed`)
- [generation-pipeline.md → Recovery-failure policy](../../../../generation-pipeline.md#recovery-failure-policy)
  (the escape the unfinished-run line points to: a branch from an earlier
  entry)
- [principles.md → Affordance loci](../../../../ui/principles.md#affordance-loci)
  (the held-until-restart row)
- [overlays.md → Dialog — Busy](../../../../ui/patterns/overlays.md#dialog--busy)
- [layout.md → Modal](../../../../ui/foundations/mobile/layout.md#modal)
- [story-list.md → Duplicate a story](../../../../ui/screens/story-list/story-list.md#duplicate-a-story)
  (the refused-on-open precedent this slice proposes for the modal)
- [The expo-dom bridge keeps neither identity nor rejections → How to apply](../../../lessons-learned/expo-dom-bridge-identity-and-rejections.md#how-to-apply)
- [A portaled overlay keeps rendering over the screen you pushed → How to apply](../../../lessons-learned/portaled-overlay-outlives-screen-focus.md#how-to-apply)
- [code-conventions.md → Forms](../../../../code-conventions.md#forms) and
  [i18n discipline](../../../../code-conventions.md#i18n-discipline)
- [testing.md → Selector strategy](../../../../testing.md#selector-strategy)
  and [Mock LLM](../../../../testing.md#mock-llm) (the re-run flow
  scripts the mock's lanes)
- [milestone.md → Open questions](../milestone.md#open-questions) (the
  contract text no audit rechecked, C7's and C8's among it)

## Scope: in

### `⎇ Branch from this entry`

- **The callback.** `onBranch: (entryId: string) => Promise<void>` joins
  `ReaderSurfaceProps` beside `onCloseChapterHere`
  (`components/reader/reader-document-types.ts:124-126`). `ReaderSurface`'s
  row passes it to `EntryCard` on `ai_reply` and `opening` rows only, as it
  passes `onRegen` (`components/reader/reader-surface.tsx:296-297`).
  `ReaderDocument` spreads the same props, so the native document carries
  it with no edit of its own. `EntryCard`'s render and gate stay as shipped:
  the gate's `disabled` tier, the hold while an inline editor is open, and
  on a branch held until a restart the restart line, since the reader's
  `editBlocked` counts the hold (`app/reader-composer/[branchId].tsx:305`),
  as canon's held-until-restart row asks.
- **The host.** In `app/reader-composer/[branchId].tsx` (C11: 6.5 owns the
  surface's `onBranch` and the modal's mount), best kept in a hook beside
  the route so a unit test reaches it. The callback settles and never
  rejects: it catches, logs and toasts host-side, since a rejection
  crossing the bridge is lost. It returns at once while a dispatch is in
  flight, as `openRollback` does (`:1332`). It reads the entry's position
  through C5's read by branch and id, and opens the modal for that entry.

### The creation modal

- **A new props-only compound**, for example `BranchCreateModal`, in the
  folder 6.4's navigator compounds use. Canon's shape: a `Dialog` on every
  tier, about 360 px; title `New branch` with `×`; the context line
  `Branching from entry <position>.`, the position the rollback confirm
  shows as its entry number (`[branchId].tsx:1370`); a required `Name`
  input, focused on open; `Create` disabled until the name holds a
  non-whitespace character; Enter in the input confirms; `Cancel`, Esc,
  `×` and a click outside cancel and write nothing.
- One input with a submit, so plain `useState`, not `react-hook-form`
  (code-conventions → Forms). The name is stored trimmed, as rename
  stores one (C8).
- **The states canon leaves out** (pending, refused, failed). This
  slice's default, to confirm at planning and then write into canon:
  - **Pending.** From the press of `Create` until the tail's navigation,
    `Create` shows a spinner, the input, `Cancel` and `×` disable, and Esc,
    a click outside and hardware back do nothing. `DialogContent` takes
    `busy`. A second press calls nothing.
  - **Refused.** The modal stays open with the name kept, and a line above
    the buttons says why. A pending embedder swap is known before any
    press, so it shows as the modal opens, with `Create` disabled, as
    Duplicate's refusals do. The rest show at `Create`, one line for each
    refusal C7 lists:

    | `forkBranch` refuses                            | The modal's line                                                                           |
    | ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
    | the gate                                        | the gate's reason line                                                                     |
    | a pending embedder swap                         | the swap's line, also shown on open                                                        |
    | an unfinished run the copy would carry          | new copy: the memory work after this entry never finished, so branch from an earlier entry |
    | the entry missing or `system`                   | new copy: the entry is no longer on the branch                                             |
    | the fork point's next entry has no create delta | the failed line, logged with its code                                                      |
    | a reversal the planner refuses as integrity     | the failed line, logged with its code                                                      |
    | a code this table doesn't list                  | the failed line, logged with its code                                                      |

  - **Failed.** `forkBranch` throws: `Couldn't create the branch.` inline,
    the modal open, the error logged. The fork is one batch, so nothing was
    written.

- **Mounted focus-gated**, as the rollback confirm is
  (`[branchId].tsx:2021-2022`).
- **The hold.** From the press of `Create` to the tail's navigation the
  reader holds its gated controls and its ways out, the Actions menu and
  the settings entry among them, through the hold 6.4 builds for a switch
  (C8): a Send in that window is refused as one during a dispatch is. The
  pending modal sits over the reader for the same span. A refusal or a
  failure before the commit releases the hold with the modal open.
- **After confirm.** In order:
  - `forkBranch` with the route's branch as the parent, the pressed entry,
    the trimmed name and "make current": C7's four-argument action, never
    the core it wraps, which takes a minted id and creation time for the
    seed;
  - on the new id, 6.4's show-branch tail with 6.4's stack-replace helper
    as its navigation, since every switch replaces the whole in-story
    stack (C8), so Back lands on the Story List. The tail never moves the
    pointer back, except when its stack reset doesn't take (D2, under
    Implementation notes), and on a failed load it still navigates, with
    the reader's own load handling the failure;
  - after the navigation, the branch store refresh C8 asks of the fork's
    callers. Its failure is logged and never surfaced: the new reader's
    mount re-reads the list anyway (C8).

  Past the commit this path surfaces nothing of its own: the host's
  catch, which shows `Couldn't create the branch.`, covers only what
  comes before it. No toast. The parent's redo stack stays, since a fork
  clears nothing (C6), and the composer's draft doesn't carry (R2). The
  fresh reader lands at the new branch's bottom, whose last entry is the
  fork entry.

### `Re-run on new branch`

- **The preview.** `CloseRerunPreview.shortcut`
  (`lib/actions/chapters/close-rerun.ts:65-78`) gains the fork point `N`,
  its id and position: the highest-position non-system entry strictly
  before the shortcut's target `B`. One rule covers both of canon's cases,
  a head close, where `N` is the chapter's end entry, and an earlier manual
  close with open-region turns before `B`, where `N` is the last of them.
  The preview also carries the branch's name, read from `branches` inside
  the same shared hold, for the confirm's sentence.
- **The confirm.** `CloseRerunConfirm` gains canon's sentence before the
  rollback warning:
  `Re-run on new branch keeps them on <branch> and branches from entry <N> as "Ch. <seq> re-run".`
  It gains an `onConfirmOnBranch` prop. The fork button is enabled and primary, takes
  the same `blockedReason` and `pending` as `Roll back & re-run`, and fires
  its own handler. The held `ReasonButton` and its `rerunOnBranchLater`
  reason go (`components/chapters/close-rerun-confirm.tsx:125-132`). With
  no turns since, the footer stays `Cancel` and `Re-run close`.
- **The auto-name.** `Ch. <seq> re-run` is an i18n key rendered from the
  preview's chapter number, so the confirm's sentence, the stored name and
  both toasts read one string.
- **The check on the parent.** A read in
  `lib/actions/chapters/close-rerun.ts` that runs every start refusal canon
  puts before the fork, on the parent, with no pending mark, and starts
  nothing:
  - the open branch, the hold, the swap and a busy story, as
    `startCloseRerun`'s first checks do (`:394-408`), but not
    `CLASSIFIER_HELD` (`:398`): under R1 a parent held by an orphan pass
    forks when the copy carries none of the orphan's writes, and
    `forkBranch` judges that (C2);
  - the close's pre-flight (`closePreflight`, `:353-355`);
  - a fresh preview, which refuses a chapter no longer the latest or with
    no close, and a close owed on the region below `B`, read with the
    parent's own `pendingClose` pick (`closeOwedAfter`, `:227-244`); then
    the confirm's counts through `shownStill` (`:327-341`), returning
    `counts-changed` with the fresh preview as the in-place start does;
  - the catch-up pass's pre-flight (`catchUpPreflight`, `:359-368`).

  It holds no mark into `forkBranch`. The in-place start brackets its
  checks and its shortcut in a pending mark (`:412`), and `forkBranch`'s
  gate refusal counts every pending turn
  (`lib/stores/generation/generation.ts:89-90`), so a copy of that pattern
  would refuse every fork. Nothing starts by itself while the confirm is
  open; a start landing between this check and the fork's lock meets
  `forkBranch`'s own gate refusal while the confirm is still mounted. The
  fork takes `N` from this check's fresh preview.

- **Fork's own refusals** have no check apart from forking. `forkBranch`
  refuses before any write, so its typed refusal is that check, mapped onto
  the still-mounted confirm as the in-place refusals are
  (`components/chapters/run-close-rerun.ts:107-148`):

  | `forkBranch` refuses                            | The confirm                                |
  | ----------------------------------------------- | ------------------------------------------ |
  | the gate                                        | stays open and held, as `keepOpen`         |
  | a pending swap                                  | closes with the lasting refusal's toast    |
  | an unfinished run the copy would carry          | closes with its own toast                  |
  | the entry missing or `system`                   | closes with the start-failed toast, logged |
  | the fork point's next entry has no create delta | closes with the start-failed toast, logged |
  | a reversal the planner refuses as integrity     | closes with the start-failed toast, logged |
  | a code this table doesn't list                  | closes with the start-failed toast, logged |

  The check's own fresh preview runs the same sweep on the same `B`
  (`shortcutTo`, `close-rerun.ts:212-224`), so the two sweep refusals
  rarely reach the fork on this path.

  A throw closes it with the start-failed toast, logged. No branch exists.

- **The start on the new branch.** A start beside `startCloseRerun` for the
  branch the fork just made. Under its own mark on that branch it reads the
  preview there and takes its expectations from it, since the user's
  counts were checked on the parent. It refuses a non-null shortcut rather
  than adopting one: the user confirmed no rollback. On a fresh fork the
  shortcut is null, since the fork's window prunes every entry after `N`,
  and the close-owed read finds no pick, since the fork copies none
  (`:236`). Before its mark it repeats, on the new branch, every check
  `startCloseRerun` makes before its own (`:394-411`): the branch is the
  open one, the classifier hold (the fork wrote the child's status idle,
  so it passes), the swap, the re-run hold, a busy story, the settle
  count read before the classifier read and again after the busy check,
  and the close's pre-flight. The busy check backs the hold below: a run
  started on the parent in the window refuses the start, since
  `isStoryBusy` counts every run of the story
  (`lib/stores/generation/generation.ts:111-121`). Under its mark it is
  `startUnderMark`'s path (`:421-467`) with that one change of
  expectations: the catch-up pre-flight, `pendingRerun`, the chain, and
  `onStarted` at the reserve.
- **The sequence,** in `components/chapters/run-close-rerun.ts` beside
  `runCloseRerun`, outside the confirm:
  - **the hold, from the press to the navigation (C8).** The confirm
    stays mounted and pending, every button disabled, Esc and hardware
    back inert, over whichever surface it opened on, the reader or the
    Chapter Timeline, and as a blocking overlay it also stops the reader's
    keyboard shortcuts (`[branchId].tsx:223-233`). With it the sequence
    raises the reader's hold C8 pins, as the creation modal's confirm
    does, so a Send in the window is refused. The confirm ends with the
    navigation, not at the fork's commit: closed at the commit, it would
    leave the parent taking input while the tail reads;
  - the check on the parent, then `forkBranch` with the parent, `N`, the
    auto-name and "make current". A refusal at either returns a step to
    the confirm and releases the hold;
  - once the fork commits, 6.4's show-branch tail, with 6.4's
    stack-replace helper as its navigation (C8). One step, so the reader
    mounts once on the new branch's route and Back lands on the Story
    List. The tail never moves the pointer back, except when its stack
    reset doesn't take (D2), and on a failed load it still navigates, the
    reader's own load handling the failure (C8). The
    publish prunes the re-run request in the same render as the
    navigation, since its branch is no longer the open one
    (`chapter-overlays-host.tsx:177-182`): that closes it with
    `reopen: false`, so a review window `Re-run…` closed stays closed, and
    shows no `not-latest` toast, since the host marks the request as
    starting. After a tail whose load failed nothing is published, so the
    sequence closes the request itself with `reopen: false`, if it is
    still this one;
  - after the navigation, the branch store refresh C8 asks of the fork's
    callers. Its failure is logged and never surfaced, and the start
    doesn't wait on it;
  - the start on the new branch. At the reserve, the info toast
    `Branched "Ch. <seq> re-run" from entry <pos> — re-running chapter <seq>'s close.`
    The re-run's own end speaks through `rerunEndNotice` as in place
    (`run-close-rerun.ts:59-79`);
  - the start-failed path. Past the commit the route and
    `stories.current_branch_id` already name the new branch, whatever
    follows, since the tail has navigated and never moves the pointer
    back; a reset that doesn't take is D2's case, which starts nothing.
    When the tail's load failed, nothing starts: the new branch
    isn't the open one, so a start would only refuse as `branchNotOpen`,
    and the reader's own load deals with the failure. When the start
    refuses or throws, nothing more runs. Either way a warning toast reads
    `Branched "Ch. <seq> re-run" from entry <pos>, but couldn't start the re-run. Retry from Chapter Timeline.`
    The cause is logged, and the new branch keeps its copied close.
- **The host.** `RerunConfirmHost`
  (`components/chapters/chapter-overlays-host.tsx:368-471`; C11: 6.5 owns
  the re-run confirm's host) wires the fork press to the sequence with the
  same `pendingRef`, `onStarting` and step handling its `confirm` has, and
  keeps `pending` set past the fork's commit until the confirm unmounts.
- **Reaching the reader's hold from the root host.** The creation modal
  raises C8's hold from inside the reader. The re-run confirm lives in the
  root overlay host (`app/_layout.tsx:117`), outside every route, so it
  needs a handle on the hold that doesn't go through the reader's own
  state. [Slice 6.4](./04-switching-navigator.md) builds the hold in
  `lib/stores/ui/`, keyed by the reader's branch, so the root host
  takes it directly. Planning confirms that against 6.4 as shipped; if
  the hold turned out to be route state, the fallback is a handle on
  the overlay surface each in-story route already registers with
  `chapterOverlaysStore` (`lib/stores/ui/chapter-overlays.ts:6-10,162-169`,
  `hooks/use-overlay-surface.ts`).

### Flips and forward pointers (C12)

- `components/chapters/close-rerun-confirm.stories.tsx`: `TurnsFollowed`
  asserts the fork enabled and the sentence in the description, in order;
  `RollbackAndRerunFiresConfirm` asserts the fork press fires
  `onConfirmOnBranch` and not `onConfirm`; `BlockedWithTurns` asserts the
  fork takes the gate's reason; `COPY.rerunOnBranchLater` goes.
  `NoTurnsSince` keeps its check that the fork is absent.
- `e2e/tests/chapter-close-rerun.spec.ts:259` asserts the fork enabled.
  `:290` stays as it is: it is the no-turns confirm, which canon gives two
  buttons.
- The docblock at `components/chapters/close-rerun-confirm.tsx:52-56`
  ("needs branch creation (M6.3) and renders held until it lands"), the
  `rerunOnBranchLater` key (`locales/en/chapters.json:130`), and the
  `CloseRerunConfirm` inventory row's "until M6.3".
- The edit notices at `locales/en/reader.json:180,182` already say "Branch
  from here", the name `EntryCard` gives `⎇` (`:175`). They need no edit,
  and from this slice on they name a control the card renders.

### Stories and inventory

- The creation modal's stories: empty, typed, whitespace only, Enter
  confirms, `Cancel` and Esc cancel, pending, each refused line, refused
  on open (a pending swap), failed. Desktop, `tablet` and `phone390`.
- `components/reader/reader-surface.stories.tsx`: a press of `⎇` on a reply
  calls `onBranch` with its id; a `user_action` row shows no `⎇`.
- `docs/ui/component-inventory.md`: a shipped row for the creation modal;
  `CloseRerunConfirm`'s row (the fork live, its sentence, the new prop);
  `ChapterOverlaysHost`'s row (the fork path's sequence and refusals).

### Canon edits its PR makes

- `branch-navigator.md → Branch creation — modal`: the pending, refused
  and failed states, as the developer settles them (Open questions), with
  the creation modal in `branch-navigator.html` updated in the same
  commit.
- `reader-composer.md → Per-entry actions`: `⎇` under a pending swap, as
  the same answer settles it.
- `entry-card.md → Divergence notices`: the branch clause "which the fork
  surface will make good" (`:641`) now holds, and the fork surface's way of
  making the tail obvious (`:609-610`) is the reader landing at the new
  branch's bottom, on entry `N`.
- `chapter-timeline.md → Re-run a close`, only if the new-branch start's
  shortcut refusal or the fork's refusal copy needs a line R1's pass did
  not give.

### Device check

On the slot AVD, never blocking: `⎇` on a reply in the native document
opens the modal, and `Create` lands the reader on the new branch.

## Scope: out

- `forkBranch` itself: its plan, copy, refusals, lock and current-branch
  write ([Slice 6.3](./03-fork-core.md), C7). 6.5 maps its refusals; it
  never decides them.
- `switchBranch`, the show-branch tail, the stack-replace helper, the
  branches store and its read, the chip, the navigator, rename, the reader
  keyed on its branch, and the review window recording its branch
  ([Slice 6.4](./04-switching-navigator.md), C8). 6.5's E2E switches back
  through 6.4's navigator.
- The store accessor and the redo map ([Slice 6.2](./02-scoped-reads-redo.md),
  C5, C6). The fork leaving the parent's Redo is 6.3's vitest; 6.5 carries
  the E2E half.
- The run-record read ([Slice 6.1](./01-copy-substrate.md), C2) and the
  refusal built on it (6.3).
- Branch delete and story duplicate ([Slice 6.6](./06-delete-duplicate.md)).
- A creation entry point in the navigator: canon has none
  ([branch-navigator.md → Why no creation entry point in the navigator](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#why-no-creation-entry-point-in-the-navigator)).
- `⎇` on a `user_action`: canon offers none.
- The composer draft across the fork's switch: lost, with no prompt (R2).
- The lead on a fork: the flag and the stamps copy as columns (C3, C10).
- A faster or non-blocking fork: 6.3 measures a fork's cost on both
  platforms.
- A branch tree or a branch details view: canon's screen-specific open
  questions.

## Acceptance criteria

`⎇` and the modal:

1. `⎇` renders on `ai_reply` and `opening` rows and on no `user_action`
   row, and a press calls `onBranch` with the row's id
   (`components/reader/reader-surface.stories.tsx`, a play per case).
2. The reader's `onBranch` resolves and logs when opening the modal throws,
   and returns without opening while a dispatch is in flight (a vitest
   component test of the host hook, for example
   `components/reader/use-branch-create.test.tsx`).
3. The modal matches canon's shape: `Create` disabled on an empty or
   whitespace-only name and enabled with a name; Enter fires `onCreate`
   with the name; `Cancel`, Esc and `×` fire `onCancel` and never
   `onCreate`. Each holds at desktop, `tablet` and `phone390`
   (`branch-create-modal.stories.tsx`, beside 6.4's navigator stories).
4. Pending: from the press to the navigation every control is disabled,
   Esc does nothing, and two presses call `forkBranch` once (the modal's
   stories and the host hook test).
5. Refused: for each row of the modal's refusal table, the no-create-delta
   and integrity refusals and an unlisted code included, the modal stays
   open with the name kept and that row's line; the reader's hold is
   released; no branch store refresh, no tail and no navigation follow.
   With a pending swap the modal opens refused, `Create` disabled (host
   hook test; a story per line).
6. Failed: a throw from `forkBranch` shows `Couldn't create the branch.`,
   keeps the modal open, releases the hold and logs; no tail follows (host
   hook test).
7. Success: `forkBranch` is called once with the route's branch, the
   pressed entry, the name and "make current"; then the show-branch tail
   with 6.4's stack-replace helper as its navigation; then, after the
   navigation, the branch store refresh. The name reaches `forkBranch`
   trimmed. No toast shows; a tail whose load failed adds none of 6.5's;
   and a refresh that throws is logged, after the tail has navigated,
   with no failure line or toast (host hook test, asserting the order and
   the navigation passed).
8. The hold: with `forkBranch` held pending, and again with the tail held
   pending after it resolved, the reader's hold is raised and a Send
   attempted in the reader is refused, registering no pending turn (host
   hook test, with the reader's dispatch guard).
9. Through the UI, `⎇` on a reply, a name and `Create` leave the database
   with a new `branches` row holding the name, the parent and the entry as
   `fork_entry_id`; `stories.current_branch_id` naming it; the child's
   entry ids equal the parent's non-system entry ids at or before that
   entry, with no system entry; no chapter on the child whose end entry
   sits after it; and the parent's entries and chapters unchanged. Back
   from the new branch's reader lands on the Story List
   (`e2e/tests/branch-fork.spec.ts`).
10. An undo made on the parent before the fork leaves Redo present on the
    parent after switching back through the navigator, and absent on the
    child (`e2e/tests/branch-fork.spec.ts`).

`Re-run on new branch`:

11. The preview's shortcut carries `N` for a head close (the chapter's
    end entry), for an earlier manual close with open-region turns before
    `B` (the last of them), and skips a system entry before `B`; it carries
    the branch's name (`lib/actions/chapters/close-rerun.test.ts`).
12. With turns since, the confirm shows the fork sentence before the
    rollback warning, the fork button is enabled, takes the gate's reason,
    disables while pending, and fires `onConfirmOnBranch`; with none, the
    fork is absent (`components/chapters/close-rerun-confirm.stories.tsx`).
13. The check on the parent refuses each of: another branch open, a held
    branch, a pending swap, a busy story, the close's failed pre-flight, a
    chapter no longer the latest, no close, a close owed below `B` (from
    the parent's pick), counts changed since the confirm (with the fresh
    preview), and the catch-up pass's failed pre-flight. Each refusal
    leaves no pending turn, no `branches` row and every entry in place. A
    parent whose `classifier_status.state` is `'running'` passes it
    (`lib/actions/chapters/close-rerun-start.test.ts`).
14. No pending turn is registered when `forkBranch` is called: its mock
    asserts `pendingTurns.size === 0` at the call. The test fails when one
    `bracketPendingTurn` on the parent spans the check and the
    `forkBranch` call together, the in-place start's shape
    (`close-rerun.ts:412-418`); a mark around the check alone ends before
    the call and proves nothing
    (`components/chapters/run-close-rerun.test.ts`, with the mutation
    shown red).
15. Each row of the confirm's refusal table, the no-create-delta and
    integrity refusals and an unlisted code included, and a throw, returns
    that row's confirm step and toast, and no refresh, tail or start
    follows (`components/chapters/run-close-rerun.test.ts`).
16. On a commit the sequence runs in order: the check, the fork, the
    tail with the stack-replace navigation, then the branch store refresh
    and the start; the info toast fires at the reserve, and a re-run's
    cancelled, failed or undone end toasts as in place. A refresh that
    throws is logged, shows no toast and doesn't stop the start
    (`components/chapters/run-close-rerun.test.ts`).
17. After a commit, the tail is called with the stack-replace navigation
    whatever follows. A tail whose load failed is followed by no start and
    by the request closed with `reopen: false`; a start refusal and a
    start throw end the sequence; each of the three shows the warning
    toast with the retry line, logged, and none moves the pointer
    (`components/chapters/run-close-rerun.test.ts`).
18. The start on the new branch starts the chain on a fresh fork whatever
    shortcut the parent's confirm showed, and refuses, removing no entry,
    when a turn stands after the close there; it refuses `busy` when a run
    of the story holds the gate, and refuses a branch that isn't the open
    one (`lib/actions/chapters/close-rerun-start.test.ts`).
19. In the host, the fork press disables every button; the confirm stays
    mounted and pending past the fork's commit, with the tail held
    pending, and unmounts with the publish; a gate refusal keeps the
    confirm open and held; after a commit a review window `Re-run…` closed
    doesn't reopen, and the prune shows no `not-latest` toast
    (`components/chapters/chapter-overlays-host-rerun.test.tsx`).
20. The hold on this path: with `forkBranch` held pending, and again with
    the tail held pending after it resolved, the reader's hold is raised
    from the root host and a Send attempted in the reader is refused,
    registering no pending turn; the hold is released when the navigation
    lands, and on a refusal before the commit
    (`components/chapters/chapter-overlays-host-rerun.test.tsx`, with the
    reader's dispatch guard).
21. Through the UI, `Re-run on new branch` from the Chapter Timeline leaves
    the database with a branch named by the auto-name key, its parent and
    `fork_entry_id` = `N`; `stories.current_branch_id` naming it; the
    parent's entries past the chapter's end and its report's action
    unchanged; no entry past the end on the child; and a committed re-run
    on the child, whose report's action differs from the parent's. Back
    from the reader lands on the Story List
    (`e2e/tests/branch-fork.spec.ts`).
22. `e2e/tests/chapter-close-rerun.spec.ts` passes with `:259` asserting
    the fork enabled (`pnpm test:e2e -- chapter-close-rerun`).

Pointers, canon and hygiene:

23. `rerunOnBranchLater` and "M6.3" appear nowhere under
    `components/chapters/`, `locales/` or `docs/ui/component-inventory.md`
    (`grep -rn`, which finds nothing).
24. The inventory rows and canon edits under Scope: in are in the PR, and
    `pnpm lint:docs` passes.
25. Every new chrome string routes through `t()`; `pnpm lint`,
    `pnpm typecheck`, `pnpm format:check`, `pnpm compiler:check` and
    `pnpm test:run` pass.

## Tests

- **Unit (vitest, `--project unit`).**
  `lib/actions/chapters/close-rerun.test.ts` for the fork point and the
  branch name in the preview. `lib/actions/chapters/close-rerun-start.test.ts`
  for the check on the parent, refusal by refusal against a real seeded
  database, and for the start on the new branch on a branch copied by
  6.1's copier and rewound by 6.3's fork.
  `components/chapters/run-close-rerun.test.ts` for the sequence with
  `forkBranch`, the tail and the start mocked: order, mapping, toasts and
  the post-commit failures, the refresh's after the navigation. The
  no-mark criterion carries a mutation check: one pending mark spanning
  the check and the `forkBranch` call, seen red, then restored by copy.
- **Component (vitest).** The host hook for `⎇`; the re-run host in
  `components/chapters/chapter-overlays-host-rerun.test.tsx`, beside its
  existing pending and prune cases. Both hold `forkBranch`, then the
  tail, on a deferred promise to reach the window the hold covers, and
  press Send through the reader's dispatch guard there.
- **Storybook.** The creation modal at three tiers; the flipped
  `CloseRerunConfirm` stories; the `ReaderSurface` press. Plays run in the
  `storybook` project under `pnpm test:run`, and on CI several times
  slower than locally.
- **E2E (desktop).** A new `e2e/tests/branch-fork.spec.ts` with two
  flows, each on its own launch since each moves the story's current
  branch: `⎇` with the Redo check, and `Re-run on new branch` from the
  Timeline with its mock LLM lanes scripted as
  `chapter-close-rerun.spec.ts` does (shared helpers move to
  `e2e/flows/` if both specs need them). The reply to fork from and `N`
  are read from the database, never fixed. The flip in
  `chapter-close-rerun.spec.ts`. A renderer edit needs `pnpm build:web`
  before a run means anything.
- **Device.** The slot AVD check under Scope: in, recorded in the PR,
  never blocking.

## Open questions

None open. Each question above was settled at planning or in the
run; the answers are under Implementation notes.

## Implementation notes

**Decisions** (developer, 2026-11-24, unless marked).

- **The creation modal's states (D1).** The slice default, now in
  [`branch-navigator.md → Branch creation — modal`](../../../../ui/screens/reader-composer/branch-navigator/branch-navigator.md#branch-creation--modal)
  and its wireframe: pending is a busy Dialog (`Create` spins; the
  input, `Cancel` and `×` disable through `DialogContent`'s new
  `closeDisabled`; Esc, a press outside and hardware back are inert; a
  second press calls nothing). A refusal is one line above the buttons
  with the name kept and `Create` left enabled to retry. A pending swap
  shows its line as the modal opens and disables `Create` while it
  lasts, live. A throw shows `Couldn't create the branch.`. `⎇` stays
  live under a swap: no branch-only prop on `EntryCard`.
- **A blocked navigation after the fork commits (D2).** When
  `showBranch`'s stack reset doesn't take, it puts
  `stories.current_branch_id` back on the branch the reader shows
  (`fromBranchId`) through the switch's own restore and its one retry,
  before it releases the hold. Both callers keep the new branch,
  refresh the branch list, close the modal or the re-run confirm (the
  request with `reopen: false`) and show a warning toast; the re-run
  path starts nothing. This amends C8's "the tail never moves the
  pointer back" for this one case
  ([milestone.md → C8](../milestone.md#c8--the-branch-list-the-switch-and-the-navigators-row)).
  The live case is native only (a clean inline editor left armed under
  the Timeline or the review window); `⎇` can't reach it, since
  `EntryCard` holds `⎇` while an editor is open.
- **The name is trimmed in the action (IC1).** `forkBranch` stores it
  trimmed, as `renameBranch` does; there is no empty-name refusal (the
  modal gates an empty name and the auto-name is never empty).
- **The callers own the tail's gate (IC2).** Before `forkBranch`, both
  callers refuse a busy story and a turn body still active on the
  parent, as `switchBranch` does before its reset; each shows as the
  gate's refusal.
- **A caller whose story is gone skips the tail (IC3),** refreshing the
  list only while the forked story is still the open one (the branches
  store holds one story's rows). Defence only: both surfaces are modal
  and held.
- **No change to the hold or the undo confirm (IC4, IC5).** The
  reader's unmount still clears the root host's token, when the hold
  has nothing left to hold; the undo confirm stays unreachable on both
  paths.
- **The auto-name is stored in the locale active at the fork (IC6).**

**Shape, as shipped.**

- The re-run path's check on the parent (`checkCloseRerunParent`)
  holds no pending mark: `forkBranch`'s gate counts every pending turn,
  so a mark spanning the check and the fork would refuse every fork. It
  skips the classifier-held read, so a parent whose run record says
  `running` with no live run passes and `forkBranch` judges the orphan
  (`unfinished-run`). The start on the new branch shares the in-place
  start's checks through one private `checkedStart` that takes the mark
  itself, so no await falls between the last check and the mark; on a
  branch whose tail kept turns after the close it refuses
  `turns-followed` and removes nothing.
- The preview's fork point `N` is the highest-position non-system entry
  before the shortcut's target, read on the branch alone; none found is
  an `integrity` refusal, logged.
- The creation modal's panel takes a definite 360 px on web
  (`min(360, viewport − 32)` on phone): `DialogContent`'s `w-full` sits
  in Radix's shrink-to-fit wrapper, so a `max-w` alone leaves every web
  dialog content-sized (filed to
  [triage](../../../triage.md)). Native keeps the Dialog's own width
  classes.

**Answered at planning, from the shipped code.**

- C7 and C8 as shipped were read against this slice; the one gap was
  `showBranch`'s third outcome, `navigation-blocked`, which D2 handles.
- The re-run path's hold is `readerHoldStore`'s own token, taken from the
  root host; no second handle was needed.
- Only an armed unsaved-changes guard can stop the stack replace: the
  story-leave guard needs a busy story, which the gate refusal and the
  hold rule out. On native a clean inline editor left open under the
  Timeline or the review window stays armed until the hold's render
  disarms it; a reset it refuses is D2's case.
- The window between the parent check and the fork's lock stays
  accepted, as the contract audit had it; AC14's mutation pins that no
  mark spans the two.
- A `user_action` fork point: answered by
  [Slice 6.3](./03-fork-core.md); the re-run path's `N` is a reply or
  the opening.

**Facts.**

- Desktop E2E (`e2e/tests/branch-fork.spec.ts`): `⎇` on the hero's
  last reply before chapter 2's close, a padded name and `Create` store
  the trimmed name, the parent and the entry; the child keeps the
  parent's non-system entries up to the reply and drops chapter 2; the
  reader lands at the bottom on the fork entry; Back reaches the Story
  List; the parent's Redo survives the fork and the child has none.
  `Re-run on new branch` from the Timeline forks at `N`, lands on the
  new branch's reader with the Lore banner running, commits the re-run
  there and leaves the parent's entries, report and lore unchanged.
- On the slot AVD (`Aventuras_Slot_1`, Android, x86_64 dev client),
  `⎇` on a reply in the native document opens the modal with the input
  focused, and `Create` lands the reader on the new branch at its
  bottom, on the fork entry; Back reaches the Story List. The pending
  spinner never paints: after the press the modal keeps its enabled
  `Create` for about 0.5–0.7 s while the fork's batch holds the JS
  thread, then the stack transition takes it away and the new reader
  shows `Loading story…` for about 0.7 s (2026-11-25, forks at entries
  71 and 23 of the hero story).
