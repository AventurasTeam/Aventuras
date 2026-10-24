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

- **On an Android phone the keyboard hides the reader's inline editor.**
  Pre-existing: main behaves the same. On an emulator (411×914 dp, the
  suggestion strip open), Edit on an entry near the bottom autofocuses
  its `Textarea` (`components/compounds/entry-card.tsx`), and the
  keyboard leaves the reader 180 CSS px above the suggestion strip and
  composer. The editor grows the row, so the reader has already left the
  bottom and the viewport-shrink re-pin doesn't fire. The textarea
  then sits at 162–386 px, only its top 18 px above the strip. For
  a long last row it sits at 211–435 px, fully hidden. Nothing scrolls
  it into view: Android's WebView never scrolled a focused field into
  view in any run, and the reader has no code that does. A fix that
  keeps a focused inline editor in view when the reader shrinks would
  also cover two cases where the re-pin had helped. The re-pin now
  holds for a focused editor
  ([`reader-composer.md → Autoscroll`](../ui/screens/reader-composer/reader-composer.md#autoscroll)),
  so they behave as on main again. On the stock phone, a long last
  row's editor kept its lower half and Save in view (79 px of the
  textarea, against 13 px without the re-pin). On a very tall reader
  (density 300), the whole textarea stayed in view, against 149 of
  its 224 px. Raised 2026-10-21 by the gated classifier slice review's
  R1 probe.

- **The Select's segment and radio branches go uncontrolled on an
  `undefined` value.** `components/ui/select.tsx`'s `SegmentBranch` and
  `RadioBranch` hand `value` straight to Radix, whose
  `useControllableState` reads `undefined` as uncontrolled, so a caller
  passing `undefined` (legal under `value: string | undefined`) switches
  between controlled and uncontrolled and gets React's warning. The
  dropdown branch maps it to `EMPTY_VALUE`. Raised 2026-10-23 by the AI
  writer map's Task 9 review, whose cast parent picker hit it.

- **A World E2E spec re-checks the delete dialog's copy.**
  `e2e/tests/world-delete-undo.spec.ts` (≈:187-188) asserts
  `world:delete.awareness` and `world:delete.tailScene` text in the
  confirm, which Storybook owns
  ([`testing.md → Test taxonomy`](../testing.md#test-taxonomy): E2E "does not re-verify
  rendering"). The AI writer map dropped the same kind of check from
  its own specs. Predates it; raised 2026-10-24 by its slice review.

- **The AI writer map's code-quality leftovers.** Its slice review's
  simplifier pass skipped these, each needing a home or a design call
  outside the slice's files:
  - `hooks/use-story-place.ts` builds a new value on every entries-store
    change; the review stabilised its one consumer
    (`components/world/use-collision-resolve.ts`) instead of the hook.

  Raised 2026-10-24 by the AI writer map's slice review.
