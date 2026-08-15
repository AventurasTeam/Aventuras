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

_None outstanding._ No-change Save semantics resolved at planning —
see Implementation notes.

## Implementation notes

### Resolved developer decisions

- **Overlay hosting splits by tier.** Desktop and tablet get an
  anchored Popover hosted by EntryCard itself; phone bridges out via
  `onRequestEditTime` and the reader route presents a native bottom
  Sheet, mirroring the rollback-modal precedent. The document bundle
  has no `BottomSheetModalProvider`, and gorhom-on-web inside an
  Android WebView with a soft keyboard is an unexercised path. This
  deviates from the letter of `entry-card.md`, which was authored
  pre-pivot and read as though the compound hosted both; that doc was
  amended in this PR.
- **No-change Save suppresses on tuple equality, not seconds.** An
  untouched open-then-save closes without invoking the action. Tuple
  equality is the load-bearing choice: on a coarse-grain calendar the
  tuple cannot represent sub-base-unit remainders, so a seconds-level
  test would let an untouched save silently rewrite `worldTime` to the
  truncated value. A second, independent guard lives in the action
  (exact seconds equality) because the form is not structurally the
  only caller. Both are covered; the coarse-calendar story is the only
  test that distinguishes the two predicates.
- **The monotonicity walk is window-local.** Head-of-window entries
  stay unflagged until their predecessor loads; no DB reach. The flag
  is soft advisory UI and self-heals on scroll-up.

### Deviations from the plan worth carrying forward

- **Decorations cross the bridge as a side table, not merged into
  rows.** The plan's merged-row shape was measured wrong during
  implementation: `working-set-store` rebuilds its row map on every
  entry patch, so a walk returning fresh row objects would void
  `ReaderRow`'s memo for the whole window on turn commit, classifier
  writes and edits — not just on append, which was the only case the
  plan's mitigation covered. `decorateWorldTime` returns a record
  keyed by entry id and `ReaderRow` takes flat primitives. Verified
  empirically with a render-counting probe: a fresh decorations object
  with identical values re-renders nothing, while a fresh `calendar`
  reference re-renders every row.
- **The tuple-to-seconds conversion is bounded by a span cap.** It is
  linear in the top-tier value, so a mistyped year froze the UI thread
  for seconds and the resulting value was writable, after which every
  reader render paid the same cost for that row permanently. The cap
  is measured against the seeded tuple rather than the origin, so an
  entry legitimately far past the origin does not open with Save
  already disabled. Bounds each keystroke, not the reachable total.
- **A failed write keeps both overlays open with the typed tuple
  intact.** The Popover originally closed before knowing the result,
  losing the user's input on failure while the Sheet kept it. The
  Sheet was right and matches the route's sibling flows.
- **Strings in the form and footer stay raw English.** This is tracked
  debt, not a sanctioned exception — the triage entry it was pinned to
  describes the pattern as a defect, and the premise that the document
  bundle cannot reach `t()` is false. Converting only the new
  component would split the monotonicity sentence across two sources,
  so the debt stays uniform and tracked.

### Constraints a later slice must not lose

- `story_entries.metadata` is a JSON-mode column with a compile-time
  `$type` cast, and the forward write path never parses it. The
  non-negative-integer check inside `updateEntryWorldTime` is the
  **only** runtime enforcement of the storage floor; it must not be
  deleted as redundant with the Zod schema.
- The E2E's delta query filters on `entry_id`, which makes it the only
  assertion anywhere that pins the survival anchor.

### Unresolved, awaiting a developer decision

- **Delta anchoring for user edits contradicts `data-model.md`.** This
  slice stamps the edited entry's own id so that rolling back a later
  turn spares a correction on a surviving entry; canon lists user
  direct edits as null-anchor deltas that always reverse positionally.
  The doc line cannot mean content edits, which are exempt from the
  delta log entirely. Filed in `docs/implementation/triage.md`; the
  code was left as shipped because amending canon is gated.
