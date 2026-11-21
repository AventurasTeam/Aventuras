# Story duplicate

What the story card's `Duplicate` copies, when it refuses, and the
dialog that starts it. Designed 2026-11-21, out of the M6 readiness
check: canon held one line
([`story-list.md → Story card`](../ui/screens/story-list/story-list.md#story-card--text-first))
written before the hard-fork branch model, and the roadmap's M6.6
bullet restated it.

## Why

The line read "clone the story row + current branch's entries +
entities/lore snapshot." Built as written, the copy carries no
`deltas`, so rollback and CTRL-Z in the duplicate have nothing to
reverse and leave entities holding later turns' state. It also drops
threads, happenings, awareness links, relationships, chapters and
vectors, and a copy without chapters owes a close over its whole
length. It names no story-row fields at all.

## Decisions

- **A dialog picks the name and the branch, with an `All branches`
  option.** A single-branch duplicate's root is exactly the source
  branch; a full duplicate copies every branch and its tree.
- **No link to the source survives except shared `assets` rows.** The
  `entry_assets` rows copy; the binary media they point at is shared,
  as branches already share it. Global rows the story points at by id
  (vault calendars, packs, provider profiles) aren't the source
  story's, so they stay references.
- **In-database copy through M6.1's copy core.** Per-table
  `INSERT … SELECT` in one transaction. Rejected: an in-process export
  and import, which strips vectors (every duplicate would pay a full
  re-index), meets import's `branches.id` collision, and would wait for
  M9.4.
- **A Duplicate column on the branch-copy manifest.** For branch-scoped
  tables duplicate differs from fork in five rows (`story_entries`,
  `entry_assets`, `*_vec`, `deltas`, `reversal_journals`), and the manifest
  already carries the rule that a new branch-scoped table gets a row.
  Story-scoped rows go in a new `Story duplicate` section. Rejected: one
  manifest for every table with Fork, Duplicate and Export columns, whose
  per-row notes concern different operations (rewind behavior against
  strip rationale) and would move out to prose; and a prose-only "as a
  fork from the tail, except…", whose exceptions are what gets missed.
- **The user stays on the story list.** A toast,
  `Duplicated as "<name>"`, carries an `Open` action. Rejected: opening the copy,
  which import and the wizard's Finish do. The copy's `last_opened_at`
  stays null, so under the default sort its card sorts last until
  opened; stamping it would record an open that never happened.
- **The fork's classifier-status reset doesn't carry.** A duplicate
  copies trailing system entries, so it copies `classifier_status` as
  it stands too: a copied pass-failure card on a status reset to idle
  would contradict itself.

## The design

### What a duplicate copies

**Ids.** A new `story_` id, and a new `br_` id for each copied branch.
Every other row keeps its id under its new branch id. Serialized JSON —
`deltas.undo_payload`, `reversal_journals.journal`, the id references
inside `entities.state` — copies verbatim and resolves within the new
branch; a delete payload naming the source branch is covered by the
re-stamping on restore that fork already relies on
([`generation-pipeline.md → Reverse-replay`](../generation-pipeline.md#reverse-replay)).

**Each copied branch, as it stands, with no rewind:**

- Every `story_entries` row, `system` entries included: a trailing
  failure card keeps its held text and its Retry. A fork drops it
  because rolling back to `N` removes it; a duplicate rolls nothing
  back.
- Every branch-scoped table in the
  [branch-copy manifest](../data-model.md#branch-model), `deltas` and
  `reversal_journals` whole.
- `*_vec` rows, every one, `pk` re-synthesized as
  `<newBranchId>:<id>:<model_id>`, `embedding_stale` flags as they
  stand.
- Not `probe_captures`: diagnostic, and both fork and export skip them.
- The `branches` row: new id, the source's `name`, `created_at`
  verbatim (the navigator orders by it), `classifier_status` verbatim.
  A single-branch duplicate's branch is the new root, so
  `parent_branch_id` and `fork_entry_id` are null. A full duplicate
  remaps `parent_branch_id` to the copy's ids and keeps
  `fork_entry_id`, since entry ids are verbatim.

**The story row.** Title from the dialog. `description`, `tags`,
`accent_color`, `cover_asset_id`, `definition` and `settings` copy
whole, the export-stripped settings fields
([`data-model.md → Backup & export format`](../data-model.md#backup--export-format))
included, since nothing leaves the setup. `status` becomes `active`,
from an archived source too; `favorite` 0; `created_at` and
`updated_at` now; `last_opened_at` null; `current_branch_id` the copied
branch, or in a full duplicate the copy of the source's current branch.

**Not copied:** `pipeline_runs` (run bookkeeping: the history of runs
before the copy stays with the source); `wizard_sessions` (drafts can't
be duplicated); in-memory records — `deferred`, `pendingClose`, the
redo stack — so the copy starts as after a restart. A close the
threshold owes is derived, so it holds on the copy; a manual close's
pick doesn't.

**Shared, not copied:** `assets` rows, the cover included.

### Refusals and execution

**Refused before any write,** on the source story and the branches
being copied:

- The story is a draft. The card doesn't offer Duplicate there; the
  action refuses as well.
- A copied branch is held: `classifier_status.state === 'running'`, an
  unrecovered orphan pass. Copying it would bake the orphan's
  uncommitted writes into the new story with no recovery marker — the
  fork's reason. Only an older build leaves a branch held.
- An embedder swap is pending on the story: staged vectors aren't live
  yet.
- A run is registered on any of the story's branches. Leaving a story
  cancels its runs and waits for idle, so from the story list this is
  defensive.

**One transaction.** One `runInTransaction` batch of
`INSERT … SELECT` statements; the rows never leave SQLite. Order: the
`stories` row, then `branches` in `created_at` order (parents before
children, for the `parent_branch_id` FK), then each branch-scoped table,
then `*_vec` last. A full duplicate copies every branch in the same
batch, so a failure leaves nothing half-copied.

**No branch lock.** A fork holds the parent's exclusive write lock
because it plans its rewind outside its transaction and the plan must
stay valid. A duplicate plans nothing, and one batch reads one
consistent snapshot of the source. _Assumed, not verified:_ the batch
runs with no other write interleaved. Fork rests on the same property;
planning checks it once for both.

**M6.1 dependencies.** The `deltas` migration to a `(branch_id, id)`
key, without which copied delta ids collide, and the sqlite-vec
self-insert check (`INSERT INTO <vec> SELECT … FROM <vec>`). If
sqlite-vec refuses it, the fork's fallback applies: pre-read the
vectors, or stage them through a temp table inside the transaction.

**Cost.** Linear in rows copied, a fork's cost with no rewind; a full
duplicate times the branch count.

**Not undoable.** A duplicate writes no deltas, like a story delete: it
is a config-table operation. Deleting the copy is the way back.

### The dialog

**Trigger.** The story card's `⋯` → `Duplicate`, on active and
archived stories. Drafts don't get the item.

**`Duplicate story`.** A Modal on every tier, about 360 px, the branch
creation modal's size.

- **Name.** Required, prefilled `<title> (copy)`, focused with the text
  selected. Duplicate is disabled while it's empty or whitespace.
  Titles needn't be unique.
- **Branch.** A Select in `dropdown` mode (its auto mode would render
  three or fewer user-named options as segment buttons), shown only
  when the story has more than one branch: the current branch first,
  marked `current`, then the rest in `created_at` order, as in the
  navigator; `All branches (N)` last. The Select has no separator.
  Defaults to the current branch.
- `Cancel` and `Duplicate`. Enter in the name confirms; Esc and the
  backdrop cancel.

**Refusals.** Checked when the dialog opens: a refusal disables
Duplicate and shows a reason line (a pending embedder change: wait for
its indexing to finish). The action re-checks at commit, and a refusal
there shows the same line. Copy is the slice's.

**While copying.** Duplicate shows a spinner; the fields and Cancel
disable; Esc and the backdrop don't close it, since a single
transaction can't be cancelled partway.

**Failure.** Nothing was written. The dialog stays open with an inline
`Couldn't duplicate the story.`; the user retries or cancels. Logged
through `logger`.

**Success.** The dialog closes and the story list re-reads. A toast
`Duplicated as "<name>"` with `Open`, which takes the ordinary open
path and so stamps `last_opened_at`. The card lands where the sort puts
it: under the default `last-opened`, last. The copy is never
favorited; an archived source's copy is active, so with the `Archived`
filter on it doesn't show, and the toast's Open is the way to it.

### Shared assets

An asset trashes only when nothing in any story references it: no
`entry_assets` row on any branch, and no `stories.cover_asset_id`.
Canon's trash-can paragraph counts `entry_assets` alone
([`data-model.md → Assets`](../data-model.md#assets-images--future-media)),
so the count widens to covers. A story delete clears its own cover
reference and drops its own `entry_assets` rows; an asset the copy
still uses never trashes. The rule lands with M9.3's refcount trashing.

## Adversarial pass

**Load-bearing assumption: nothing reads a row by its id alone across
stories.** Fork already repeats ids across branches of one story; a
duplicate repeats them across stories. Checked: every TanStack query key
in `hooks/`, `components/` and `lib/` that names a row also names its
`branchId`, and the new story's branches have new ids. The known
id-alone sites are the M6 readiness check's: the diff cache keyed on
`delta.id` (now held for a ruling) and the History tab's lookup
(`components/history/use-history-target.ts`, a carried M6.3 item). A
branch-keyed diff cache covers stories too.

**A read that won't see the copy.** The story list's chapter numbers
(`hooks/use-story-chapter-numbers.ts`) key on `settleCount` alone and
reread on a generation settle or a refocus. A duplicate is neither, so
the new card would show no chapter until one. The action refetches it,
as it rehydrates the stories. Verified by reading, not run.

**Edge cases.**

- An archived source: the copy is `active` and appears under `All`, not
  under `Archived`.
- A source whose last turn failed: the system card copies with its held
  text, and its Retry runs on the copy.
- A source owing an interrupted pass: `deferred` doesn't copy, but
  `processedThrough` does, so Send's owed-pass check and the cadence
  still see the unprocessed turns. The copy behaves as the source would
  after a restart.
- A vault calendar referenced by both: a shared global row, as for any
  two stories on that calendar.
- Delete of the copy: `deleteStory` scopes every delete by the copy's
  branch ids and the vec0 deletes by `pk` prefix, so the source is
  untouched; shared assets survive by the widened count.
- Disk full mid-copy: the transaction rolls back and the dialog shows
  the failure.

**Read-site impact.** The story list (rehydrate and the chapter-number
refetch); `embedderSwapStore`'s deferred upgrade and `generationStore`'s
records are keyed by story or branch id, and the copy's are new, so
nothing carries; the story `.avts` export of the copy works unchanged.

**Doc-integration cascades.** The `story-list.md` card bullet and the
mobile overflow line already name Duplicate; the dialog gets a section.
`story-card.md`'s Draft row hides Duplicate. The roadmap's M6.6 bullet
restates the old line and gets rewritten; the M9.3 note on covers gains
the cross-story count. No heading is renamed.

**Missing perspective.**

- Undo: none, by design; the copy is deleted instead.
- Translation: `translations` copy with the branch.
- Backup: a full backup holds both stories and each shared asset once.
- Cross-platform: Modal and Select on every tier; the copy runs
  wherever the DB does.
- Found in passing: the export manifest claims every table but has no
  `pipeline_runs` or `wizard_sessions` row; both are diagnostic or
  wizard state, so they get rows that strip them.

## Integration plan

**Canonical files:**

- `docs/data-model.md`
  - `### Branch model`: add a `Duplicate` column to the branch-copy
    manifest. Rows differing from fork: `story_entries` (all rows,
    system included, no rewind), `entry_assets` (current rows, no
    rewind), `deltas` and `reversal_journals` (all rows), `*_vec` (all
    rows, `pk` re-synthesized). Every other row reads the same as fork. Extend the "new branch-scoped table gets a
    row" rule to name both columns.
  - New `### Story duplicate` after `### Story deletion`: ids, the story
    row, story-scoped tables (`branches`, `pipeline_runs`,
    `wizard_sessions`, `assets`), `classifier_status`, refusals, the one
    transaction, no lock, not undoable.
  - `### Story deletion`: the referenced-survives bullet adds that a
    delete clears the story's own cover reference.
  - `### Backup & export format`: add `pipeline_runs` and
    `wizard_sessions` rows (stripped).
  - `### Assets (images & future media)`: the trash-can refcount counts
    `entry_assets` rows and `stories.cover_asset_id` across every story.
- `docs/ui/screens/story-list/story-list.md`
  - `## Story card — text-first`: the Duplicate bullet points at the
    new section, drafts excluded.
  - New `## Duplicate a story` after `## Story import`: the dialog,
    refusals, busy, failure, success toast, sort landing.
- `docs/ui/patterns/story-card.md`
  - The state table's Draft row: the overflow menu also hides
    Duplicate.
- `docs/ui/screens/story-list/story-list.html`
  - A `duplicate` review-bar group: off, branches, single-branch, all
    branches, refused, copying, failed, done (toast and the new card
    last). The cards' `⋯` opens the dialog.
- `docs/implementation/roadmap.md`
  - M6.6 bullet: restate as the designed shape, depending on M6.1's
    copy core, the `deltas` key migration and the vec self-insert
    check; note the chapter-number refetch.
  - M9.3 slice-authoring note: the refcount counts covers and
    `entry_assets` across every story.

**Renames:** none.

**Patterns adopted on a new surface:**

- (`story-list.md`, `toast.md`): the success toast; the toast
  pattern's Used-by list gains the story list.
- (`story-list.md`, `forms.md`): the dialog's Input and Select; the
  form-control pattern's Used-by list gains the story list.

The dialog's Modal cites
[`layout.md → Modal`](../ui/foundations/mobile/layout.md#modal), a
foundation rather than a pattern with a Used-by.

**Followups resolved:** none in `followups.md` or `parked.md`.

**Followups introduced:** none; build notes ride the roadmap's M6.6 and
M9.3 entries.

**Wireframes updated:** `docs/ui/screens/story-list/story-list.html`
(the duplicate dialog states and the done toast).

**Intentional repeated prose:** `story-list.md → Duplicate a story`
restates the refusals in user terms, deferring their reasons to
`data-model.md → Story duplicate`.
