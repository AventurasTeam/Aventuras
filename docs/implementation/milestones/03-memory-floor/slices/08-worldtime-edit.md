# Slice 3.8 — Per-entry worldTime click-to-edit + monotonicity flag

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** none (day-one build — entry metadata + the M2.3
  `lib/calendar` substrate and M2.5 footer rendering are merged
  prerequisites). Milestone-level validation waits on
  [Slice 3.2](./02-piggyback.md) writing non-zero `worldTime`
  values (the per-turn layer owns that write); that is a
  verification gate, not a build gate.
- **Blocks:** none

## Goal

The world-time footer becomes the manual-correction surface for
`metadata.worldTime`: click opens an edit overlay hosting a
`TierTupleInput` for the active calendar, Save writes one
`op=update` delta, and the reader computes the per-entry
monotonicity-break flag that EntryCard renders as a warning glyph
and overlay banner.

## Background

The classifier estimates elapsed time and will get it wrong;
the correction is direct manipulation with no cascade — one edit,
one reversible delta, downstream consumers tolerate any
non-negative value. M2.5 already renders the footer label
opaquely through the calendar formatter; this slice supplies the
interactive half the EntryCard pattern pins: `onEditTime` +
`worldTimeRaw` make the footer clickable on AI, opening, and user
entries, and `worldTimeMonotonicityBreak` drives the indicator.
The monotonicity walk is host-side — O(N) per list render against
the entries collection, comparing each entry to the most recent
preceding entry with `worldTime > 0` (flashback zeros skipped).

## Required reading

- [`entry-card.md → World-time footer`](../../../../ui/patterns/entry-card.md#world-time-footer)
  — the host contract this slice fulfills: props, overlay shape
  (Popover desktop / Sheet phone), TierTupleInput body, warning
  banner, indicator semantics, edit-restrictions gating.
- [`reader-composer.md → Per-entry world-time footer`](../../../../ui/screens/reader-composer/reader-composer.md#per-entry-world-time-footer)
  — host responsibilities incl. the cached monotonicity walk.
- [`data-model.md → In-world time tracking`](../../../../data-model.md#in-world-time-tracking)
  — the three-layer invariant split, no-cascade contract,
  flashback-promotion semantics, storage floor (`≥ 0`).
- [`data-model.md → Entry metadata shape`](../../../../data-model.md#entry-metadata-shape)
  — metadata edits are delta-logged.
- [`calendar-systems/spec.md → Rendering pipeline`](../../../../calendar-systems/spec.md#rendering-pipeline)
  — tuple ↔ seconds walks the overlay round-trips.

## Scope: in

- **Edit overlay:** footer click (respecting the in-flight
  `disabled` gate) opens Popover / Sheet per breakpoint; body hosts
  `TierTupleInput` (the shipped wizard primitive) pre-populated
  from `worldTimeRaw + worldTimeOrigin` through the calendar's tier
  stack; Save recomputes cumulative seconds, validates `≥ 0`, and
  invokes the metadata-update action (one `op=update` delta);
  Cancel discards.
- **Monotonicity walk:** reader-side computation cached against
  the entries-collection identity; passes
  `worldTimeMonotonicityBreak` (with the previous entry's label
  for the banner / tooltip string) into EntryCard.
- **Wiring on all editable kinds:** AI, opening, and user entries
  (user entries inherit `worldTime` at write since M2; they edit on
  the same terms).
- The warning banner inside the overlay and the tooltip on desktop
  indicator hover, per the pattern doc.

## Scope: out

- Footer rendering itself — shipped in M2.5.
- Per-turn `worldTime` writes — [Slice 3.2](./02-piggyback.md)
  (the per-turn classification layer owns entry metadata).
- Era-flip affordances (time-chip popover, flip-era modal) — M7.2.
- `sceneTime` flashback modeling — explicitly a future exit in
  canon.

## Acceptance criteria

- Editing an AI entry's time via the overlay writes exactly one
  `op=update` delta against `metadata.worldTime`; CTRL-Z reverses
  it; no other entry's metadata changes (vitest on the action;
  manual on the overlay).
- The tuple round-trip is lossless: open-edit-save with no change
  writes no delta (or a no-op guard prevents the write — pick at
  planning and test it).
- Setting entry N's time below entry N−1's flags entry N with the
  indicator; the overlay banner names the previous entry's label;
  fixing the value clears the flag on next render (component test +
  Storybook states).
- Flashback entries (`worldTime = 0`) are skipped as comparison
  ancestors and are not themselves flagged (vitest on the walk).
- Footer click is inert while generation is in flight (edit
  restrictions gate).
- The walk is computed once per entries-collection identity
  (memoization asserted — no per-row recomputation in profiling
  smoke).

## Tests

- Vitest: monotonicity walk matrix (in-order, out-of-order,
  flashback-skips, head / tail edges), tuple ↔ seconds round-trip
  against `earth-gregorian`, action delta shape.
- Storybook: footer editable / indicator / overlay states on
  EntryCard (extends the shipped stories).
- Manual smoke: phone Sheet variant with keyboard (fixed-shape
  body, `avoidKeyboard` only per the pattern).

## Open questions

- **No-change Save semantics** — suppress the delta on equal value
  vs always-write; lean suppress (delta-log hygiene), confirm at
  planning.

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
