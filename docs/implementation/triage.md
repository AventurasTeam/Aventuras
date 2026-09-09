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

- **`cascadeDeleteOps` never fires when reverse-replay undoes a
  `create`.** The registry hook (`lib/actions/delta/registry.ts`) is read
  in exactly two places — the explicit `deleteHappening` handler and
  `redo.ts` re-applying a `delete` — while `reverse-replay`'s create arm is
  a bare row delete. So a registered cascade silently does not cover the
  undo path, and `happenings` is registered as though it does. Nothing had
  hit it because a suffix rollback takes every reference down with its
  target; the content-edit reversal is the first entry-scoped caller and
  closes the set by hand in `classifier-facts.ts`. Either the registry
  should consult the hook on create-undo, or the hook wants documenting as
  delete-op-only so the next caller does not assume coverage it lacks.
  Unowned: it is a delta-layer contract, not any one surface's work.

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

- **Nothing decides when a degenerate retrieval query should be
  dropped.**
  [`retrieval.md → Redundancy`](../memory/retrieval.md#redundancy--reporting-a-degenerate-query)
  captures, per emitted Q4 query, the share of its own top-K the
  structural floor had already seated — the measure that makes a useless
  query distinguishable from a useful one, which is precisely what the
  removed prose-extract slot could never report. It is deliberately
  observability-only in v1: acting on it needs a threshold, and setting
  one needs data that does not exist yet. The parked Tier-2 tuning
  surface covers _exposing_ ranker knobs, not the decision to drop a
  query, so this has no home there. Revisit once real captures
  accumulate; the answer may be that no automatic drop is wanted and the
  number stays diagnostic.

- **The Q4-saturated retrieval pass breaches its own cost ceiling at
  dim 768, and no one has chosen a response.**
  [`retrieval.md → Per-turn cost budget`](../memory/retrieval.md#per-turn-cost-budget)
  measures it at ~319ms against the Target bullet's stated ceiling of
  under ~250ms at the top of the projected range on desktop. Not an
  outlier: it is the worst case the Q4 cap allows — top of the
  projected range, all three Q4 slots filled, dim 768. The doc names
  three options without choosing one: move the ceiling, tighten the Q4
  cap, or drop dim 768 as a desktop default. Dim 384 at the same scale
  measures ~182ms and sits comfortably inside, so the breach is
  specific to the larger embedding model. Unowned because commit
  `220e94a2` correctly deleted the triage entry that used to own Q4's
  projected cost once this branch measured it — but that left the
  decision living only as canon prose, with no queue entry to route it
  to an owner.

- **Q1 and Q2 carry no length cap, and Q1 is the slot a user can blow
  up on purpose.**
  [`retrieval.md → Q3`](../memory/retrieval.md#q3-piggyback-summary) and
  [`Q4`](../memory/retrieval.md#q4-classifier-emitted-queries) now share
  one 200-char cap, applied at query build. Q1 is `userAction` trimmed
  and nothing more, with no length limit on the composer that produces
  it; Q2's structural digest grows with scene-entity and thread count.
  Both are therefore still cut by the local tokenizer's `truncation:
true` (`lib/embedder/local/runtime.native.ts`) at a length nobody
  chose — the same silent limit the Q3 cap was added to replace. Q1 is
  the highest-weighted slot, so a pasted wall of text degrades the turn
  it was meant to steer. Unowned: capping user input is a composer
  decision, capping the digest is a retrieval one, and neither has a
  slice.

- **Nothing links a new required settings key to its backfill
  migration.** Settings writes are key-scoped `json_set`
  (`lib/db/stories/settings-ops.ts`), so a key added to
  `storySettingsSchema` without a `.default()` needs a migration or every
  upgraded story fails `storySettingsSchema.parse` and will not open.
  Migrations 0007, 0011 and 0013 all follow the pattern by hand, and
  nothing enforces it — `story-config-schema.test.ts` counts the
  _defaulted_ keys, which is the opposite half. A guard test walking
  `storySettingsSchema.shape` for keys with no `ZodDefault` wrapper and
  diffing them against a checked-in allowlist would close it in ~15
  lines, but choosing that allowlist is a real decision (several keys
  are legitimately required-and-unmigrated because they predate the
  pattern). Unowned: it guards the schema layer on behalf of every
  future slice, not any one of them.

- **Four hand-rolled copies of the same settings-hardening guard.** The
  shape `Number.isFinite(v) ? Math.max(floor, Math.floor(v)) : floor`
  appears in `buffer.ts` (`toCount`), `scan-surface.ts` (`toTake`) and
  `injection.ts` (`toDepth`), all under `lib/retrieval`, and now in
  `entry-reads.ts` under `lib/pipeline/definitions`. Each guards a
  `stories.settings` number that reaches a read site without having gone
  through `storySettingsSchema` — a real and recurring need, since the
  schema deliberately avoids `.int()` so a hand-edited blob degrades
  instead of refusing to open the story. A shared helper is the obvious
  move; what stops it being mechanical is that each caller's floor and
  units differ, and three live in one module while the fourth does not,
  so the helper has no obvious home under the `lib/*` public-API rule.
  Unowned: a cross-module utility question, not any one slice's work.

- **No bundled template exercises the scene-read gate's false branch.**
  `buildGenerationContext` skips the scene query when a template names
  none of `SCENE_VARIABLES`, and that gate is what keeps a prompt from
  paying for reads it never renders. As of the fallback-parity work all
  three bundled `generationContext` templates name `sceneEntities`, so
  nothing covers the skip. It is not dead code — a user-authored pack
  template can name no scene variable — but the only honest test needs a
  registered template that production does not ship, so covering it
  means deciding whether a test-only template belongs in the registry.
  The sibling gates for `entries` and `lastTurns` are still covered.
  Unowned: it guards the context builder on behalf of custom packs, not
  any one slice.

- **Four docs point at `followups.md#ux` for items that are no longer
  there.** [`roadmap.md`](./roadmap.md) (the world-state-block pass),
  [`wizard.md`](../ui/screens/wizard/wizard.md) (scene tagging on
  user-written openings),
  [`12a-runtime-integrity.md`](./milestones/03-memory-floor/slices/12a-runtime-integrity.md)
  (the `updateEntryWorldTime` metadata race) and
  [`entry-card.md`](../ui/patterns/entry-card.md) (the
  writer-serialization fix) each cite the section as the owner of an
  item that has since been resolved into canon or merged into a parked
  entry — the wizard one duplicates the `classifier-on-opening-retrofit`
  bullet directly below it. The anchor resolves only because the heading
  was kept as an explicit empty section when the ledger drained
  (2026-09-09). Each wants retargeting to where its content actually
  landed, which is a per-reference lookup rather than one edit; the
  writer-serialization fix may have no landing site at all, in which case
  the citation is the item. Unowned: doc rot spread across four surfaces,
  none of which owns the ledger.
