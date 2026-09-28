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
  truncate.** `parseVisualChanges` now truncates a note to
  `VISUAL_TEXT_MAX`, matching `characterStateSchema`'s 500-char visual
  caps (4.2b, developer decision 2026-09-28). Still open: an entity
  that already holds an over-long visual field from before this fix
  still fails a later `updateEntity` that re-validates its whole
  state — e.g. a delete clearing a ref to it. No repair of existing
  rows.
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
  keeps its own casing — the lore pane's Body tab patches this at
  save (`canonicalCategory` in `lore-detail-pane.tsx`), matching an
  existing category's casing even when it wasn't picked from the
  suggestions. The next consumer of `Autocomplete` with
  `casingNormalization="canonical"` won't get this for free and
  needs the same save-time patch (2026-09-28, raised by 4.2b).
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
  until the parked
  [link-row union](../parked.md#history-shows-link-row-edits) or a
  global delta surface (Diagnostics Hub delta log) lands. Read, not
  verified (2026-09-28, raised by 4.2b).
