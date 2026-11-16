# The reader's inline edit session

How the reader guards an entry's inline editor: which leaves raise the
navigate-away guard, and what the reader's other actions do while the
editor is open. Designed 2026-11-16. As design, it resolves the UX
followup "The reader's in-place prose edit has no leave guard". The
developer had decided that guard on 2026-11-15; this session adds
everything it left open. The code is a plan-mode followup.

## Why

The reader's inline editor (`editingId`, `editDraft` in
`components/reader/reader-surface.tsx`) holds a draft with nothing
guarding it. Read from the code, not run:

- **Unguarded leaves.** These drop the draft, or leave it under the
  stack, with no prompt:
  - Return and Android back pop the route.
  - The Actions menu's Go-to: the reader passes no `beforeNavigate`,
    unlike World, Plot and Timeline.
  - ⛭ Story Settings, Manage chapters, the peek drawer and Browse chip
    links, the status pill's Memory, the system-entry and cut-off fixes.
  - A review-row press: the reader registers `useOverlaySurface()` with
    no guard, so 5.11's `press` navigates straight away.
  - Electron window close and reload.
- **No dirty signal on Android.** There the surface runs inside the
  expo-dom document, so the route has no dirty signal at all.
- **A silent replace.** The pencil on another row replaces the draft
  (`startEdit`). Only the edited card hides its action cluster.
- **A leaked editor.** A reversal that removes the edited row leaves
  `editingId` pointing at it: the draft lingers unseen, and a redo
  that restores the row reopens the editor with the old draft.
- **↻ outdates the draft.** ↻ on the head reply, while that turn's
  user entry holds a dirty draft, regenerates from the stored text.
- **CTRL-Z and redo can't take the guard's Save-then-proceed.** A
  Save makes the edit the latest action, so the undo would reverse the
  save itself. It also clears the redo stack. The reader is the only
  surface where story undo and a dirty session meet; World has no
  undo hotkey.

## Decisions

The canon is
[`reader-composer.md → Inline edit session`](../ui/screens/reader-composer/reader-composer.md#inline-edit-session).
In short:

- **The session.** An open editor is one session, dirty when the
  draft differs from the stored text. Its own Save and Cancel stand in
  for a save bar.
- **Every leave is guarded while dirty**, pushes included. The reader
  stays mounted under a push, but a draft held under the stack is one
  the user no longer sees, and canon guards the intent.
- **The guard's buttons.**
  - Save is the editor's plain Save, never Save & regenerate.
  - Save is available exactly when the editor's own Save is: the edit
    gate holds both, with the same reason. A head-turn edit stays
    savable through a pass or a close, which it interrupts.
  - A refused Save keeps the dialog up with its reason.
- **Order.** The unsaved guard asks before the story-leave
  abort-confirm, as on World and Plot.
- **Edit-mode focus.** While an editor is open, dirty or not, these
  wait with a reason: every other row's action cluster, a system row's
  Retry, and story undo and redo. When the run gate also holds an
  action, the gate's reason shows, since cancelling the edit wouldn't
  free it.
- **What stays live.** Send, the chips, jumps, the peek drawer, the
  world-time and scene editors, and a system row's Dismiss and Copy
  don't drop the draft. Fix links are leaves, so they're guarded.
- **A leaving row.** A row leaving the loaded set by any other path
  closes its editor and drops the draft.
- **A document crash.** On Android, a crash of the reader's document
  loses an open draft.

## Approaches

**Chosen: the surface keeps the draft and reports the session.**

- `ReaderSurface` keeps `editingId` and `editDraft`, and reports only
  transitions (`{ open, dirty }`) to the route, so there is no traffic
  per keystroke.
- It exposes `commitDraft()` on its handle, which returns the commit's
  result. On desktop the route awaits it directly. On Android the
  document's imperative call runs it and answers through a callback,
  since `useDOMImperativeHandle` documents no return value (the Expo
  docs call it alpha and steer data flow to callbacks; inferred, not
  tested). DOM→native callbacks do return values: `commitDraft`
  already awaits `onCommitEdit`'s result.
- The route builds the guard the way World does:
  - `useUnsavedChangesGuard` for pops and the window;
  - `beforeNavigate` on the Actions menu;
  - `useOverlaySurface(guard)` for review-row presses;
  - a guarded wrapper for its own forward links.

  The `open` flag also gates undo and redo, which live in the route.

- There's one commit path, `commitDraft` with its refusal policy, as
  the developer's decision named.

**Rejected: lift the session to the route.** The route would own
`editingId` as a prop, with the draft mirrored into a route ref on
each keystroke. That needs no native→DOM call. But `editingId` as a
document prop makes every editor open and close re-send the whole
loaded window on Android, the cost the followup "Native reader rows
rerender per emission" measured at about 510 ms per commit at
20 chapters.

**Rejected: guard inside the document.** Pops, Android back, the
Actions menu and the window are all route-side, and the dialog is an
RN modal.

**Rejected for in-surface actions:**

- **Wait only while dirty.** An undo that reverts this row's earlier
  content edit would change the text under an open clean editor. The
  editor would then read as dirty, holding the pre-undo text, and
  would need re-seeding rules.
- **Guard each transition.** That needs per-action Save semantics
  (Save then roll back, Save then regenerate), and each action would
  have to know whether it touches the edited row. Undo still couldn't
  take Save-then-proceed.

**Split off: undo visibility.** The developer raised telling the user
what CTRL-Z undoes, by a confirm or otherwise. It is its own design,
run next. The rule that undo and redo wait while an editor is open
holds whatever that design decides, since a confirm wouldn't fix the
Save-then-undo inversion either.

## Adversarial pass

- **Load-bearing: the route knows "dirty" in time.** On desktop the
  surface runs in-process, so it does. On Android, dirty arrives as an
  async bridge message, so a first keystroke and a back press within
  the bridge latency would pop unguarded.
  - Build: on Android the route arms its guard when the editor opens,
    and asks the document at leave time whether the draft is dirty.
    Clean proceeds with no dialog.
  - Desktop arms on dirty, since a browser's `beforeunload` can't ask.
  - Reasoned, not run.
- **A system row's Retry.** On a failed regenerate, Retry regenerates
  the head reply from the stored text, as ↻ would. It waits too
  (accepted).
- **Two reasons at once.** The run gate and edit focus share
  EntryCard's one `disabledReason`. The gate's outranks (accepted).
- **A document crash.** It loses the draft; canon says so (accepted).
  - Build: the route clears its session on each document boot, or its
    Save would reach a document with no editor and sit refused with no
    reason.
  - Build: a `commitDraft` with no open editor counts as clean.
- **Drift pass: `Close chapter…`.** It fell through both lists, and
  Slice 5.10 said the reader had nothing to guard. It is guarded
  (developer decision), since the close reads stored prose and C7's
  `openCloseModal` already runs the surface's guard. `Flip era…` and
  `Set lead character…` stay live.
- **Checked, no change:**
  - **Send with a dirty head-turn draft.** The draft survives. Its row
    stops being the head turn, and the editor's notice switches to the
    frozen-row nudge (`resolveContentEditNotice`, read, not run).
  - **A head-turn Save from the guard during a pass.** It interrupts
    the pass, so the story-leave check then finds nothing running
    (from canon).
  - **The review window.** It reverses no entries, and its row presses
    are guarded.
  - **Window close with World dirty underneath.** The existing
    `askEach` chains each surface's dialog.
  - **The silent replace.** Edit-mode focus makes `startEdit`'s
    replace unreachable.
  - **The sliding window.** When the document renders a slice short of
    the store, an open editor's row could leave the slice. Added to
    that followup for its design to decide.

## Integration plan

- **`reader-composer.md`:**
  - New `### Inline edit session` under `## Per-entry actions`, after
    "Save and regenerate on a content edit".
  - A `save-sessions.md` citation in **Relevant sections**.
  - One clause in the Loaded-set model's **Branch switch**: an open
    edit's draft is guarded first.
- **`save-sessions.md`:**
  - **Used by** adds the reader's inline entry editor.
  - A new **Where applied** bullet for the inline-editor variant,
    linking the reader section.
- **`actions-menu.md`:** the reader's undo and redo disable during
  generation and while an entry's inline editor is open.
- **`entry-card.md → Edit mode`:** one sentence. The reader holds its
  other entries' actions while one is in edit mode.
- **`followups.md`:**
  - **UX:** the leave-guard entry becomes "The reader's inline edit
    session isn't built.", with the build notes above.
  - The sliding-window entry gains the editor sentence.
- **No wireframe change.** `reader-composer.html` has no edit state;
  the editor's states live in EntryCard's Storybook.
