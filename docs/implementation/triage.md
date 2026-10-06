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

- **Name-collision detection misses partial-name duplicates.** Layer B
  reconciliation (`lib/classifier/reconcile.ts`) gates on an exact
  `normalizeTerm` name match against existing characters, so "Kael" and
  "Kael Stormborn" never reach the embedding comparison: the classifier
  creates a second row with no flag, and no surface offers a merge.
  Keywords and aliases are not consulted either. Only characters are
  reconciled at all, though canon gives the flag to all four kinds.
  Scene presence is unused too: the classifier's window carries each
  turn's prose but not the `sceneEntities` saved in its metadata, and
  Layer B compares names and descriptions only, so a "new" character in
  a turn whose scene already names the existing row (strong evidence of
  a classifier miss) still lands as a flagged duplicate. Revisit
  together, developer-requested: feed each window turn its saved
  metadata state, resolve or promote such a character to the existing
  row, and consider correcting past entries' scene presence once a
  duplicate is resolved — a merge rewrites only the tail scene, so
  earlier entries keep naming the deleted loser and render it as
  "Entity no longer exists". Found during 4.2c planning (2026-10-06);
  the classifier is M3.3's substrate, outside 4.2c's scope.
- **The classifier drops why it flagged a row.** `reconcileNewCharacter`
  returns a `FlagReason` (`distinct`, `ambiguous`, `no-signal`), the
  similarity and the best-matching namesake, and its type comment says
  the reason is "carried explicitly for the collision-review surface",
  but `lib/classifier/plan.ts` persists only the 0/1 flag. The resolve
  dialog could say "descriptions differ" or "couldn't compare", and a
  stored partner id would let World pair the flagged row with the
  namesake the classifier actually compared rather than guessing by
  name. Both need a schema column. Found during 4.2c planning
  (2026-10-06).
