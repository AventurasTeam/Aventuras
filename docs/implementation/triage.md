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

- **Nothing runs React Compiler, so its bail-outs are invisible.** The
  compiler is on (`app.json` → `expo.experiments.reactCompiler`) but no
  lint rule or CI step reports what it skipped:
  `eslint-plugin-react-hooks` 5.2.0 ships no compiler rule, and
  `.storybook/main.ts` adds only the worklets plugin, so plays exercise
  uncompiled components. **The ask is a gate** — a lint rule, or the
  sweep in CI — before anyone chases individual files. Evidence: running
  `babel-plugin-react-compiler` with `panicThreshold: 'all_errors'` over
  `components/`, `app/` and `hooks/` (stories and tests excluded) on
  2026-09-16 found 25 of 269 files bailing — ref access during render,
  several `Todo` shapes (`components/story-settings/memory-panel.tsx`'s
  three `try … finally` handlers among them), manual-memo deps that
  cannot be preserved, a value-mutation error and one incompatible
  library. Five of the 25 bail for a cause a gate would catch first,
  because lint can already see it: an
  `eslint-disable-next-line react-hooks/exhaustive-deps` in
  `components/reader/reader-document.tsx`,
  `components/compounds/import-dialog.tsx`,
  `components/compounds/model-card-document.tsx`,
  `components/compounds/embedder-download-dialog.tsx` (two) and
  `components/wizard/step-calendar.tsx`. The mechanism and the
  panic-threshold technique are in
  [the compiler-suppression lesson](lessons-learned/exhaustive-deps-suppression-disables-the-compiler.md).
  Surfaced 2026-09-14.

- **E2E turn helpers are copied per spec, and one invariant is
  justified two different ways.** `waitForTurnTerminal` is duplicated
  in `e2e/tests/story-settings-models.spec.ts` and
  `story-settings-edit-info.spec.ts`, while `takeTurn` and
  `captureForTurn` are local to `story-settings-keyword-inject.spec.ts`;
  `waitForTurnTerminal` and `takeTurn` hang the same "Send visible is
  the turn's terminal" invariant on different evidence (isGenerating
  excludes suggestion-refresh, versus refreshSuggestions having one
  call site), so the copies will drift. Lifting both into
  `e2e/harness/` would also fix `retrieval-q4.spec.ts` and
  `retrieval-q4-fallback.spec.ts`, which poll a capture on a content
  predicate (five query slots) and so cannot tell "no capture written
  yet" from "written but wrong" — their own comments admit the
  coupling. Surfaced 2026-09-16.

- **A presented bottom Sheet may not leave the DOM after close in the
  vitest-browser runner.** Closing a phone bottom Sheet didn't
  reliably remove it from the DOM under `vitest-browser` during this
  slice's story work, so a play should assert dismissal through the
  trigger's `aria-expanded` rather than the sheet's absence. Likely a
  runner artifact rather than real behavior; unverified on a narrow
  Electron window or Android. Surfaced 2026-09-22.

- **`searchable-overlay-list.tsx` is ~1650 lines, and its
  [Implementation notes](../ui/patterns/searchable-overlay-list.md#implementation-notes)
  overstate native virtualization.** The doc says virtualization is
  always on, via `SectionList` on native, but the inline
  (popover-hosted) native branch, `InlineNativeList`, renders through
  a plain gesture-handler `ScrollView` with no virtualization — only
  `SheetNativeList` (the phone-Sheet branch) uses `SectionList`.
  Moving `InlineNativeList` / `SheetNativeList` into a sibling module
  would also shrink the file. Surfaced 2026-09-22.

- **`Toolbar` diverges from its own spec.**
  `docs/ui/patterns/toolbar.md → Mechanism` prescribes a CSS container
  query on web (`@container (max-width: 1023px)`, the FormRow
  dual-mechanism) with `useTier()` only on native;
  `components/compounds/toolbar.tsx` (166–212) instead uses `onLayout`
  plus a `useTier()` first-frame guess on every platform and renders
  two structurally different trees. Every desktop `EntityListPane`
  sits in a 340 px list pane (`MasterDetailLayout`'s
  `DEFAULT_LIST_PANE_WIDTH`), so it mounts wide off `useTier()`'s
  viewport-width guess and remounts the search input and chips into
  the narrow tree a commit later, once `onLayout` reports the actual
  container width (one-frame flash; focus loss if a container crosses
  the threshold — inferred, not observed). Storybook plays that click
  a chip right after mount silently no-op against the pre-swap node;
  Plot's own list-pane stories had to add a wait for the narrow
  branch's geometry (`toolbarSettled()` in
  `components/plot/plot-list-pane.stories.tsx`). Direction: one tree
  keyed by the container query on web, or have `EntityListPane` pin
  the narrow layout (the `TierTupleInput` / FormRow-lesson precedent).
  Surfaced 2026-09-22.

- **The save bar's invalid-draft reason is tooltip-only on phone.**
  Rejections get a toast — `app/plot/[branchId].tsx`'s `onRejected`
  is `toast.error`, because the save bar's notice is an icon with no
  visible text — but an invalid draft doesn't: `session.invalidReason`
  only reaches `SaveBar`'s `notice` slot, which is a `title` tooltip on
  web and a bare `aria-label` on native
  (`components/compounds/save-bar.tsx`). So on phone the reason a
  disabled Save gives is unreachable by touch.
  `docs/ui/patterns/save-sessions.md` (`Invalid draft`) already flags
  that the slot "reaches phone users, who get no tooltip" for
  field-level consequences and routes those elsewhere, but assigns the
  invalid-draft reason itself to that same slot — check that doc for
  the intended phone surface before deciding the fix. Surfaced
  2026-09-22.
