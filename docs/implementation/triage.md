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
  - 2026-10-07, 4.5a: `Trigger Opens Overlay`
    (`preset-browser.stories.tsx:49`) failed once in a 27-file parallel
    run, on `findByText`'s 1 s default, and passed 3 of 3 alone.

  **Revisit trigger.** A browser-project regression that a parallel run
  cannot localise. That is the moment the missing debugging move costs
  something, and the moment a fourth serial run is worth what it takes
  to get. Held rather than routed in the 2026-09-09 triage pass, which
  did not re-run the suite serially — the evidence above is still as of
  `edce17b8`.

- **An E2E failure with a dirty pane hangs teardown.** When a test fails
  while a pane is dirty, the main process's armed close guard blocks
  `app.close()` (`e2e/harness/launch.ts`), so each spec's `afterAll`
  waits out the 90 s hook timeout per attempt and leaks its temporary
  `userData` directory. The harness needs a fallback that exits the app
  from main or kills it after a timeout. Found in 4.2c's PR 2 review
  (2026-10-06).
- **The desktop window has no minimum width.** `createWindow` in
  `electron/main.ts` sets `width` and `height` but no `minWidth`, so the
  window can shrink to widths no desktop user works at, and layouts get
  exercised there that only phones should reach. Example: below 330 px
  the collision dialog's mode segment clips (see the segment-clip entry
  above). Developer-requested: set `minWidth` around 360 px, which still
  lets the window narrow into the phone tier to check phone layouts.
  Found in 4.2c's developer review (2026-10-07).
- **The World and Plot `search` locators match the hidden reader rail's search
  box.** `e2e/locators/world.ts:60` and `e2e/locators/plot.ts:28` match the
  rail's identical placeholder whenever the rail shows the same category
  (World's default `Characters`), a latent strict-mode trap. Scope them like
  `categoryTrigger` and `tierHeader` if they ever fail. Raised in 4.5a review,
  2026-10-07.
- **`chrome.back` matches its name as a substring.** `e2e/locators/chrome.ts:8`
  has no `exact: true`, so the phone rail Sheet's "Back to categories"
  (`reader:rail.backToCategories`) would collide if that button ever rendered
  in a desktop E2E DOM. Latent: the Sheet is phone-only and E2E is
  desktop-only. Raised in 4.5a's final review, 2026-10-07.
- **Slice 4.6 left a duplicate waiting for a shared home.**
  (2026-10-08) The closing review's simplifier skipped each because the
  shared copy needs a module that doesn't exist yet, or a file outside the
  slice:
  - `openWorld` in `e2e/tests/import-export.spec.ts` repeats
    `openWorldFromHome` in `e2e/tests/world.spec.ts`; `e2e/flows/navigation.ts`
    is the natural home.

  Raised in 4.6's slice review, 2026-10-08.

- **Phone deep-link reveal can't scroll the hidden list.** (2026-10-09)
  World's and Plot's mount-arrival `revealRow` opens the row's tier, but
  on phone the list sits under the detail with `hidden`
  (`components/shells/master-detail-layout.tsx:83`), so the scroll and
  focus are a no-op and the first `←` shows the tier open with the list
  at the top. Fix shape: reveal the selected row in `handleBack` in the
  same guarded update as `select(null)`, as `onPillPress` does
  (`app/world/[branchId].tsx:379`); applies to World and Plot, and
  `openEntity` on phone has the same gap. Raised in 4.5b's review,
  2026-10-09.
