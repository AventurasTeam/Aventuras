# Slice 3.9 — CTRL-Z action-batched extension over the survival anchor

## Metadata

- **Milestone:** [Milestone 3 — Memory floor](../milestone.md)
- **Depends on:** [Slice 3.3](./03-classifier.md) (the C3 shared
  reversal sweep with drain + clamp; classifier-source deltas to
  skip and spare)
- **Blocks:** none

## Goal

CTRL-Z grows from M2.5's single-action undo into the full
undoable-unit algorithm: head-selection that steps over
`periodic_classifier` groups, prose-turn undo as a positional
suffix reversal from the turn's start (carrying piggyback deltas
and lagging classifier deltas anchored to the undone turn, sparing
facts anchored to surviving turns), group reversal for non-prose
actions, and the redo stack over the batched units.

## Background

M2.5 shipped CTRL-Z as "reverse the most recent action group" —
correct while every delta was foreground. The classifier breaks
both halves: its groups sit at the log head but are never undo
targets, and its lagging facts about old turns commit at new tail
positions, so a bare suffix sweep would over-reverse them. The
canonical algorithm selects the most recent undoable unit skipping
classifier groups, then reverses either the positional suffix from
a prose turn's first `log_position` (filtered by the survival-
anchor predicate, live since M2.2 and exercised since 3.3) or just
the `action_id` group otherwise. The sweep itself — barrier drain,
`reversalInProgress` bracket, watermark clamp — is C3; this slice
is the selection logic, the redo semantics over batched units, and
the reader keybinding behavior.

## Required reading

- [`data-model.md → Entry mutability & rollback`](../../../../data-model.md#entry-mutability--rollback)
  — action boundaries, the three-step CTRL-Z algorithm, redo-stack
  semantics.
- [`data-model.md → Survival anchor`](../../../../data-model.md#survival-anchor)
  — the predicate, the clamp, and the redo re-derive tolerance
  ("redo does not restore `processedThrough`").
- [`classifier.md → Background-task framing`](../../../../memory/classifier.md#background-task-framing)
  — why classifier `action_id`s are never undo targets.
- [`generation-pipeline.md → Prose reversals and the classifier barrier`](../../../../generation-pipeline.md#prose-reversals-and-the-classifier-barrier)
  — the bracket this slice's reversals must run inside (via C3).

## Scope: in

- **Target selection:** walk back from the head to the most recent
  undoable unit (user turn, user edit, chapter close later),
  skipping `source = periodic_classifier` groups.
- **Prose-turn reversal:** detect "group creates a `story_entries`
  row"; reverse the positional suffix from the turn's first
  `log_position` through the C3 sweep (predicate-filtered, drained,
  clamped) — the M2.5 single-group path for prose turns is
  superseded.
- **Group reversal:** non-prose units reverse their `action_id`
  group only; classifier deltas above them stay put.
- **Redo:** reversed deltas move to the in-memory redo stack as one
  unit; redo re-applies the unit; the stack clears on any new
  action; no `processedThrough` restore on redo (accepted
  re-derive, cleaned at M5 chapter-close dedup).
- **Reader integration:** keybinding + any toast copy unchanged in
  surface; disabled states while a reversal or pipeline gate is
  active follow the existing edit-restrictions rules.

## Scope: out

- The sweep internals (barrier, clamp, prune) — C3, owned by
  [Slice 3.3](./03-classifier.md).
- Regenerate — [Slice 3.10](./10-regenerate.md) (same sweep,
  different trigger + re-dispatch).
- Chapter-close as an undoable unit — the algorithm handles
  "otherwise" groups generically; the first real chapter-close
  group arrives in M5.2 (its atomic-unit test lands there).
- Deep rollback surface (multi-chapter reverse-replay UI) — M5.5.
- Rollback-to-entry (per-entry delete) — shipped in M2.2; unchanged
  here beyond riding the C3 sweep.

## Acceptance criteria

- Fixture log: user turn A, classifier pass anchored to A, user
  turn B, classifier pass with facts anchored to both A and B.
  CTRL-Z once: B's entry, its piggyback deltas, and classifier
  facts anchored to B reverse; facts anchored to A survive;
  `processedThrough` clamps below B; redo restores the unit
  (vitest — the load-bearing scenario).
- A classifier group at the literal head is stepped over: CTRL-Z
  targets the user turn beneath it and the suffix sweep carries the
  classifier group down with it (vitest).
- A user field-edit above a classifier group reverses alone
  (group path); the classifier group stays (vitest).
- CTRL-Z fired while a classifier run is mid-flight drains it via
  the C3 bracket before sweeping (vitest with the controllable
  stub; the interleaving matrix itself is 3.3's suite).
- Redo of a classifier-processed turn may re-derive that turn's
  facts (asserted as tolerated: no crash, no duplicate-key
  violation — awareness UNIQUE upsert absorbs).
- Undo in a fresh wizard-created story remains a no-op; undo floor
  stops at the opening (M2 behavior preserved, re-asserted).

## Tests

- Vitest: the fixture-log matrix above, selection walk edge cases
  (empty log, all-classifier head run, consecutive prose turns),
  redo-stack unit semantics.
- No Storybook scope (no new compounds); manual smoke on desktop
  keybinding + Android (if a UI undo affordance exists per M2.5's
  surface, exercise it).

## Open questions

- **Redo-stack shape for suffix units** — M2.5's stack stores
  single groups; batched units need ordered multi-group frames.
  Confirm the frame shape at planning (runtime-only, no schema).

## Implementation notes

_Populated at finish: notable deviations from the plan and resolved developer decisions._
