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

- **Pressable `Tag` misses the phone tap floor.** (2026-09-11) A
  20 dp pill with `hitSlop={8}` reaches only ~36 dp against the
  [tap-target floor](../ui/foundations/spacing.md#tap-target-on-native)
  ([`touch.md`](../ui/foundations/mobile/touch.md#touch-target-floor-on-phone)),
  and Android's `hitSlop` can't extend past the parent anyway. Affects
  the review pill and the generation pill; fix is visible size, not
  more slop.
- **No shared lore kind glyph.** (2026-09-11)
  [`iconography.md → Entity kind glyphs`](../ui/foundations/iconography.md#entity-kind-glyphs)
  has no lore glyph; `BookOpen` (the app logo) is inlined in `LoreRow`
  and `WorldDetailPlaceholder` — needs a shared kind icon covering lore.
- **DB IPC has no retry for transient failures.** (2026-09-12) A
  one-off rejection on the renderer-to-main SQLite bridge fails the
  operation outright; for a story open it now sends the user back to
  the story list. A bounded retry for transient bridge errors would
  cover every DB call, not just opens. Needs a call on which errors
  count as transient.
- **catppuccin-latte's success and warning pairs fail contrast.**
  (2026-09-13) White on `#40a02b` measures 3.3:1 and on `#df8e1d`
  2.6:1, under the 4.5:1 that filled Tags' `text-xs` labels need
  (staged and retired pills, the review pill, the generation error
  pill). Every other theme passes. Theme-token call: darken the tones
  or give them a dark `-fg`.
