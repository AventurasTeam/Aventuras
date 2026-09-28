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

- **Piggyback entity visual text is uncapped.** `parseVisualChanges`
  only trims, and `buildStatePatchOutcome` never validates, but
  `updateEntity` re-validates the whole state against
  `characterStateSchema` (500-char visual caps), so an over-long field
  on an unrelated entity that references a deleted location, character
  or faction makes the delete fail with an opaque schema-validation
  error. Options: clamp or validate on the piggyback write path, or a
  merge-style ref-clearing handler that doesn't re-validate unrelated
  fields (2026-09-28, raised by 4.2b).
- **Thread and happening update handlers record every column named in
  the patch.** Entity and lore updates drop unchanged ones. Safe today
  because `threadPatch` and `happeningPatch` pre-filter, but a future
  unfiltered writer would make History list unchanged fields and feed
  extra keys to user precedence (2026-09-28, raised by 4.2b).
- **Translation writers take no row lock.** No `translations` key
  exists in `row-locks.ts`, so a delete's "children read under the
  locks" doesn't hold for translations. Latent until the translation
  phase ships a writer: a translation written between a cascade's read
  and its commit would orphan, and could collide with
  `translations_natural_uniq` on undo (2026-09-28, raised by 4.2b).
