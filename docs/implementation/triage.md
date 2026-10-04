# Implementation triage

Inbox for cross-cutting deferrals surfaced during implementation that
have **no single downstream slice to own them** — the items that would
otherwise be dropped straight into [`followups.md`](../followups.md) or
[`parked.md`](../parked.md) and lost.

Drop them here first. This file is a **queue, not a ledger**: an item
living here means "not yet triaged," not "deferred forever." Triage
happens as a separate pass — each item is read, then routed to its real
home (a specific slice's Open questions, the active
[`followups.md`](../followups.md) ledger, [`parked.md`](../parked.md), a
canonical spec change) or deleted if it dissolves on inspection. Keep
the queue short; a growing inbox is the signal to triage.

A deferral that a **specific downstream slice** will own does not belong
here — it goes straight into that slice's Open questions, where the
slice-planning gate forces its resolution before that slice is planned.

## Inbox

- **Story isolation leaks across files under
  `--fileParallelism=false`.** Serializing puts every story file in one
  page, and some app-level DOM state survives the file that set it.
  Latent rather than active — nothing runs the suite serially — but it
  means "run the browser project sequentially" is not available as a
  debugging move, which is exactly the move a browser-project
  regression calls for. See
  [failed Storybook files with zero failed tests](lessons-learned/storybook-load-flake-zero-failed-tests.md)
  for the parallel-run flake this sits next to; the two may share a
  cause. **Anchor item — accumulating evidence, not yet actionable.**
  Append observations rather than rewriting.

  Evidence so far:
  - 2026-08-24, raised at `384823d6`: the `Diagnostics On` story in
    `app-actions-menu-pure.stories.tsx` failed 2/2, body carrying a
    `data-density` attribute. Attributed to that story; both the
    attribution and the mechanism are unconfirmed.
  - 2026-08-25 at `edce17b8`, three full serial runs (96 files, 803
    tests): green, then a failure in `Trigger Opens Overlay`
    (`preset-browser.stories.tsx`), then green. `Diagnostics On` passed
    all three; `components/compounds` alone is green 26/26. So it is
    intermittent (~1 in 3), the failing story varies across
    directories, and it is not one story's dependency. Root cause
    unidentified — an overlay that fails to open suggests residual
    pointer-events or portal state rather than `data-density`, which
    every file sets for itself through the global decorator in
    `.storybook/preview.tsx`.

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **Piggyback entity visual text was uncapped; new writes now
  truncate.** `buildPiggybackActions` truncates a note to
  `VISUAL_TEXT_MAX`, matching `characterStateSchema`'s 500-char visual
  caps, so notes from the tagged block and from the fallback
  classifier are both cut (4.2b, developer decision 2026-09-28). Still
  open: an entity that already holds an over-long visual field from
  before this fix still fails a later `updateEntity` that re-validates
  its whole state — e.g. a delete clearing a ref to it. No repair of
  existing rows. The fallback classifier path also accepts stackable
  keys and amounts that the tagged-block parser's `parseTransfers`
  rejects — a blank or over-long key, a fractional or negative amount —
  and those fail the same whole-state re-validation; pre-existing, not
  fixed.
- **`row-closure.ts`'s `CHILD_TABLES` widens a reversal set only for
  happenings' children.** A reversal deleting a character a create made
  orphans relationship, involvement or awareness rows naming it that
  were written in a different action group. Read, not reproduced;
  pre-existing (2026-09-28, raised by 4.2b).
- **`commitRowDelete` and `commitRowSave` check the generation gate
  before taking row locks.** A turn starting while a user write waits
  on a lock can write a referenced entity's `state` that the user
  write's full-`state` patch (built from an earlier snapshot) then
  overwrites. Re-checking the gate after the locks are held would close
  it for both; alternatively, turn admission could await
  `settleUserWrites()` first, as the prose-reversal barrier already
  does. Reasoned, not reproduced (2026-09-28, raised by 4.2b).
- **HistoryTab reloads its first chunk on every `settleCount`
  change.** Any run settling (any kind, any branch), or a reversal
  ending, collapses the list to a spinner and drops the older
  chunks the user loaded, so the scroll position jumps. Every delta
  writer checked patches the target row after commit, so the row
  identity may already cover it — checked by grep, not proven.
  Options: drop `settleCount` from the version, or keep rows during
  a version-only reload and refetch up to the loaded count. Read,
  not reproduced (2026-09-28, raised by 4.2b).
- **`Button`'s `loading` state doesn't reach assistive tech on
  web.** React Native Web drops `accessibilityState.busy`, so no
  `aria-busy` renders. Seen testing History's Load older: the button
  disables and shows a progressbar spinner, with nothing announcing
  "busy" to a screen reader. Canon already commits to `aria-busy`
  on a busy control — [`import-dialog.md` →
  Accessibility](../ui/patterns/import-dialog.md#accessibility)
  requires `aria-busy="true"` (web) on its own spinner/reading
  state — so this is a deviation across every `loading` consumer of
  `Button`, not a History-specific gap (2026-09-28, raised by 4.2b).
- **Plot panes keep their tab when `[+] Blank` starts a create.**
  Thread and happening panes hold the tab in
  `useState(initialTab ?? 'overview')`, without the render-time
  `createSeq` reset the entity panes' `useEntityTab` and the lore
  pane have, so a Blank started from a row open on History lands on
  History's "History starts at the first save" instead of Overview.
  Pre-existing from 4.3 (2026-09-28, raised by 4.2b).
- **Row save sessions leave Save enabled while an untouched field is
  invalid.** react-hook-form's `onChange` validation merges only the
  edited field's error, so `useRowSaveSession`'s `invalidReason`
  stays null (its TSDoc says "null while the draft is writable") —
  e.g. an entity or Plot create enables Save with an empty name after
  editing another field; Save then refuses. The lore session runs a
  one-shot whole-draft check on the first edit; lifting that into the
  shared hook broke no test but shows errors on fields the user
  hasn't touched, a product call (2026-09-28, raised by 4.2b).
- **`LoreDetailPane` duplicates `EntityDetailFrame`.** The head, tab
  list, menu and JSON viewer wiring, plus the tab-reset hook, are a
  near-copy (~100 lines) of `EntityDetailFrame` / `useEntityTab`;
  generalizing the frame would let menu changes, e.g. Delete, land
  once instead of twice (2026-09-28, raised by 4.2b).
- **The lore body textarea doesn't fill the pane.** Canon
  ([world.md → Body tab — lore](../ui/screens/world/world.md#body-tab--lore))
  and the slice say the body fills the remaining height; it ships
  as a 12–40-row `EmbedWindowTextarea`, because filling needs the
  shared `DetailPane` scroller to let content grow (every pane,
  phone keyboard layout) (2026-09-28, raised by 4.2b).
- **`Autocomplete`'s `casingNormalization` (default `'canonical'`)
  canonicalizes only a committed pick.** A variant typed and left uncommitted
  keeps its own casing. No shipped consumer uses `canonical` (the lore,
  thread and happening categories are `as-typed`), so the next one
  needs a save-time patch. The canonical match also takes the first
  case-insensitive suggestion even when one matches exactly, so on a
  list holding both `Cosmology` and `cosmology`, picking `Cosmology`
  commits `cosmology` (2026-09-28, raised by 4.2b).
- **AlertDialog impact lists aren't in the dialog's accessible
  description.** The bulleted impact list (`DeleteConfirmDialog`'s
  `delete-impacts` View, and the shipped
  `RollbackConfirm` — `components/reader/rollback-confirm.tsx`) is a
  plain `Text` sibling of `AlertDialogDescription`, the only body
  content wired into the dialog's `aria-describedby`; a screen reader
  can still browse to the sibling rows, it just doesn't announce them
  with the description, and the leading `•` glyph reads as a
  character rather than a list marker. `DefinitionalChangeDialog`
  puts its bullets inside the description instead — a working
  alternative already shipped. Pattern-wide — every AlertDialog
  consumer with an impact list, not just World / Plot delete. Read,
  not verified with a screen reader (2026-09-28, raised by 4.2b).
- **A creative third-person story whose lead is its only character can
  never delete that character.** Creative + third-person is the one
  mode/narration combination where a lead is optional
  ([`data-model.md → Story settings shape`](../data-model.md#story-settings-shape)),
  but once one is set, deleting it is refused (`lead-entity`) and
  `setStoryLead` has no path to clear it back to null. M6's
  per-branch, delta-logged lead
  ([roadmap.md](./roadmap.md#m6--branches--diff-cache)) is the likely
  home (2026-09-28, raised by 4.2b).
- **The History tab's `Deleted` op chip likely never matches in a
  per-row tab.** A deleted row can't be selected to open its
  History tab, and undoing its delete prunes the delta, so no row's
  History tab is likely to ever see a `Deleted` chip produce a result —
  until 4.2c's
  [link-row union](./milestones/04-world-plot-read-surfaces/slices/02c-collision-review.md#scope-in)
  or a global delta surface (Diagnostics Hub delta log) lands. Read,
  not verified (2026-09-28, raised by 4.2b).
- **The composer's Send-blocked reason is invisible to sighted Android
  users.** While a turn generates or suggestions refresh, the reader
  passes `sendBlocked` and the "blocked while generating" reason
  reaches only Send's tooltip and `accessibilityHint`; web shows it on
  hover or focus, native shows nothing on screen. Canon keeps it off
  the visible reason line
  ([`principles.md → What's not gated`](../ui/principles.md#whats-not-gated)
  and its disabled-controls tooltip rule under
  [Affordance loci](../ui/principles.md#affordance-loci)); the gap is
  native-only and pre-existing (2026-09-28, raised by 4.2b review).
- **A link an entity delete captured can come back with no delta.**
  An entity delete keeps the link rows it cascades only in its own undo
  payload. When a later reversal removes the machine write that created
  one of them, that create-undo finds the row already gone and prunes
  its delta; undoing the entity delete then restores the row through
  the live-link filter, since both its ends are live, and nothing left
  in the log can reverse it. Follow-up (developer decision on the 4.2b
  stack review, R1 option a): a create-undo of a link row that is
  already absent also strips that row from the delete payload that
  captured it — the contract between the reverse-replay closure and
  the delete cascade payload
  ([generation-pipeline.md → Reverse-replay](../generation-pipeline.md#reverse-replay)).
  Both triggers were probed with a scratch test on the 4.2b head:
  - **A periodic pass reversed mid-burst.** The pass is abort-free
    once its single model call returns, so the window is its write
    burst: the user deletes a character between two of its writes,
    then a later write fails (any rejection but a `noop`, or a throw,
    aborts the run and reverse-replays it) or boot recovery reverses
    the pass.
    Reproduced for a relationship between two characters the pass
    didn't create. Involvement and awareness rows can't hit it: the
    classifier writes them only under a happening created in the same
    pass, which the reversal deletes, so the live-link filter drops
    them. CTRL-Z never reverses a pass's writes: its bracket cancels
    an in-flight pass, which either stops before its first write or
    lands its whole burst first.
  - **A prose edit's sweep, with no timing window.** The user deletes
    a character, then edits the head turn's prose, whose sweep reverses
    the periodic facts anchored to it; CTRL-Z the edit, then CTRL-Z
    the delete. Reproduced for a relationship anchored to the head turn
    between characters that survive, and for awareness anchored to the
    head turn under a happening anchored to an older turn, which the
    sweep keeps. Not for an involvement: it shares its happening's
    anchor, so the sweep deletes the happening too.

  Option (a) as worded covers creates only. A swept pass update to a
  captured row is pruned the same way: a relationship view the pass
  changed from `ally` to `rival` comes back as `rival` when the
  delete is undone, though that row keeps its older create delta. A
  rerun doesn't duplicate a restored row: awareness and relationship
  writes are upserts behind unique indexes (`haw_natural_uniq`,
  `char_rel_pair_uniq`) and update it in place. `happening_involvements`
  has no such index, and `createHappeningInvolvement` doesn't check for
  an existing link, but the classifier emits involvements only under a
  happening it creates (2026-09-30, raised by the 4.2b stack review).

  The deleted row itself has the same gap, which option (a) doesn't
  reach. A happening the pass wrote from the head turn, deleted in
  Plot: edit that turn's prose, CTRL-Z the edit, CTRL-Z the delete. The
  happening and its links come back with no delta, the pass's rerun
  writes the happening a second time, and a later rollback removes only
  one. In the prose-edit trigger above, the same rollback also leaves
  the untracked awareness row naming a happening that is gone. Probed
  through the pipeline and the delete, edit, undo and rollback actions
  at the 4.2b review head (`1428e5b8`), not re-run on `main`
  (2026-09-30, from a slice-review skill test).

- **`blankToNull` has two copies.** `lib/world/draft-text.ts` and
  `lib/plot/thread-draft.ts` each define it (World's entity and lore
  drafts use the first, Plot's thread and happening drafts the second).
  It wants a shared home such as `lib/text`. The 4.2b stack doesn't
  touch Plot's copy or its callers, so the move is a follow-up on main
  (2026-09-30, raised by the 4.2b stack review).
- **`reader-composer-modes.spec` can fail on its own locator.** After
  Send it waits for `getByText('E2E-MODES', { exact: false })`, which
  also matches the mock reply (`E2E-MODES-REPLY …`); when the reply
  renders before the assertion runs, Playwright's strict mode sees two
  elements and fails, and the retry passes. Seen once in two runs on
  the 4.2b head; the spec is unchanged since 3.4b. A locator that can
  only match the user action (the wrapped text, or `exact: true`) would
  close it (2026-09-30, raised by the 4.2b stack-review follow-up).
- **A late vector write can delete a newer vector and leave the row
  clean with none.** `upsertVecOps` guards its insert on the row still
  holding the embedded text, but its delete of the prior
  `(branch, id, model)` vector is unconditional, and the stale-flag
  clear is guarded like the insert. If two embeds of one row overlap
  and the older finishes last, it removes the vector the newer one
  wrote and inserts nothing, while the flag the newer one cleared
  stays clear, so the drain never revisits the row. Guarding the
  delete with the same predicate would close it. Whether two embeds of
  one row can overlap is unchecked: one drain pass is sequential, but
  the turn-time embed (`lib/embedder-swap/app-deps.ts`) uses the same
  model and isn't obviously serialized against it. Read, not reproduced
  (2026-09-30, raised by the 4.2b type-design follow-up).
- **`RowSaveResult.code` is a bare optional string.** The save side of
  what the delete side now closes (`RowDeleteRejectionCode`): World's
  `saveRejectionText` and Plot's save mapper match a few codes and let
  the rest fall through, and `ENTITY_REJECTION` spreads a family's
  codes into an open set. Closing it the same way means a code union
  for the save family, the runner's refusals mapped at `commitRowSave`
  as `commitRowDelete` does, and exhaustive copy tables. The save paths
  predate 4.2b, so the follow-up left them (2026-09-30, raised by the
  4.2b type-design follow-up).
- **About eight tests hand-write the vec0 insert that `plantVec` now
  provides.** `lib/db/__tests__/vec-fixtures.ts` plants a vector with
  no source check; the delete-cascade, entity-delete, story-delete, KNN
  and vec0-migration tests and `e2e/harness/db.ts` each spell the same
  `INSERT` out. The `lib/` ones could adopt it; none was in the
  follow-up's range (2026-09-30, raised by the 4.2b type-design
  follow-up).
- **Keyword-seated rows leave the pool before MMR, so they never
  enter its selected set.** `rankPerType` (`lib/retrieval/ranker.ts`)
  filters seated rows out before `mmrRank`, so a near-duplicate of a
  seated row is ranked with no diversity penalty against it. Canon
  says a seated row "is skipped when it later appears as a ranked
  candidate" ([Keyword injection](../memory/retrieval.md#keyword-injection)),
  which reads as a fill-time skip that leaves it in MMR's `S`. A third
  reading starts `S` with the seats, since they are already selected.
  Which one is intended is unsettled. Read, not reproduced
  (2026-10-02, raised by an E1 eval review of PR #487 Task 2).
