# Undo says what it reverses

How the reader's story undo tells the user what it will reverse, and
what it did. Designed 2026-11-16, at the developer's request: what an
undo reverses often isn't visible, much less obvious. It is split off
from [the inline edit session's design](./2026-11-16-reader-inline-edit-guard.md),
which decided that undo and redo wait while an editor is open. The code
is a plan-mode followup.

## Why

Story undo exists only in the reader: the shortcut and the Actions
menu's `Undo last action`, with `undoLastAction` having no other caller.
Its target is the newest group on the branch that isn't a pass
(`headGroupRows` in `lib/actions/story-entries/undo.ts`, then
`selectUndoTarget`).

- **The target can come from anywhere:**
  - a turn;
  - a chapter close;
  - a World or Plot save, or a merge;
  - a Timeline chapter edit;
  - an era flip;
  - one of the reader's own edits;
  - a suggestion refresh.
- **Nothing describes it.** A successful undo shows nothing at all, and
  the keyboard path is silent even when an undo is refused.
- **The sharpest failure is unseen and permanent.** A stray Ctrl-Z
  silently undoes something the user can't see, such as a close or a
  merge. The next turn then clears the redo stack, so the loss stays,
  and the user never knew.

## Decisions

The canon is
[`reader-composer.md → Undo and redo`](../ui/screens/reader-composer/reader-composer.md#undo-and-redo).
In short:

- **Name every target, confirm the unseen.**
  - The menu's entries name their target: `Undo <target>`,
    `Redo <target>`.
  - Every undo ends with an info toast, `Undid <target>`, with Redo.
  - A confirm runs only when the target can't be seen from the
    reader.
- **Seen**, which never confirms, means a turn, or a group one of the
  reader's own writers tagged with `$undoKind`. Those writers are the
  content, scene and world-time edits and the suggestion refresh.
  Everything else is unseen.
- **What runs is exactly what was named.** The undo reverses the
  `actionId` its label or confirm described. If a newer action became
  the latest in between, nothing is undone.
- **The description comes from the deltas.** Turns and closes are
  recognised by their deltas, tagged groups by their tag, and the rest
  by History's humanizer. No action label is recorded.
- **Redo never confirms**, and its notice carries no action, since
  canon still keeps undo affordances off toasts.

## Approaches

**Rejected shapes for the undo:**

- **Confirm every undo.** It puts a second keystroke on the routine
  "undo the turn I just read", and confirms that fire on everything
  teach click-through.
- **Name it, never confirm.** This relies on a toast being seen before
  the next action clears redo, which is the failure being fixed.

**Rejected description: record an action label.** A kind and subject
for every user action, in an actions table or a column on deltas,
would give precise words such as "merging Long John into John Silver".
It costs a migration, a label at every user-action call site, and
canon on what a label means after a partial reversal. Derived words
name a merge by its rows, and the confirm lists them.

**Rejected notices:**

- **A toast with no action**, which leaves touch users opening the
  menu to redo.
- **A persistent notice** until the next action. It's new chrome,
  outside both the toast and the banner patterns.

**Chosen binding: describe, then undo exactly that action.**
`undoLastAction` and `redoLastAction` take the expected `actionId` and
refuse when the head moved. Rejected:

- **Undo whatever is head at confirm.** It can name one action and
  reverse another.
- **Cache the description on every commit.** Every writer must notify
  the cache, a missed one leaves a stale label silently, and it still
  needs the pin.

**Out of scope, by the developer's choice, nothing recorded:**

- **Undo on World, Plot or Timeline.** Canon routes it through the
  reader (`world.md`'s delete hint).
- **A per-row Revert**, which would be selective undo below the head.

## Adversarial pass

- **The first seen rule broke.** It was "a group with a `story_entries`
  write is seen", and `tailSceneActions` (`lib/world/entity-delete.ts`)
  writes the tail entry's scene metadata inside a World delete's group
  and a merge's. Undoing either would have skipped the confirm and
  read "your edit to entry #42".
  - A shape rule (entry writes plus entity updates only) would be exact
    for today's writers, but a future World action that rewrites the
    tail scene without a delete would read as seen, which fails
    toward no confirm.
  - Tagging fails toward the confirm instead (developer's choice).
  - Entry metadata's writers are a closed set today: piggyback (a turn),
    the scene, world-time and content edits, suggestion refresh, and
    `tailSceneActions`.
- **Suggestion refresh is an undo target.** It writes an `ai_classifier`
  delta under its own run's action id, and `selectUndoTarget` skips
  only `periodic_classifier`. Canon is silent on it. It is tagged and
  named, and is not made un-undoable here.
- **A confirm left open while a close commits.** Undo interrupts a
  close, so the close can commit while the confirm is up. The pinned
  `actionId` refuses rather than reversing the new head.
- **A re-run undone with no journal** (5.13) already shows a warning
  toast saying the earlier close couldn't be restored. That warning
  stands in for the notice; Redo stays in the menu.
- **A turn undone during a pass** also shows the existing "moved to the
  next turn" toast. The two stack, and both are true.
- **World's delete hint quoted `Undo last action`.** The label is now
  dynamic, so the shared string `common:deleteUndoHint` says "Undo in
  its menu".
- **Toasts in a row.** A newer undo's notice replaces the older one,
  so a toast's Redo always means the top of the redo stack.
- **Translation.** The strings are whole sentences per kind and per
  place, never a phrase spliced into an "Undo …" frame, since other
  languages move the verb.
- **Payload walks.** `$undoKind` is skipped by every walk that skips
  `$` keys, such as History's `changedPaths` and the reversal's column
  walk. Redo re-inserts deltas whole, so the tag survives. Checked for
  the merge-pin design's `$machinePin`, not re-run here.

## Drift pass

Eleven findings, applied with the developer's go-ahead:

- **A re-run's undo can't be redone** (`chapter-close.md → Re-running
a close`), so the notice carries Redo only when the undo left
  something to redo.
- **A divider-only removal's kept work** is a `chapter_close` group
  with no `chapters` delta, named "the kept close work at entry #N".
- **The race's stated cause was wrong.** Only a turn's undo passes
  through a close, and a turn never confirms. The real case is a close
  a background pass started, committing while the confirm is up.
- **`actions-menu.md`'s "Both disable during generation"** was already
  wrong for Undo, which stays live through a pass or a close. Corrected.
- **The refusal after a confirm** toasts on the keyboard path too.
- **World's delete hint** quotes no label, since other languages don't
  lead with "Undo".
- **Era flips stay unseen.** A flip changes every date on display, and
  the wording no longer calls the tagged writers "the reader's own".
- **Close impact lines** come from the chapter delete confirm, since
  the review window doesn't count.
- **The confirm cites `alert-dialog.md`**, which lists it.
- **`actions-menu.md`** keeps only the menu-owned rules.
- **Build notes:** toast replacement by id, and the E2E locators that
  match the exact label.

## Integration plan

- **`reader-composer.md`:**
  - New `## Undo and redo`, before `## Era flip`.
  - The Actions-menu bullet in **Relevant sections**.
- **`actions-menu.md`:**
  - The reader row of the contextual table, and its paragraph.
  - An unseen target's label ends in `…`, since it opens the confirm.
- **`toast.md`:** the carve-out from the **Undo affordance**
  exclusion, and three **Used by → Reader** toasts.
- **`world.md`:** the delete hint's copy.
- **`data-model.md`:** `$undoKind` in the **Keys prefixed `$`** bullet.
- **`followups.md → UX`:** "Undo doesn't say what it reverses.", with
  the build notes.
