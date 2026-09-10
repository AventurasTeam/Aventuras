# Slice 4.2c — Collision review drivers

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** [Slice 4.2b](./02b-lore-history-delete.md) (the
  merge's losing row deletes through the hardened entity arm — C3);
  the dialog wiring, rename and keep drivers need only
  [Slice 4.1](./01-world-shell.md) (a partial gate in the milestone
  graph)
- **Blocks:** none

## Goal

The shipped `CollisionResolveDialog` gets real drivers. `Resolve →`
on a flagged row opens the dialog with both rows projected to
`EntitySummary`, and each resolution writes deltas under one
`action_id`: **merge** (canonical update, loser delete through C3,
awareness / involvement / relationship reattachment with the UNIQUE
rule, inverse-ref rewrite, translations move, keyword and tag union),
**rename** (both rows, flag clear), **keep as distinct** (flag clear
only). The dialog's drifted `InjectionMode` and `ScalarField` unions
are fixed first.

## Background

The periodic classifier writes `name_collision_flag = 1` when a
freshly extracted entity's description does not match an existing
same-name row strongly enough to promote it. The World panel is the
only surface that resolves the flag; 4.1 made it visible and seeded a
flagged pair, this slice makes it actionable. The compound is a pure
View with a Promise-driven `onResolve`; the pattern doc's own open
item is exactly this slice — real DB-write drivers. Two known drifts
to clear before wiring: `collision-resolve-diff.ts` declares
`'always' | 'on-relevance' | 'never'` against the shipped
`'always' | 'auto' | 'disabled'` enum, and its `ScalarField` omits
`priority`, which canon lists among the per-row radio scalars.

## Required reading

- [`world.md → Collision review and entity merge`](../../../../ui/screens/world/world.md#collision-review-and-entity-merge)
  through [`Authorship and 3+ collisions`](../../../../ui/screens/world/world.md#authorship-and-3-collisions)
  — every path's writes, the UNIQUE-collision rule, reversibility,
  the in-flight gate, the 3+ iteration rule.
- [`patterns/collision-resolve.md`](../../../../ui/patterns/collision-resolve.md)
  in full — dialog props, `EntitySummary` projection, `Resolution`
  shape, divergence and merge reducer, submit rules, open items.
- [`layout.md → Mapping — desktop to mobile`](../../../../ui/foundations/mobile/layout.md#mapping--desktop-to-mobile)
  — a short Modal stays a Modal on phone; the dialog has no Sheet
  expression.
- [`memory/edge-cases.md → Name collision`](../../../../memory/edge-cases.md#name-collision-and-disambiguation)
  and [`Polymorphic naming`](../../../../memory/edge-cases.md#polymorphic-naming--v1-limitation).
- [`data-model.md → Happenings & character knowledge`](../../../../data-model.md#happenings--character-knowledge)
  (the awareness UNIQUE constraint) and
  [`Character-to-character relationships`](../../../../data-model.md#character-to-character-relationships)
  (the `a_id < b_id` invariant a reattached row must keep).
- [`data-model.md → Translation targets`](../../../../data-model.md#translation-targets)
  — the rows that move with the canonical id.
- [`memory/retrieval.md → Keywords schema`](../../../../memory/retrieval.md#keywords-schema)
  — why keywords union and de-duplicate.
- [Milestone contracts C3, C4, C7, C12](../milestone.md#slice-contracts).

## Scope: in

- **Drift fixes** as the first commit: the compound imports the
  shipped `InjectionMode`, and `ScalarField` / `SCALAR_FIELDS` gain
  `priority` so a divergent priority renders its radio row.
- **Projection:** the World consumer builds two `EntitySummary`
  values (older by `created_at` first) with real `relationCounts`
  read from the stores / DB (awareness, involvements, inverse refs
  across the six ref fields, embeddings 0 | 1, translations).
- **Merge driver:** one `applyDeltaActionGroup` under a single
  `action_id` with `source = 'user_edit'` — `updateEntity` on the
  canonical (chosen scalars, keyword union normalized through C12, tag
  union), awareness rows moved to the canonical id (loser's row
  dropped on a `(branch_id, character_id, happening_id)` collision,
  footnoted in the summary), involvements moved, relationships
  re-keyed through the both-perspective action C7 pins (a pair that
  would collapse to self is dropped; a duplicate pair merges
  perspectives, canonical's non-null winning), inverse `state` refs on
  other entities rewritten to the canonical — one merged
  `updateEntity` per affected row — translations re-targeted, the
  loser deleted through the C3 entity arm (which sweeps its vectors,
  drops it from the tail scene, and refuses if the loser is the lead),
  and the flag cleared. The canonical re-embeds via `embedding_stale`
  if an embedded field changed (already the update arm's behavior).
- **Rename driver:** two `updateEntity` deltas (sparse — only rows
  whose name changed) plus the flag clear, one `action_id`.
- **Keep driver:** the flag clear alone, one `action_id`.
- **Flag clear as a delta.** Canon makes every path CTRL-Z
  reversible; keep-as-distinct's only write is the clear, so the
  clear must be delta-logged — this slice adds `nameCollisionFlag` to
  the entity update arm's delta-logged columns for the user-edit
  path, leaving the classifier's operational **set** on the M1.5
  non-delta seam, and adds the field's label to C4's humanizer.
- **Wiring:** 4.1's `Resolve →` opens the dialog — a Modal on every
  tier, as shipped — disabled while generation is in flight; a merge
  whose loser is the lead surfaces the `lead-entity` refusal inline;
  after a resolution the list re-derives (pill count drops, strip
  disappears, a remaining pair re-surfaces for 3+ collisions).
- **Storybook:** the dialog already has stories; add the `priority`
  radio row and the phone 3-line prose clamp state if the pattern's
  open item is picked up here.

## Scope: out

- Surfacing chrome (pill, strip, badge) and the seeded pair —
  [Slice 4.1](./01-world-shell.md).
- N-way merge UI — not v1 by canon; the user iterates pairs.
- Per-field diff inside `state` — v1 limitation by canon.
- The classifier's flag-setting path — M3.3 (unchanged).

## Acceptance criteria

- Merging B into A where B holds an awareness row A already has for
  the same happening keeps A's row, drops B's, and the summary
  footnote fires; every other awareness / involvement / relationship
  row of B is on A afterwards; the two other entities holding B in
  `inventory[]` and `current_location_id` point at A through one
  update each; B's translations target A; B is gone with zero vec0
  rows; A's `name_collision_flag = 0` (vitest over fixtures).
- CTRL-Z of the merge restores B with every row it held, restores
  the inverse refs, re-flags B, and B is `embedding_stale = 1`;
  redo re-merges (vitest on reverse-replay and redo of the group).
- A merge whose losing row is the story's lead is refused with
  `lead-entity` before any write (vitest).
- The projection's `relationCounts` match the DB for a fixture entity
  across all six inverse-ref fields, awareness, involvements and
  translations (vitest on the projection builder).
- Rename with only B's name changed writes one `updateEntity` delta
  and the flag clear; Save is disabled while neither name changed
  (vitest plus component test).
- Keep-as-distinct writes exactly one delta (the flag clear), CTRL-Z
  re-flags the row, and the History tab labels the field (vitest;
  component test on the humanizer).
- With three same-name rows, resolving one pair leaves the remaining
  pair flagged and visible on next open (vitest on the list
  derivation).
- `Resolve →` is disabled with the in-flight tooltip during a turn
  (component test).
- `tsc --noEmit` passes with the compound consuming the shipped
  `InjectionMode`, and a fixture pair differing only in `priority`
  renders one radio row (component test).

## Tests

- Vitest: merge driver matrix (each relation table, UNIQUE collision,
  relationship self-collapse and pair-merge, inverse refs per field
  merged per row, translations, keyword and tag union normalization,
  lead refusal), rename and keep drivers, group reversibility,
  projection counts.
- Component tests: wiring gates, refusal copy, humanizer label.
- E2E (desktop): seeded pair → merge → undo, asserting rows in the DB.

## Open questions

- **Delta-logging the flag clear.** Adding `nameCollisionFlag` to the
  update arm's `UPDATABLE` set makes any future user-edit path able to
  flip it; confirm no classifier path routes through the user-edit
  arm so the M1.5 operational seam stays the only setter.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved
developer decisions._
